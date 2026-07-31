/**
 * Schema loader — reads the bundled `schema.sql` and applies it to the given
 * database connection. Splitting load from `client.ts` keeps the migration
 * runner directly testable (no env / singleton coupling) and makes it trivial
 * to point at an in-memory `:memory:` connection in tests.
 *
 * The DDL is idempotent (CREATE ... IF NOT EXISTS), so this can be run on
 * every startup without side effects beyond `sqlite_schema` bookkeeping.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type Database from "better-sqlite3";

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirname = dirname(moduleFilename);

/** Resolve the absolute path to `schema.sql` next to this compiled module. */
export function getSchemaPath(): string {
  return join(moduleDirname, "schema.sql");
}

/** Read the raw schema DDL from disk. */
export function readSchema(): string {
  return readFileSync(getSchemaPath(), "utf-8");
}

/**
 * Apply the schema to `db`. Safe to call multiple times — every statement
 * uses `IF NOT EXISTS`.
 */
export function applySchema(db: Database.Database): void {
  // Check if notes_fts needs tokenizer migration (unicode61 → trigram)
  const ftsRow = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='notes_fts'",
  ).get() as { sql: string } | undefined;

  const needsMigration = ftsRow && !ftsRow.sql.includes("trigram");
  if (needsMigration) {
    // Drop old unicode61 FTS table and its triggers before recreating
    db.exec("DROP TRIGGER IF EXISTS notes_ai");
    db.exec("DROP TRIGGER IF EXISTS notes_ad");
    db.exec("DROP TRIGGER IF EXISTS notes_au");
    db.exec("DROP TABLE IF EXISTS notes_fts");
  }

  db.exec(readSchema());

  // Rebuild FTS index after tokenizer migration
  if (needsMigration) {
    db.exec("INSERT INTO notes_fts(notes_fts) VALUES('rebuild')");
  }
}
