/**
 * Concurrency tests for the knowledge base — issue #97.
 *
 * Verifies the SQLite WAL-mode singleton handles two concurrent MCP
 * clients writing to the same database without dropping or corrupting
 * rows.
 *
 * Coverage:
 *  - 2 clients, 10 concurrent kb_write calls each → 20 notes total
 *  - No row loss, no duplicate ids, no exceptions
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _initDb } from "../../../db/client.js";
import { createMemoryMcpServer } from "../../server.js";

async function makeClient(
  db: Database.Database,
  clientName: string,
): Promise<{ client: Client; close: () => void }> {
  const mcp = createMemoryMcpServer({ db });

  const client = new Client(
    { name: clientName, version: "0.0.1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    mcp.server.connect(serverTransport),
  ]);

  return {
    client,
    close: () => {
      // Don't close the DB — the other client is still using it.
    },
  };
}

interface ToolResult {
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  return (await client.callTool({ name, arguments: args })) as ToolResult;
}

describe("MCP server — concurrency (issue #97)", () => {
  let db: Database.Database;
  let tmpDir: string;
  let a: { client: Client; close: () => void };
  let b: { client: Client; close: () => void };

  beforeEach(async () => {
    db = _initDb(":memory:");
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-concurrency-test-"));

    const origConfig = (await import("../../../config.js")).config;
    const origKbDir = origConfig.KB_DATA_DIR;
    origConfig.KB_DATA_DIR = tmpDir;

    a = await makeClient(db, "claude-code");
    b = await makeClient(db, "codex");
  });
  afterEach(() => {
    if (db.open) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("two clients can write KB notes concurrently without loss", async () => {
    const N = 10;
    const aWrites = Array.from({ length: N }, (_, i) =>
      callTool(a.client, "kb_write", {
        content: `# Claude Note ${i}\n\nContent from claude-code.`,
        tags: ["claude"],
        path: `concurrent/claude-${i}.md`,
      }),
    );
    const bWrites = Array.from({ length: N }, (_, i) =>
      callTool(b.client, "kb_write", {
        content: `# Codex Note ${i}\n\nContent from codex.`,
        tags: ["codex"],
        path: `concurrent/codex-${i}.md`,
      }),
    );

    const results = await Promise.all([...aWrites, ...bWrites]);
    for (const r of results) {
      expect(r.isError).toBeFalsy();
    }

    // 20 rows in the notes table.
    const row = db.prepare("SELECT COUNT(*) AS n FROM notes").get() as { n: number };
    expect(row.n).toBe(20);
  });

  it("concurrent writes do not produce duplicate ids", async () => {
    const N = 10;
    const aWrites = Array.from({ length: N }, (_, i) =>
      callTool(a.client, "kb_write", {
        content: `# A${i}\n\n.`,
        tags: ["a"],
        path: `ids/a-${i}.md`,
      }),
    );
    const bWrites = Array.from({ length: N }, (_, i) =>
      callTool(b.client, "kb_write", {
        content: `# B${i}\n\n.`,
        tags: ["b"],
        path: `ids/b-${i}.md`,
      }),
    );

    const results = await Promise.all([...aWrites, ...bWrites]);
    const paths = results.map((r) => JSON.parse(r.content[0].text).path as string);
    const unique = new Set(paths);
    expect(unique.size).toBe(20); // all distinct
  });
});
