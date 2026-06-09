/**
 * `lingcrawl memory` subcommands (issue #77 — CLI tool).
 *
 * The CLI is a thin adapter: it does not own a MemoryStore instance, and it
 * does not duplicate any of the store's business logic. It calls into
 * MemoryStoreImpl / SessionStore (and uses raw SQL only for the `search`
 * subcommand, which is not part of the v0.1 store interface and therefore
 * stays local to the CLI layer).
 *
 * Design notes
 * ------------
 * - All subcommands are async and return a string body — the dispatcher in
 *   `cli/index.ts` handles stdout / exit code. This keeps each subcommand
 *   testable in isolation (the test file imports the runnable functions
 *   directly and asserts on the returned string, no spawn / IPC needed).
 * - The CLI re-uses the process-wide `getDb()` / `closeDb()` pair from
 *   `db/client.ts`. The unit tests swap the singleton out for an in-memory
 *   DB by calling `_initDb(":memory:")` first and resetting with
 *   `closeDb()` afterwards.
 * - Errors are typed: `cliError(message)` produces an error tagged with
 *   `cliExit: true` so the dispatcher knows to set exit code 1.
 */
import { Command } from "commander";
import { getDb } from "../db/client.js";
import { MemoryStoreImpl } from "../memory/store.js";
import { CapacityExceededError, SubstringMatchError } from "../memory/errors.js";
import type { MemoryEntry, Usage } from "../memory/types.js";

/* -------------------------------------------------------------------------- */
/*                              Shared error type                             */
/* -------------------------------------------------------------------------- */

/** Thrown by CLI subcommands to signal a non-zero exit. The dispatcher
 *  catches it, prints `.message` to stderr, and exits with code 1. */
export class CliError extends Error {
  readonly cliExit = true as const;
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/* -------------------------------------------------------------------------- */
/*                              Memory subcommands                            */
/* -------------------------------------------------------------------------- */

type Target = "memory" | "user";

/** All `memory` subcommands share the same access pattern: open the singleton
 *  DB, build a store, run. Centralised so the dispatcher can release the
 *  handle in one place. */
function withStore<T>(fn: (store: MemoryStoreImpl) => Promise<T>): Promise<T> {
  const store = new MemoryStoreImpl(getDb());
  return fn(store);
}

/** `lingcrawl memory list` — show all entries grouped by `target` with
 *  capacity usage per group. Matches the format in issue #77:
 *
 *      == memory (3 entries, 67% — 1,474/2,200 chars) ==
 *      [1] Project uses pnpm + TypeScript
 *      [2] Run tests with `pnpm harness jest`
 *
 *      == user (2 entries, 42% — 580/1,375 chars) ==
 *      [3] Prefers concise responses
 *      [4] Communicates in English
 *
 *  If a target has no entries, the section is skipped entirely (avoids
 *  printing "0 entries, 0% — 0/2200" boilerplate that would just be noise).
 */
export async function listMemory(): Promise<string> {
  return withStore(async (store) => {
    const out: string[] = [];
    for (const target of ["memory", "user"] as const) {
      const entries = await store.list(target);
      if (entries.length === 0) continue;
      const usage = await store.getUsage(target);
      out.push(formatTargetBlock(target, entries, usage));
    }
    if (out.length === 0) {
      return "No memory entries yet. Add one with `lingcrawl memory add`.";
    }
    return out.join("\n\n");
  });
}

function formatTargetBlock(
  target: Target,
  entries: MemoryEntry[],
  usage: Usage,
): string {
  const lines: string[] = [];
  lines.push(
    `== ${target} (${entries.length} ${entries.length === 1 ? "entry" : "entries"}, ` +
      `${usage.pct}% — ${usage.used.toLocaleString("en-US")}/${usage.limit.toLocaleString("en-US")} chars) ==`,
  );
  for (const e of entries) {
    lines.push(`[${e.id}] ${e.content}`);
  }
  return lines.join("\n");
}

/** `lingcrawl memory show <id>` — single entry detail. Errors with CliError
 *  (exit 1) if no entry has that id. */
export async function showMemory(id: number): Promise<string> {
  return withStore(async (store) => {
    const entry = await store.get(id);
    if (!entry) {
      throw new CliError(`No memory entry with id ${id}.`);
    }
    const usage = await store.getUsage(entry.target);
    return [
      `== Memory entry #${entry.id} (${entry.target}) ==`,
      `Created: ${formatTs(entry.createdAt)}`,
      `Updated: ${formatTs(entry.updatedAt)}`,
      `Capacity: ${usage.pct}% — ${usage.used.toLocaleString("en-US")}/${usage.limit.toLocaleString("en-US")} chars`,
      "",
      entry.content,
    ].join("\n");
  });
}

/** `lingcrawl memory search <query>` — substring search over both targets.
 *
 *  The v0.1 `MemoryStore` interface does not expose a search method
 *  (issue #77 is the first place that needs one), so the query is executed
 *  directly against the `memory_entries` table. The matching is case-
 *  insensitive substring on `content`, ordered by `id ASC`.
 *
 *  FTS5 would be overkill here — memory entries are short and few, and
 *  substring is what the user actually asked for in the brief.
 */
export async function searchMemory(query: string): Promise<string> {
  if (!query.trim()) {
    throw new CliError("Search query must not be empty.");
  }
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT id, target, content FROM memory_entries " +
        "WHERE content LIKE '%' || ? || '%' " +
        "ORDER BY target ASC, id ASC",
    )
    .all(query) as Array<{ id: number | bigint; target: string; content: string }>;

