/**
 * Unit tests for `memory/store.ts` (issue #69).
 *
 * Strategy: each test builds a fresh in-memory SQLite connection via
 * `_initDb(":memory:")` (the same pattern `db/client.test.ts` uses) and
 * closes it in `afterEach`. We never touch the process-wide `getDb()`
 * singleton because it depends on `config.DATA_DIR` and is covered by
 * snips / E2E.
 *
 * We monkey-patch `config.MEMORY_CHAR_LIMIT` and `config.USER_CHAR_LIMIT`
 * via `Object.defineProperty` to exercise boundary conditions cheaply —
 * the default 2200/1375 ceilings would force every test to allocate
 * multi-KB strings, which is wasteful and obscures intent.
 */
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { config } from "../../../config.js";
import { MemoryStoreImpl } from "../../store.js";
import { CapacityExceededError } from "../../errors.js";
import type { MemoryEntry, Usage } from "../../types.js";

/** Build a fresh in-memory DB + store, with patched char limits. */
function makeStore(limits: { memory: number; user: number }): {
  db: Database.Database;
  store: MemoryStoreImpl;
  restore: () => void;
} {
  const db = _initDb(":memory:");
  const store = new MemoryStoreImpl(db);

  const originalMemory = config.MEMORY_CHAR_LIMIT;
  const originalUser = config.USER_CHAR_LIMIT;
  Object.defineProperty(config, "MEMORY_CHAR_LIMIT", {
    value: limits.memory,
    configurable: true,
  });
  Object.defineProperty(config, "USER_CHAR_LIMIT", {
    value: limits.user,
    configurable: true,
  });

  return {
    db,
    store,
    restore: () => {
      Object.defineProperty(config, "MEMORY_CHAR_LIMIT", {
        value: originalMemory,
        configurable: true,
      });
      Object.defineProperty(config, "USER_CHAR_LIMIT", {
        value: originalUser,
        configurable: true,
      });
      if (db.open) db.close();
    },
  };
}

describe("MemoryStore — add (happy path)", () => {
  let db: Database.Database;
  let store: MemoryStoreImpl;
  let restore: () => void;

  beforeEach(() => {
    ({ db, store, restore } = makeStore({ memory: 100, user: 50 }));
  });
  afterEach(() => restore());

  it("inserts a row and returns the new id", async () => {
    const { id } = await store.add("memory", "hello world");
    expect(typeof id).toBe("number");
    expect(id).toBeGreaterThan(0);

    const row = db
      .prepare("SELECT * FROM memory_entries WHERE id = ?")
      .get(id) as { target: string; content: string } | undefined;
    expect(row?.target).toBe("memory");
    expect(row?.content).toBe("hello world");
  });

  it("returns a usage snapshot that reflects the new total", async () => {
    const r1 = await store.add("memory", "abc");
    expect(r1.usage).toEqual<Usage>({
      target: "memory",
      used: 3,
      limit: 100,
      pct: 3.0,
    });

    const r2 = await store.add("memory", "12345");
    expect(r2.usage).toEqual<Usage>({
      target: "memory",
      used: 8,
      limit: 100,
      pct: 8.0,
    });
    expect(r2.id).not.toBe(r1.id);
  });

  it("isolates usage accounting per target", async () => {
    await store.add("memory", "abcde"); // memory = 5
    const userResult = await store.add("user", "x"); // user = 1
    expect(userResult.usage).toEqual<Usage>({
      target: "user",
      used: 1,
      limit: 50,
      pct: 2.0,
    });

    const memUsage = await store.getUsage("memory");
    expect(memUsage.used).toBe(5);
  });

  it("stores the content verbatim (no trimming / normalization)", async () => {
    const { id } = await store.add("user", "  spaces  around  ");
    const got = await store.get(id);
    expect(got?.content).toBe("  spaces  around  ");
  });
});

