/**
 * Unit tests for the `lingcrawl-memory` CLI (issue #77).
 *
 * Strategy
 * --------
 * We deliberately do NOT spawn a subprocess. The CLI is split into:
 *
 *   - `cli/memory.ts`  → pure-ish `listMemory()` / `showMemory(id)` etc. that
 *                         return strings
 *   - `cli/session.ts` → same shape for sessions
 *   - `cli/index.ts`   → `run(argv)` + `buildProgram()` for the Commander
 *                         wiring
 *
 * The tests import the runnable functions directly and assert on the
 * returned strings. For the `run()` integration we also exercise a couple
 * of end-to-end paths through `run([...])` to confirm the dispatch +
 * exit-code plumbing works.
 *
 * DB handling
 * -----------
 * Every test gets its own in-memory SQLite via `_initDb(":memory:")`,
 * which the `getDb()` singleton transparently picks up. `closeDb()` in
 * `afterEach` resets the singleton so the next test starts clean. We
 * seed the DB with `MemoryStoreImpl` / `SessionStore` — i.e. we go through
 * the same code path a real user would, never poking at SQL directly
 * except in the few places the CLI itself uses raw SQL (search).
 */
import { _initDb, closeDb, getDb } from "../../../db/client.js";
import { MemoryStoreImpl } from "../../../memory/store.js";
import { SessionStore } from "../../../session/store.js";
import { CapacityExceededError } from "../../../memory/errors.js";
import {
  CliError,
  listMemory,
  removeMemory,
  searchMemory,
  showMemory,
  statsMemory,
  explainMemoryError,
} from "../../memory.js";
import {
  listSessions,
  searchSessions,
  showSession,
} from "../../session.js";
import { buildProgram, run } from "../../index.js";

/* ----------------------------- test fixtures ----------------------------- */

let db: ReturnType<typeof _initDb>;

beforeEach(() => {
  // Force a fresh in-memory DB on every test. `getDb()` caches the handle
  // in a module-level variable, so `closeDb()` is required to reset it.
  db = _initDb(":memory:");
});

afterEach(() => {
  closeDb();
});

/** Seed two `memory` entries and two `user` entries. Returns the ids. */
async function seedMemory(): Promise<{ memory: number[]; user: number[] }> {
  const store = new MemoryStoreImpl(db);
  const m1 = await store.add("memory", "Project uses pnpm + TypeScript");
  const m2 = await store.add("memory", "Run tests with `pnpm harness jest`");
  const u1 = await store.add("user", "Prefers concise responses");
  const u2 = await store.add("user", "Communicates in English");
  return { memory: [m1.id, m2.id], user: [u1.id, u2.id] };
}

/** Seed a single session with 2 exchanges; returns the session id. */
function seedSession(): string {
  const store = new SessionStore(db);
  store.logExchange({
    sessionId: "s1",
    source: "cli",
    clientName: "test-runner",
    userMessage: "how do I cache things?",
    assistantMessage: "use redis",
  });
  store.logExchange({
    sessionId: "s1",
    source: "cli",
    userMessage: "what about TTL?",
    assistantMessage: "redis TTL is set on the key",
  });
  return "s1";
}

/* --------------------------- memory subcommands --------------------------- */

describe("memory list", () => {
  it("groups entries by target with capacity usage", async () => {
    await seedMemory();
    const out = await listMemory();

    // Two target blocks, in the order [memory, user].
    expect(out).toContain("== memory (2 entries,");
    expect(out).toContain("== user (2 entries,");
    expect(out).toContain("[1] Project uses pnpm + TypeScript");
    expect(out).toContain("[2] Run tests with `pnpm harness jest`");
    expect(out).toContain("[3] Prefers concise responses");
    expect(out).toContain("[4] Communicates in English");

    // Capacity bar uses locale-grouped numbers.
    expect(out).toMatch(/\d+% — \d+\/\d+ chars/);
  });

  it("returns a friendly empty message when there are no entries", async () => {
    const out = await listMemory();
    expect(out).toContain("No memory entries yet.");
  });
});

