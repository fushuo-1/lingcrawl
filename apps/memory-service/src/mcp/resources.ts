/**
 * MCP resources for the knowledge base — issue #97.
 *
 * Exposes two read-only resources that the LLM host reads at
 * session start to seed its context:
 *
 *   - `kb://recent` — the 20 most recently updated notes, rendered as a
 *     markdown table.
 *   - `kb://index` — the full directory tree of all notes, rendered as
 *     an indented outline.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { IndexStore } from "../kb/index-store.js";
import { renderRecent, renderIndex } from "../kb/snapshot-renderer.js";

export interface RegisterKbResourcesDeps {
  indexStore: IndexStore;
}

export function registerKbResources(
  server: McpServer,
  deps: RegisterKbResourcesDeps,
): void {
  server.resource(
    "kb-recent",
    "kb://recent",
    {
      description:
        "The 20 most recently updated knowledge-base notes, rendered as a " +
        "markdown table with path, title, tags, and updated date.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const notes = deps.indexStore.recentNotes(20);
      const text = renderRecent(notes);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    },
  );

  server.resource(
    "kb-index",
    "kb://index",
    {
      description:
        "The full directory tree of all knowledge-base notes, rendered as " +
        "an indented outline grouped by directory.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const notes = deps.indexStore.listNotes();
      const text = renderIndex(notes);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "text/markdown",
            text,
          },
        ],
      };
    },
  );
}
