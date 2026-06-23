/**
 * MCP tool: `kb_sync` — synchronize the SQLite index with files on disk.
 *
 * Modes:
 *   - action="scan": scan without modifying — returns file paths that differ.
 *   - action="sync": full sync — adds/updates/removes to match disk.
 *   - With path: single-note check — reports whether the note is indexed,
 *     on disk, and whether the two are in sync.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeStore } from "../../kb/knowledge-store.js";

export function registerKbSyncTool(
  server: McpServer,
  store: KnowledgeStore,
): void {
  server.tool(
    "kb_sync",
    "Synchronize the SQLite index with the knowledge base files on disk. " +
      "Use this after manually adding, editing, or deleting .md files outside of kb_write. " +
      "action='scan' reports mismatches without changing anything. " +
      "action='sync' (default) actually updates the index.",
    {
      path: z
        .string()
        .optional()
        .describe(
          "Optional specific note path to check. " +
            "If omitted, scans or syncs all files.",
        ),
      action: z
        .enum(["scan", "sync"])
        .optional()
        .default("sync")
        .describe(
          "'scan' = read-only, report mismatches with file paths. " +
            "'sync' = actually update the index.",
        ),
    },
    async ({ path: notePath, action }) => {
      try {
        if (notePath) {
          const result = store.checkNoteSync(notePath);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ success: true, ...result }, null, 2),
              },
            ],
          };
        }

        const dryRun = action === "scan";
        const result = store.syncIndex(dryRun);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  action,
                  added: result.added,
                  updated: result.updated,
                  removed: result.removed,
                  total: result.added + result.updated + result.removed,
                  ...(dryRun && {
                    addedFiles: result.addedPaths,
                    removedFiles: result.removedPaths,
                  }),
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
            { type: "text" as const, text: `Error: kb_sync: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
