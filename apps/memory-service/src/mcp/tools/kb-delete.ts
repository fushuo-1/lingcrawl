/**
 * MCP tool: `kb_delete` — delete a knowledge-base note (issue #102).
 *
 * Removes the Markdown file, the index entry, associated links, and clears
 * any financial memory note_path references.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeStore } from "../../kb/knowledge-store.js";

export function registerKbDeleteTool(
  server: McpServer,
  knowledgeStore: KnowledgeStore,
): void {
  server.tool(
    "kb_delete",
    "Delete a knowledge-base note by path. " +
      "Also clears any financial_memory note_path references linked to this note.",
    {
      path: z
        .string()
        .describe("Path of the note to delete (e.g. '投资/AAPL.md')."),
    },
    async ({ path }) => {
      try {
        const deleted = knowledgeStore.deleteNote(path);
        if (!deleted) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: kb_delete: Note not found: ${path}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, path }, null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: kb_delete: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
