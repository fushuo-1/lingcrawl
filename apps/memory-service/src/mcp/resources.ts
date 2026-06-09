/**
 * MCP resources for the memory service — issue #76.
 *
 * Exposes two frozen-snapshot resources that the LLM host reads at
 * session start to seed its long-term context:
 *
 *   - `memory://notes` — the agent's personal notes (target='memory'),
 *     rendered as markdown with capacity bar and section grouping.
 *   - `memory://user`  — the user profile (target='user'),
 *     rendered as markdown.
 *
 * The `takenAt` timestamp reflects the moment of read, not the moment
 * of store mutation — clients that cache the resource (Claude Desktop,
 * Cursor, Codex) get a stable view for the duration of one session
 * because the LLM host's caching policy keys off `resources/read`
 * call timing, not file mtime.
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { renderNotes, renderUserProfile } from "../memory/snapshot.js";
import type { MemoryStore } from "../memory/types.js";

export interface RegisterMemoryResourcesDeps {
  store: MemoryStore;
  /**
   * Clock function. Tests can inject a fixed timestamp; production uses
   * `() => new Date()`.
   */
  now?: () => Date;
}

export function registerMemoryResources(
  server: McpServer,
  deps: RegisterMemoryResourcesDeps,
): void {
  const now = deps.now ?? (() => new Date());

  // Register a resource template so clients can request
  // `memory://notes` and `memory://user` separately. Each read calls
  // the matching `render*` function and returns a frozen snapshot.
  server.resource(
    "memory-notes",
    new ResourceTemplate("memory://notes", { list: undefined }),
    {
      description:
        "The agent's personal notes (MEMORY.md equivalent). Frozen snapshot of " +
        "the 'memory' target at the moment of read — used by the LLM host to " +
        "seed long-term context at session start.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const [entries, usage] = await Promise.all([
        deps.store.list("memory"),
        deps.store.getUsage("memory"),
      ]);
      const text = renderNotes(entries, usage, formatTimestamp(now()));
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
    "memory-user",
    new ResourceTemplate("memory://user", { list: undefined }),
    {
      description:
        "The user profile (USER.md equivalent). Frozen snapshot of the 'user' " +
        "target at the moment of read — used by the LLM host to seed the user " +
        "preferences in its context at session start.",
      mimeType: "text/markdown",
    },
    async (uri) => {
      const [entries, usage] = await Promise.all([
        deps.store.list("user"),
        deps.store.getUsage("user"),
      ]);
      const text = renderUserProfile(entries, usage, formatTimestamp(now()));
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

/** "2026-06-08 14:23:01" style — matches the SnapshotRenderer test fixtures. */
function formatTimestamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  );
}
