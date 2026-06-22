/**
 * MCP tool: `kb_read` — thin adapter over KnowledgeStore.readNote.
 *
 * Follows the same error-handling pattern as kb-write.ts and kb-search.ts.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeStore } from "../../kb/knowledge-store.js";
import { NoteNotFoundError } from "../../kb/errors.js";

export function registerKbReadTool(
  server: McpServer,
  store: KnowledgeStore,
): void {
  server.tool(
    "kb_read",
    "Read a knowledge note by its path. Returns the full content including frontmatter and body.",
    {
      path: z
        .string()
        .min(1)
        .describe(
          'Relative path of the note, e.g. "调试经验/Docker/构建后磁盘膨胀.md"',
        ),
    },
    async ({ path }) => {
      try {
        const result = store.readNote(path);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  path,
                  frontmatter: result.frontmatter,
                  body: result.body,
                },
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
              {
                type: "text" as const,
                text: `Error: kb_read: ${err.message}`,
              },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            {
              type: "text" as const,
              text: `Error: kb_read: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
