/**
 * MCP tools: `memory_add`, `memory_replace`, `memory_remove`, `memory_search`.
 *
 * These are thin adapters over `MemoryStore` (issues #69 + #70) that translate
 * the store's structured errors into the MCP `isError: true` response shape.
 *
 * Behaviour contract (issue #75):
 *   - `memory_add` returns `{success, id, usage, noDuplicateAdded?}`.
 *     Capacity / security errors come back as `isError: true`; the agent can
 *     read the current entries out of the error text and decide.
 *   - `memory_replace` and `memory_remove` return the updated `usage` on
 *     success; 0 / 2+ substring matches return `isError: true`.
 *   - `memory_search` runs in-process substring filtering over the small
 *     (20-50 entry) store — FTS5 is reserved for sessions (issue #73).
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CapacityExceededError,
  SecurityScanError,
  SubstringMatchError,
} from "../../memory/errors.js";
import type { MemoryStore } from "../../memory/types.js";

const targetSchema = z.enum(["memory", "user"]);

function formatEntries(entries: { id: number; content: string }[]): string {
  return entries
    .map((e) => `  - [${e.id}] ${JSON.stringify(e.content)}`)
    .join("\n");
}

/**
 * Common error formatter — every tool catches its own throwables and funnels
 * them through this so the agent sees a consistent `Error: ...` line plus the
 * structured snapshot it needs to recover.
 */
function errText(prefix: string, err: unknown): string {
  if (err instanceof CapacityExceededError) {
    return [
      `Error: ${prefix}: ${err.message}`,
      `Current entries (${err.currentEntries.length}):`,
      formatEntries(err.currentEntries),
      `Usage: ${err.usage.used}/${err.usage.limit} chars (${err.usage.pct}%)`,
    ].join("\n");
  }
  if (err instanceof SecurityScanError) {
    return `Error: ${prefix}: ${err.message}` +
      (err.pattern ? ` (pattern: ${err.pattern})` : "");
  }
  if (err instanceof SubstringMatchError) {
    return `Error: ${prefix}: ${err.message}`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `Error: ${prefix}: ${msg}`;
}

export function registerMemoryTools(
  server: McpServer,
  store: MemoryStore,
): void {
  server.tool(
    "memory_add",
    "Add a fact to the agent's persistent memory or user profile. Returns the new entry id and current capacity usage. Duplicate content is silently skipped (returns noDuplicateAdded=true). Capacity overflow and prompt-injection patterns are rejected with isError=true so the agent can decide how to consolidate.",
    {
      target: targetSchema.describe(
        "Which memory store to write to: 'memory' (agent's notes) or 'user' (user profile).",
      ),
      content: z.string().min(1).describe("The fact to remember."),
    },
    async ({ target, content }) => {
      try {
        const result = await store.add(target, content);
        if (result.noDuplicateAdded) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: true,
                    id: result.id,
                    usage: result.usage,
                    noDuplicateAdded: true,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, id: result.id, usage: result.usage },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: errText("memory_add", err) }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "memory_replace",
    "Replace a single memory entry identified by an unambiguous substring of its content with new content. Requires exactly one match — 0 or 2+ matches return isError=true. Capacity and security checks are applied to the new content.",
    {
      target: targetSchema.describe(
        "Which memory store to operate on: 'memory' or 'user'.",
      ),
      old_text: z
        .string()
        .min(1)
        .describe(
          "A substring of the existing entry's content. Must match exactly one entry.",
        ),
      content: z
        .string()
        .min(1)
        .describe("The new content to replace it with."),
    },
    async ({ target, old_text, content }) => {
      try {
        const result = await store.replace(target, old_text, content);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  id: result.id,
                  usage: result.usage,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: errText("memory_replace", err) },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "memory_remove",
    "Remove a single memory entry identified by an unambiguous substring of its content. Requires exactly one match — 0 or 2+ matches return isError=true.",
    {
      target: targetSchema.describe(
        "Which memory store to operate on: 'memory' or 'user'.",
      ),
      old_text: z
        .string()
        .min(1)
        .describe(
          "A substring of the existing entry's content. Must match exactly one entry.",
        ),
    },
    async ({ target, old_text }) => {
      try {
        const result = await store.remove(target, old_text);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  removedId: result.removedId,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            { type: "text" as const, text: errText("memory_remove", err) },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "memory_search",
    "Search memory entries (memory or user) by case-insensitive substring match. Returns at most `limit` hits ordered by id. Each hit carries the entry's id, content, and a simple match-count score (higher = more occurrences of the query).",
    {
      query: z
        .string()
        .min(1)
        .describe("Substring to search for (case-insensitive)."),
      target: targetSchema
        .optional()
        .describe(
          "Optional target scope. If omitted, both 'memory' and 'user' are searched.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .default(20)
        .describe("Maximum number of hits to return (1-200, default 20)."),
    },
    async ({ query, target, limit }) => {
      try {
        const targets: Array<"memory" | "user"> = target
          ? [target]
          : ["memory", "user"];

        const lowerQuery = query.toLowerCase();
        const hits: Array<{
          id: number;
          target: "memory" | "user";
          content: string;
          score: number;
        }> = [];

        for (const t of targets) {
          const entries = await store.list(t);
          for (const e of entries) {
            const lowerContent = e.content.toLowerCase();
            if (!lowerContent.includes(lowerQuery)) continue;
            // Count non-overlapping occurrences — a simple but useful score.
            let score = 0;
            let idx = 0;
            while (true) {
              const found = lowerContent.indexOf(lowerQuery, idx);
              if (found === -1) break;
              score += 1;
              idx = found + lowerQuery.length;
            }
            hits.push({ id: e.id, target: t, content: e.content, score });
          }
        }

        // Sort by score DESC, then by id ASC (stable for ties).
        hits.sort((a, b) => b.score - a.score || a.id - b.id);
        const sliced = hits.slice(0, limit);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  query,
                  count: sliced.length,
                  hits: sliced,
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
            { type: "text" as const, text: `Error: memory_search: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