describe("memory show", () => {
  it("shows full details for a known id", async () => {
    const { memory } = await seedMemory();
    const out = await showMemory(memory[0]);
    expect(out).toContain(`Memory entry #${memory[0]}`);
    expect(out).toContain("(memory)");
    expect(out).toContain("Project uses pnpm + TypeScript");
    expect(out).toMatch(/Created: \d{4}-\d{2}-\d{2}/);
    expect(out).toMatch(/Updated: \d{4}-\d{2}-\d{2}/);
  });

  it("throws CliError for an unknown id", async () => {
    await seedMemory();
    await expect(showMemory(9999)).rejects.toBeInstanceOf(CliError);
    try {
      await showMemory(9999);
    } catch (err) {
      expect((err as Error).message).toContain("9999");
    }
  });
});

describe("memory search", () => {
  it("finds entries by case-insensitive substring", async () => {
    await seedMemory();
    const out = await searchMemory("PNPM");
    expect(out).toContain("Found 1 match for \"PNPM\"");
    expect(out).toContain("Project uses pnpm + TypeScript");
  });

  it("matches across both targets", async () => {
    await seedMemory();
    const out = await searchMemory("c");
    // "c" hits: "Project uses pnpm + TypeScript", "Communicates in English",
    // and the assistant answer "use redis" / "concise" → "Prefers concise responses".
    expect(out).toMatch(/Found \d+ matches/);
    expect(out).toContain("Communicates in English");
  });

  it("returns a friendly message when nothing matches", async () => {
    const out = await searchMemory("nonexistent-token-xyz");
    expect(out).toContain("No memory entries match");
  });

  it("rejects an empty query with CliError", async () => {
    await expect(searchMemory("   ")).rejects.toBeInstanceOf(CliError);
  });
});

describe("memory remove", () => {
  it("removes the entry by id and reports success", async () => {
    const { memory } = await seedMemory();
    const out = await removeMemory(memory[0]);
    expect(out).toContain(`Removed memory entry #${memory[0]}`);

    // Verify the row is actually gone (the `show` command would 404 too).
    const remaining = await new MemoryStoreImpl(db).list("memory");
    expect(remaining.map((e) => e.id)).not.toContain(memory[0]);
  });

  it("throws CliError for an unknown id", async () => {
    await expect(removeMemory(424242)).rejects.toBeInstanceOf(CliError);
  });
});

describe("memory stats", () => {
  it("reports capacity for both targets", async () => {
    await seedMemory();
    const out = await statsMemory();
    expect(out).toContain("Memory capacity");
    expect(out).toMatch(/memory\s+\d+\.\d%\s+\d+\s+\/\s+\d+ chars/);
    expect(out).toMatch(/user\s+\d+\.\d%\s+\d+\s+\/\s+\d+ chars/);
  });
});

describe("explainMemoryError (user-facing error mapping)", () => {
  it("maps CapacityExceededError to a one-line CLI message", async () => {
    const store = new MemoryStoreImpl(db);
    // Force the capacity error by writing more than the default allows.
    try {
      await store.add("memory", "x".repeat(5000));
    } catch (err) {
      const msg = explainMemoryError(err);
      expect(msg).not.toBeNull();
      expect(msg).toContain("Capacity exceeded");
      expect(msg).toContain("memory");
    }
  });

  it("returns null for non-store errors", () => {
    expect(explainMemoryError(new Error("nope"))).toBeNull();
    expect(explainMemoryError("a string")).toBeNull();
  });
});

/* -------------------------- session subcommands --------------------------- */

