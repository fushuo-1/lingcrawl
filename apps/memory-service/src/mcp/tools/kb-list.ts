/**
 * MCP tool: `kb_list` — thin adapter over KnowledgeStore.listNotes.
 *
 * Follows the same error-handling pattern as kb-read.ts and kb-search.ts.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeStore } from "../../kb/knowledge-store.js";

export function registerKbListTool(
  server: McpServer,
  store: KnowledgeStore,
): void {
  server.tool(
    "kb_list",
    "List knowledge base notes with optional filtering by path prefix, tags, and limit. Returns note metadata (path, title, tags, timestamps) sorted by most recently updated.",
    {
      path: z
        .string()
        .optional()
        .describe(
          "Optional path prefix filter. Only notes whose path starts with this value are returned.",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Optional list of tags to filter by. A note matches if it has ANY of the listed tags.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .default(50)
        .describe("Maximum number of notes to return (1-500, default 50)."),
    },
    async ({ path, tags, limit }) => {
      try {
        const notes = store.listNotes({
          pathPrefix: path,
          tags,
          limit,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  count: notes.length,
                  notes: notes.map((n) => ({
                    path: n.path,
                    title: n.title,
                    tags: n.tags,
                    createdAt: n.createdAt,
                    updatedAt: n.updatedAt,
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
            { type: "text" as const, text: `Error: kb_list: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
