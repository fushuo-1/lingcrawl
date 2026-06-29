/**
 * Unit tests for `kb_delete` MCP tool (issue #102).
 *
 * Uses in-memory SQLite + InMemoryTransport + SDK Client.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
let tmpDir: string;
let close: () => void;

async function setup() {
  db = _initDb(":memory:");
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-delete-test-"));

  const mod = await import("../../../config.js");
  const origKbDir = mod.config.KB_DATA_DIR;
  mod.config.KB_DATA_DIR = tmpDir;

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
    mod.config.KB_DATA_DIR = origKbDir;
    if (db.open) db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  };
}

beforeEach(async () => {
  await setup();
});

afterEach(() => {
  close();
});

describe("kb_delete — registration", () => {
  it("is registered in tools/list", async () => {
    const { tools } = await client.listTools();
    const tool = tools.find((t) => t.name === "kb_delete");
    expect(tool).toBeDefined();
  });
});

describe("kb_delete — deletion", () => {
  it("deletes an existing note and clears linked financial memory note_path", async () => {
    const writeResult = await callTool(client, "kb_write", {
      content: "# AAPL\n\nBullish thesis.",
      tags: ["stock"],
      path: "投资/AAPL.md",
    });
    const writeBody = parseText(writeResult) as { success: boolean; path: string };
    const notePath = writeBody.path;

    const finResult = await callTool(client, "fin_memory_write", {
      entity_type: "opinion",
      ticker: "AAPL",
      direction: "bullish",
      time_horizon: "medium",
      confidence: 4,
      thesis: "Strong earnings",
    });
    const finBody = parseText(finResult) as { success: boolean; memory: { id: string } };
    const finId = finBody.memory.id;

    await callTool(client, "fin_memory_link_note", { id: finId, note_path: notePath });

    const deleteResult = await callTool(client, "kb_delete", { path: notePath });
    expect(deleteResult.isError).toBeFalsy();
    const deleteBody = parseText(deleteResult) as { success: boolean; path: string };
    expect(deleteBody.success).toBe(true);

    const readResult = await callTool(client, "kb_read", { path: notePath });
    expect(readResult.isError).toBe(true);

    const finReadResult = await callTool(client, "fin_memory_read", { id: finId });
    const finReadBody = parseText(finReadResult) as {
      success: boolean;
      memory: { notePath?: string };
    };
    expect(finReadBody.memory.notePath).toBeFalsy();
  });

  it("returns isError for non-existent note", async () => {
    const result = await callTool(client, "kb_delete", { path: "不存在.md" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });
});
