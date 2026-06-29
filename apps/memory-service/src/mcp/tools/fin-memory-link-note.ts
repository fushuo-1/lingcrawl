/**
 * MCP tool: `fin_memory_link_note` — link/unlink a financial memory to a KB note (issue #100).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FinancialStore } from "../../financial/financial-store.js";

export function registerFinMemoryLinkNoteTool(
  server: McpServer,
  store: FinancialStore,
): void {
  server.tool(
    "fin_memory_link_note",
    "Link a financial memory to a knowledge-base note path, or unlink it by passing an empty note_path. " +
      "The note_path is stored as a weak reference and can be cleared automatically when the note is deleted.",
    {
      id: z
        .string()
        .uuid()
        .describe("UUID of the financial memory to link."),
      note_path: z
        .string()
        .optional()
        .describe(
          "Knowledge-base note path to link (e.g. '投资/AAPL.md'). " +
            "Omit or pass empty string to unlink.",
        ),
    },
    async ({ id, note_path: notePath }) => {
      try {
        const memory = store.linkNote(id, notePath || null);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, memory }, null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: fin_memory_link_note: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