describe("MemoryStore — add (capacity boundaries)", () => {
  let db: Database.Database;
  let store: MemoryStoreImpl;
  let restore: () => void;

  beforeEach(() => {
    ({ db, store, restore } = makeStore({ memory: 10, user: 5 }));
  });
  afterEach(() => restore());

  it("accepts an entry that brings used exactly to the limit (used + newLen === limit)", async () => {
    // 5 chars already, add another 5 → 10/10
    await store.add("memory", "12345");
    const r = await store.add("memory", "abcde");
    expect(r.usage.used).toBe(10);
    expect(r.usage.limit).toBe(10);
    expect(r.usage.pct).toBe(100);
  });

  it("rejects an entry that would push used 1 char past the limit", async () => {
    // 5 chars already, add another 6 → would be 11/10
    await store.add("memory", "12345");
    await expect(store.add("memory", "abcdef")).rejects.toThrow(
      CapacityExceededError,
    );
  });

  it("rejects an empty add once any prior entry exists at the limit", async () => {
    await store.add("user", "12345"); // 5/5
    await expect(store.add("user", "")).rejects.toThrow(CapacityExceededError);
  });

  it("accepts an empty add when the store is empty (0 + 0 <= limit)", async () => {
    const r = await store.add("user", "");
    expect(r.usage.used).toBe(0);
  });

  it("CapacityExceededError carries currentEntries and usage with full snapshot", async () => {
    await store.add("memory", "aaa");
    await store.add("memory", "bbbbb");
    // 8/10, next add of length 3 would be 11/10
    let caught: unknown;
    try {
      await store.add("memory", "xxx");
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(CapacityExceededError);
    const err = caught as CapacityExceededError;
    expect(err.usage).toEqual<Usage>({
      target: "memory",
      used: 8,
      limit: 10,
      pct: 80,
    });
    expect(err.currentEntries).toHaveLength(2);
    expect(err.currentEntries.map((e) => e.content).sort()).toEqual([
      "aaa",
      "bbbbb",
    ]);
    // The DB should not contain the rejected row.
    const rowCount = (
      db.prepare("SELECT count(*) AS n FROM memory_entries").get() as {
        n: number;
      }
    ).n;
    expect(rowCount).toBe(2);
  });
});

describe("MemoryStore — get", () => {
  let store: MemoryStoreImpl;
  let restore: () => void;

  beforeEach(() => {
    ({ store, restore } = makeStore({ memory: 50, user: 50 }));
  });
  afterEach(() => restore());

  it("returns null when no row exists for the given id", async () => {
    const got = await store.get(99999);
    expect(got).toBeNull();
  });

  it("returns the row when the id exists", async () => {
    const { id } = await store.add("user", "profile line");
    const got = await store.get(id);
    expect(got).toMatchObject<Partial<MemoryEntry>>({
      id,
      target: "user",
      content: "profile line",
    });
    expect(got!.createdAt).toBeGreaterThan(0);
    expect(got!.updatedAt).toBeGreaterThan(0);
  });

  it("returns distinct entries for distinct ids", async () => {
    const a = await store.add("memory", "alpha");
    const b = await store.add("memory", "beta");
    expect((await store.get(a.id))?.content).toBe("alpha");
    expect((await store.get(b.id))?.content).toBe("beta");
  });
});

describe("MemoryStore — list", () => {
  let store: MemoryStoreImpl;
  let restore: () => void;

  beforeEach(() => {
    ({ store, restore } = makeStore({ memory: 100, user: 100 }));
  });
  afterEach(() => restore());

  it("returns an empty array when no rows match the target", async () => {
    expect(await store.list("memory")).toEqual([]);
    expect(await store.list("user")).toEqual([]);
  });

  it("returns rows in ascending id order regardless of insertion order", async () => {
    const a = await store.add("memory", "first");
    const b = await store.add("memory", "second");
    const c = await store.add("memory", "third");
    const entries = await store.list("memory");
    expect(entries.map((e) => e.id)).toEqual([a.id, b.id, c.id]);
    expect(entries.map((e) => e.content)).toEqual(["first", "second", "third"]);
  });

  it("scopes results to the requested target only", async () => {
    const m1 = await store.add("memory", "m1");
    const u1 = await store.add("user", "u1");
    const m2 = await store.add("memory", "m2");
    const u2 = await store.add("user", "u2");

    const mem = await store.list("memory");
    const user = await store.list("user");

    expect(mem.map((e) => e.id)).toEqual([m1.id, m2.id]);
    expect(user.map((e) => e.id)).toEqual([u1.id, u2.id]);
    expect(mem.every((e) => e.target === "memory")).toBe(true);
    expect(user.every((e) => e.target === "user")).toBe(true);
  });
});

describe("MemoryStore — getUsage", () => {
  let store: MemoryStoreImpl;
  let restore: () => void;

  beforeEach(() => {
    ({ store, restore } = makeStore({ memory: 200, user: 80 }));
  });
  afterEach(() => restore());

  it("reports used=0 / pct=0 for an empty store", async () => {
    expect(await store.getUsage("memory")).toEqual<Usage>({
      target: "memory",
      used: 0,
      limit: 200,
      pct: 0,
    });
    expect(await store.getUsage("user")).toEqual<Usage>({
      target: "user",
      used: 0,
      limit: 80,
      pct: 0,
    });
  });

  it("sums LENGTH(content) across all entries of the target", async () => {
    await store.add("memory", "abc"); // 3
    await store.add("memory", ""); // 0
    await store.add("memory", "12345"); // 5
    const usage = await store.getUsage("memory");
    expect(usage.used).toBe(8);
    expect(usage.pct).toBe(4.0);
  });

  it("computes pct as used/limit*100 rounded to 1 decimal", async () => {
    await store.add("user", "x".repeat(20)); // 20/80 = 25%
    const usage = await store.getUsage("user");
    expect(usage.used).toBe(20);
    expect(usage.pct).toBe(25.0);
  });

  it("returns the configured limit, not a hardcoded constant", async () => {
    const usage = await store.getUsage("memory");
    expect(usage.limit).toBe(config.MEMORY_CHAR_LIMIT);
  });
});

describe("MemoryStore — add transaction atomicity", () => {
  let db: Database.Database;
  let store: MemoryStoreImpl;
  let restore: () => void;

  beforeEach(() => {
    ({ db, store, restore } = makeStore({ memory: 10, user: 10 }));
  });
  afterEach(() => restore());

  it("rejected add does not insert a partial row", async () => {
    await store.add("memory", "12345"); // 5/10
    const before = (
      db.prepare("SELECT count(*) AS n FROM memory_entries").get() as {
        n: number;
      }
    ).n;
    await expect(store.add("memory", "toolongxx")).rejects.toThrow(
      CapacityExceededError,
    );
    const after = (
      db.prepare("SELECT count(*) AS n FROM memory_entries").get() as {
        n: number;
      }
    ).n;
    expect(after).toBe(before);
  });
});
