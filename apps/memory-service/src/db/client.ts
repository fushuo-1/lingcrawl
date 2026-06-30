/**
 * SQLite client — better-sqlite3 singleton.
 *
 * Production: `getDb()` opens `<DATA_DIR>/memory.db` with WAL + foreign keys
 * and applies the schema once.
 *
 * Tests: pass `:memory:` (or a tmpfile path) to `_initDb()` to get a
 * short-lived, isolated connection. The module-level singleton is reset by
 * `closeDb()` so suites can run sequentially without leaking handles.
 */
import Database from "better-sqlite3";
import { join } from "node:path";
import { config } from "../config.js";
import { applySchema } from "./migrations.js";
import { DbError } from "./errors.js";

let dbInstance: Database.Database | null = null;

/**
 * Internal: open a new connection, apply PRAGMAs, and run the schema.
 * Extracted from `getDb()` so tests can build a fresh in-memory DB without
 * mutating the singleton.
 */
export function _initDb(dbPath: string): Database.Database {
  let db: Database.Database;
  try {
    db = new Database(dbPath);
  } catch (err) {
    throw new DbError(`Failed to open SQLite database at "${dbPath}"`, {
      cause: err,
    });
  }

  // Apply non-journal PRAGMAs first. Note: `synchronous = NORMAL` will
  // silently re-enable WAL mode if it's currently DELETE, so the journal
  // mode PRAGMA must come LAST to take effect.
  db.pragma("synchronous = NORMAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  try {
    applySchema(db);
  } catch (err) {
    db.close();
    throw new DbError("Failed to apply DB schema", { cause: err });
  }

  // Journal mode — applied LAST because setting `synchronous = NORMAL` above
  // would otherwise flip us back to WAL. Default DELETE is safe for Docker
  // bind mounts where fcntl locks are unreliable.
  db.pragma(`journal_mode = ${config.SQLITE_JOURNAL_MODE}`);

  return db;
}

/**
 * Get the process-wide database connection, opening it on first call.
 *
 * Path: `<DATA_DIR>/memory.db` (DATA_DIR is auto-created by config.ts).
 */
export function getDb(): Database.Database {
  if (dbInstance) return dbInstance;

  const dbPath = join(config.DATA_DIR, "memory.db");
  dbInstance = _initDb(dbPath);
  return dbInstance;
}

/** Close the singleton (test cleanup). Idempotent. */
export function closeDb(): void {
  if (dbInstance) {
    // If WAL mode is active, checkpoint before closing so no data is left
    // only in the WAL file (which would be lost if the container is killed).
    if (config.SQLITE_JOURNAL_MODE === "wal") {
      try {
        dbInstance.pragma("wal_checkpoint(TRUNCATE)");
      } catch {
        // Best-effort; don't prevent shutdown on checkpoint failure.
      }
    }
    dbInstance.close();
    dbInstance = null;
  }
}
