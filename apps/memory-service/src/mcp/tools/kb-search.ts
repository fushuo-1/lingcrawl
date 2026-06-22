/**
 * MCP tool: `kb_search`.
 *
 * Thin adapter over `IndexStore.searchNotes` that exposes full-text search
 * over the knowledge base via the MCP protocol. Follows the same error
 * handling pattern as `memory.ts` and `session.ts`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IndexStore } from "../../kb/index-store.js";

export function registerKbSearchTool(
  server: McpServer,
  indexStore: IndexStore,
): void {
  server.tool(
    "kb_search",
    "Full-text search over the knowledge base notes (FTS5 + BM25 ranking). Returns matching notes with snippets, tags, and relevance scores. Supports optional filtering by tags and path prefix.",
    {
      query: z
        .string()
        .min(1)
        .describe("Search keywords (FTS5 query syntax, e.g. 'redis OR cache')."),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of tags to filter by. A note matches if it has ANY of the listed tags.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Optional path prefix filter. Only notes whose path starts with this value are returned.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of hits to return (1-100, default 20)."),
    },
    async ({ query, tags, path, limit }) => {
      try {
        const hits = indexStore.searchNotes(query, {
          tags,
          pathPrefix: path,
          limit,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  query,
                  count: hits.length,
                  hits: hits.map((h) => ({
                    path: h.path,
                    title: h.title,
                    tags: h.tags,
                    snippet: h.snippet,
                    score: h.score,
                  })),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: kb_search: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
