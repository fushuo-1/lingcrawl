/**
 * MCP tools: `user_get`, `user_update`.
 *
 * v0.1 simplification: `user_update` does a full-replace — it deletes every
 * existing `target='user'` row in the SQLite table and then `add`s the new
 * content. This sidesteps the substring-uniqueness constraint of
 * `MemoryStore.remove` (which is designed for surgical edits) and matches the
 * "I want to rewrite my profile" mental model that the PRD captures in user
 * story #11.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CapacityExceededError, SecurityScanError } from "../../memory/errors.js";
import type { MemoryStore } from "../../memory/types.js";

function errText(prefix: string, err: unknown): string {
  if (err instanceof CapacityExceededError) {
    return `Error: ${prefix}: ${err.message}`;
  }
  if (err instanceof SecurityScanError) {
    return `Error: ${prefix}: ${err.message}`;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return `Error: ${prefix}: ${msg}`;
}

export interface UserUpdateDeps {
  /** The MemoryStore used for get / add. */
  store: MemoryStore;
  /**
   * Atomic "delete all rows for a given target" hook. We accept it as a
   * callback (rather than importing the DB directly) so the MCP layer stays
   * decoupled from SQLite and tests can swap it out.
   */
  deleteAll: (target: "user") => void;
}

export function registerUserTools(
  server: McpServer,
  deps: UserUpdateDeps,
): void {
  const { store, deleteAll } = deps;

  server.tool(
    "user_get",
    "Read the current user profile. Returns all 'user' entries plus the current capacity usage (chars used / limit and percentage).",
    {},
    async () => {
      try {
        const [entries, usage] = await Promise.all([
          store.list("user"),
          store.getUsage("user"),
        ]);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  entries: entries.map((e) => ({
                    id: e.id,
                    content: e.content,
                    createdAt: e.createdAt,
                    updatedAt: e.updatedAt,
                  })),
                  usage,
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
            { type: "text" as const, text: `Error: user_get: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "user_update",
    "Replace the entire user profile atomically. Deletes all existing 'user' entries and persists the supplied content as a single new entry. Capacity and security checks apply to the new content.",
    {
      content: z
        .string()
        .min(1)
        .describe("The new full user profile content to persist."),
    },
    async ({ content }) => {
      try {
        // Step 1: clear out the existing user profile. We use a direct
        // DELETE rather than `store.remove` because the latter requires an
        // unambiguous substring match — a constraint that does not fit a
        // full-replace semantic.
        deleteAll("user");

        // Step 2: write the new content. Capacity / security errors land
        // here; we surface them as isError.
        const result = await store.add("user", content);
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
          content: [
            { type: "text" as const, text: errText("user_update", err) },
          ],
          isError: true,
        };
      }
    },
  );
}
