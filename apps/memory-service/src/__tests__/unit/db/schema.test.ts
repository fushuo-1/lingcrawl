/**
 * Unit tests for `db/schema.sql`.
 *
 * Verifies the structural and semantic guarantees the schema makes:
 *   - All 4 base tables + 1 FTS5 virtual table + 3 triggers + 1 index exist.
 *   - CHECK constraints reject out-of-set enums (target, source, status).
 *   - UNIQUE(session_id, sequence) prevents duplicate turn positions.
 *   - FOREIGN KEY on exchanges.session_id → sessions.id is enforced.
 *   - FTS5 triggers keep the mirror in sync on INSERT / UPDATE / DELETE.
 */
import type Database from "better-sqlite3";
import { _initDb } from "../client.js";

function openDb(): Database.Database {
  return _initDb(":memory:");
}

function listObjects(
  db: Database.Database,
  type: "table" | "trigger" | "index",
): string[] {
  return (
    db
      .prepare(
        "SELECT name FROM sqlite_schema " +
          "WHERE type = ? AND name NOT LIKE 'sqlite_%' " +
          "ORDER BY name",
      )
      .all(type) as Array<{ name: string }>
  ).map((r) => r.name);
}

describe("db/schema — structural presence", () => {
  let db: Database.Database;
  afterEach(() => {
    if (db?.open) db.close();
  });

  it("creates the 4 base tables + FTS5 virtual table", () => {
    db = openDb();
    const tables = listObjects(db, "table");
    expect(tables).toEqual(
      expect.arrayContaining([
        "memory_entries",
        "sessions",
        "exchanges",
        "exchanges_fts",
        "pending_memories",
      ]),
    );
  });

  it("creates the 3 FTS-sync triggers", () => {
    db = openDb();
    const triggers = listObjects(db, "trigger");
    expect(triggers).toEqual(
      expect.arrayContaining(["exchanges_ai", "exchanges_ad", "exchanges_au"]),
    );
  });

  it("creates the idx_memory_entries_target index", () => {
    db = openDb();
    const indexes = listObjects(db, "index");
    expect(indexes).toContain("idx_memory_entries_target");
  });
});

describe("db/schema — CHECK constraints", () => {
  let db: Database.Database;
  afterEach(() => {
    if (db?.open) db.close();
  });

  it("memory_entries rejects target values outside {memory, user}", () => {
    db = openDb();
    expect(() =>
      db
        .prepare("INSERT INTO memory_entries (target, content) VALUES (?, ?)")
        .run("agent", "x"),
    ).toThrow(/CHECK/);
  });

  it("sessions rejects source values outside {cli, mcp, api}", () => {
    db = openDb();
    db.prepare("INSERT INTO sessions (id, source) VALUES (?, ?)").run(
      "s1",
      "cli",
    );
    expect(() =>
      db
        .prepare("INSERT INTO sessions (id, source) VALUES (?, ?)")
        .run("s2", "web"),
    ).toThrow(/CHECK/);
  });

  it("pending_memories rejects target values outside {memory, user}", () => {
    db = openDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO pending_memories (content, target, confidence) VALUES (?, ?, ?)",
        )
        .run("x", "agent", 0.9),
    ).toThrow(/CHECK/);
  });

  it("pending_memories rejects status values outside {pending, approved, rejected}", () => {
    db = openDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO pending_memories (content, target, confidence, status) VALUES (?, ?, ?, ?)",
        )
        .run("x", "memory", 0.9, "done"),
    ).toThrow(/CHECK/);
  });
});

