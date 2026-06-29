/**
 * Unit tests for `fin_memory_link_note` MCP tool (issue #100).
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

async function createOpinion(): Promise<string> {
  const result = await callTool(client, "fin_memory_write", {
    entity_type: "opinion",
    ticker: "AAPL",
    direction: "bullish",
    time_horizon: "medium",
    confidence: 4,
    thesis: "Strong earnings",
  });
  const body = parseText(result) as { success: boolean; memory: { id: string } };
  return body.memory.id;
}

describe("fin_memory_link_note — registration", () => {
  it("is registered in tools/list", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "fin_memory_link_note");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("link");
  });
});

describe("fin_memory_link_note — link/unlink", () => {
  it("links a note path to a memory", async () => {
    const id = await createOpinion();

    const result = await callTool(client, "fin_memory_link_note", {
      id,
      note_path: "投资/AAPL.md",
    });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as { success: boolean; memory: { notePath: string } };
    expect(body.memory.notePath).toBe("投资/AAPL.md");
  });

  it("unlinks a note when note_path is empty", async () => {
    const id = await createOpinion();
    await callTool(client, "fin_memory_link_note", {
      id,
      note_path: "投资/AAPL.md",
    });

    const result = await callTool(client, "fin_memory_link_note", { id });
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as { success: boolean; memory: { notePath?: string } };
    expect(body.memory.notePath).toBeUndefined();
  });

  it("returns isError for non-existent id", async () => {
    const result = await callTool(client, "fin_memory_link_note", {
      id: "00000000-0000-0000-0000-000000000000",
      note_path: "投资/X.md",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
