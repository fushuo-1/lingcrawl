/**
 * MCP server factory — issue #75.
 *
 * Wires together:
 *   1. The `McpServer` instance (from `@modelcontextprotocol/sdk/server/mcp`).
 *   2. An `initialize` handler override that captures the connecting client's
 *      `clientInfo.name` so the `session_log` tool can stamp it onto the
 *      session row (user story #22).
 *   3. The 8 tools defined in `./tools/*`.
 *
 * Pure factory — no transport wiring. The HTTP transport is in `transport.ts`
 * and is the only thing that talks to Fastify.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { InitializeRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import type Database from "better-sqlite3";
import { getDb } from "../db/client.js";
import { MemoryStoreImpl } from "../memory/store.js";
import { SessionStore } from "../session/store.js";
import { registerMemoryResources } from "./resources.js";
import { registerMemoryTools } from "./tools/memory.js";
import { registerSessionTools } from "./tools/session.js";
import { registerUserTools } from "./tools/user.js";

export interface MemoryMcpServer {
  /** The McpServer instance — pass to `transport.ts` to wire HTTP. */
  server: McpServer;
  /** Most recently observed `clientInfo.name` (or null if no initialize yet). */
  getClientName: () => string | null;
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
        // resources: {}  // added in #76
      },
      instructions:
        "Persistent memory for AI agents. Use memory_* / user_* / session_* " +
        "tools to store and recall facts across sessions.",
    },
  );

  // Captured at initialize time. Read by registerSessionTools below.
  let clientName: string | null = null;

  // Override the default `initialize` handler so we can capture clientInfo.
  // (The SDK auto-registers one; setRequestHandler replaces it.)
  server.server.setRequestHandler(InitializeRequestSchema, (request, extra) => {
    const info = request.params?.clientInfo;
    if (info && typeof info.name === "string" && info.name.length > 0) {
      clientName = info.name;
    }
    return {
      protocolVersion: request.params?.protocolVersion ?? "2024-11-05",
      capabilities: {
        tools: {},
        // resources: {}  // added in #76
      },
      serverInfo: {
        name: "lingcrawl-memory",
        version: "0.1.0",
      },
    };
  });

  // Use the injected DB (for tests) or the shared singleton (in prod).
  // If `options.db` is provided, touch the singleton too so any future
  // `getDb()` call returns the same connection — keeps the test DB and
  // the singleton in lockstep.
  const db = options.db ?? getDb();
  const memoryStore = new MemoryStoreImpl(db);
  const sessionStore = new SessionStore(db);

  // user_update's `deleteAll` is wired to a direct DELETE on the same
  // database connection. This is the v0.1 full-replace shortcut (see
  // user.ts for the rationale).
  const deleteAllForUser = (target: "user"): void => {
    if (target !== "user") {
      throw new Error(`deleteAll only supports 'user' target, got '${target}'`);
    }
    db.prepare("DELETE FROM memory_entries WHERE target = ?").run("user");
  };

  registerMemoryTools(server, memoryStore);
  registerUserTools(server, { store: memoryStore, deleteAll: deleteAllForUser });
  registerSessionTools(server, {
    store: sessionStore,
    getClientName: () => clientName,
  });
  registerMemoryResources(server, { store: memoryStore });

  return {
    server,
    getClientName: () => clientName,
    closeDb: () => {
      // The McpServer itself doesn't own a DB handle; we close the singleton
      // only if the caller asks. The default `getDb()` lazy-init pattern
      // means we may not even have a connection — so import dynamically
      // and call closeDb() to be safe.
      import("../db/client.js").then(({ closeDb }) => closeDb());
    },
  };
}
