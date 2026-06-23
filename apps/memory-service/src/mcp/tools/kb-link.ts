/**
 * MCP tool: `kb_link` — query backlinks and broken links.
 *
 * Two actions:
 *   - `backlinks` + `path` → which notes link to the given note
 *   - `broken` → all [[target]] links where target note does not exist
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeStore } from "../../kb/knowledge-store.js";
import { NoteNotFoundError } from "../../kb/errors.js";

export function registerKbLinkTool(
  server: McpServer,
  store: KnowledgeStore,
): void {
  server.tool(
    "kb_link",
    "Query bidirectional links. Use action='backlinks' with a path to see which notes link to it. Use action='broken' to find all [[target]] links where the target note does not exist yet.",
    {
      action: z
        .enum(["backlinks", "broken"])
        .describe("The link query to run."),
      path: z
        .string()
        .optional()
        .describe(
          'Note path (required for action="backlinks"), e.g. "FPGA/I2C/I2C Slave FPGA 调试记录.md".',
        ),
    },
    async ({ action, path: notePath }) => {
      try {
        if (action === "backlinks") {
          if (!notePath) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: kb_link: path is required for action='backlinks'",
                },
              ],
              isError: true,
            };
          }
          const links = store.getBacklinks(notePath);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  { success: true, action, path: notePath, count: links.length, links },
                  null,
                  2,
                ),
              },
            ],
          };
        }

        // action === "broken"
        const links = store.getBrokenLinks();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, action, count: links.length, links },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof NoteNotFoundError) {
          return {
            content: [
              { type: "text" as const, text: `Error: kb_link: ${err.message}` },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: kb_link: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
