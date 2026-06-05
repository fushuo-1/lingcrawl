import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { executeSearch } from "../../search/execute";
import { logger } from "../../lib/logger";
import { v7 as uuidv7 } from "uuid";

export function registerSearchTool(server: McpServer) {
  server.tool(
    "search",
    "Search the web using a meta search engine. Returns search results with titles, URLs, and snippets.",
    {
      query: z.string().describe("The search query"),
      limit: z
        .number()
        .min(1)
        .max(20)
        .default(5)
        .describe("Number of results to return (1-20)"),
    },
    async ({ query, limit }) => {
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
        if (!results?.web?.length) {
          return {
            content: [{ type: "text" as const, text: `No results found for: "${query}"` }],
          };
        }

        const text = results.web
          .map(
            (r: any, i: number) =>
              `${i + 1}. **${r.title}**\n   ${r.url}\n   ${r.description || ""}`,
          )
          .join("\n\n");

        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message || String(e)}` }],
        };
      }
    },
  );
}
