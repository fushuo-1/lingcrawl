/**
 * MCP server factory — knowledge base edition (issue #97).
 *
 * Wires together:
 *   1. The `McpServer` instance (from `@modelcontextprotocol/sdk/server/mcp`).
 *   2. The 4 knowledge-base tools: kb_write, kb_read, kb_search, kb_list.
 *   3. Two MCP resources: kb://recent, kb://index.
 *
 * Pure factory — no transport wiring. The HTTP transport is in `transport.ts`
 * and is the only thing that talks to Fastify.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type Database from "better-sqlite3";
import { config } from "../config.js";
import { getDb } from "../db/client.js";
import { FileManager } from "../kb/file-manager.js";
import { IndexStore } from "../kb/index-store.js";
import { KnowledgeStore } from "../kb/knowledge-store.js";
import { registerKbStalenessTool } from "./tools/kb-staleness.js";
import { registerKbDeleteTool } from "./tools/kb-delete.js";
import { registerKbListTool } from "./tools/kb-list.js";
import { registerKbLinkTool } from "./tools/kb-link.js";
import { registerKbReadTool } from "./tools/kb-read.js";
import { registerKbSearchTool } from "./tools/kb-search.js";
import { registerKbSyncTool } from "./tools/kb-sync.js";
import { registerKbWriteTool } from "./tools/kb-write.js";
import { registerKbResources } from "./resources.js";
import { FinancialIndexStore } from "../financial/financial-index-store.js";

export interface MemoryMcpServer {
  /** The McpServer instance — pass to `transport.ts` to wire HTTP. */
  server: McpServer;
  /** Close the underlying SQLite singleton. Call on process shutdown. */
  closeDb: () => void;
}

export interface CreateMemoryMcpOptions {
  /**
   * Optional database handle. Defaults to the process-wide singleton
   * from `getDb()`. Tests pass an isolated `_initDb(":memory:")` handle
   * so their writes do not collide with the singleton used elsewhere.
   */
  db?: Database.Database;
}

export function createMemoryMcpServer(
  options: CreateMemoryMcpOptions = {},
): MemoryMcpServer {
  const server = new McpServer(
    {
      name: "lingcrawl-memory",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
      },
      instructions:
        "Knowledge base for AI agents. Use kb_write to save notes, " +
        "kb_read to retrieve them, kb_search for full-text search, " +
        "kb_list to browse, kb_link for backlinks and broken links, " +
        "kb_delete to remove notes, and kb_sync to re-index after external file changes. " +
        "Read kb://recent and kb://index resources for session context. " +
        "Financial memories: write via kb_write with entity_type frontmatter fields " +
        "(entity_type, ticker, direction, time_horizon, confidence, etc.); " +
        "search via kb_search with entity_type/ticker/direction/market filters. " +
        "Use kb_staleness to scan staleness of financial memories and archive outdated ones.",
    },
  );

  // Use the injected DB (for tests) or the shared singleton (in prod).
  const db = options.db ?? getDb();

  // Knowledge Base
  const fileManager = new FileManager(config.KB_DATA_DIR);
  const kbIndexStore = new IndexStore(db);
  const financialIndexStore = new FinancialIndexStore(db);
  const knowledgeStore = new KnowledgeStore({
    fileManager,
    indexStore: kbIndexStore,
    financialIndexStore,
  });

  registerKbWriteTool(server, knowledgeStore);
  registerKbReadTool(server, knowledgeStore);
  registerKbSearchTool(server, kbIndexStore, financialIndexStore);
  registerKbListTool(server, knowledgeStore);
  registerKbLinkTool(server, knowledgeStore);
  registerKbSyncTool(server, knowledgeStore);
  registerKbDeleteTool(server, knowledgeStore);
  registerKbStalenessTool(server, knowledgeStore, financialIndexStore);
  registerKbResources(server, { indexStore: kbIndexStore });

  return {
    server,
    closeDb: () => {
      import("../db/client.js").then(({ closeDb }) => closeDb());
    },
  };
}
