import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scrapeRequestSchema } from "../../controllers/types";
import { buildSyncScrapeJob } from "../../services/job-factory";
import { processJobInternal } from "../../services/worker/scrape-worker";

export function registerReadPdfTool(server: McpServer) {
  server.tool(
    "read_pdf",
    "Read and extract text content from a local PDF file on the server. Supports page ranges, table extraction, and OCR mode for scanned documents.",
    {
      path: z.string().describe("Absolute path to the PDF file on the server"),
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
    async ({ path, pages, includeTables, includeImages, mode }) => {
      try {
        // Convert local path to file:// URL
        const normalizedPath = path.replace(/\\/g, "/");
        const fileUrl = normalizedPath.startsWith("/")
          ? `file://${normalizedPath}`
          : `file:///${normalizedPath}`;

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
            content: [{ type: "text" as const, text: `Error: File not found: ${path}. Check that the path is correct and the file exists.` }],
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
      }
    },
  );
}
