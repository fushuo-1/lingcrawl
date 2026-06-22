/**
 * `lingcrawl kb` subcommands (issue #97 — knowledge base CLI).
 *
 * Thin adapter over KnowledgeStore / IndexStore.
 * Returns string bodies, throws `CliError` for user-facing failures.
 *
 * Subcommands:
 *   - `list [path]` — list notes, optionally filtered by path prefix
 *   - `search <query>` — full-text search notes (FTS5)
 */
import { Command } from "commander";
import { getDb } from "../db/client.js";
import { FileManager } from "../kb/file-manager.js";
import { IndexStore } from "../kb/index-store.js";
import { KnowledgeStore } from "../kb/knowledge-store.js";
import { config } from "../config.js";

/* -------------------------------------------------------------------------- */
/*                              Shared error type                             */
/* -------------------------------------------------------------------------- */

export class CliError extends Error {
  readonly cliExit = true as const;
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/* -------------------------------------------------------------------------- */
/*                              Helper                                        */
/* -------------------------------------------------------------------------- */

function createStore(): KnowledgeStore {
  const db = getDb();
  const fileManager = new FileManager(config.KB_DATA_DIR);
  const indexStore = new IndexStore(db);
  return new KnowledgeStore({ fileManager, indexStore });
}

/* -------------------------------------------------------------------------- */
/*                              KB subcommands                                */
/* -------------------------------------------------------------------------- */

/** `lingcrawl kb list [path]` — list notes, optionally by path prefix. */
export async function listNotes(pathPrefix?: string): Promise<string> {
  const store = createStore();
  const notes = store.listNotes({
    pathPrefix: pathPrefix || undefined,
    limit: 100,
  });

  if (notes.length === 0) {
    return pathPrefix
      ? `No notes found under "${pathPrefix}".`
      : "No notes yet. Write one with `kb_write`.";
  }

  const lines: string[] = [
    `Found ${notes.length} ${notes.length === 1 ? "note" : "notes"}:`,
  ];
  for (const n of notes) {
    const tagStr = n.tags.length > 0 ? ` [${n.tags.join(", ")}]` : "";
    const updated = formatTs(n.updatedAt);
    lines.push(`  ${n.path}  — ${n.title}${tagStr}  (${updated})`);
  }
  return lines.join("\n");
}

/** `lingcrawl kb search <query>` — full-text search notes via FTS5. */
export async function searchNotes(query: string): Promise<string> {
  if (!query.trim()) {
    throw new CliError("Search query must not be empty.");
  }

  const db = getDb();
  const indexStore = new IndexStore(db);

  let hits;
  try {
    hits = indexStore.searchNotes(query, { limit: 20 });
  } catch (err) {
    // FTS5 syntax errors are common (unbalanced quotes, stray operators);
    // surface them as a friendly CliError.
    const msg = err instanceof Error ? err.message : String(err);
    throw new CliError(
      `Invalid search query: ${msg}\n` +
        `Tip: use simple keywords or quote phrases, e.g. \'"${query}"\'.`,
    );
  }

  if (hits.length === 0) {
    return `No notes match "${query}".`;
  }

  const lines: string[] = [
    `Found ${hits.length} ${hits.length === 1 ? "hit" : "hits"} for "${query}":`,
  ];
  for (const h of hits) {
    lines.push(`  ${h.path}  — ${h.title}  (score: ${h.score.toFixed(3)})`);
    if (h.snippet) {
      lines.push(`    ${h.snippet.replace(/\n/g, " ").slice(0, 120)}`);
    }
  }
  return lines.join("\n");
}

function formatTs(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().replace("T", " ").slice(0, 19);
}

/* -------------------------------------------------------------------------- */
/*                              Commander wiring                              */
/* -------------------------------------------------------------------------- */

export function buildKbCommand(): Command {
  const cmd = new Command("kb").description(
    "Inspect and manage the knowledge base.",
  );

  cmd
    .command("list")
    .description("List notes, optionally filtered by path prefix.")
    .argument("[path]", "Optional path prefix filter")
    .action(async (pathPrefix?: string) => {
      process.stdout.write((await listNotes(pathPrefix)) + "\n");
    });

  cmd
    .command("search")
    .description("Full-text search notes (FTS5).")
    .argument("<query>", "Search query")
    .action(async (query: string) => {
      process.stdout.write((await searchNotes(query)) + "\n");
    });

  return cmd;
}
