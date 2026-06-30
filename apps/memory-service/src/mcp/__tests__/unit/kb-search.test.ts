/**
 * Unit tests for `kb_search` MCP tool (issue #96).
 *
 * Uses in-memory SQLite + IndexStore directly (no MCP transport needed)
 * to verify the search logic in isolation.
 */
import type Database from "better-sqlite3";
import { _initDb } from "../../../db/client.js";
import { IndexStore } from "../../../kb/index-store.js";

let db: Database.Database;
let store: IndexStore;

beforeEach(() => {
  db = _initDb(":memory:");
  store = new IndexStore(db);

  // Seed test data
  store.upsertNote({
    path: "projects/redis-caching.md",
    title: "Redis Caching Strategy",
    tags: ["redis", "performance"],
    content: "Redis is an in-memory data store used for caching frequently accessed data.",
  });
  store.upsertNote({
    path: "projects/postgres-schema.md",
    title: "PostgreSQL Schema Design",
    tags: ["postgres", "database"],
    content: "PostgreSQL is a powerful relational database with advanced query capabilities.",
  });
  store.upsertNote({
    path: "guides/redis-replication.md",
    title: "Redis Replication Guide",
    tags: ["redis", "devops"],
    content: "Setting up Redis replication for high availability and read scaling.",
  });
  store.upsertNote({
    path: "notes/docker-deploy.md",
    title: "Docker Deployment Notes",
    tags: ["docker", "devops"],
    content: "Docker compose configurations for local development and staging.",
  });
});

afterEach(() => {
  if (db.open) db.close();
});

/* ----- basic keyword search ----- */

describe("kb_search — basic keyword search", () => {
  it("returns matching notes for a keyword query", () => {
    const hits = store.searchNotes("redis");
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of hits) {
      expect(hit.path).toBeDefined();
      expect(hit.title).toBeDefined();
      expect(Array.isArray(hit.tags)).toBe(true);
      expect(typeof hit.snippet).toBe("string");
      expect(typeof hit.score).toBe("number");
    }
  });
});

/* ----- BM25 ranking ----- */

describe("kb_search — BM25 ranking", () => {
  it("returns results ordered by relevance score (most relevant first)", () => {
    const hits = store.searchNotes("redis");
    // All hits should have scores in ascending order (BM25 rank is negative,
    // so closer to 0 = more relevant)
    for (let i = 1; i < hits.length; i++) {
      expect(hits[i - 1].score).toBeLessThanOrEqual(hits[i].score);
    }
  });
});

/* ----- tags filter ----- */

describe("kb_search — tags filter", () => {
  it("filters results by tag", () => {
    const hits = store.searchNotes("redis", { tags: ["performance"] });
    expect(hits.length).toBe(1);
    expect(hits[0].path).toBe("projects/redis-caching.md");
    expect(hits[0].tags).toContain("performance");
  });

  it("matches notes with ANY of the provided tags", () => {
    const hits = store.searchNotes("redis", { tags: ["performance", "devops"] });
    expect(hits.length).toBe(2);
  });
});

/* ----- path prefix filter ----- */

describe("kb_search — path prefix filter", () => {
  it("filters results by path prefix", () => {
    const hits = store.searchNotes("redis", { pathPrefix: "guides/" });
    expect(hits.length).toBe(1);
    expect(hits[0].path).toBe("guides/redis-replication.md");
  });

  it("returns no results for non-matching prefix", () => {
    const hits = store.searchNotes("redis", { pathPrefix: "notes/" });
    expect(hits.length).toBe(0);
  });
});

/* ----- empty query ----- */

describe("kb_search — empty query", () => {
  it("returns empty results for non-matching query", () => {
    const hits = store.searchNotes("xyznonexistent");
    expect(hits).toEqual([]);
  });
});

/* ----- limit parameter ----- */

