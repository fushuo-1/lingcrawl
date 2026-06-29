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
import { registerKbDeleteTool } from "./tools/kb-delete.js";
import { registerKbListTool } from "./tools/kb-list.js";
import { registerKbLinkTool } from "./tools/kb-link.js";
import { registerKbReadTool } from "./tools/kb-read.js";
import { registerKbSearchTool } from "./tools/kb-search.js";
import { registerKbSyncTool } from "./tools/kb-sync.js";
import { registerKbWriteTool } from "./tools/kb-write.js";
import { registerKbResources } from "./resources.js";
import { registerFinMemoryDeleteTool } from "./tools/fin-memory-delete.js";
import { registerFinMemoryLinkNoteTool } from "./tools/fin-memory-link-note.js";
import { registerFinMemoryReadTool } from "./tools/fin-memory-read.js";
import { registerFinMemorySearchTool } from "./tools/fin-memory-search.js";
import { registerFinMemoryWriteTool } from "./tools/fin-memory-write.js";
import { FinancialStore } from "../financial/financial-store.js";

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
        "Financial memories: use fin_memory_write to record opinions, strategies, " +
        "positions, and lessons; fin_memory_read to retrieve by id; " +
        "fin_memory_search to filter and search; fin_memory_delete to remove; " +
        "fin_memory_link_note to link/unlink a knowledge-base note.",
    },
  );

  // Use the injected DB (for tests) or the shared singleton (in prod).
  const db = options.db ?? getDb();

  // Knowledge Base
  const fileManager = new FileManager(config.KB_DATA_DIR);
  const kbIndexStore = new IndexStore(db);
  const financialStore = new FinancialStore(db);
  const knowledgeStore = new KnowledgeStore({
    fileManager,
    indexStore: kbIndexStore,
    financialStore,
  });

  registerKbWriteTool(server, knowledgeStore);
  registerKbReadTool(server, knowledgeStore);
  registerKbSearchTool(server, kbIndexStore);
  registerKbListTool(server, knowledgeStore);
  registerKbLinkTool(server, knowledgeStore);
  registerKbSyncTool(server, knowledgeStore);
  registerKbDeleteTool(server, knowledgeStore);
  registerKbResources(server, { indexStore: kbIndexStore });

  // Financial memories
  registerFinMemoryWriteTool(server, financialStore);
  registerFinMemoryReadTool(server, financialStore);
  registerFinMemorySearchTool(server, financialStore);
  registerFinMemoryDeleteTool(server, financialStore);
  registerFinMemoryLinkNoteTool(server, financialStore);

  return {
    server,
    closeDb: () => {
      import("../db/client.js").then(({ closeDb }) => closeDb());
    },
  };
}
