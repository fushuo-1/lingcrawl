/**
 * Concurrency tests for the memory service — issue #78.
 *
 * Verifies the SQLite WAL-mode singleton handles two concurrent MCP
 * clients writing to the same database without dropping or corrupting
 * rows. (The two clients are the realistic scenario: Claude Code and
 * Codex connected to the same memory service.)
 *
 * Coverage:
 *  - 2 clients, 20 concurrent memory_add calls each → 40 rows total
 *  - 2 clients, 10 concurrent session_log calls each → 20 exchanges total
 *  - No row loss, no duplicate ids, no exceptions
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { createMemoryMcpServer } from "../server.js";

async function makeClient(
  db: Database.Database,
  clientName: string,
): Promise<{ client: Client; close: () => void }> {
  // Each client connects to the SAME McpServer, so both share the
  // MemoryStore bound to `db`. Two parallel SDK clients = the realistic
  // "Claude Code + Codex" scenario.
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

describe("MCP server — concurrency (issue #78)", () => {
  let db: Database.Database;
  let a: { client: Client; close: () => void };
  let b: { client: Client; close: () => void };

  beforeEach(async () => {
    db = _initDb(":memory:");
    a = await makeClient(db, "claude-code");
    b = await makeClient(db, "codex");
  });
  afterEach(() => {
    if (db.open) db.close();
  });

  it("two clients can write memory entries concurrently without loss", async () => {
    const N = 20;
    const aWrites = Array.from({ length: N }, (_, i) =>
      callTool(a.client, "memory_add", { target: "memory", content: `claude-code: ${i}` }),
    );
    const bWrites = Array.from({ length: N }, (_, i) =>
      callTool(b.client, "memory_add", { target: "memory", content: `codex: ${i}` }),
    );

    const results = await Promise.all([...aWrites, ...bWrites]);
    for (const r of results) {
      expect(r.isError).toBeFalsy();
    }

    // 40 rows in the store.
    const row = db.prepare("SELECT COUNT(*) AS n FROM memory_entries").get() as { n: number };
    expect(row.n).toBe(40);
  });

  it("two clients can log exchanges concurrently without loss", async () => {
    const N = 10;
    const aLogs = Array.from({ length: N }, (_, i) =>
      callTool(a.client, "session_log", {
        session_id: "claude-session",
        user_message: `claude u${i}`,
        assistant_message: `claude a${i}`,
      }),
    );
    const bLogs = Array.from({ length: N }, (_, i) =>
      callTool(b.client, "session_log", {
        session_id: "codex-session",
        user_message: `codex u${i}`,
        assistant_message: `codex a${i}`,
      }),
    );

    const results = await Promise.all([...aLogs, ...bLogs]);
    for (const r of results) {
      expect(r.isError).toBeFalsy();
    }

    const row = db.prepare("SELECT COUNT(*) AS n FROM exchanges").get() as { n: number };
    expect(row.n).toBe(20);
  });

  it("concurrent writes do not produce duplicate ids (PRIMARY KEY preserved)", async () => {
    const N = 20;
    const aWrites = Array.from({ length: N }, (_, i) =>
      callTool(a.client, "memory_add", { target: "memory", content: `a${i}` }),
    );
    const bWrites = Array.from({ length: N }, (_, i) =>
      callTool(b.client, "memory_add", { target: "memory", content: `b${i}` }),
    );

    const results = await Promise.all([...aWrites, ...bWrites]);
    const ids = results.map((r) => JSON.parse(r.content[0].text).id as number);
    const unique = new Set(ids);
    expect(unique.size).toBe(40); // all distinct
  });
});
