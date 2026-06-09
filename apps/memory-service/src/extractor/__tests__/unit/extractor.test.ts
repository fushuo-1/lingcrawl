/**
 * Unit tests for the extractor worker (issue #81).
 *
 * Coverage:
 *  - parseInterval handles "30m", "1h", "5m", "300s", "500ms", "30"
 *  - runOnce writes filtered suggestions to pending_memories
 *  - runOnce marks examined exchanges with extracted_at
 *  - runOnce respects LLM_MIN_CONFIDENCE filter
 *  - runOnce returns {examined: 0, written: 0} when no unextracted exchanges
 *  - approvePending moves a pending row to memory_entries and marks
 *    the pending row approved
 *  - approvePending throws when the row is not pending
 *  - rejectPending marks the row rejected (idempotent: rejects throw
 *    on already-actioned rows)
 *  - listPending returns pending rows newest first
 *
 * These tests use an in-memory SQLite handle (no native binding needed
 * for the Worker logic — only the constructor wiring needs the DB).
 */
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { MemoryStoreImpl } from "../../../memory/store.js";
import {
  ExtractorWorker,
  parseInterval,
} from "../index.js";
import type { ExtractedMemory, LlmProvider } from "../llm/provider.js";

/* ----- helpers ----- */

function makeFixtureDb(): Database.Database {
  return _initDb(":memory:");
}

function makeStubLlm(suggestions: ExtractedMemory[]): LlmProvider {
  return {
    name: "stub-llm",
    extract: async () => suggestions,
  };
}

function seedOneExchange(db: Database.Database, id: number): void {
  db.prepare(
    "INSERT INTO sessions (id, source) VALUES (?, ?)",
  ).run("s1", "cli");
  db.prepare(
    "INSERT INTO exchanges (session_id, sequence, user_message, " +
      "user_message_ts, assistant_message, assistant_message_ts) " +
      "VALUES (?, ?, ?, ?, ?, ?)",
  ).run("s1", 1, `u${id}`, 1700000000, `a${id}`, 1700000060);
}

const SAMPLE_EXCHANGES = [
  {
    id: 1,
    userMessage: "I prefer concise replies",
    assistantMessage: "OK",
    timestamp: 1700000000,
  },
];

/* ----- parseInterval ----- */

describe("parseInterval", () => {
  it("parses '30m' as 30 minutes", () => {
    expect(parseInterval("30m")).toBe(30 * 60 * 1000);
  });
  it("parses '1h' as 60 minutes", () => {
    expect(parseInterval("1h")).toBe(60 * 60 * 1000);
  });
  it("parses '5m' as 5 minutes", () => {
    expect(parseInterval("5m")).toBe(5 * 60 * 1000);
  });
  it("parses '300s' as 5 minutes", () => {
    expect(parseInterval("300s")).toBe(5 * 60 * 1000);
  });
  it("parses '500ms' as 500 ms", () => {
    expect(parseInterval("500ms")).toBe(500);
  });
  it("treats bare numbers as ms (default unit)", () => {
    expect(parseInterval("30")).toBe(30);
  });
  it("throws on garbage input", () => {
    expect(() => parseInterval("not a duration")).toThrow(/Invalid/);
  });
});

/* ----- runOnce ----- */

describe("ExtractorWorker.runOnce", () => {
  let db: Database.Database;
  let worker: ExtractorWorker;

  beforeEach(() => {
    db = makeFixtureDb();
    const memoryStore = new MemoryStoreImpl(db);
    worker = new ExtractorWorker({
      db,
      llm: makeStubLlm([]),
      memoryStore,
      now: () => 1800000000,
    });
  });
  afterEach(() => {
    if (db.open) db.close();
  });

  it("returns zero counts when there are no unextracted exchanges", async () => {
    const result = await worker.runOnce();
    expect(result).toEqual({ examined: 0, written: 0 });
  });

  it("writes LLM suggestions to pending_memories and marks exchanges examined", async () => {
    seedOneExchange(db, 1);
    const llm: LlmProvider = {
      name: "stub",
      extract: async () => [
        { content: "User prefers concise replies", target: "user", confidence: 0.9, sourceExchangeId: 1 },
      ],
    };
    worker = new ExtractorWorker({
      db, llm, memoryStore: new MemoryStoreImpl(db), now: () => 1800000000,
    });

    const result = await worker.runOnce();
    expect(result.examined).toBe(1);
    expect(result.written).toBe(1);

    // The exchange is marked examined.
    const row = db.prepare("SELECT extracted_at FROM exchanges WHERE id = 1").get() as { extracted_at: number | null };
    expect(row.extracted_at).toBe(1800000000);

    // The pending_memories row exists with the right shape.
    const pending = db.prepare("SELECT * FROM pending_memories").all() as Array<{
      source_exchange_id: number;
      content: string;
      target: string;
      confidence: number;
      status: string;
    }>;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      source_exchange_id: 1,
      content: "User prefers concise replies",
      target: "user",
      confidence: 0.9,
      status: "pending",
    });
  });

  it("filters out suggestions below LLM_MIN_CONFIDENCE", async () => {
    seedOneExchange(db, 1);
    // Set the config limit to 0.8 for the duration of this test. We
    // re-import config to pick up the env change; ESM modules are
    // not in jest.resetModules()'s scope without explicit reload, so
    // we accept that the static 0.7 from the default config will be
    // used here. Instead, test the filter logic with the static config
    // by choosing confidence values around 0.7.
    const llm: LlmProvider = {
      name: "stub",
      extract: async () => [
        { content: "high", target: "user", confidence: 0.9, sourceExchangeId: 1 },
        { content: "low", target: "user", confidence: 0.1, sourceExchangeId: 1 },
      ],
    };
    const w = new ExtractorWorker({
      db, llm, memoryStore: new MemoryStoreImpl(db), now: () => 1800000000,
    });
    const result = await w.runOnce();
    // Default LLM_MIN_CONFIDENCE is 0.7, so only 0.9 passes.
    expect(result.written).toBe(1);
  });

  it("does not re-process already-extracted exchanges", async () => {
    seedOneExchange(db, 1);
    db.prepare("UPDATE exchanges SET extracted_at = 1700000000 WHERE id = 1").run();
    const result = await worker.runOnce();
    expect(result.examined).toBe(0);
  });
});

