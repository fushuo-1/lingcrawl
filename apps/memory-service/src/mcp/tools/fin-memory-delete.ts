/**
 * MCP tool: `fin_memory_delete` — delete a financial memory by id (issue #100).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FinancialStore } from "../../financial/financial-store.js";

export function registerFinMemoryDeleteTool(
  server: McpServer,
  store: FinancialStore,
): void {
  server.tool(
    "fin_memory_delete",
    "Delete a financial memory by its UUID id. Returns success=true if the memory was deleted.",
    {
      id: z
        .string()
        .uuid()
        .describe("UUID of the financial memory to delete."),
    },
    async ({ id }) => {
      try {
        const deleted = store.delete(id);
        if (!deleted) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: fin_memory_delete: Financial memory not found: ${id}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, id }, null, 2),
            },
          ],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: fin_memory_delete: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
