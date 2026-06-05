import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeSearch } from "../../search/execute";
import { logger } from "../../lib/logger";
import { v7 as uuidv7 } from "uuid";

export function registerSearchTool(server: McpServer) {
  server.tool(
    "search",
    "Search the web using a meta search engine. Returns structured search results with titles, URLs, snippets, source sites, and publish dates.",
    {
      query: z.string().describe("The search query"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(5)
        .describe("Number of results to return (1-20)"),
      searchEngine: z
        .string()
        .optional()
        .describe(
          "Preferred search engine: auto (default, intelligent routing), baidu, google, bing, duckduckgo, sogou, brave",
        ),
    },
    async ({ query, limit, searchEngine }) => {
      try {
        const jobId = uuidv7();
        const result = await executeSearch(
          { query, limit, sources: [{ type: "web" }], timeout: 60000 },
          {
            teamId: "mcp",
            origin: "mcp",
            apiKeyId: null,
            flags: null,
            requestId: jobId,
            bypassBilling: true,
            zeroDataRetention: false,
          },
          logger.child({ module: "mcp", tool: "search" }),
        );

        const results = result.response as any;
        const meta = results?.queryMeta;

        if (!results?.web?.length) {
          const metaLine = meta
            ? `\nQuery type: ${meta.queryType}, Language: ${meta.language}, Engines: ${meta.engines}`
            : "";
          return {
            content: [{ type: "text" as const, text: `No results found for: "${query}"${metaLine}` }],
          };
        }

        const lines: string[] = [];

        // Query intent section
        if (meta) {
          lines.push("## Search Intent");
          lines.push(`- Query type: ${meta.queryType}`);
          lines.push(`- Detected language: ${meta.language}`);
          lines.push(`- Engines used: ${meta.engines}`);
          if (meta.timeRange) {
            lines.push(`- Time range: ${meta.timeRange}`);
          }
          lines.push("");
        }

        // Results section
        lines.push("## Search Results");
        lines.push("");

        results.web.forEach((r: any, i: number) => {
          lines.push(`### ${i + 1}. ${r.title}`);
          if (r.source) {
            lines.push(`- **Source**: ${r.source}`);
          }
          if (r.publishedDate) {
            lines.push(`- **Published**: ${r.publishedDate}`);
          }
          lines.push(`- **URL**: ${r.url}`);
          if (r.description) {
            lines.push(r.description);
          }
          lines.push("");
        });

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message || String(e)}` }],
        };
      }
    },
  );
}
