import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { scrapeRequestSchema } from "../../controllers/types";
import { buildSyncScrapeJob } from "../../services/job-factory";
import { processJobInternal } from "../../services/worker/scrape-worker";

export function registerExtractTool(server: McpServer) {
  server.tool(
    "extract",
    "Extract full text content from one or more web URLs. Returns the text content of each page.",
    {
      urls: z
        .array(z.string().url())
        .min(1)
        .max(10)
        .describe("List of URLs to extract content from (max 10)"),
    },
    async ({ urls }) => {
      try {
        const results: string[] = [];

        for (const url of urls) {
          try {
            const parsed = scrapeRequestSchema.parse({
              url,
              formats: [{ type: "markdown" }],
            });

            const job = buildSyncScrapeJob({
              url: parsed.url,
              scrapeOptions: { ...parsed },
              origin: "mcp",
              unnormalizedSourceURL: url,
            });

            const result = await processJobInternal(job as any);
            const content = result?.markdown || "(no content extracted)";
            results.push(`## ${url}\n\n${content}`);
          } catch (e: any) {
            results.push(`## ${url}\n\nError: ${e.message || String(e)}`);
          }
        }

        const text = results.join("\n\n---\n\n");
        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message || String(e)}` }],
        };
      }
    },
  );
}