/* ----- approvePending / rejectPending ----- */

describe("ExtractorWorker.review actions", () => {
  let db: Database.Database;
  let memoryStore: MemoryStoreImpl;
  let worker: ExtractorWorker;

  beforeEach(() => {
    db = makeFixtureDb();
    memoryStore = new MemoryStoreImpl(db);
    worker = new ExtractorWorker({
      db,
      llm: makeStubLlm([]),
      memoryStore,
      now: () => 1800000000,
    });
  });
  afterEach(() => {
    if (db.open) db.close();
  });

  it("approvePending moves the row to memory_entries and marks approved", async () => {
    seedOneExchange(db, 1);
    db.prepare(
      "INSERT INTO pending_memories (source_exchange_id, content, target, confidence, created_at, status) " +
        "VALUES (?, ?, ?, ?, ?, 'pending')",
    ).run(1, "prefers concise", "user", 0.9, 1800000000);

    const { memoryId } = await worker.approvePending(1);
    expect(memoryId).toBeGreaterThan(0);

    const entry = memoryStore.get(memoryId);
    expect(entry).not.toBeNull();
    expect(entry!.content).toBe("prefers concise");

    const pending = db.prepare("SELECT status FROM pending_memories WHERE id = 1").get() as { status: string };
    expect(pending.status).toBe("approved");
  });

  it("approvePending throws when the row is already approved", async () => {
    seedOneExchange(db, 1);
    db.prepare(
      "INSERT INTO pending_memories (source_exchange_id, content, target, confidence, created_at, status) " +
        "VALUES (?, ?, ?, ?, ?, 'approved')",
    ).run(1, "x", "user", 0.9, 1800000000);

    await expect(worker.approvePending(1)).rejects.toThrow(/already/);
  });

  it("approvePending throws on a missing id", async () => {
    await expect(worker.approvePending(999)).rejects.toThrow(/not found/);
  });

  it("rejectPending marks the row rejected (idempotent guard)", () => {
    seedOneExchange(db, 1);
    db.prepare(
      "INSERT INTO pending_memories (source_exchange_id, content, target, confidence, created_at, status) " +
        "VALUES (?, ?, ?, ?, ?, 'pending')",
    ).run(1, "x", "user", 0.9, 1800000000);

    worker.rejectPending(1);
    const row = db.prepare("SELECT status FROM pending_memories WHERE id = 1").get() as { status: string };
    expect(row.status).toBe("rejected");

    // Rejecting again should throw because the row is no longer pending.
    expect(() => worker.rejectPending(1)).toThrow(/not pending/);
  });
});

/* ----- listPending ----- */

describe("ExtractorWorker.listPending", () => {
  let db: Database.Database;
  let worker: ExtractorWorker;

  beforeEach(() => {
    db = makeFixtureDb();
    worker = new ExtractorWorker({
      db, llm: makeStubLlm([]), memoryStore: new MemoryStoreImpl(db), now: () => 1800000000,
    });
  });
  afterEach(() => {
    if (db.open) db.close();
  });

  it("returns pending rows ordered by created_at DESC", () => {
    db.prepare(
      "INSERT INTO pending_memories (source_exchange_id, content, target, confidence, created_at, status) " +
        "VALUES (NULL, 'old', 'user', 0.5, 1000, 'pending')",
    ).run();
    db.prepare(
      "INSERT INTO pending_memories (source_exchange_id, content, target, confidence, created_at, status) " +
        "VALUES (NULL, 'new', 'memory', 0.7, 2000, 'pending')",
    ).run();
    db.prepare(
      "INSERT INTO pending_memories (source_exchange_id, content, target, confidence, created_at, status) " +
        "VALUES (NULL, 'rej', 'user', 0.5, 3000, 'rejected')",
    ).run();

    const rows = worker.listPending();
    expect(rows.map((r) => r.content)).toEqual(["new", "old"]);
  });
});
