/**
 * `lingcrawl session` subcommands (issue #77 — CLI tool).
 *
 * Mirrors the design of `cli/memory.ts`: thin adapter over `SessionStore`,
 * returns string bodies, throws `CliError` for user-facing failures.
 *
 * - `list`  — most-recent N sessions, one line per session
 * - `show`  — full session body (metadata header + numbered exchanges)
 * - `search` — FTS5 keyword search over user + assistant messages
 */
import { Command } from "commander";
import { getDb } from "../db/client.js";
import { SessionStore } from "../session/store.js";
import { FtsQueryError } from "../session/errors.js";
import { CliError } from "./memory.js";

/** `lingcrawl session list [--limit N]` — most recent sessions, newest first.
 *  Default limit is 20 (matches the `SessionStore.search` default) so the
 *  CLI behaviour stays consistent with what a user has probably seen before. */
export async function listSessions(limit: number): Promise<string> {
  const store = new SessionStore(getDb());
  const sessions = store.listSessions(limit);
  if (sessions.length === 0) {
    return "No sessions logged yet.";
  }
  const lines: string[] = [
    `Showing ${sessions.length} most-recent ${sessions.length === 1 ? "session" : "sessions"}:`,
  ];
  for (const s of sessions) {
    const when = formatTs(s.startedAt);
    const client = s.clientName ? `, ${s.clientName}` : "";
    lines.push(`  ${s.id}  [${s.source}${client}]  started ${when}`);
  }
  return lines.join("\n");
}

/** `lingcrawl session show <id>` — full session + exchanges, ordered by
 *  `sequence ASC`. Matches the issue #77 example:
 *
 *      == Session s1 (cli, started 2026-06-08 14:23:01) ==
 *      [1] user:     how do I cache things?
 *          assistant: use redis
 *      [2] user:     what about TTL?
 *          assistant: redis TTL is set on the key
 */
export async function showSession(id: string): Promise<string> {
  const store = new SessionStore(getDb());
  const result = store.getSession(id);
  if (!result) {
    throw new CliError(`No session with id "${id}".`);
  }
  const { session, exchanges } = result;

  const lines: string[] = [];
  const meta: string[] = [session.source];
  if (session.clientName) meta.push(session.clientName);
  meta.push(`started ${formatTs(session.startedAt)}`);
  if (session.endedAt !== null) meta.push(`ended ${formatTs(session.endedAt)}`);
  lines.push(`== Session ${session.id} (${meta.join(", ")}) ==`);

  if (exchanges.length === 0) {
    lines.push("(no exchanges)");
    return lines.join("\n");
  }

  // Compute max sequence width for column alignment ([1] vs [100]).
  const seqWidth = String(exchanges.length).length;
  for (const ex of exchanges) {
    const seqLabel = `[${String(ex.sequence).padStart(seqWidth)}]`;
    lines.push(
      `${seqLabel} user:      ${indentBody(ex.userMessage, seqLabel.length + "user:     ".length)}`,
    );
    lines.push(
      `    assistant: ${indentBody(ex.assistantMessage, "    assistant: ".length)}`,
    );
  }
  return lines.join("\n");
}

/** Re-indent a multi-line body so the second-and-onward lines line up with
 *  the first line of the column. Trims trailing newlines so we don't print
 *  spurious blank lines. */
function indentBody(body: string, firstLineWidth: number): string {
  const trimmed = body.replace(/\s+$/, "");
  const lines = trimmed.split("\n");
  if (lines.length === 1) return lines[0];
  const pad = " ".repeat(firstLineWidth);
  return [lines[0], ...lines.slice(1).map((l) => pad + l)].join("\n");
}

/** `lingcrawl session search <query>` — FTS5 keyword search. Surfaces
 *  `FtsQueryError` as a CliError so the user gets a clean message instead
 *  of a raw SQLite stack trace. */
export async function searchSessions(query: string): Promise<string> {
  if (!query.trim()) {
    throw new CliError("Search query must not be empty.");
  }
  const store = new SessionStore(getDb());
  let hits;
  try {
    hits = store.search({ query, limit: 20 });
  } catch (err) {
    if (err instanceof FtsQueryError) {
      throw new CliError(
        `Invalid FTS5 query: ${err.sqliteMessage}\n` +
          `Tip: wrap phrases in double quotes, e.g. \`"${query}"\`.`,
      );
    }
    throw err;
  }

  if (hits.length === 0) {
    return `No exchanges match "${query}".`;
  }
  const lines: string[] = [
    `Found ${hits.length} ${hits.length === 1 ? "hit" : "hits"} for "${query}":`,
  ];
  for (const h of hits) {
    lines.push(
      `  [session ${h.sessionId} #${h.sequence}]  score=${h.score.toFixed(3)}`,
    );
    lines.push(`    user:      ${truncate(h.userMessage, 80)}`);
    lines.push(`    assistant: ${truncate(h.assistantMessage, 80)}`);
  }
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length <= max ? oneLine : oneLine.slice(0, max - 1) + "…";
}

function formatTs(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/* -------------------------------------------------------------------------- */
/*                              Commander wiring                              */
/* -------------------------------------------------------------------------- */

export function buildSessionCommand(): Command {
  const cmd = new Command("session").description(
    "Inspect and search conversation sessions.",
  );

  cmd
    .command("list")
    .description("List recent sessions (newest first).")
    .option(
      "-l, --limit <n>",
      "Maximum number of sessions to show",
      (v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 1) {
          throw new CliError(`Invalid --limit "${v}" — must be a positive integer.`);
        }
        return n;
      },
      20,
    )
    .action(async (opts: { limit: number }) => {
      process.stdout.write((await listSessions(opts.limit)) + "\n");
    });

  cmd
    .command("show")
    .description("Show a session's metadata and all exchanges.")
    .argument("<id>", "Session id")
    .action(async (id: string) => {
      process.stdout.write((await showSession(id)) + "\n");
    });

  cmd
    .command("search")
    .description("Full-text search across all session messages (FTS5).")
    .argument("<query>", "FTS5 query (wrap phrases in double quotes)")
    .action(async (query: string) => {
      process.stdout.write((await searchSessions(query)) + "\n");
    });

  return cmd;
}
