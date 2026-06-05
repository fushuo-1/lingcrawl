import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scrapeRequestSchema } from "../../controllers/types";
import { buildSyncScrapeJob } from "../../services/job-factory";
import { processJobInternal } from "../../services/worker/scrape-worker";

export function registerScrapeTool(server: McpServer) {
  server.tool(
    "scrape",
    "Scrape a single web page and return its content. Supports HTML pages, PDFs, and dynamically rendered JavaScript pages.",
    {
      url: z.string().url().describe("The URL to scrape"),
      formats: z
        .array(z.enum(["markdown", "html", "screenshot", "links"]))
        .default(["markdown"])
        .describe("Output formats to return"),
      waitFor: z
        .number()
        .min(0)
        .max(60000)
        .optional()
        .describe("Time in ms to wait for JavaScript rendering (0-60000)"),
    },
    async ({ url, formats, waitFor }) => {
      try {
        const parsed = scrapeRequestSchema.parse({
          url,
          formats: formats.map(f => ({ type: f })),
          waitFor,
        });

        const job = buildSyncScrapeJob({
          url: parsed.url,
          scrapeOptions: { ...parsed },
          origin: "mcp",
          unnormalizedSourceURL: url,
        });

        const result = await processJobInternal(job as any);
        if (!result) {
          return {
            content: [{ type: "text" as const, text: "Error: Scrape returned no result. The page may be empty or unreachable." }],
          };
        }

        const parts: Array<{ type: "text"; text: string }> = [];
        if (result.markdown) parts.push({ type: "text", text: result.markdown });
        if (result.html) parts.push({ type: "text", text: result.html });
        if (result.metadata?.title) {
          parts.unshift({ type: "text", text: `# ${result.metadata.title}\n` });
        }

        if (parts.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Scrape succeeded but no content was extracted." }],
          };
        }

        return { content: parts };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message || String(e)}` }],
        };
      }
    },
  );
}
