/**
 * End-to-end tests for MCP resources (memory://notes, memory://user) — issue #76.
 *
 * Uses the SDK's `InMemoryTransport` + `Client` so we exercise the
 * full MCP protocol path (resources/list, resources/read) without
 * going through HTTP. Each test uses a fresh in-memory SQLite DB.
 *
 * Coverage map:
 *  - resources/list returns both memory:// URIs
 *  - resources/read(memory://notes) returns rendered notes markdown
 *  - resources/read(memory://user) returns rendered user markdown
 *  - both resources report text/markdown mimeType
 *  - empty store: notes/user resources still return a valid (empty-state) doc
 *  - takenAt is propagated to the snapshot timestamp in the rendered text
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { createMemoryMcpServer } from "../server.js";

interface TestFixtures {
  client: Client;
  close: () => void;
}

async function setup(now: () => Date = () => new Date("2026-06-08T14:23:01Z")): Promise<TestFixtures> {
  const db: Database.Database = _initDb(":memory:");
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
      if (db.open) db.close();
    },
  };
}

describe("MCP server — resources/list", () => {
  let fixtures: TestFixtures;

  beforeEach(async () => {
    fixtures = await setup();
  });
  afterEach(() => fixtures.close());

  it("returns both memory:// URIs", async () => {
    const { resources } = await fixtures.client.listResources();
    const uris = resources.map((r) => r.uri).sort();
    expect(uris).toEqual(["memory://notes", "memory://user"]);
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

  it("memory://notes returns the empty-state document when no entries", async () => {
    const result = await fixtures.client.readResource({ uri: "memory://notes" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("Agent's Personal Notes");
    expect(text).toContain("Empty — no entries yet.");
    expect(text).toContain("2026-06-08 14:23:01");
  });

  it("memory://user returns the empty-state document when no entries", async () => {
    const result = await fixtures.client.readResource({ uri: "memory://user" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("User Profile");
    expect(text).toContain("Empty — no entries yet.");
  });

  it("memory://user contains persisted content after user_update", async () => {
    await fixtures.client.callTool({
      name: "user_update",
      arguments: { content: "Prefers concise responses" },
    });
    const result = await fixtures.client.readResource({ uri: "memory://user" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("Prefers concise responses");
  });

  it("memory://notes contains persisted content after memory_add", async () => {
    await fixtures.client.callTool({
      name: "memory_add",
      arguments: { target: "memory", content: "Project uses pnpm" },
    });
    const result = await fixtures.client.readResource({ uri: "memory://notes" });
    const text = result.contents[0]?.text ?? "";
    expect(text).toContain("Project uses pnpm");
  });
});