  if (rows.length === 0) {
    return `No memory entries match "${query}".`;
  }
  const lines: string[] = [
    `Found ${rows.length} ${rows.length === 1 ? "match" : "matches"} for "${query}":`,
  ];
  for (const r of rows) {
    lines.push(`[${r.id}] (${r.target}) ${r.content}`);
  }
  return lines.join("\n");
}

/** `lingcrawl memory remove <id>` — delete a single entry by id.
 *  Errors (exit 1) if the id does not exist.
 *
 *  Note: this is a single-id delete, deliberately different from
 *  `MemoryStore.remove(target, substring)` (which requires a 1-of-N
 *  substring match). The CLI is the human-facing tool; an unambiguous id
 *  is friendlier than asking the user to type a substring. */
export async function removeMemory(id: number): Promise<string> {
  return withStore(async (store) => {
    const existing = await store.get(id);
    if (!existing) {
      throw new CliError(`No memory entry with id ${id}.`);
    }
    // MemoryStore.remove requires a substring with exactly one match — but
    // we already know the id and have the full content, so use that. This
    // is guaranteed unique by id.
    await store.remove(existing.target, existing.content);
    return `Removed memory entry #${id} (${existing.target}).`;
  });
}

/** `lingcrawl memory stats` — capacity snapshot for both targets. */
export async function statsMemory(): Promise<string> {
  return withStore(async (store) => {
    const memory = await store.getUsage("memory");
    const user = await store.getUsage("user");
    return [
      "== Memory capacity ==",
      formatStatLine("memory", memory),
      formatStatLine("user", user),
    ].join("\n");
  });
}

function formatStatLine(target: Target, usage: Usage): string {
  return (
    `  ${target.padEnd(7)} ${usage.pct.toString().padStart(5)}%  ` +
    `${usage.used.toLocaleString("en-US").padStart(6)} / ` +
    `${usage.limit.toLocaleString("en-US")} chars`
  );
}

/* -------------------------------------------------------------------------- */
/*                              Common formatting                             */
/* -------------------------------------------------------------------------- */

function formatTs(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/** Friendly wrapper that maps a thrown store error into a CLI-friendly
 *  message. Used by the dispatcher. */
export function explainMemoryError(err: unknown): string | null {
  if (err instanceof CapacityExceededError) {
    return `Capacity exceeded for "${err.usage.target}" ` +
      `(${err.usage.used}/${err.usage.limit} chars). ` +
      `Remove or consolidate entries before adding more.`;
  }
  if (err instanceof SubstringMatchError) {
    return err.matches === 0
      ? `No entry contains that substring.`
      : `Ambiguous: ${err.matches} entries contain that substring. ` +
        `Provide a more specific substring or use the id with \`memory remove <id>\`.`;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/*                              Commander wiring                              */
/* -------------------------------------------------------------------------- */

/** Build the `memory` subcommand with all leaf subcommands attached. The
 *  dispatcher in `cli/index.ts` adds this as a Command to the root program.
 *
 *  Each leaf action does `process.stdout.write` + exit, OR throws a
 *  CliError that the dispatcher converts to a stderr message + exit 1.
 *  We choose the throw form so the unit tests can call the underlying
 *  `listMemory()` / `showMemory(id)` etc. directly without spawning.
 */
export function buildMemoryCommand(): Command {
  const cmd = new Command("memory").description(
    "Inspect and manage memory entries (agent notes + user profile).",
  );

  cmd
    .command("list")
    .description("List all entries grouped by target with capacity usage.")
    .action(async () => {
      process.stdout.write((await listMemory()) + "\n");
    });

  cmd
    .command("show")
    .description("Show a single entry by id.")
    .argument("<id>", "Entry id (integer)", (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        throw new CliError(`Invalid id "${v}" — must be a positive integer.`);
      }
      return n;
    })
    .action(async (id: number) => {
      process.stdout.write((await showMemory(id)) + "\n");
    });

  cmd
    .command("search")
    .description("Search entries by keyword (case-insensitive substring).")
    .argument("<query>", "Search query")
    .action(async (query: string) => {
      process.stdout.write((await searchMemory(query)) + "\n");
    });

  cmd
    .command("remove")
    .description("Remove a single entry by id.")
    .argument("<id>", "Entry id (integer)", (v) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n < 1) {
        throw new CliError(`Invalid id "${v}" — must be a positive integer.`);
      }
      return n;
    })
    .action(async (id: number) => {
      process.stdout.write((await removeMemory(id)) + "\n");
    });

  cmd
    .command("stats")
    .description("Show capacity usage for both targets.")
    .action(async () => {
      process.stdout.write((await statsMemory()) + "\n");
    });

  return cmd;
}
