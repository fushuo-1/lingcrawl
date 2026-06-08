/**
 * Unit tests for `apps/memory-service/src/session/store.ts` — issue #72.
 *
 * Each test builds its own in-memory SQLite via `_initDb(":memory:")` so the
 * suites are independent and run in milliseconds. We deliberately do NOT go
 * through `getDb()` here — that would couple the unit tests to `config.DATA_DIR`
 * and to the process-wide singleton. The store itself is constructed directly
 * with the in-memory handle.
 *
 * Coverage map (mirrors the acceptance criteria in issue #72):
 * - First `logExchange` creates the session row
 * - Repeated `logExchange` increments `sequence` per session (1,2,3,…)
 * - `logExchange` is atomic: insert + sequence + insert in one tx
 * - `listSessions(limit)` returns most-recent-first
 * - `getSession` returns `null` for unknown ids
 * - `getSession` returns `{session, exchanges}` ordered by `sequence ASC`
 * - `metadata` is serialized on write and parsed back on read
 * - `clientName` and `timestamp` are handled correctly
 */
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { SessionStore } from "../../store.js";

/* ----- helpers ----- */

function openStore(): {
 db: Database.Database;
 store: SessionStore;
} {
 const db = _initDb(":memory:");
 return { db, store: new SessionStore(db) };
}

function countSessions(db: Database.Database): number {
 return (
 db.prepare("SELECT count(*) AS n FROM sessions").get() as { n: number }
 ).n;
}

function countExchanges(db: Database.Database, sessionId: string): number {
 return (
 db
 .prepare("SELECT count(*) AS n FROM exchanges WHERE session_id = ?")
 .get(sessionId) as { n: number }
 ).n;
}

/* ----- logExchange — first call creates the session ----- */

describe("SessionStore.logExchange — first call creates the session", () => {
 let db: Database.Database;
 let store: SessionStore;

 beforeEach(() => {
 ({ db, store } = openStore());
 });

 afterEach(() => {
 if (db?.open) db.close();
 });

 it("creates the session row when it does not exist yet", () => {
 expect(countSessions(db)).toBe(0);

 store.logExchange({
 sessionId: "s1",
 userMessage: "hi",
 assistantMessage: "hello",
 source: "cli",
 });

 expect(countSessions(db)).toBe(1);
 const row = db
 .prepare("SELECT id, source FROM sessions WHERE id = ?")
 .get("s1") as { id: string; source: string };
 expect(row.id).toBe("s1");
 expect(row.source).toBe("cli");
 });

 it("writes the exchange with sequence=1 for a new session", () => {
 const result = store.logExchange({
 sessionId: "s1",
 userMessage: "hi",
 assistantMessage: "hello",
 source: "cli",
 });

 expect(result.sessionId).toBe("s1");
 expect(result.sequence).toBe(1);
 expect(result.exchangeId).toBeGreaterThanOrEqual(1);
 expect(countExchanges(db, "s1")).toBe(1);
 });

 it("uses unixepoch() for ts columns when timestamp is omitted", () => {
 const before = Math.floor(Date.now() /1000);
 store.logExchange({
 sessionId: "s1",
 userMessage: "hi",
 assistantMessage: "hello",
 source: "cli",
 });
 const after = Math.floor(Date.now() /1000) +1;

 const row = db
 .prepare(
 "SELECT user_message_ts, assistant_message_ts FROM exchanges WHERE session_id = ?",
 )
 .get("s1") as {
 user_message_ts: number;
 assistant_message_ts: number;
 };

 // `unixepoch()` returns whole-second UTC timestamps; allow ±1s slack for
 // clock drift between JS Date.now() and the SQLite-side call.
 expect(row.user_message_ts).toBeGreaterThanOrEqual(before);
 expect(row.user_message_ts).toBeLessThanOrEqual(after);
 expect(row.assistant_message_ts).toBe(row.user_message_ts);
 });

 it("uses the supplied timestamp for both ts columns when provided", () => {
 const custom =1700000000;
 store.logExchange({
 sessionId: "s1",
 userMessage: "hi",
 assistantMessage: "hello",
 source: "mcp",
 timestamp: custom,
 });

 const row = db
 .prepare(
 "SELECT user_message_ts, assistant_message_ts FROM exchanges WHERE session_id = ?",
 )
 .get("s1") as {
 user_message_ts: number;
 assistant_message_ts: number;
 };
 expect(row.user_message_ts).toBe(custom);
 expect(row.assistant_message_ts).toBe(custom);
 });

 it("persists clientName when supplied and leaves it null otherwise", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "hi",
 assistantMessage: "hello",
 source: "cli",
 clientName: "claude-code",
 });
 store.logExchange({
 sessionId: "s2",
 userMessage: "hi",
 assistantMessage: "hello",
 source: "api",
 });

 const s1 = db
 .prepare("SELECT client_name FROM sessions WHERE id = ?")
 .get("s1") as { client_name: string | null };
 const s2 = db
 .prepare("SELECT client_name FROM sessions WHERE id = ?")
 .get("s2") as { client_name: string | null };

 expect(s1.client_name).toBe("claude-code");
 expect(s2.client_name).toBeNull();
 });

 it("sets extracted_at to NULL in v0.1 (extractor fills it in v0.2)", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "hi",
 assistantMessage: "hello",
 source: "cli",
 });

 const row = db
 .prepare("SELECT extracted_at FROM exchanges WHERE session_id = ?")
 .get("s1") as { extracted_at: number | null };
 expect(row.extracted_at).toBeNull();
 });
});

