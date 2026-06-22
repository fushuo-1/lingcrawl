/**
 * Unit tests for the `lingcrawl-memory` CLI (issue #97 — knowledge base edition).
 *
 * Strategy
 * --------
 * We deliberately do NOT spawn a subprocess. The CLI is split into:
 *
 *   - `cli/kb.ts`    → pure `listNotes()` / `searchNotes()` that return strings
 *   - `cli/index.ts` → `run(argv)` + `buildProgram()` for the Commander wiring
 *
 * DB handling
 * -----------
 * The CLI functions use `getDb()` internally, which opens a file-based DB
 * at `config.DATA_DIR/memory.db`. We patch both `config.DATA_DIR` and
 * `config.KB_DATA_DIR` to a temp directory so each test gets a fresh DB.
 * `closeDb()` in `afterEach` resets the singleton.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { closeDb, getDb } from "../../../db/client.js";
import { FileManager } from "../../../kb/file-manager.js";
import { IndexStore } from "../../../kb/index-store.js";
import { KnowledgeStore } from "../../../kb/knowledge-store.js";
import { config } from "../../../config.js";
import { CliError, listNotes, searchNotes } from "../../kb.js";
import { buildProgram, run } from "../../index.js";

/* ----------------------------- test fixtures ----------------------------- */

let tmpDir: string;
let origDataDir: string;
let origKbDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-test-"));
  origDataDir = config.DATA_DIR;
  origKbDir = config.KB_DATA_DIR;
  config.DATA_DIR = tmpDir;
  config.KB_DATA_DIR = tmpDir;
});

afterEach(() => {
  config.DATA_DIR = origDataDir;
  config.KB_DATA_DIR = origKbDir;
  closeDb();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Seed notes via KnowledgeStore using the getDb() singleton (same as CLI). */
function seedNotes(): void {
  const db = getDb();
  const fileManager = new FileManager(tmpDir);
  const indexStore = new IndexStore(db);
  const store = new KnowledgeStore({ fileManager, indexStore });

  store.writeNote({
    content: "# Docker 构建\n\nDocker build 后要 prune。",
    tags: ["调试经验", "Docker"],
    path: "调试经验/Docker/构建后磁盘膨胀.md",
  });
  store.writeNote({
    content: "# TypeScript 类型体操\n\n一些类型技巧。",
    tags: ["TypeScript"],
    path: "调试经验/TypeScript/类型体操.md",
  });
}

/* --------------------------- kb subcommands --------------------------- */

describe("kb list", () => {
  it("returns a friendly empty message when there are no notes", async () => {
    const out = await listNotes();
    expect(out).toContain("No notes yet");
  });

  it("lists all notes with path, title, tags", async () => {
    seedNotes();
    const out = await listNotes();
    expect(out).toContain("Found 2 notes");
    expect(out).toContain("调试经验/Docker/构建后磁盘膨胀.md");
    expect(out).toContain("调试经验/TypeScript/类型体操.md");
  });

  it("filters by path prefix", async () => {
    seedNotes();
    const out = await listNotes("调试经验/Docker");
    expect(out).toContain("Found 1 note");
    expect(out).toContain("构建后磁盘膨胀");
  });

  it("returns a friendly message when prefix matches nothing", async () => {
    seedNotes();
    const out = await listNotes("nonexistent/path");
    expect(out).toContain("No notes found");
  });
});

describe("kb search", () => {
  it("finds notes by keyword via FTS5", async () => {
    seedNotes();
    const out = await searchNotes("Docker");
    expect(out).toContain("Found 1 hit");
    expect(out).toContain("构建后磁盘膨胀");
  });

  it("returns a friendly message when nothing matches", async () => {
    seedNotes();
    // Use quoted phrase to avoid FTS5 column-name interpretation of hyphens
    const out = await searchNotes('"nonexistent-xyz"');
    expect(out).toContain("No notes match");
  });

  it("rejects an empty query with CliError", async () => {
    await expect(searchNotes("   ")).rejects.toBeInstanceOf(CliError);
  });
});

/* ---------------------- run() / buildProgram() plumbing ------------------- */

describe("run() — Commander dispatch integration", () => {
  it("returns exit 0 for a successful `kb list`", async () => {
    const code = await run(["kb", "list"]);
    expect(code).toBe(0);
  });

  it("returns exit 1 for an unknown subcommand", async () => {
    const code = await run(["kb", "wat"]);
    expect(code).toBe(1);
  });

  it("returns exit 1 for `kb search` with empty query", async () => {
    const code = await run(["kb", "search", "   "]);
    expect(code).toBe(1);
  });

  it("builds a program with `kb` subcommand", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).toContain("kb");
  });
});
