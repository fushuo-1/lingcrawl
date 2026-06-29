/**
 * Unit tests for `fin_memory_delete` MCP tool (issue #100).
 *
 * Uses in-memory SQLite + InMemoryTransport + SDK Client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { createMemoryMcpServer } from "../../server.js";

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

function parseText(r: ToolResult): unknown {
  return JSON.parse(r.content[0].text);
}

let db: Database.Database;
let client: Client;
let close: () => void;

async function setup() {
  db = _initDb(":memory:");
  const mcp = createMemoryMcpServer({ db });

  client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    mcp.server.connect(serverTransport),
  ]);

  close = () => {
    if (db.open) db.close();
  };
}

beforeEach(async () => {
  await setup();
});

afterEach(() => {
  close();
});

describe("fin_memory_delete — registration", () => {
  it("is registered in tools/list", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "fin_memory_delete");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("delete");
  });
});

describe("fin_memory_delete — deletion", () => {
  it("deletes an existing memory", async () => {
    const writeResult = await callTool(client, "fin_memory_write", {
      entity_type: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      time_horizon: "medium",
      confidence: 4,
      thesis: "Strong earnings",
    });
    const writeBody = parseText(writeResult) as { success: boolean; memory: { id: string } };
    const id = writeBody.memory.id;

    const deleteResult = await callTool(client, "fin_memory_delete", { id });
    expect(deleteResult.isError).toBeFalsy();
    const deleteBody = parseText(deleteResult) as { success: boolean; id: string };
    expect(deleteBody.success).toBe(true);
    expect(deleteBody.id).toBe(id);

    const readResult = await callTool(client, "fin_memory_read", { id });
    expect(readResult.isError).toBe(true);
  });

  it("returns isError for non-existent id", async () => {
    const result = await callTool(client, "fin_memory_delete", {
      id: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
