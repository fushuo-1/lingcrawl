import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { config } from "./config";

/**
 * Memory Service — AI Agent long-term memory + session history retrieval.
 *
 * v0.1 scaffold (issues #67 + #68): exposes only `/health` over HTTP on
 * 127.0.0.1:3001. The MCP server, tools, resources, SQLite store, and CLI
 * are added in follow-up issues (#74, #75, #76, etc.).
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
    await app.close();
    process.exit(0);
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

if (require.main === module) {
  void start();
}

export { buildServer, start };
