/**
 * MCP tool: `fin_memory_read` — read a single financial memory by id (issue #99).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { FinancialStore } from "../../financial/financial-store.js";

export function registerFinMemoryReadTool(
  server: McpServer,
  store: FinancialStore,
): void {
  server.tool(
    "fin_memory_read",
    "Read a financial memory by its UUID id. Returns the full memory record.",
    {
      id: z
        .string()
        .uuid()
        .describe("UUID of the financial memory to read."),
    },
    async ({ id }) => {
      try {
        const memory = store.getById(id);
        if (!memory) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: fin_memory_read: Financial memory not found: ${id}`,
              },
            ],
            isError: true,
          };
        }

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
            { type: "text" as const, text: `Error: fin_memory_read: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
