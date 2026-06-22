/**
 * Unit tests for `kb_list` MCP tool (issue #97).
 *
 * Uses in-memory SQLite + temp directory + KnowledgeStore directly
 * to verify the list logic, plus MCP integration tests.
 */
import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { applySchema } from "../../../db/migrations.js";
import { FileManager } from "../../../kb/file-manager.js";
import { IndexStore } from "../../../kb/index-store.js";
import { KnowledgeStore } from "../../../kb/knowledge-store.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb-list-test-"));
}

let db: Database.Database;
let tmpDir: string;
let store: KnowledgeStore;

beforeEach(() => {
  db = createTestDb();
  tmpDir = createTempDir();
  const fileManager = new FileManager(tmpDir);
  const indexStore = new IndexStore(db);
  store = new KnowledgeStore({ fileManager, indexStore });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ----- listNotes via KnowledgeStore ----- */

describe("kb_list — listNotes via KnowledgeStore", () => {
  it("returns empty array when no notes exist", () => {
    const result = store.listNotes();
    expect(result).toEqual([]);
  });

  it("returns all notes sorted by updatedAt DESC", () => {
    store.writeNote({ content: "# Note A\n\nFirst.", tags: ["AI"] });
    store.writeNote({ content: "# Note B\n\nSecond.", tags: ["dev"] });
    store.writeNote({ content: "# Note C\n\nThird.", tags: ["AI"] });

    const result = store.listNotes();
    expect(result).toHaveLength(3);
    // Should be sorted by updatedAt DESC (most recent first)
    expect(result[0].updatedAt).toBeGreaterThanOrEqual(result[1].updatedAt);
    expect(result[1].updatedAt).toBeGreaterThanOrEqual(result[2].updatedAt);
  });

  it("filters by pathPrefix", () => {
    store.writeNote({ content: "# A\n\n.", path: "dir1/A.md" });
    store.writeNote({ content: "# B\n\n.", path: "dir2/B.md" });
    store.writeNote({ content: "# C\n\n.", path: "dir1/C.md" });

    const result = store.listNotes({ pathPrefix: "dir1" });
    expect(result).toHaveLength(2);
    for (const note of result) {
      expect(note.path).toMatch(/^dir1\//);
    }
  });

  it("filters by tags", () => {
    store.writeNote({ content: "# A\n\n.", tags: ["AI", "NLP"] });
    store.writeNote({ content: "# B\n\n.", tags: ["dev"] });
    store.writeNote({ content: "# C\n\n.", tags: ["AI"] });

    const result = store.listNotes({ tags: ["AI"] });
    expect(result).toHaveLength(2);
  });

  it("respects limit", () => {
    for (let i = 0; i < 10; i++) {
      store.writeNote({ content: `# Note ${i}\n\n.`, tags: ["test"] });
    }

    const result = store.listNotes({ limit: 3 });
    expect(result).toHaveLength(3);
  });

  it("returns correct NoteMeta fields", () => {
    store.writeNote({ content: "# My Title\n\nBody.", tags: ["AI", "test"] });

    const result = store.listNotes();
    expect(result).toHaveLength(1);
    const note = result[0];
    expect(note.title).toBe("My Title");
    expect(note.tags).toEqual(["AI", "test"]);
    expect(note.path).toMatch(/\.md$/);
    expect(note.createdAt).toBeGreaterThan(0);
    expect(note.updatedAt).toBeGreaterThan(0);
    expect(typeof note.id).toBe("number");
  });
});

/* ----- MCP tool integration ----- */

describe("kb_list — MCP tool integration", () => {
  it("registers kb_list in tools/list and can call it", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMemoryMcpServer } = await import("../../server.js");

    const origConfig = (await import("../../../config.js")).config;
    const origKbDir = origConfig.KB_DATA_DIR;
    origConfig.KB_DATA_DIR = tmpDir;

    try {
      const mcp = createMemoryMcpServer({ db });

      const client = new Client(
        { name: "test-client", version: "0.0.1" },
        { capabilities: {} },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await Promise.all([
        client.connect(clientTransport),
        mcp.server.connect(serverTransport),
      ]);

      // Verify kb_list is registered
      const { tools } = await client.listTools();
      const kbListTool = tools.find((t) => t.name === "kb_list");
      expect(kbListTool).toBeDefined();
      expect(kbListTool!.description).toContain("List knowledge base notes");

      // Call with empty store
      const result = (await client.callTool({
        name: "kb_list",
        arguments: {},
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.success).toBe(true);
      expect(body.count).toBe(0);
      expect(body.notes).toEqual([]);
    } finally {
      origConfig.KB_DATA_DIR = origKbDir;
    }
  });

  it("kb_list returns notes after writing some", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMemoryMcpServer } = await import("../../server.js");

    const origConfig = (await import("../../../config.js")).config;
    const origKbDir = origConfig.KB_DATA_DIR;
    origConfig.KB_DATA_DIR = tmpDir;

    try {
      const mcp = createMemoryMcpServer({ db });

      const client = new Client(
        { name: "test-client", version: "0.0.1" },
        { capabilities: {} },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await Promise.all([
        client.connect(clientTransport),
        mcp.server.connect(serverTransport),
      ]);

      // Write two notes
      await client.callTool({
        name: "kb_write",
        arguments: {
          content: "# Note Alpha\n\nContent A.",
          tags: ["AI"],
        },
      });
      await client.callTool({
        name: "kb_write",
        arguments: {
          content: "# Note Beta\n\nContent B.",
          tags: ["dev"],
        },
      });

      // List all
      const result = (await client.callTool({
        name: "kb_list",
        arguments: {},
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.success).toBe(true);
      expect(body.count).toBe(2);
      expect(body.notes[0]).toHaveProperty("path");
      expect(body.notes[0]).toHaveProperty("title");
      expect(body.notes[0]).toHaveProperty("tags");
      expect(body.notes[0]).toHaveProperty("createdAt");
      expect(body.notes[0]).toHaveProperty("updatedAt");

      // List with path filter
      const alphaPath = body.notes.find((n: { title: string }) => n.title === "Note Alpha")!.path;
      const dirPrefix = alphaPath.split("/").slice(0, -1).join("/");
      const filtered = (await client.callTool({
        name: "kb_list",
        arguments: { path: dirPrefix },
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(filtered.isError).toBeFalsy();
      const filteredBody = JSON.parse(filtered.content[0].text);
      expect(filteredBody.count).toBeGreaterThanOrEqual(1);
    } finally {
      origConfig.KB_DATA_DIR = origKbDir;
    }
  });

  it("kb_list supports tag filtering", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMemoryMcpServer } = await import("../../server.js");

    const origConfig = (await import("../../../config.js")).config;
    const origKbDir = origConfig.KB_DATA_DIR;
    origConfig.KB_DATA_DIR = tmpDir;

    try {
      const mcp = createMemoryMcpServer({ db });

      const client = new Client(
        { name: "test-client", version: "0.0.1" },
        { capabilities: {} },
      );
      const [clientTransport, serverTransport] =
        InMemoryTransport.createLinkedPair();
      await Promise.all([
        client.connect(clientTransport),
        mcp.server.connect(serverTransport),
      ]);

      // Write notes with different tags
      await client.callTool({
        name: "kb_write",
        arguments: { content: "# AI Note\n\n.", tags: ["AI"] },
      });
      await client.callTool({
        name: "kb_write",
        arguments: { content: "# Dev Note\n\n.", tags: ["dev"] },
      });

      // Filter by tag
      const result = (await client.callTool({
        name: "kb_list",
        arguments: { tags: ["AI"] },
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.count).toBe(1);
      expect(body.notes[0].tags).toContain("AI");
    } finally {
      origConfig.KB_DATA_DIR = origKbDir;
    }
  });
});
