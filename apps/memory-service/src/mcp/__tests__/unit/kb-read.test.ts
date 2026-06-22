/**
 * Unit tests for `kb_read` MCP tool (issue #95).
 *
 * Uses in-memory SQLite + temp directory + KnowledgeStore directly
 * to verify the read logic in isolation, plus MCP integration tests.
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
  return fs.mkdtempSync(path.join(os.tmpdir(), "kb-read-test-"));
}

let db: Database.Database;
let tmpDir: string;
let store: KnowledgeStore;
let fileManager: FileManager;
let indexStore: IndexStore;

beforeEach(() => {
  db = createTestDb();
  tmpDir = createTempDir();
  fileManager = new FileManager(tmpDir);
  indexStore = new IndexStore(db);
  store = new KnowledgeStore({ fileManager, indexStore });
});

afterEach(() => {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/* ----- read existing note ----- */

describe("kb_read — read existing note", () => {
  it("returns frontmatter and body for a previously written note", () => {
    const { path: notePath } = store.writeNote({
      content: "# My Note\n\nHello world.",
      tags: ["AI", "test"],
    });

    const result = store.readNote(notePath);
    expect(result.frontmatter.tags).toEqual(["AI", "test"]);
    expect(result.frontmatter.created).toBeTruthy();
    expect(result.frontmatter.updated).toBeTruthy();
    expect(result.body).toContain("# My Note");
    expect(result.body).toContain("Hello world.");
  });

  it("returns body without frontmatter delimiters", () => {
    const { path: notePath } = store.writeNote({
      content: "---\ntags: [FPGA]\ncreated: 2024-01-01T00:00:00.000Z\nupdated: 2024-01-01T00:00:00.000Z\n---\n\n# With FM\n\nBody content.",
    });

    const result = store.readNote(notePath);
    expect(result.body).not.toContain("---");
    expect(result.body).toContain("# With FM");
    expect(result.body).toContain("Body content.");
  });

  it("frontmatter contains correct tags from write", () => {
    const { path: notePath } = store.writeNote({
      content: "# Tagged\n\nContent.",
      tags: ["docker", "devops"],
    });

    const result = store.readNote(notePath);
    expect(result.frontmatter.tags).toContain("docker");
    expect(result.frontmatter.tags).toContain("devops");
  });

  it("frontmatter contains valid ISO timestamps", () => {
    const { path: notePath } = store.writeNote({
      content: "# Timestamped\n\nContent.",
      tags: ["test"],
    });

    const result = store.readNote(notePath);
    // Should be valid ISO 8601
    expect(() => new Date(result.frontmatter.created)).not.toThrow();
    expect(() => new Date(result.frontmatter.updated)).not.toThrow();
    expect(new Date(result.frontmatter.created).toISOString()).toBe(
      result.frontmatter.created,
    );
    expect(new Date(result.frontmatter.updated).toISOString()).toBe(
      result.frontmatter.updated,
    );
  });
});

/* ----- read non-existent note ----- */

describe("kb_read — read non-existent note", () => {
  it("throws NoteNotFoundError for missing file", () => {
    expect(() => store.readNote("nonexistent.md")).toThrow(/Note not found/);
  });

  it("throws for path that was never written", () => {
    expect(() => store.readNote("some/missing/path.md")).toThrow(
      /Note not found/,
    );
  });
});

/* ----- MCP tool integration ----- */

describe("kb_read — MCP tool integration", () => {
  it("registers kb_read in tools/list and can call it", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMemoryMcpServer } = await import("../../server.js");

    // Patch config to use our temp dir
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

      // Verify kb_read is registered
      const { tools } = await client.listTools();
      const kbTool = tools.find((t) => t.name === "kb_read");
      expect(kbTool).toBeDefined();
      expect(kbTool!.description).toContain("knowledge");

      // Write a note first via kb_write
      const writeResult = (await client.callTool({
        name: "kb_write",
        arguments: {
          content: "# MCP Read Test\n\nSome content for reading.",
          tags: ["mcp-test"],
        },
      })) as { content: Array<{ type: string; text: string }> };
      const writeBody = JSON.parse(writeResult.content[0].text);
      expect(writeBody.success).toBe(true);

      // Now read it via kb_read
      const result = (await client.callTool({
        name: "kb_read",
        arguments: { path: writeBody.path },
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBeFalsy();
      const body = JSON.parse(result.content[0].text);
      expect(body.success).toBe(true);
      expect(body.path).toBe(writeBody.path);
      expect(body.frontmatter.tags).toContain("mcp-test");
      expect(body.frontmatter.created).toBeTruthy();
      expect(body.frontmatter.updated).toBeTruthy();
      expect(body.body).toContain("# MCP Read Test");
      expect(body.body).toContain("Some content for reading.");
      // Body should not contain frontmatter delimiters
      expect(body.body).not.toContain("---");
    } finally {
      origConfig.KB_DATA_DIR = origKbDir;
    }
  });

  it("kb_read returns isError for non-existent note", async () => {
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

      const result = (await client.callTool({
        name: "kb_read",
        arguments: { path: "nonexistent/missing.md" },
      })) as {
        content: Array<{ type: string; text: string }>;
        isError?: boolean;
      };

      expect(result.isError).toBe(true);
      expect(result.content[0].text).toMatch(/Error: kb_read:/);
      expect(result.content[0].text).toContain("Note not found");
    } finally {
      origConfig.KB_DATA_DIR = origKbDir;
    }
  });
});
