import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scrapeRequestSchema } from "../../controllers/types";
import { buildSyncScrapeJob } from "../../services/job-factory";
import { processJobInternal } from "../../services/worker/scrape-worker";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const UPLOAD_DIR = "/tmp/pdf-upload";
const MAX_PDF_SIZE_BYTES = 500 * 1024 * 1024; // 500MB
const MAX_CONCURRENT_UPLOADS = 3;

// Simple counting semaphore to bound concurrent uploads
let activeUploads = 0;
const uploadQueue: Array<() => void> = [];

async function acquireUploadSlot(): Promise<void> {
  if (activeUploads < MAX_CONCURRENT_UPLOADS) {
    activeUploads++;
    return;
  }
  return new Promise<void>((resolve) => {
    uploadQueue.push(() => {
      activeUploads++;
      resolve();
    });
  });
}

function releaseUploadSlot(): void {
  activeUploads--;
  const next = uploadQueue.shift();
  if (next) next();
}

export function registerUploadPdfTool(server: McpServer) {
  server.tool(
    "upload_pdf",
    "Upload and extract text from a PDF file. " +
      "Parameters: 'content' accepts base64-encoded PDF data; 'path' is a server-side file path hint. " +
      "When a user provides a file path, you (the AI Agent) MUST: 1) read the file, 2) encode it to base64, " +
      "3) pass the base64 string via the 'content' parameter. Do NOT pass user-provided local paths to 'path'. " +
      "The 'path' parameter only works for files already accessible on the server filesystem. " +
      "Path formats: absolute paths (e.g. '/data/report.pdf') and relative paths (resolved from the client's working directory) are both supported. " +
      "Supports page ranges, table extraction, and OCR mode. Max file size: 500MB.",
    {
      content: z
        .string()
        .optional()
        .describe("Base64-encoded PDF file content. Use this when the user provides a local file path: read the file, encode to base64, and pass here."),
      path: z
        .string()
        .optional()
        .describe("Path to a PDF file on the server filesystem. Accepts absolute paths (e.g. '/data/doc.pdf') and relative paths (resolved from the client's working directory). Only use this for files already on the server; for local files, use 'content' with base64 instead."),
      pages: z
        .string()
        .optional()
        .describe("Page range to extract (e.g. '1-5', '3,7,12-20')"),
      includeTables: z
        .boolean()
        .default(false)
        .describe("Whether to detect and extract tables"),
      includeImages: z
        .boolean()
        .default(false)
        .describe("Whether to extract images"),
      mode: z
        .enum(["fast", "auto", "ocr"])
        .default("auto")
        .describe("Parsing mode: 'fast' for text-only, 'auto' for smart detection, 'ocr' for scanned PDFs"),
    },
    async ({ content, path, pages, includeTables, includeImages, mode }) => {
      let tmpPath: string | undefined;

      try {
        // Validate: exactly one of content or path
        if (!content && !path) {
          return {
            content: [{ type: "text" as const, text: "Error: Provide either 'content' (base64) or 'path' (server file path)." }],
          };
        }
        if (content && path) {
          return {
            content: [{ type: "text" as const, text: "Error: Provide only one of 'content' or 'path', not both." }],
          };
        }

        let fileUrl: string;

        if (content) {
          // Base64 upload path
          const buffer = Buffer.from(content, "base64");

          // Size check on decoded buffer
          if (buffer.length > MAX_PDF_SIZE_BYTES) {
            return {
              content: [{ type: "text" as const, text: `Error: PDF size (${(buffer.length / 1024 / 1024).toFixed(1)}MB) exceeds the 500MB limit.` }],
            };
          }

          // PDF magic bytes check (%PDF)
          if (buffer.length < 4 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
            return {
              content: [{ type: "text" as const, text: "Error: Content is not a valid PDF file (missing %PDF header)." }],
            };
          }

          // Acquire semaphore before writing
          await acquireUploadSlot();

          // Write to tmpfs
          await mkdir(UPLOAD_DIR, { recursive: true });
          tmpPath = `${UPLOAD_DIR}/${randomUUID()}.pdf`;
          await writeFile(tmpPath, buffer);

          fileUrl = `file://${tmpPath}`;
        } else {
          // Local path fallback (same logic as read_pdf)
          const normalizedPath = path!.replace(/\\/g, "/");
          fileUrl = normalizedPath.startsWith("/")
            ? `file://${normalizedPath}`
            : `file:///${normalizedPath}`;
        }

        const parsed = scrapeRequestSchema.parse({
          url: fileUrl,
          formats: [{ type: "markdown" }],
          parsers: [
            {
              type: "pdf",
              ...(pages && { pages }),
              includeTables,
              includeImages,
              mode,
            },
          ],
        });

        const job = buildSyncScrapeJob({
          url: parsed.url,
          scrapeOptions: { ...parsed },
          origin: "mcp",
          unnormalizedSourceURL: fileUrl,
        });

        const result = await processJobInternal(job as any);
        if (!result) {
          return {
            content: [{ type: "text" as const, text: "Error: PDF extraction returned no result. The file may be empty or unreadable." }],
          };
        }

        const parts: Array<{ type: "text"; text: string }> = [];
        if (result.markdown) {
          parts.push({ type: "text", text: result.markdown });
        }

        if (parts.length === 0) {
          return {
            content: [{ type: "text" as const, text: "PDF processed but no text content was extracted. If this is a scanned document, try setting mode to 'ocr'." }],
          };
        }

        return { content: parts };
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("ENOENT") || msg.includes("no such file")) {
          return {
            content: [{ type: "text" as const, text: `Error: File not found. Check that the path is correct and the file exists.` }],
          };
        }
        if (msg.includes("OCR") || msg.includes("ocr") || msg.includes("scanned")) {
          return {
            content: [{ type: "text" as const, text: "This appears to be a scanned PDF. Try setting mode to 'ocr' for better results." }],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
        };
      } finally {
        // Always clean up tmpfs file and release semaphore
        if (tmpPath) {
          await unlink(tmpPath).catch(() => {});
          releaseUploadSlot();
        }
      }
    },
  );
}
