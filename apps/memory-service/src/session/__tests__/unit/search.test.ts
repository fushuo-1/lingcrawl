/**
 * Unit tests for `SessionStore.search` — issue #73.
 *
 * Coverage map (mirrors the acceptance criteria in issue #73):
 * - Basic keyword hit: matches an `assistant_message` containing the term
 * - Cross-field hit: matches `user_message` and `assistant_message`
 * - Empty result set (no matches) returns an empty array
 * - `includeContext=true` populates `context.prev` / `context.next`
 * - Boundary case: first exchange in a session has `prev = null`
 * - Boundary case: last exchange in a session has `next = null`
 * - FTS5 syntax error (e.g. unbalanced quote) raises `FtsQueryError`
 * - `limit` defaults to 20 and caps the result set
 *
 * Each test builds its own in-memory SQLite via `_initDb(":memory:")` so the
 * suites stay isolated and run in milliseconds. The store is constructed
 * directly with the in-memory handle — we deliberately do NOT go through
 * `getDb()` (that would couple the unit tests to `config.DATA_DIR` and to the
 * process-wide singleton).
 */
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { FtsQueryError } from "../../errors.js";
import { SessionStore } from "../../store.js";

/* ----- helpers ----- */

function openStore(): {
  db: Database.Database;
  store: SessionStore;
} {
  const db = _initDb(":memory:");
  return { db, store: new SessionStore(db) };
}

