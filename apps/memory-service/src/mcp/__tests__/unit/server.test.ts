/**
 * End-to-end tests for the MCP server (`createMemoryMcpServer`) — issue #97.
 *
 * Tests the knowledge-base-only server:
 *  - tools/list returns 4 registered tools
 *  - kb_write / kb_read / kb_search / kb_list work end-to-end
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { _initDb } from "../../../db/client.js";
import { createMemoryMcpServer } from "../../server.js";

interface TestFixtures {
  client: Client;
  close: () => void;
  tmpDir: string;
}

async function setup(): Promise<TestFixtures> {
  const db: Database.Database = _initDb(":memory:");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-server-test-"));

  // Patch config to use our temp dir
  const origConfig = (await import("../../../config.js")).config;
  const origKbDir = origConfig.KB_DATA_DIR;
  origConfig.KB_DATA_DIR = tmpDir;

  const mcp = createMemoryMcpServer({ db });

  const client = new Client(
    { name: "test-client", version: "0.0.1" },
    { capabilities: {} },
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([
    client.connect(clientTransport),
    mcp.server.connect(serverTransport),
  ]);

  return {
    client,
    tmpDir,
    close: () => {
      origConfig.KB_DATA_DIR = origKbDir;
      if (db.open) db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
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

function parseText(r: ToolResult): unknown {
  return JSON.parse(r.content[0].text);
}

/* ----- tools/list ----- */

describe("MCP server — tools/list", () => {
  let fixtures: TestFixtures;

  beforeEach(async () => {
    fixtures = await setup();
  });
  afterEach(() => fixtures.close());

  it("registers exactly 4 knowledge-base tools", async () => {
    const { tools } = await fixtures.client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "kb_list",
      "kb_read",
      "kb_search",
      "kb_write",
    ]);
  });

  it("every tool has a non-empty description", async () => {
    const { tools } = await fixtures.client.listTools();
    for (const t of tools) {
      expect(typeof t.description).toBe("string");
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

/* ----- kb_write + kb_read round-trip ----- */

describe("MCP server — kb_write + kb_read round-trip", () => {
  let fixtures: TestFixtures;

  beforeEach(async () => {
    fixtures = await setup();
  });
  afterEach(() => fixtures.close());

  it("write then read returns correct content", async () => {
    const writeResult = await callTool(fixtures.client, "kb_write", {
      content: "# Test Note\n\nHello world.",
      tags: ["test"],
    });
    expect(writeResult.isError).toBeFalsy();
    const writeBody = parseText(writeResult) as { success: boolean; path: string };
    expect(writeBody.success).toBe(true);

    const readResult = await callTool(fixtures.client, "kb_read", {
      path: writeBody.path,
    });
    expect(readResult.isError).toBeFalsy();
    const readBody = parseText(readResult) as {
      success: boolean;
      frontmatter: { tags: string[] };
      body: string;
    };
    expect(readBody.success).toBe(true);
    expect(readBody.body).toContain("# Test Note");
    expect(readBody.body).toContain("Hello world.");
    expect(readBody.frontmatter.tags).toContain("test");
  });

  it("kb_read returns isError for nonexistent note", async () => {
    const r = await callTool(fixtures.client, "kb_read", {
      path: "nonexistent.md",
    });
    expect(r.isError).toBe(true);
    expect(r.content[0].text).toContain("Note not found");
  });
});

/* ----- kb_search ----- */

describe("MCP server — kb_search", () => {
  let fixtures: TestFixtures;

  beforeEach(async () => {
    fixtures = await setup();
  });
  afterEach(() => fixtures.close());

  it("returns search hits for matching content", async () => {
    await callTool(fixtures.client, "kb_write", {
      content: "# Redis Guide\n\nRedis is a fast in-memory store.",
      tags: ["dev"],
    });
    await callTool(fixtures.client, "kb_write", {
      content: "# Postgres Guide\n\nPostgres is a solid RDBMS.",
      tags: ["dev"],
    });

    const r = await callTool(fixtures.client, "kb_search", { query: "redis" });
    expect(r.isError).toBeFalsy();
    const body = parseText(r) as { count: number };
    expect(body.count).toBe(1);
  });
});

/* ----- kb_list ----- */

describe("MCP server — kb_list", () => {
  let fixtures: TestFixtures;

  beforeEach(async () => {
    fixtures = await setup();
  });
  afterEach(() => fixtures.close());

  it("returns empty list when no notes exist", async () => {
    const r = await callTool(fixtures.client, "kb_list", {});
    expect(r.isError).toBeFalsy();
    const body = parseText(r) as { count: number; notes: unknown[] };
    expect(body.count).toBe(0);
    expect(body.notes).toEqual([]);
  });

  it("returns written notes", async () => {
    await callTool(fixtures.client, "kb_write", {
      content: "# Alpha\n\nContent.",
      tags: ["AI"],
    });
    await callTool(fixtures.client, "kb_write", {
      content: "# Beta\n\nMore.",
      tags: ["dev"],
    });

    const r = await callTool(fixtures.client, "kb_list", {});
    expect(r.isError).toBeFalsy();
    const body = parseText(r) as { count: number };
    expect(body.count).toBe(2);
  });
});

/* ----- resources/list ----- */

describe("MCP server — resources/list", () => {
  let fixtures: TestFixtures;

  beforeEach(async () => {
    fixtures = await setup();
  });
  afterEach(() => fixtures.close());

  it("returns both kb:// URIs", async () => {
    const { resources } = await fixtures.client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(["kb://index", "kb://recent"]);
  });

  it("every resource reports text/markdown mimeType", async () => {
    const { resources } = await fixtures.client.listResources();
    for (const r of resources) {
      expect(r.mimeType).toBe("text/markdown");
    }
  });
});

/* ----- resources/read ----- */

describe("MCP server — resources/read", () => {
  let fixtures: TestFixtures;

  beforeEach(async () => {
    fixtures = await setup();
  });
  afterEach(() => fixtures.close());

  it("kb://recent returns empty-state when no notes", async () => {
    const result = await fixtures.client.readResource({ uri: "kb://recent" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("Knowledge Base — Recent Notes");
    expect(text).toContain("No notes yet");
  });

  it("kb://index returns empty-state when no notes", async () => {
    const result = await fixtures.client.readResource({ uri: "kb://index" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("Knowledge Base — Index");
    expect(text).toContain("No notes yet");
  });

  it("kb://recent returns notes after writing", async () => {
    await fixtures.client.callTool({
      name: "kb_write",
      arguments: {
        content: "# Test Note\n\nContent.",
        tags: ["AI"],
      },
    });

    const result = await fixtures.client.readResource({ uri: "kb://recent" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("Test Note");
    expect(text).toContain("| Path | Title | Tags | Updated |");
  });

  it("kb://index returns directory tree after writing", async () => {
    await fixtures.client.callTool({
      name: "kb_write",
      arguments: {
        content: "# Docker Note\n\nContent.",
        path: "调试经验/Docker/构建.md",
      },
    });

    const result = await fixtures.client.readResource({ uri: "kb://index" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("调试经验/");
    expect(text).toContain("- Docker/");
    expect(text).toContain("- 构建.md");
  });
});
