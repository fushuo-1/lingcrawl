/**
 * MCP tools: `session_log`, `session_search`.
 *
 * `session_log` is fed by AI agents that have just finished a user/assistant
 * turn. The `clientName` is captured automatically from the MCP `initialize`
 * handshake (user story #22) via a `setRequestHandler(InitializeRequestSchema,
 * …)` override installed by the server factory in `server.ts`. If the client
 * never sent an `initialize` (shouldn't happen with a spec-compliant client
 * but defensive), we fall back to `null`.
 *
 * `session_search` delegates straight to `SessionStore.search` (FTS5 over
 * `exchanges` user + assistant messages). The result shape mirrors the store
 * so the agent can read `hit.context` directly when `include_context=true`.
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FtsQueryError } from "../../session/errors.js";
import type { SessionStore } from "../../session/store.js";

export interface SessionLogDeps {
  store: SessionStore;
  /** Live snapshot of `clientInfo.name` from the most recent `initialize`. */
  getClientName: () => string | null;
}

export function registerSessionTools(
  server: McpServer,
  deps: SessionLogDeps,
): void {
  const { store, getClientName } = deps;

  server.tool(
    "session_log",
    "Persist one user→assistant exchange to the conversation history. The first call for a given session_id creates the session row automatically. The clientName is captured from the MCP client's `initialize.clientInfo.name` — you do not need to pass it.",
    {
      session_id: z
        .string()
        .min(1)
        .describe("Stable id for the conversation session."),
      user_message: z.string().min(1).describe("The user's message."),
      assistant_message: z
        .string()
        .min(1)
        .describe("The assistant's reply."),
      metadata: z
        .record(z.string(), z.unknown())
        .optional()
        .describe(
          "Optional free-form metadata (model, project, etc.) persisted on the session row.",
        ),
    },
    async ({ session_id, user_message, assistant_message, metadata }) => {
      try {
        const result = store.logExchange({
          sessionId: session_id,
          userMessage: user_message,
          assistantMessage: assistant_message,
          source: "mcp",
          clientName: getClientName() ?? undefined,
          metadata,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  exchangeId: result.exchangeId,
                  sessionId: result.sessionId,
                  sequence: result.sequence,
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
            { type: "text" as const, text: `Error: session_log: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "session_search",
    "Full-text search over the conversation history (user + assistant messages). Uses SQLite FTS5. Optionally includes the exchange that came before and after each hit (within the same session) so the LLM can reconstruct context.",
    {
      query: z
        .string()
        .min(1)
        .describe("FTS5 keyword query (e.g. 'redis OR cache')."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .default(20)
        .describe("Maximum number of hits to return (1-100, default 20)."),
      include_context: z
        .boolean()
        .default(false)
        .describe(
          "When true, each hit carries `context.prev` and `context.next` exchanges (null on session boundaries).",
        ),
    },
    async ({ query, limit, include_context }) => {
      try {
        const hits = store.search({ query, limit, includeContext: include_context });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, query, count: hits.length, hits },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        // FTS5 syntax errors are common when an agent passes stray operators
        // or unbalanced quotes; surface them with the original query and
        // message so the agent can self-correct.
        if (err instanceof FtsQueryError) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Error: session_search: ${err.message} ` +
                  `(hint: use simple keywords or quote phrases, e.g. 'foo bar')`,
              },
            ],
            isError: true,
          };
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: session_search: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}