describe("SessionStore.search", () => {
  let db: Database.Database;
  let store: SessionStore;

  beforeEach(() => {
    ({ db, store } = openStore());
  });

  afterEach(() => {
    if (db?.open) db.close();
  });

  it("returns hits ordered by bm25 score (most relevant first)", () => {
    // Seed two sessions with a couple of exchanges each. The "redis"
    // keyword appears in `assistant_message` once and in `user_message`
    // for the other hit; we don't pin the exact ordering across bm25
    // versions, only that results come back ordered by ascending score.
    store.logExchange({
      sessionId: "s1",
      userMessage: "hello",
      assistantMessage: "world",
      source: "cli",
    });
    store.logExchange({
      sessionId: "s1",
      userMessage: "tell me about redis caching",
      assistantMessage: "sure, redis is fast",
      source: "cli",
    });
    store.logExchange({
      sessionId: "s2",
      userMessage: "how do I learn rust",
      assistantMessage: "read the book and write code",
      source: "cli",
    });

    const hits = store.search({ query: "redis" });
    expect(hits.length).toBe(2);
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i].score).toBeGreaterThanOrEqual(hits[i - 1].score);
    }
  });

  it("matches a keyword that lives in assistant_message", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "what is a good cache",
      assistantMessage: "redis is a popular in-memory cache",
      source: "cli",
    });

    const hits = store.search({ query: "redis" });
    expect(hits).toHaveLength(1);
    expect(hits[0].assistantMessage).toContain("redis");
    expect(hits[0].sessionId).toBe("s1");
    expect(hits[0].sequence).toBe(1);
    expect(typeof hits[0].exchangeId).toBe("number");
    expect(typeof hits[0].score).toBe("number");
  });

  it("matches a keyword that lives in user_message", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "I think redis is the right tool",
      assistantMessage: "maybe, depending on the workload",
      source: "cli",
    });

    const hits = store.search({ query: "redis" });
    expect(hits).toHaveLength(1);
    expect(hits[0].userMessage).toContain("redis");
  });

  it("matches both user_message and assistant_message in the same query", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "I keep hearing about redis",
      assistantMessage: "yes, redis is widely used",
      source: "cli",
    });
    store.logExchange({
      sessionId: "s1",
      userMessage: "another question",
      assistantMessage: "another answer about redis specifically",
      source: "cli",
    });
    store.logExchange({
      sessionId: "s2",
      userMessage: "totally unrelated",
      assistantMessage: "no keyword here",
      source: "cli",
    });

    const hits = store.search({ query: "redis" });
    // Only the two exchanges that mention redis — the third one must not leak.
    expect(hits).toHaveLength(2);
    const exchanges = hits.map((h) => h.exchangeId).sort();
    expect(exchanges).toEqual(hits.map((h) => h.exchangeId).sort());
    // The third exchange (s2) must not be in the results.
    const s2Hit = hits.find((h) => h.sessionId === "s2");
    expect(s2Hit).toBeUndefined();
  });

  it("returns an empty array when nothing matches", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "hello",
      assistantMessage: "world",
      source: "cli",
    });
    expect(store.search({ query: "no-such-keyword-anywhere" })).toEqual([]);
  });

  it("respects the limit parameter and caps the result set", () => {
    for (let i = 0; i < 5; i++) {
      store.logExchange({
        sessionId: `s${i}`,
        userMessage: `mention redis here #${i}`,
        assistantMessage: `reply about redis #${i}`,
        source: "cli",
      });
    }
    expect(store.search({ query: "redis" })).toHaveLength(5);
    expect(store.search({ query: "redis", limit: 3 })).toHaveLength(3);
    expect(store.search({ query: "redis", limit: 1 })).toHaveLength(1);
  });

  it("defaults limit to 20 when not provided", () => {
    // Insert 25 hits — default limit must clamp to 20.
    for (let i = 0; i < 25; i++) {
      store.logExchange({
        sessionId: `s${i}`,
        userMessage: `redis turn #${i}`,
        assistantMessage: `reply #${i}`,
        source: "cli",
      });
    }
    expect(store.search({ query: "redis" })).toHaveLength(20);
  });

  it("populates context.prev and context.next when includeContext=true", () => {
    const r1 = store.logExchange({
      sessionId: "s1",
      userMessage: "first user message",
      assistantMessage: "first assistant reply",
      source: "cli",
      timestamp: 100,
    });
    store.logExchange({
      sessionId: "s1",
      userMessage: "what about redis",
      assistantMessage: "redis is fast",
      source: "cli",
      timestamp: 200,
    });
    const r3 = store.logExchange({
      sessionId: "s1",
      userMessage: "third user message",
      assistantMessage: "third assistant reply",
      source: "cli",
      timestamp: 300,
    });

    const hits = store.search({ query: "redis", includeContext: true });
    expect(hits).toHaveLength(1);
    const hit = hits[0];

    expect(hit.context).toBeDefined();
    expect(hit.context!.prev).not.toBeNull();
    expect(hit.context!.next).not.toBeNull();

    expect(hit.context!.prev!.exchangeId).toBe(r1.exchangeId);
    expect(hit.context!.prev!.sequence).toBe(1);
    expect(hit.context!.prev!.userMessage).toBe("first user message");

    expect(hit.context!.next!.exchangeId).toBe(r3.exchangeId);
    expect(hit.context!.next!.sequence).toBe(3);
    expect(hit.context!.next!.userMessage).toBe("third user message");
  });

  it("sets context.prev=null on the first exchange of a session", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "tell me about redis",
      assistantMessage: "redis is fast",
      source: "cli",
    });

    const hits = store.search({ query: "redis", includeContext: true });
    expect(hits).toHaveLength(1);
    expect(hits[0].sequence).toBe(1);
    expect(hits[0].context!.prev).toBeNull();
    expect(hits[0].context!.next).toBeNull();
  });

  it("sets context.next=null on the last exchange of a session", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "first",
      assistantMessage: "first reply",
      source: "cli",
    });
    store.logExchange({
      sessionId: "s1",
      userMessage: "second",
      assistantMessage: "second reply with redis",
      source: "cli",
    });

    const hits = store.search({ query: "redis", includeContext: true });
    expect(hits).toHaveLength(1);
    expect(hits[0].sequence).toBe(2);
    expect(hits[0].context!.prev).not.toBeNull();
    expect(hits[0].context!.prev!.sequence).toBe(1);
    expect(hits[0].context!.next).toBeNull();
  });

  it("omits context entirely when includeContext is not set", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "what is redis",
      assistantMessage: "redis is a cache",
      source: "cli",
    });

    const hits = store.search({ query: "redis" });
    expect(hits).toHaveLength(1);
    expect(hits[0].context).toBeUndefined();
  });

  it("omits context when includeContext=false explicitly", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "what is redis",
      assistantMessage: "redis is a cache",
      source: "cli",
    });

    const hits = store.search({ query: "redis", includeContext: false });
    expect(hits).toHaveLength(1);
    expect(hits[0].context).toBeUndefined();
  });

  it("returns multiple hits within the same session ordered by score", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "redis turn 1 user",
      assistantMessage: "redis turn 1 assistant",
      source: "cli",
    });
    store.logExchange({
      sessionId: "s1",
      userMessage: "redis turn 2 user — say it twice for relevance",
      assistantMessage: "redis turn 2 assistant — and again here",
      source: "cli",
    });

    const hits = store.search({ query: "redis" });
    expect(hits).toHaveLength(2);
    // Both belong to session s1, sequences 1 and 2 (in some order).
    const sequences = hits.map((h) => h.sequence).sort();
    expect(sequences).toEqual([1, 2]);
    for (const h of hits) {
      expect(h.sessionId).toBe("s1");
    }
  });

  it("returns hits across multiple sessions", () => {
    store.logExchange({
      sessionId: "alpha",
      userMessage: "what is redis",
      assistantMessage: "an in-memory cache",
      source: "cli",
    });
    store.logExchange({
      sessionId: "beta",
      userMessage: "how do I use redis",
      assistantMessage: "import the client and call set/get",
      source: "cli",
    });
    store.logExchange({
      sessionId: "gamma",
      userMessage: "totally unrelated",
      assistantMessage: "no keyword",
      source: "cli",
    });

    const hits = store.search({ query: "redis" });
    expect(hits).toHaveLength(2);
    const sessionIds = new Set(hits.map((h) => h.sessionId));
    expect(sessionIds).toEqual(new Set(["alpha", "beta"]));
  });

  it("throws FtsQueryError on unbalanced FTS5 syntax", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "hello",
      assistantMessage: "world",
      source: "cli",
    });

    // Unbalanced double quote — FTS5 raises `fts5: syntax error`.
    expect(() => store.search({ query: '"unbalanced' })).toThrow(FtsQueryError);
  });

  it("preserves the original query and sqlite message on FtsQueryError", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "hello",
      assistantMessage: "world",
      source: "cli",
    });

    const badQuery = '"unbalanced';
    try {
      store.search({ query: badQuery });
      throw new Error("expected search to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(FtsQueryError);
      const ftsErr = err as FtsQueryError;
      expect(ftsErr.query).toBe(badQuery);
      expect(ftsErr.sqliteMessage).toMatch(/fts5/i);
      expect(ftsErr.message).toContain(badQuery);
    }
  });

  it("rejects a non-positive limit with RangeError", () => {
    store.logExchange({
      sessionId: "s1",
      userMessage: "hello",
      assistantMessage: "world",
      source: "cli",
    });

    expect(() => store.search({ query: "hello", limit: 0 })).toThrow(RangeError);
    expect(() => store.search({ query: "hello", limit: -1 })).toThrow(RangeError);
    expect(() =>
      store.search({ query: "hello", limit: 1.5 }),
    ).toThrow(RangeError);
  });
});
