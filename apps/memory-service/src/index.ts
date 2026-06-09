import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { closeDb, getDb } from "./db/client.js";
import { createMemoryMcpServer } from "./mcp/server.js";
import { mountMcpHttpTransport } from "./mcp/transport.js";

/**
 * Memory Service — AI Agent long-term memory + session history retrieval.
 *
 * v0.1 (issues #67–#75): Fastify HTTP server on 127.0.0.1:3001, with:
 *   - GET  /health   — liveness probe
 *   - ALL  /mcp      — MCP Streamable HTTP transport (8 tools)
 *
 * The MCP server is built lazily inside `buildServer` so that any
 * startup failure (bad config, DB open failure) surfaces before
 * Fastify starts listening.
 */
async function buildServer(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
    },
  });

  await app.register(cors);

  app.get("/health", async (_request, reply) => {
    reply.code(200);
    reply.header("content-type", "application/json");
    return { status: "ok" };
  });

  // Touch the DB early so a corrupt file or missing dir fails at boot,
  // not at the first MCP request.
  getDb();

  // Build the MCP server and mount it.
  const mcp = createMemoryMcpServer();
  mountMcpHttpTransport(app, { server: mcp.server });

  return app;
}

async function start(): Promise<void> {
  const app = await buildServer();

  try {
    await app.listen({ port: config.PORT, host: config.HOST });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }

  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down`);
    closeDb();
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, "/")}`) {
  void start();
}

export { buildServer, start };
