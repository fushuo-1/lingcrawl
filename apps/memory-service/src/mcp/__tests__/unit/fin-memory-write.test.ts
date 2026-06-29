/**
 * Unit tests for `fin_memory_write` MCP tool (issue #99).
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

/* ----- tool registration ----- */

describe("fin_memory_write — registration", () => {
  it("is registered in tools/list", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "fin_memory_write");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("financial memory");
  });
});

/* ----- opinion creation ----- */

describe("fin_memory_write — opinion creation", () => {
  it("creates a valid opinion", async () => {
    const result = await callTool(client, "fin_memory_write", {
      entity_type: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      time_horizon: "medium",
      confidence: 4,
      thesis: "Strong earnings growth",
      risks: "Supply chain disruption",
      source: "earnings call",
      tags: ["tech", "earnings"],
    });

    expect(result.isError).toBeFalsy();
    const body = parseText(result) as { success: boolean; memory: { id: string; ticker: string } };
    expect(body.success).toBe(true);
    expect(body.memory.ticker).toBe("AAPL");
    expect(body.memory.id).toBeDefined();
  });

  it("returns isError for missing required fields", async () => {
    const result = await callTool(client, "fin_memory_write", {
      entity_type: "opinion",
      ticker: "AAPL",
      // missing direction, time_horizon, confidence, thesis
    });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error: fin_memory_write:/);
    expect(result.content[0].text).toContain("Missing required fields");
  });

  it("creates with explicit id", async () => {
    const explicitId = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";
    const result = await callTool(client, "fin_memory_write", {
      id: explicitId,
      entity_type: "opinion",
      ticker: "BTC",
      direction: "bearish",
      time_horizon: "short",
      confidence: 2,
      thesis: "Regulatory headwinds",
    });

    const body = parseText(result) as { success: boolean; memory: { id: string } };
    expect(body.memory.id).toBe(explicitId);
  });

  it("creates a strategy entity", async () => {
    const result = await callTool(client, "fin_memory_write", {
      entity_type: "strategy",
      name: "RSI Momentum",
      asset_class: "stock",
      rules: "Buy when RSI > 70",
      strategy_status: "draft",
    });

    expect(result.isError).toBeFalsy();
    const body = parseText(result) as { success: boolean; memory: { entityType: string; name: string } };
    expect(body.memory.entityType).toBe("strategy");
    expect(body.memory.name).toBe("RSI Momentum");
  });

  it("creates a position entity", async () => {
    const result = await callTool(client, "fin_memory_write", {
      entity_type: "position",
      ticker: "NVDA",
      position_status: "holding",
      quantity: 50,
      cost_basis: 450,
      target_price: 600,
    });

    expect(result.isError).toBeFalsy();
    const body = parseText(result) as { success: boolean; memory: { entityType: string; quantity: number } };
    expect(body.memory.entityType).toBe("position");
    expect(body.memory.quantity).toBe(50);
  });

  it("creates a lesson entity", async () => {
    const result = await callTool(client, "fin_memory_write", {
      entity_type: "lesson",
      title: "Don't chase pumps",
      lesson_category: "mistake",
      lesson: "Chasing pumps leads to losses",
    });

    expect(result.isError).toBeFalsy();
    const body = parseText(result) as { success: boolean; memory: { entityType: string; title: string } };
    expect(body.memory.entityType).toBe("lesson");
    expect(body.memory.title).toBe("Don't chase pumps");
  });
});

/* ----- round-trip with fin_memory_read ----- */

describe("fin_memory_write + fin_memory_read round-trip", () => {
  it("write then read returns the same memory", async () => {
    const writeResult = await callTool(client, "fin_memory_write", {
      entity_type: "opinion",
      ticker: "MSFT",
      direction: "bullish",
      time_horizon: "long",
      confidence: 5,
      thesis: "AI leadership",
      market: "NASDAQ",
      tags: ["ai", "cloud"],
    });

    const writeBody = parseText(writeResult) as { success: boolean; memory: { id: string } };
    const id = writeBody.memory.id;

    const readResult = await callTool(client, "fin_memory_read", { id });
    expect(readResult.isError).toBeFalsy();
    const readBody = parseText(readResult) as { success: boolean; memory: { ticker: string; thesis: string; tags: string[] } };
    expect(readBody.memory.ticker).toBe("MSFT");
    expect(readBody.memory.thesis).toBe("AI leadership");
    expect(readBody.memory.tags).toEqual(["ai", "cloud"]);
  });

  it("fin_memory_read returns isError for non-existent id", async () => {
    const result = await callTool(client, "fin_memory_read", {
      id: "00000000-0000-0000-0000-000000000000",
    });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