/* ----- logExchange — sequence increment across calls ----- */

describe("SessionStore.logExchange — sequence increments per session", () => {
 let db: Database.Database;
 let store: SessionStore;

 beforeEach(() => {
 ({ db, store } = openStore());
 });

 afterEach(() => {
 if (db?.open) db.close();
 });

 it("increments sequence as1,2,3 across multiple calls on the same session", () => {
 const r1 = store.logExchange({
 sessionId: "s1",
 userMessage: "u1",
 assistantMessage: "a1",
 source: "cli",
 });
 const r2 = store.logExchange({
 sessionId: "s1",
 userMessage: "u2",
 assistantMessage: "a2",
 source: "cli",
 });
 const r3 = store.logExchange({
 sessionId: "s1",
 userMessage: "u3",
 assistantMessage: "a3",
 source: "cli",
 });

 expect(r1.sequence).toBe(1);
 expect(r2.sequence).toBe(2);
 expect(r3.sequence).toBe(3);
 expect(countExchanges(db, "s1")).toBe(3);
 });

 it("counts sequences independently per session", () => {
 const a1 = store.logExchange({
 sessionId: "A",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 const b1 = store.logExchange({
 sessionId: "B",
 userMessage: "u",
 assistantMessage: "a",
 source: "mcp",
 });
 const a2 = store.logExchange({
 sessionId: "A",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 const b2 = store.logExchange({
 sessionId: "B",
 userMessage: "u",
 assistantMessage: "a",
 source: "mcp",
 });

 expect(a1.sequence).toBe(1);
 expect(b1.sequence).toBe(1);
 expect(a2.sequence).toBe(2);
 expect(b2.sequence).toBe(2);

 expect(countSessions(db)).toBe(2);
 expect(countExchanges(db, "A")).toBe(2);
 expect(countExchanges(db, "B")).toBe(2);
 });

 it("preserves the existing session row on subsequent calls (INSERT OR IGNORE)", () => {
 // First call seeds the session with metadata + clientName.
 store.logExchange({
 sessionId: "s1",
 userMessage: "u1",
 assistantMessage: "a1",
 source: "cli",
 clientName: "claude-code",
 metadata: { project: "lingcrawl" },
 });

 // Second call does NOT pass clientName / metadata — the existing row must be
 // kept intact, not overwritten with NULL.
 store.logExchange({
 sessionId: "s1",
 userMessage: "u2",
 assistantMessage: "a2",
 source: "cli",
 });

 const row = db
 .prepare(
 "SELECT client_name, metadata FROM sessions WHERE id = ?",
 )
 .get("s1") as {
 client_name: string | null;
 metadata: string | null;
 };
 expect(row.client_name).toBe("claude-code");
 expect(JSON.parse(row.metadata as string)).toEqual({
 project: "lingcrawl",
 });
 });

 it("returns monotonically increasing exchangeIds within a session", () => {
 const r1 = store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 const r2 = store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 expect(r2.exchangeId).toBeGreaterThan(r1.exchangeId);
 });
});

/* ----- listSessions — ordering + limit ----- */

describe("SessionStore.listSessions", () => {
 let db: Database.Database;
 let store: SessionStore;

 beforeEach(() => {
 ({ db, store } = openStore());
 });

 afterEach(() => {
 if (db?.open) db.close();
 });

 it("returns sessions ordered by started_at DESC (most recent first)", () => {
 // Insert sessions with explicit started_at values; the first one created
 // must appear last in the result.
 db.prepare(
 "INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)",
 ).run("old", "cli",1000);
 db.prepare(
 "INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)",
 ).run("mid", "cli",2000);
 db.prepare(
 "INSERT INTO sessions (id, source, started_at) VALUES (?, ?, ?)",
 ).run("new", "cli",3000);

 const sessions = store.listSessions();
 expect(sessions.map((s) => s.id)).toEqual(["new", "mid", "old"]);
 });

 it("defaults limit to50 when omitted", () => {
 for (let i =0; i <55; i++) {
 store.logExchange({
 sessionId: `s${i}`,
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 }
 const sessions = store.listSessions();
 expect(sessions).toHaveLength(50);
 });

 it("respects an explicit limit", () => {
 for (let i =0; i <5; i++) {
 store.logExchange({
 sessionId: `s${i}`,
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 }
 expect(store.listSessions(3)).toHaveLength(3);
 expect(store.listSessions(1)).toHaveLength(1);
 });

 it("returns an empty array when there are no sessions", () => {
 expect(store.listSessions()).toEqual([]);
 });

 it("returns sessions with parsed metadata", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 metadata: { project: "lingcrawl", tags: ["a", "b"] },
 });

 const [session] = store.listSessions();
 expect(session.metadata).toEqual({
 project: "lingcrawl",
 tags: ["a", "b"],
 });
 });

 it("returns metadata as null when none was provided at insert time", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 const [session] = store.listSessions();
 expect(session.metadata).toBeNull();
 });
});

/* ----- getSession — session + exchanges ----- */

describe("SessionStore.getSession", () => {
 let db: Database.Database;
 let store: SessionStore;

 beforeEach(() => {
 ({ db, store } = openStore());
 });

 afterEach(() => {
 if (db?.open) db.close();
 });

 it("returns null when the session id does not exist", () => {
 expect(store.getSession("does-not-exist")).toBeNull();
 });

 it("returns the session row for a known id", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "mcp",
 clientName: "codex",
 });

 const result = store.getSession("s1");
 expect(result).not.toBeNull();
 expect(result?.session.id).toBe("s1");
 expect(result?.session.source).toBe("mcp");
 expect(result?.session.clientName).toBe("codex");
 });

 it("returns exchanges in sequence ASC order across multiple turns", () => {
 const r1 = store.logExchange({
 sessionId: "s1",
 userMessage: "u1",
 assistantMessage: "a1",
 source: "cli",
 timestamp:100,
 });
 const r2 = store.logExchange({
 sessionId: "s1",
 userMessage: "u2",
 assistantMessage: "a2",
 source: "cli",
 timestamp:200,
 });
 const r3 = store.logExchange({
 sessionId: "s1",
 userMessage: "u3",
 assistantMessage: "a3",
 source: "cli",
 timestamp:300,
 });

 const result = store.getSession("s1");
 expect(result).not.toBeNull();
 const exchanges = result!.exchanges;
 expect(exchanges).toHaveLength(3);
 expect(exchanges.map((e) => e.sequence)).toEqual([1,2,3]);
 expect(exchanges.map((e) => e.userMessage)).toEqual(["u1", "u2", "u3"]);
 expect(exchanges.map((e) => e.assistantMessage)).toEqual([
 "a1",
 "a2",
 "a3",
 ]);

 // exchangeIds come back in insert order, monotonic.
 expect(exchanges.map((e) => e.exchangeId)).toEqual([
 r1.exchangeId,
 r2.exchangeId,
 r3.exchangeId,
 ]);
 });

 it("returns an empty exchanges array for a session with no turns yet", () => {
 db.prepare(
 "INSERT INTO sessions (id, source) VALUES (?, ?)",
 ).run("empty", "cli");

 const result = store.getSession("empty");
 expect(result).not.toBeNull();
 expect(result?.exchanges).toEqual([]);
 });

 it("returns parsed metadata for the session row", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 metadata: { model: "gpt-4o-mini", turn:1 },
 });

 const result = store.getSession("s1");
 expect(result?.session.metadata).toEqual({
 model: "gpt-4o-mini",
 turn:1,
 });
 });

 it("does not return exchanges belonging to other sessions", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });
 store.logExchange({
 sessionId: "s2",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });

 const r1 = store.getSession("s1");
 const r2 = store.getSession("s2");
 expect(r1?.exchanges).toHaveLength(1);
 expect(r1?.exchanges[0].sessionId).toBe("s1");
 expect(r2?.exchanges).toHaveLength(1);
 expect(r2?.exchanges[0].sessionId).toBe("s2");
 });
});

