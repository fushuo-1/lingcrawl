/**
 * MCP tool: `fin_memory_search` — search financial memories (issue #99).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FinancialStore } from "../../financial/financial-store.js";

export function registerFinMemorySearchTool(
  server: McpServer,
  store: FinancialStore,
): void {
  server.tool(
    "fin_memory_search",
    "Search financial memories with filtering and sorting. " +
      "Supports filtering by entity_type, ticker, market, direction, and tags. " +
      "Free-text query searches ticker, thesis, title, and name fields.",
    {
      entity_types: z
        .array(z.enum(["opinion", "strategy", "position", "lesson"]))
        .optional()
        .describe("Filter by entity types."),
      ticker: z
        .string()
        .optional()
        .describe("Filter by exact ticker match."),
      market: z
        .string()
        .optional()
        .describe("Filter by market."),
      direction: z
        .enum(["bullish", "bearish", "neutral"])
        .optional()
        .describe("Filter by direction."),
      tags: z
        .array(z.string())
        .optional()
        .describe("Filter by tags (matches ANY)."),
      query: z
        .string()
        .optional()
        .describe("Free-text search across ticker, thesis, title, and name."),
      sort_by: z
        .enum(["updated_desc", "created_desc", "relevance"])
        .default("updated_desc")
        .describe("Sort order. Use 'relevance' for composite scoring."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum results to return."),
      offset: z
        .number()
        .int()
        .min(0)
        .default(0)
        .describe("Offset for pagination."),
    },
    async (args) => {
      try {
        const result = store.search(
          {
            entityTypes: args.entity_types,
            ticker: args.ticker,
            market: args.market,
            direction: args.direction,
            tags: args.tags,
            query: args.query,
          },
          {
            sortBy: args.sort_by,
            limit: args.limit,
            offset: args.offset,
          },
        );

        const response: Record<string, unknown> = {
          success: true,
          total: result.total,
          count: result.count,
          memories: result.memories,
        };
        if (result.relevanceScores) {
          response.relevance_scores = result.relevanceScores;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(response, null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: fin_memory_search: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
