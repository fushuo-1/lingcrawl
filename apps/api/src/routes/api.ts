import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";

import { searchController } from "../controllers/search";
import { scrapeController } from "../controllers/scrape";
import { scrapeStatusController } from "../controllers/scrape-status";
import { batchScrapeController } from "../controllers/batch-scrape";
import {
  batchCrawlStatusController,
  crawlStatusController,
} from "../controllers/crawl-status";
import { crawlCancelController } from "../controllers/crawl-cancel";
import { crawlErrorsController } from "../controllers/crawl-errors";
import { mapController } from "../controllers/map";
import { crawlController } from "../controllers/crawl";
import { crawlStatusWSController } from "../controllers/crawl-status-ws";
import { githubReadController } from "../controllers/github-read";
import { linksController } from "../controllers/links";
import { extractController } from "../controllers/extract";
import {
  blocklistHook,
  idempotencyHook,
  validateJobIdHook,
  isValidJobId,
  registerTimingHooks,
} from "./shared";

/**
 * Express-to-Fastify adapter (temporary, replaced when controllers are migrated).
 * Wraps Fastify request/reply into Express-compatible objects so that controllers
 * using res.status().json(), req.on(), req.protocol, req.get() work unchanged.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adapt(controller: (req: any, res: any) => Promise<any>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    // Express-compatible request shim (plain object — avoids prototype getter conflicts)
    const reqShim: Record<string, any> = {
      body: request.body,
      params: request.params as Record<string, string>,
      query: request.query as Record<string, string>,
      headers: request.headers,
      protocol: request.protocol,
      // Event emitter methods (req.on("close", ...))
      on: request.raw.on.bind(request.raw),
      once: request.raw.once.bind(request.raw),
      removeListener: request.raw.removeListener.bind(request.raw),
      // Express-style req.get(headerName)
      get(name: string) {
        if (name.toLowerCase() === "host") return request.headers.host ?? request.hostname;
        return request.headers[name.toLowerCase()];
      },
    };

    // Express-compatible response shim
    let statusCode = 200;
    const resShim: Record<string, any> = {
      status(code: number) {
        statusCode = code;
        return resShim; // chainable
      },
      json(body: unknown) {
        reply.code(statusCode).send(body);
        return resShim;
      },
      send(body?: unknown) {
        reply.code(statusCode).send(body);
        return resShim;
      },
      setHeader(name: string, value: string) {
        reply.header(name, value);
      },
    };
    await controller(reqShim, resShim);
  };
}

export default async function apiRoutes(fastify: FastifyInstance) {
  await registerTimingHooks(fastify);

  const writePre = [blocklistHook, idempotencyHook];

  // Search
  fastify.post("/search", { preHandler: writePre }, adapt(searchController));

  // Scrape
  fastify.post("/scrape", { preHandler: writePre }, adapt(scrapeController));
  fastify.get(
    "/scrape/:jobId",
    { preHandler: validateJobIdHook },
    adapt(scrapeStatusController),
  );

  // Batch Scrape
  fastify.post(
    "/batch/scrape",
    { preHandler: writePre },
    adapt(batchScrapeController),
  );
  fastify.get(
    "/batch/scrape/:jobId",
    { preHandler: validateJobIdHook },
    adapt(batchCrawlStatusController),
  );
  fastify.delete(
    "/batch/scrape/:jobId",
    { preHandler: validateJobIdHook },
    adapt(crawlCancelController),
  );
  fastify.get(
    "/batch/scrape/:jobId/errors",
    adapt(crawlErrorsController),
  );

  // Map
  fastify.post("/map", { preHandler: writePre }, adapt(mapController));

  // Crawl
  fastify.post("/crawl", { preHandler: writePre }, adapt(crawlController));
  // Crawl status — single route handles both HTTP GET and WebSocket upgrade
  fastify.route({
    method: "GET",
    url: "/crawl/:jobId",
    preHandler: validateJobIdHook,
    handler: adapt(crawlStatusController),
    wsHandler: (socket, request) => {
      const { jobId } = request.params as { jobId: string };
      if (!isValidJobId(jobId)) {
        socket.close(1008, "Invalid job ID");
        return;
      }
      crawlStatusWSController(socket, request);
    },
  });
  fastify.delete(
    "/crawl/:jobId",
    { preHandler: validateJobIdHook },
    adapt(crawlCancelController),
  );
  fastify.get(
    "/crawl/:jobId/errors",
    { preHandler: validateJobIdHook },
    adapt(crawlErrorsController),
  );

  // GitHub Read
  fastify.post("/github/read", adapt(githubReadController));

  // Links
  fastify.post("/links", adapt(linksController));

  // Extract (dual mode: fulltext or LLM)
  fastify.post("/extract", adapt(extractController));
}
