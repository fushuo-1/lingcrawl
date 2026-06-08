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

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Resolve the absolute path to `schema.sql` next to this compiled module. */
export function getSchemaPath(): string {
  return join(__dirname, "schema.sql");
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
  db.exec(readSchema());
}
