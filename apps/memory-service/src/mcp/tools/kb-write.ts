/**
 * MCP tool: `kb_write` — thin adapter over KnowledgeStore.
 *
 * Follows the same error-handling pattern as memory.ts.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeStore } from "../../kb/knowledge-store.js";
import {
  EmptyContentError,
  NoteNotFoundError,
} from "../../kb/errors.js";

export function registerKbWriteTool(
  server: McpServer,
  store: KnowledgeStore,
): void {
  server.tool(
    "kb_write",
    "Write a note to the knowledge base. Parses frontmatter, resolves category from tags, extracts [[wikilinks]], and updates the search index. Returns the final path, title, and whether a new file was created.",
    {
      content: z
        .string()
        .min(1)
        .describe(
          "Full markdown content of the note. May include YAML frontmatter (tags, created, updated).",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Optional tags to override or supplement frontmatter tags. Used to determine the note's category directory.",
        ),
      path: z
        .string()
        .optional()
        .describe(
          "Optional explicit relative path (e.g. 'AI/MyNote.md'). If omitted, path is derived from title + tags.",
        ),
    },
    async ({ content, tags, path: notePath }) => {
      try {
        const result = store.writeNote({ content, tags, path: notePath });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  path: result.path,
                  title: result.title,
                  created: result.created,
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
            {
              type: "text" as const,
              text: `Error: kb_write: ${msg}`,
            },
          ],
          isError: true,
        };
      }
    },
  );
}
