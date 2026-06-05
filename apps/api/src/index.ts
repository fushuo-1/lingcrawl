import "dotenv/config";
import { config } from "./config";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import websocket from "@fastify/websocket";

import apiRouter from "./routes/api";
import mcpRouter from "./mcp/transport";
import os from "os";
import { logger } from "./lib/logger";
import http from "node:http";
import https from "node:https";
import { v7 as uuidv7 } from "uuid";
import { cacheableLookup } from "./scraper/scrapeURL/lib/cacheableLookup";
import { nuqShutdown } from "./services/worker/nuq";
import { initializeBlocklist } from "./scraper/WebScraper/utils/blocklist";
import { initializeEngineForcing } from "./scraper/WebScraper/utils/engine-forcing";
import { ZodError } from "zod";
import { QueueFullError } from "./services/queue-jobs";

const numCPUs = config.ENV === "local" ? 2 : os.cpus().length;
logger.info(`Number of CPUs: ${numCPUs} available`);

logger.info("Network info dump", {
  networkInterfaces: os.networkInterfaces(),
});

cacheableLookup.install(http.globalAgent);
cacheableLookup.install(https.globalAgent);

const app: FastifyInstance = Fastify({
  bodyLimit: 10 * 1024 * 1024,
  logger: false,
});

global.isProduction = config.IS_PRODUCTION;

app.get("/", async () => ({
  message: "LingCrawl API",
  documentation_url: "https://docs.lingcrawl.dev",
}));

app.get("/e2e-test", async () => "OK");

app.get("/health/liveness", async () => ({ status: "ok" }));
app.get("/health/readiness", async () => ({ status: "ok" }));
app.get("/is-production", async () => ({ isProduction: global.isProduction }));

app.setErrorHandler((error, request, reply) => {
  if (error instanceof QueueFullError) {
    return reply.code(429).send({
      success: false,
      error: error.message,
    });
  } else if (error instanceof ZodError) {
    const issues = error.issues;
    if (
      Array.isArray(issues) &&
      issues.find((x: any) => x.message === "URL uses unsupported protocol")
    ) {
      logger.warn("Unsupported protocol error: " + JSON.stringify(request.body));
    }

    const hasUnrecognizedKeys = issues.some(
      (e: any) => e.code === "unrecognized_keys",
    );
    const strictMessage =
      "Unrecognized key in body -- please review the v2 API documentation for request body changes";

    const customErrorMessage = hasUnrecognizedKeys
      ? strictMessage
      : issues.length > 0 && issues[0].code === "custom"
        ? issues[0].message
        : "Bad Request";

    return reply.code(400).send({
      success: false,
      code: "BAD_REQUEST",
      error: customErrorMessage,
      details: issues,
    });
  } else if (
    error instanceof SyntaxError &&
    "status" in error &&
    (error as any).status === 400 &&
    "body" in error
  ) {
    return reply.code(400).send({
      success: false,
      code: "BAD_REQUEST_INVALID_JSON",
      error: "Bad request, malformed JSON",
    });
  } else {
    const id = uuidv7();
    logger.error(
      "Error occurred in request! (" + request.url + ") -- ID " + id + " -- ",
      {
        error,
        errorId: id,
        path: request.url,
        teamId: (request as any).acuc?.team_id,
        team_id: (request as any).acuc?.team_id,
      },
    );
    return reply.code(500).send({
      success: false,
      code: "UNKNOWN_ERROR",
      error: `An error occurred. Please check your logs for more details. Error ID: ${id}`,
    });
  }
});

logger.info(`Worker ${process.pid} started`);

const DEFAULT_PORT = config.PORT;
const HOST = config.HOST;

async function startServer(port = DEFAULT_PORT) {
  await app.register(cors);
  await app.register(formbody);
  await app.register(websocket);

  await app.register(apiRouter, { prefix: "/api" });
  await app.register(mcpRouter);

  try {
    await initializeBlocklist();
    initializeEngineForcing();
  } catch (error) {
    logger.error("Failed to initialize blocklist and engine forcing", {
      error,
    });
    throw error;
  }

  await app.listen({ port: Number(port), host: HOST });
  logger.info(`Worker ${process.pid} listening on port ${port}`);

  const exitHandler = async () => {
    logger.info("SIGTERM signal received: closing HTTP server");
    if (config.IS_KUBERNETES) {
      logger.info("Waiting 60s for GCE load balancer drain timeout");
      await new Promise(resolve => setTimeout(resolve, 60000));
    }
    await app.close();
    await nuqShutdown();
    logger.info("NUQ shutdown complete");
    process.exit(0);
  };

  if (require.main === module) {
    process.on("SIGTERM", exitHandler);
    process.on("SIGINT", exitHandler);
  }
  return app;
}

if (require.main === module) {
  startServer().catch(error => {
    logger.error("Failed to start server", { error });
    process.exit(1);
  });
}

export { app, startServer };