describe("db/schema — UNIQUE / FK constraints", () => {
  let db: Database.Database;
  afterEach(() => {
    if (db?.open) db.close();
  });

  it("exchanges UNIQUE(session_id, sequence) blocks duplicate positions", () => {
    db = openDb();
    db.prepare("INSERT INTO sessions (id, source) VALUES (?, ?)").run(
      "s1",
      "cli",
    );
    const ins = db.prepare(
      "INSERT INTO exchanges " +
        "(session_id, sequence, user_message, user_message_ts, " +
        " assistant_message, assistant_message_ts) " +
        "VALUES (?, ?, ?, ?, ?, ?)",
    );
    ins.run("s1", 1, "hi", 1, "hello", 2);
    expect(() =>
      ins.run("s1", 1, "hi again", 3, "hello again", 4),
    ).toThrow(/UNIQUE/);
  });

  it("exchanges.session_id is a foreign key to sessions.id (FK enforced)", () => {
    db = openDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO exchanges " +
            "(session_id, sequence, user_message, user_message_ts, " +
            " assistant_message, assistant_message_ts) " +
            "VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run("does-not-exist", 1, "hi", 1, "hello", 2),
    ).toThrow(/FOREIGN KEY/);
  });

  it("pending_memories.source_exchange_id is a foreign key to exchanges.id (FK enforced)", () => {
    db = openDb();
    expect(() =>
      db
        .prepare(
          "INSERT INTO pending_memories " +
            "(source_exchange_id, content, target, confidence) " +
            "VALUES (?, ?, ?, ?)",
        )
        .run(99999, "x", "memory", 0.9),
    ).toThrow(/FOREIGN KEY/);
  });
});

describe("db/schema — FTS5 triggers keep exchanges_fts in sync", () => {
  let db: Database.Database;
  afterEach(() => {
    if (db?.open) db.close();
  });

  function insertExchange(
    seq: number,
    user: string,
    assistant: string,
  ): number {
    const info = db
      .prepare(
        "INSERT INTO exchanges " +
          "(session_id, sequence, user_message, user_message_ts, " +
          " assistant_message, assistant_message_ts) " +
          "VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run("s1", seq, user, 1, assistant, 2);
    return Number(info.lastInsertRowid);
  }

  it("INSERT trigger mirrors rows into exchanges_fts", () => {
    db = openDb();
    db.prepare("INSERT INTO sessions (id, source) VALUES (?, ?)").run(
      "s1",
      "cli",
    );
    insertExchange(1, "what is SQLite", "SQLite is an embedded database");
    const hits = db
      .prepare(
        "SELECT rowid FROM exchanges_fts WHERE exchanges_fts MATCH ?",
      )
      .all("SQLite") as Array<{ rowid: number | bigint }>;
    expect(hits).toHaveLength(1);
    expect(Number(hits[0].rowid)).toBe(1);
  });

  it("DELETE trigger removes rows from exchanges_fts", () => {
    db = openDb();
    db.prepare("INSERT INTO sessions (id, source) VALUES (?, ?)").run(
      "s1",
      "cli",
    );
    const id = insertExchange(
      1,
      "delete me please",
      "okay acknowledged deletion",
    );
    db.prepare("DELETE FROM exchanges WHERE id = ?").run(id);
    const hits = db
      .prepare(
        "SELECT rowid FROM exchanges_fts WHERE exchanges_fts MATCH ?",
      )
      .all("delete") as Array<{ rowid: number | bigint }>;
    expect(hits).toHaveLength(0);
  });

  it("UPDATE trigger refreshes exchanges_fts with the new content", () => {
    db = openDb();
    db.prepare("INSERT INTO sessions (id, source) VALUES (?, ?)").run(
      "s1",
      "cli",
    );
    const id = insertExchange(1, "old term", "old answer");
    db.prepare(
      "UPDATE exchanges SET user_message = ?, assistant_message = ? WHERE id = ?",
    ).run("new term", "new answer", id);

    const oldHits = db
      .prepare(
        "SELECT rowid FROM exchanges_fts WHERE exchanges_fts MATCH ?",
      )
      .all("old") as Array<{ rowid: number | bigint }>;
    const newHits = db
      .prepare(
        "SELECT rowid FROM exchanges_fts WHERE exchanges_fts MATCH ?",
      )
      .all("new") as Array<{ rowid: number | bigint }>;
    expect(oldHits).toHaveLength(0);
    expect(newHits).toHaveLength(1);
  });
});