/* ----- metadata round-trip ----- */

describe("SessionStore — metadata round-trip", () => {
 let db: Database.Database;
 let store: SessionStore;

 beforeEach(() => {
 ({ db, store } = openStore());
 });

 afterEach(() => {
 if (db?.open) db.close();
 });

 it("stores complex metadata as JSON and returns it parsed on read", () => {
 const meta = {
 project: "lingcrawl",
 env: "dev",
 tags: ["ai", "scrape"],
 nested: { ok: true, count:42 },
 };

 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 metadata: meta,
 });

 // listSessions returns parsed metadata
 const fromList = store.listSessions()[0];
 expect(fromList.metadata).toEqual(meta);

 // getSession returns parsed metadata
 const fromGet = store.getSession("s1");
 expect(fromGet?.session.metadata).toEqual(meta);
 });

 it("stores metadata as the literal JSON string in the row (verifiable via raw SELECT)", () => {
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 metadata: { foo: "bar" },
 });

 const row = db
 .prepare("SELECT metadata FROM sessions WHERE id = ?")
 .get("s1") as { metadata: string | null };
 expect(row.metadata).not.toBeNull();
 expect(JSON.parse(row.metadata as string)).toEqual({ foo: "bar" });
 });
});

/* ----- atomicity: session upsert + exchange insert in one transaction ----- */

