import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { mapRequestSchema } from "../../controllers/types";
import { getMapResults } from "../../lib/map-utils";

export function registerMapTool(server: McpServer) {
  server.tool(
    "map",
    "Discover all URLs on a website. Returns a list of page URLs found on the site without scraping their content.",
    {
      url: z.string().url().describe("The website URL to map"),
      limit: z
        .number()
        .min(1)
        .max(500)
        .default(100)
        .describe("Maximum number of URLs to return (1-500)"),
    },
    async ({ url, limit }) => {
      try {
        const parsed = mapRequestSchema.parse({ url, limit });

        const result = await getMapResults({
          url: parsed.url,
          limit: parsed.limit,
          teamId: "mcp",
          origin: "mcp",
          flags: null,
        });

        if (!result.mapResults?.length) {
          return {
            content: [{ type: "text" as const, text: `No URLs found for: ${url}` }],
          };
        }

        const text = `Found ${result.mapResults.length} URLs:\n\n${result.mapResults.join("\n")}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        return {
          content: [{ type: "text" as const, text: `Error: ${e.message || String(e)}` }],
        };
      }
    },
  );
}
