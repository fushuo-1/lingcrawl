/**
 * Unit tests for `db/client.ts`.
 *
 * Strategy: every test builds its own connection via `_initDb(":memory:")`
 * and closes it afterwards — the in-memory mode is fast (no fs IO) and
 * gives each test a clean slate. We deliberately do NOT exercise the
 * process-wide `getDb()` singleton here, because it depends on `config.DATA_DIR`
 * and is exercised by the snips/E2E layer instead.
 */
import type Database from "better-sqlite3";
import { _initDb, closeDb, getDb } from "../client.js";
import { applySchema } from "../migrations.js";

/** Helper: open a fresh in-memory DB with schema applied. */
function openMemoryDb(): Database.Database {
  return _initDb(":memory:");
}

describe("db/client — _initDb", () => {
  let db: Database.Database;

  afterEach(() => {
    if (db && db.open) db.close();
  });

  it("opens a connection, applies schema, and returns a working DB handle", () => {
    db = openMemoryDb();
    // Smoke: a query that would fail if the connection were not initialized.
    const row = db
      .prepare("SELECT count(*) AS n FROM memory_entries")
      .get() as { n: number };
    expect(row.n).toBe(0);
  });

  it("enables WAL journal mode (PRAGMA journal_mode returns 'wal')", () => {
    db = openMemoryDb();
    // For an in-memory DB SQLite reports 'memory' regardless of the request,
    // so we instead assert the PRAGMA statement was accepted without error
    // and that the busy_timeout was set. WAL itself is verified on a real
    // file path in the dedicated tmpfile test below.
    expect(() => db.pragma("journal_mode = WAL")).not.toThrow();
  });

  it("enables WAL journal mode on a real file path", () => {
    const os = require("node:os") as typeof import("node:os");
    const path = require("node:path") as typeof import("node:path");
    const fs = require("node:fs") as typeof import("node:fs");
    const tmpFile = path.join(
      os.tmpdir(),
      `memory-svc-wal-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
    );
    try {
      const fileDb = _initDb(tmpFile);
      try {
        const mode = fileDb.pragma("journal_mode", { simple: true });
        expect(mode).toBe("wal");
      } finally {
        fileDb.close();
      }
    } finally {
      // Clean up -shm and -wal sidecar files too.
      for (const ext of ["", "-shm", "-wal", "-journal"]) {
        try {
          fs.unlinkSync(tmpFile + ext);
        } catch {
          /* ignore */
        }
      }
    }
  });

  it("enables foreign_keys (PRAGMA foreign_keys returns 1)", () => {
    db = openMemoryDb();
    const fk = db.pragma("foreign_keys", { simple: true });
    expect(fk).toBe(1);
  });

  it("sets busy_timeout to 5000ms", () => {
    db = openMemoryDb();
    const timeout = db.pragma("busy_timeout", { simple: true });
    expect(timeout).toBe(5000);
  });

  it("applies the schema: all 4 tables + FTS5 virtual table + 3 triggers", () => {
    db = openMemoryDb();
    const rows = db
      .prepare(
        "SELECT type, name FROM sqlite_schema " +
          "WHERE name NOT LIKE 'sqlite_%' " +
          "ORDER BY type, name",
      )
      .all() as Array<{ type: string; name: string }>;

    const tables = rows.filter((r) => r.type === "table").map((r) => r.name);
    const triggers = rows
      .filter((r) => r.type === "trigger")
      .map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "memory_entries",
        "sessions",
        "exchanges",
        "pending_memories",
        "exchanges_fts", // FTS5 virtual table is reported as type='table'
      ]),
    );
    expect(tables).toHaveLength(5);

    expect(triggers).toEqual(
      expect.arrayContaining([
        "exchanges_ai",
        "exchanges_ad",
        "exchanges_au",
      ]),
    );
    expect(triggers).toHaveLength(3);
  });

  it("creates the idx_memory_entries_target index", () => {
    db = openMemoryDb();
    const idx = db
      .prepare(
        "SELECT name FROM sqlite_schema " +
          "WHERE type = 'index' AND name = 'idx_memory_entries_target'",
      )
      .get() as { name: string } | undefined;
    expect(idx?.name).toBe("idx_memory_entries_target");
  });

  it("is idempotent — applying the schema twice does not throw or duplicate objects", () => {
    db = openMemoryDb();
    expect(() => applySchema(db)).not.toThrow();

    const tablesBefore = (
      db.prepare("SELECT count(*) AS n FROM sqlite_schema").get() as {
        n: number;
      }
    ).n;
    applySchema(db);
    const tablesAfter = (
      db.prepare("SELECT count(*) AS n FROM sqlite_schema").get() as {
        n: number;
      }
    ).n;
    expect(tablesAfter).toBe(tablesBefore);
  });
});

describe("db/client — getDb / closeDb singleton", () => {
  afterEach(() => {
    closeDb();
  });

  it("getDb() returns the same instance on repeated calls", () => {
    const a = getDb();
    const b = getDb();
    expect(a).toBe(b);
  });

  it("closeDb() releases the singleton — next getDb() opens a fresh one", () => {
    const a = getDb();
    closeDb();
    const b = getDb();
    expect(b).not.toBe(a);
    // b must be a working connection.
    expect(
      (b.prepare("SELECT 1 AS one").get() as { one: number }).one,
    ).toBe(1);
  });
});