describe("kb_search — limit parameter", () => {
  it("respects the limit parameter", () => {
    const hits = store.searchNotes("redis OR postgres OR docker", { limit: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it("defaults to returning up to 50 results when no limit specified", () => {
    // Just verify it doesn't throw and returns results
    const hits = store.searchNotes("redis");
    expect(hits.length).toBeLessThanOrEqual(50);
  });
});

/* ----- excludeArchived filter ----- */

describe("kb_search — excludeArchived filter", () => {
  it("默认不排除 _archived/ 路径", () => {
    store.upsertNote({
      path: "tech/_archived/old-redis.md",
      title: "Old Redis Notes",
      tags: ["redis"],
      content: "Archived Redis notes from legacy project.",
    });
    const hits = store.searchNotes("redis OR archived");
    const paths = hits.map((h) => h.path);
    expect(paths).toContain("tech/_archived/old-redis.md");
  });

  it("excludeArchived=true 排除 _archived/ 路径", () => {
    store.upsertNote({
      path: "tech/_archived/old-redis.md",
      title: "Old Redis Notes",
      tags: ["redis"],
      content: "Archived Redis notes from legacy project.",
    });
    const hits = store.searchNotes("redis OR archived", { excludeArchived: true });
    const paths = hits.map((h) => h.path);
    expect(paths).not.toContain("tech/_archived/old-redis.md");
  });

  it("excludeArchived=false 不排除 _archived/ 路径", () => {
    store.upsertNote({
      path: "tech/_archived/old-redis.md",
      title: "Old Redis Notes",
      tags: ["redis"],
      content: "Archived Redis notes from legacy project.",
    });
    const hits = store.searchNotes("redis OR archived", { excludeArchived: false });
    const paths = hits.map((h) => h.path);
    expect(paths).toContain("tech/_archived/old-redis.md");
  });
});

/* ----- MCP tool adapter (via server integration) ----- */

describe("kb_search — MCP tool integration", () => {
  it("registers kb_search in tools/list and can call it", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMemoryMcpServer } = await import("../../server.js");

    // The server creates its own IndexStore from the db option,
    // but we need the KB schema applied. _initDb already does that.
    // We reuse the same db handle so the server's IndexStore sees our data.
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

    // Verify kb_search is registered
    const { tools } = await client.listTools();
    const kbTool = tools.find((t) => t.name === "kb_search");
    expect(kbTool).toBeDefined();
    expect(kbTool!.description).toContain("knowledge base");

    // Call kb_search
    const result = await client.callTool({
      name: "kb_search",
      arguments: { query: "redis", limit: 10 },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
    expect(body.query).toBe("redis");
    expect(body.count).toBeGreaterThanOrEqual(2);
    expect(body.hits.length).toBeGreaterThanOrEqual(2);

    // Each hit has the expected shape
    for (const hit of body.hits) {
      expect(typeof hit.path).toBe("string");
      expect(typeof hit.title).toBe("string");
      expect(Array.isArray(hit.tags)).toBe(true);
      expect(typeof hit.snippet).toBe("string");
      expect(typeof hit.score).toBe("number");
    }
  });

  it("kb_search with tags filter via MCP", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMemoryMcpServer } = await import("../../server.js");

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

    const result = await client.callTool({
      name: "kb_search",
      arguments: { query: "redis", tags: ["performance"] },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBeFalsy();
    const body = JSON.parse(result.content[0].text);
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.hits[0].tags).toContain("performance");
  });

  it("kb_search returns isError for invalid FTS5 query", async () => {
    const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
    const { InMemoryTransport } = await import("@modelcontextprotocol/sdk/inMemory.js");
    const { createMemoryMcpServer } = await import("../../server.js");

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

    // Invalid FTS5 query (unbalanced quotes)
    const result = await client.callTool({
      name: "kb_search",
      arguments: { query: '"unclosed phrase' },
    }) as { content: Array<{ type: string; text: string }>; isError?: boolean };

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toMatch(/Error: kb_search:/);
  });
});
