import path from "node:path";
import { readFile } from "node:fs/promises";
import JSZip from "jszip";
import { config } from "../../../../config";
import { MinerUError } from "../../../../lib/error";
import type { ExtractedTable } from "./types";

// ── Public types ──────────────────────────────────────────────────────────────

export interface MinerUParseOptions {
  isOcr: boolean;
  pageRanges?: string;
}

export interface MinerUResult {
  markdown: string;
  tables: ExtractedTable[];
}

export interface ContentListItem {
  type: string;
  text?: string;
  table_body?: string;
  img_path?: string;
  [key: string]: unknown;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function parseWithMinerU(
  filePath: string,
  options: MinerUParseOptions,
): Promise<MinerUResult> {
  const {
    MINERU_API_TOKEN,
    MINERU_API_URL,
    MINERU_OCR_ENABLED,
    MINERU_OCR_TIMEOUT,
    MINERU_MODEL_VERSION,
    MINERU_LANGUAGE,
  } = config;

  if (!MINERU_OCR_ENABLED) {
    throw new MinerUError(
      "MINERU_DISABLED",
      "MinerU OCR processing is disabled. Set MINERU_OCR_ENABLED=true to enable it.",
    );
  }

  if (!MINERU_API_TOKEN) {
    throw new MinerUError(
      "MINERU_TOKEN_MISSING",
      "MinerU API token is not configured. Set MINERU_API_TOKEN in your environment variables.",
    );
  }

  const authHeader = {
    Authorization: `Bearer ${MINERU_API_TOKEN}`,
    "Content-Type": "application/json",
  };

  // 1. Request signed upload URL
  // Ensure filename ends with .pdf (temp files may have .pdf.tmp.xxx extension)
  const baseName = path.basename(filePath);
  const fileName = baseName.endsWith(".pdf") ? baseName : baseName.replace(/\.tmp\..*$/, "") || "document.pdf";
  const fileEntry: Record<string, unknown> = {
    name: fileName,
  };
  if (options.pageRanges) {
    fileEntry.page_ranges = options.pageRanges;
  }

  const submitBody = {
    files: [fileEntry],
    model_version: MINERU_MODEL_VERSION,
    is_ocr: options.isOcr,
    enable_table: true,
    enable_formula: true,
    language: MINERU_LANGUAGE,
  };

  const submitRes = await fetch(`${MINERU_API_URL}/file-urls/batch`, {
    method: "POST",
    headers: authHeader,
    body: JSON.stringify(submitBody),
  });

  if (!submitRes.ok) {
    const body = await submitRes.text().catch(() => "");
    throw new MinerUError(
      "MINERU_OCR_FAILED",
      `MinerU submit failed (${submitRes.status}): ${body}`,
    );
  }

  const submitData = (await submitRes.json()) as {
    code: number;
    msg?: string;
    data: { batch_id: string; file_urls: string[] };
  };

  console.log("[MINERU] submit response:", JSON.stringify(submitData));

  if (submitData.code !== 0 || !submitData.data) {
    throw new MinerUError(
      "MINERU_OCR_FAILED",
      `MinerU submit error (code=${submitData.code}): ${submitData.msg || "unknown"}`,
    );
  }

  const { batch_id, file_urls } = submitData.data;

  // 2. Upload file to signed URL
  const fileBuffer = await readFile(filePath);
  const uploadRes = await fetch(file_urls[0], {
    method: "PUT",
    body: fileBuffer,
  });

  if (!uploadRes.ok) {
    throw new MinerUError(
      "MINERU_OCR_FAILED",
      `MinerU file upload failed (${uploadRes.status})`,
    );
  }

  // 3. Poll for results
  const fullZipUrl = await pollForResults(
    MINERU_API_URL,
    authHeader,
    batch_id,
    MINERU_OCR_TIMEOUT,
  );

  // 4. Download and extract zip
  const zipRes = await fetch(fullZipUrl);
  if (!zipRes.ok) {
    throw new MinerUError(
      "MINERU_OCR_FAILED",
      `Failed to download MinerU result zip (${zipRes.status})`,
    );
  }

  const zipBuffer = Buffer.from(await zipRes.arrayBuffer());
  const zip = await JSZip.loadAsync(zipBuffer);

  // 5. Extract full.md
  let markdown = "";
  const tables: ExtractedTable[] = [];

  const mdFile = zip.file(/full\.md$/i)[0];
  if (mdFile) {
    markdown = await mdFile.async("text");
  }

  // 6. Extract content_list JSON
  const contentListFiles = zip.file(/_content_list\.json$/i);
  if (contentListFiles.length > 0) {
    const raw = await contentListFiles[0].async("text");
    const contentList: ContentListItem[] = JSON.parse(raw);
    tables.push(...mapContentListToTables(contentList));
  }

  return { markdown, tables };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function pollForResults(
  apiUrl: string,
  headers: Record<string, string>,
  batchId: string,
  timeout: number,
): Promise<string> {
  const deadline = Date.now() + timeout;
  const pollInterval = 3000;

  while (Date.now() < deadline) {
    const res = await fetch(`${apiUrl}/extract-results/batch/${batchId}`, {
      headers,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new MinerUError(
        "MINERU_OCR_FAILED",
        `MinerU poll failed (${res.status}): ${body}`,
      );
    }

    const data = (await res.json()) as {
      code: number;
      data: {
        extract_result: Array<{
          state: string;
          full_zip_url?: string;
          err_msg?: string;
        }>;
      };
    };

    const result = data.data.extract_result[0];
    if (!result) {
      throw new MinerUError(
        "MINERU_OCR_FAILED",
        "MinerU returned empty extract_result",
      );
    }

    switch (result.state) {
      case "done":
        if (!result.full_zip_url) {
          throw new MinerUError(
            "MINERU_OCR_FAILED",
            "MinerU done but no full_zip_url",
          );
        }
        return result.full_zip_url;

      case "failed":
        throw new MinerUError(
          "MINERU_OCR_FAILED",
          `MinerU extraction failed: ${result.err_msg ?? "unknown error"}`,
        );

      // waiting-file, pending, running, converting — keep polling
      default:
        break;
    }

    await new Promise((r) => setTimeout(r, pollInterval));
  }

  throw new MinerUError(
    "MINERU_OCR_FAILED",
    `MinerU polling timed out after ${timeout}ms`,
  );
}

export function mapContentListToTables(
  contentList: ContentListItem[],
): ExtractedTable[] {
  const tables: ExtractedTable[] = [];
  let tableIndex = 0;

  for (const item of contentList) {
    if (item.type !== "table") continue;
    if (!item.table_body) continue;

    const parsed = parseHtmlTable(item.table_body);
    tables.push({
      page: 0,
      tableIndex: tableIndex++,
      rows: parsed.rows,
      rowCount: parsed.rows.length,
      colCount: parsed.colCount,
      confidence: 1.0,
    });
  }

  return tables;
}

function parseHtmlTable(html: string): {
  rows: string[][];
  colCount: number;
} {
  const rows: string[][] = [];
  let colCount = 0;

  // Simple regex-based HTML table parser — avoids pulling in cheerio for this
  // narrow use-case.
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch: RegExpExecArray | null;

  while ((rowMatch = rowRegex.exec(html)) !== null) {
    const cells: string[] = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch: RegExpExecArray | null;

    while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
      // Strip inner HTML tags, keep text content
      cells.push(cellMatch[1].replace(/<[^>]+>/g, "").trim());
    }

    if (cells.length > colCount) colCount = cells.length;
    rows.push(cells);
  }

  return { rows, colCount };
}