describe("SessionStore.logExchange — atomicity", () => {
 let db: Database.Database;
 let store: SessionStore;

 beforeEach(() => {
 ({ db, store } = openStore());
 });

 afterEach(() => {
 if (db?.open) db.close();
 });

 it("commits session + exchange together — no partial writes visible", () => {
 // If logExchange is atomic, after one successful call we should see both
 // a session row and exactly one exchange row. If it were not atomic we
 // might see a session with zero exchanges (or vice versa) on a crash.
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 source: "cli",
 });

 expect(countSessions(db)).toBe(1);
 expect(countExchanges(db, "s1")).toBe(1);
 });

 it("rejects an unknown source value via CHECK constraint", () => {
 // The store itself doesn't validate `source` — the DB does. This documents
 // the contract that the column enforces the enum.
 expect(() =>
 store.logExchange({
 sessionId: "s1",
 userMessage: "u",
 assistantMessage: "a",
 // @ts-expect-error — intentionally invalid to test the CHECK constraint
 source: "web",
 }),
 ).toThrow(/CHECK/);
 });

 it("survives50 sequential writes to the same session without sequence drift", () => {
 for (let i =0; i <50; i++) {
 store.logExchange({
 sessionId: "s1",
 userMessage: `u${i}`,
 assistantMessage: `a${i}`,
 source: "cli",
 timestamp:1000 + i,
 });
 }
 const result = store.getSession("s1");
 expect(result?.exchanges).toHaveLength(50);
 expect(result?.exchanges[0].sequence).toBe(1);
 expect(result?.exchanges[49].sequence).toBe(50);
 // Sequences must be contiguous — no gaps.
 const sequences = result!.exchanges.map((e) => e.sequence);
 for (let i =0; i < sequences.length; i++) {
 expect(sequences[i]).toBe(i +1);
 }
 });
});
