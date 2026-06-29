/**
 * Unit tests for `fin_memory_search` MCP tool (issue #99).
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

async function seedData() {
  // Seed some test data via the tool
  await callTool(client, "fin_memory_write", {
    entity_type: "opinion",
    ticker: "AAPL",
    direction: "bullish",
    time_horizon: "medium",
    confidence: 4,
    thesis: "Strong earnings growth",
    market: "NASDAQ",
    tags: ["tech"],
  });
  await callTool(client, "fin_memory_write", {
    entity_type: "opinion",
    ticker: "AAPL",
    direction: "bearish",
    time_horizon: "short",
    confidence: 2,
    thesis: "Supply chain issues",
    market: "NASDAQ",
    tags: ["tech", "china"],
  });
  await callTool(client, "fin_memory_write", {
    entity_type: "opinion",
    ticker: "BTC",
    direction: "bullish",
    time_horizon: "long",
    confidence: 3,
    thesis: "Halving cycle",
    market: "Crypto",
    tags: ["crypto"],
  });
  await callTool(client, "fin_memory_write", {
    entity_type: "strategy",
    name: "RSI Momentum",
    asset_class: "stock",
    rules: "Buy RSI > 70",
    strategy_status: "active",
    tags: ["momentum"],
  });
  await callTool(client, "fin_memory_write", {
    entity_type: "lesson",
    title: "Don't FOMO",
    lesson_category: "mistake",
    lesson: "FOMO leads to losses",
    tags: ["psychology"],
  });
}

beforeEach(async () => {
  await setup();
});

afterEach(() => {
  close();
});

/* ----- tool registration ----- */

describe("fin_memory_search — registration", () => {
  it("is registered in tools/list", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "fin_memory_search");
    expect(tool).toBeDefined();
    expect(tool!.description).toContain("Search");
  });
});

/* ----- search filters ----- */

describe("fin_memory_search — filtering", () => {
  beforeEach(async () => {
    await seedData();
  });

  it("returns all memories with no filters", async () => {
    const result = await callTool(client, "fin_memory_search", {});
    expect(result.isError).toBeFalsy();
    const body = parseText(result) as { total: number; count: number; memories: unknown[] };
    expect(body.total).toBe(5);
    expect(body.count).toBe(5);
  });

  it("filters by entity_types", async () => {
    const result = await callTool(client, "fin_memory_search", {
      entity_types: ["opinion"],
    });
    const body = parseText(result) as { total: number; memories: Array<{ entityType: string }> };
    expect(body.total).toBe(3);
    expect(body.memories.every((m) => m.entityType === "opinion")).toBe(true);
  });

  it("filters by ticker", async () => {
    const result = await callTool(client, "fin_memory_search", {
      ticker: "AAPL",
    });
    const body = parseText(result) as { total: number; memories: Array<{ ticker: string }> };
    expect(body.total).toBe(2);
    expect(body.memories.every((m) => m.ticker === "AAPL")).toBe(true);
  });

  it("filters by direction", async () => {
    const result = await callTool(client, "fin_memory_search", {
      direction: "bullish",
    });
    const body = parseText(result) as { total: number; memories: Array<{ direction: string }> };
    expect(body.total).toBe(2);
    expect(body.memories.every((m) => m.direction === "bullish")).toBe(true);
  });

  it("filters by market", async () => {
    const result = await callTool(client, "fin_memory_search", {
      market: "Crypto",
    });
    const body = parseText(result) as { total: number; memories: Array<{ market: string }> };
    expect(body.total).toBe(1);
    expect(body.memories[0].market).toBe("Crypto");
  });

  it("filters by tags", async () => {
    const result = await callTool(client, "fin_memory_search", {
      tags: ["tech"],
    });
    const body = parseText(result) as { total: number };
    expect(body.total).toBe(2);
  });

  it("filters by free-text query", async () => {
    const result = await callTool(client, "fin_memory_search", {
      query: "earnings",
    });
    const body = parseText(result) as { total: number; memories: Array<{ thesis: string }> };
    expect(body.total).toBe(1);
    expect(body.memories[0].thesis).toContain("earnings");
  });

  it("combines multiple filters", async () => {
    const result = await callTool(client, "fin_memory_search", {
      entity_types: ["opinion"],
      ticker: "AAPL",
      direction: "bullish",
    });
    const body = parseText(result) as { total: number; memories: Array<{ ticker: string; direction: string }> };
    expect(body.total).toBe(1);
    expect(body.memories[0].ticker).toBe("AAPL");
    expect(body.memories[0].direction).toBe("bullish");
  });
});

/* ----- pagination and sorting ----- */

describe("fin_memory_search — pagination and sorting", () => {
  beforeEach(async () => {
    await seedData();
  });

  it("respects limit", async () => {
    const result = await callTool(client, "fin_memory_search", {
      limit: 2,
    });
    const body = parseText(result) as { total: number; count: number };
    expect(body.total).toBe(5);
    expect(body.count).toBe(2);
  });

  it("respects offset", async () => {
    const result = await callTool(client, "fin_memory_search", {
      limit: 2,
      offset: 4,
    });
    const body = parseText(result) as { total: number; count: number };
    expect(body.total).toBe(5);
    expect(body.count).toBe(1);
  });

  it("sorts by updated_desc by default", async () => {
    const result = await callTool(client, "fin_memory_search", {
      limit: 3,
    });
    const body = parseText(result) as { memories: Array<{ updatedAt: number }> };
    expect(body.memories[0].updatedAt).toBeGreaterThanOrEqual(body.memories[1].updatedAt);
  });

  it("sorts by created_desc when requested", async () => {
    const result = await callTool(client, "fin_memory_search", {
      sort_by: "created_desc",
    });
    const body = parseText(result) as { memories: Array<{ createdAt: number }> };
    expect(body.memories[0].createdAt).toBeGreaterThanOrEqual(body.memories[1].createdAt);
  });

  it("sorts by relevance when requested", async () => {
    const result = await callTool(client, "fin_memory_search", {
      sort_by: "relevance",
    });
    const body = parseText(result) as {
      memories: Array<{ id: string; entityType: string; updatedAt: number }>;
      relevance_scores: Record<string, number>;
    };
    expect(body.memories.length).toBe(5);
    expect(body.relevance_scores).toBeDefined();
    const first = body.memories[0].id;
    const second = body.memories[1].id;
    expect(body.relevance_scores[first]).toBeGreaterThanOrEqual(
      body.relevance_scores[second],
    );
  });
});