describe("session list", () => {
  it("returns the most recent sessions, newest first", async () => {
    const s1 = seedSession();
    const store = new SessionStore(db);
    // A second, newer session — should appear first.
    store.logExchange({
      sessionId: "s2",
      source: "mcp",
      userMessage: "later",
      assistantMessage: "later reply",
    });

    const out = await listSessions(10);
    expect(out).toContain(s1);
    expect(out).toContain("s2");
    // Newer session appears before older one in the output.
    expect(out.indexOf("s2")).toBeLessThan(out.indexOf(s1));
  });

  it("respects the limit argument", async () => {
    const store = new SessionStore(db);
    for (let i = 0; i < 5; i++) {
      store.logExchange({
        sessionId: `s${i}`,
        source: "cli",
        userMessage: "x",
        assistantMessage: "y",
      });
    }
    const out = await listSessions(3);
    // We expect 3 session lines, plus the header line.
    const bodyLines = out.split("\n").slice(1).filter((l) => l.trim().length > 0);
    expect(bodyLines).toHaveLength(3);
  });

  it("returns a friendly empty message when there are no sessions", async () => {
    const out = await listSessions(10);
    expect(out).toContain("No sessions logged yet.");
  });
});

describe("session show", () => {
  it("renders the full session with metadata and ordered exchanges", async () => {
    const id = seedSession();
    const out = await showSession(id);
    expect(out).toContain(`Session ${id}`);
    expect(out).toContain("[cli");
    expect(out).toContain("test-runner"); // clientName
    expect(out).toMatch(/started \d{4}-\d{2}-\d{2}/);
    expect(out).toContain("[1] user:      how do I cache things?");
    expect(out).toContain("    assistant: use redis");
    expect(out).toContain("[2] user:      what about TTL?");
    expect(out).toContain("    assistant: redis TTL is set on the key");
  });

  it("throws CliError for an unknown session id", async () => {
    await expect(showSession("nope")).rejects.toBeInstanceOf(CliError);
  });
});

describe("session search", () => {
  it("finds exchanges by FTS5 keyword", async () => {
    seedSession();
    const out = await searchSessions("redis");
    expect(out).toMatch(/Found 2 hits/);
    expect(out).toContain("[session s1 #1]");
    expect(out).toContain("[session s1 #2]");
    expect(out).toContain("use redis");
    expect(out).toContain("redis TTL");
  });

  it("returns a friendly message when nothing matches", async () => {
    const out = await searchSessions("nonexistent-xyz");
    expect(out).toContain("No exchanges match");
  });

  it("surfaces an FTS5 syntax error as a CliError, not a raw SQLite error", async () => {
    seedSession();
    // A bare `*` is not a valid FTS5 query — triggers `FtsQueryError`
    // inside SessionStore, which the CLI rewraps as CliError.
    await expect(searchSessions('"unterminated')).rejects.toBeInstanceOf(CliError);
  });

  it("rejects an empty query with CliError", async () => {
    await expect(searchSessions("")).rejects.toBeInstanceOf(CliError);
  });
});

/* ---------------------- run() / buildProgram() plumbing ------------------- */

describe("run() — Commander dispatch integration", () => {
  it("returns exit 0 for a successful `memory stats`", async () => {
    const code = await run(["memory", "stats"]);
    expect(code).toBe(0);
  });

  it("returns exit 1 for an unknown subcommand", async () => {
    const code = await run(["memory", "wat"]);
    expect(code).toBe(1);
  });

  it("returns exit 1 for `memory show` against an unknown id", async () => {
    const code = await run(["memory", "show", "9999"]);
    expect(code).toBe(1);
  });

  it("returns exit 1 for `session show` against an unknown id", async () => {
    const code = await run(["session", "show", "nope"]);
    expect(code).toBe(1);
  });

  it("builds a program with both `memory` and `session` subcommands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("memory");
    expect(names).toContain("session");
  });
});

/* -------------------- singleton isolation sanity check -------------------- */

describe("getDb() / closeDb() — test isolation", () => {
  it("seeds from the same DB the CLI subcommands read from", async () => {
    // Smoke test that proves the CLI is actually using the singleton,
    // not a fresh handle: seed via the store, then read via listMemory.
    const store = new MemoryStoreImpl(getDb());
    const { id } = await store.add("memory", "singleton check");
    const out = await listMemory();
    expect(out).toContain(`[${id}] singleton check`);
  });
});
