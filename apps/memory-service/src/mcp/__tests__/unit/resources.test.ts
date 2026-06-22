/**
 * End-to-end tests for MCP resources (kb://recent, kb://index) — issue #97.
 *
 * Uses the SDK's `InMemoryTransport` + `Client` so we exercise the
 * full MCP protocol path (resources/list, resources/read) without
 * going through HTTP. Each test uses a fresh in-memory SQLite DB.
 *
 * Coverage map:
 *  - resources/list returns both kb:// URIs
 *  - resources/read(kb://recent) returns rendered recent notes markdown
 *  - resources/read(kb://index) returns rendered index tree markdown
 *  - both resources report text/markdown mimeType
 *  - empty store: both resources still return a valid (empty-state) doc
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
}

async function setup(): Promise<TestFixtures> {
  const db: Database.Database = _initDb(":memory:");
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-resources-test-"));

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
    close: () => {
      origConfig.KB_DATA_DIR = origKbDir;
      if (db.open) db.close();
      fs.rmSync(tmpDir, { recursive: true, force: true });
    },
  };
}

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

  it("kb://recent contains notes after kb_write", async () => {
    await fixtures.client.callTool({
      name: "kb_write",
      arguments: {
        content: "# Project Uses Pnpm\n\nContent.",
        tags: ["dev"],
      },
    });

    const result = await fixtures.client.readResource({ uri: "kb://recent" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("Project Uses Pnpm");
    expect(text).toContain("| Path | Title | Tags | Updated |");
  });

  it("kb://index contains directory tree after kb_write", async () => {
    await fixtures.client.callTool({
      name: "kb_write",
      arguments: {
        content: "# Docker Build\n\nContent.",
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
