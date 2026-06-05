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
 * Awaits the controller so async errors propagate to Fastify's setErrorHandler.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function adapt(controller: (req: any, res: any) => Promise<any>) {
  return async (request: FastifyRequest, reply: FastifyReply) => {
    await controller(request, reply);
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
  fastify.get(
    "/crawl/:jobId",
    { preHandler: validateJobIdHook },
    adapt(crawlStatusController),
  );
  fastify.delete(
    "/crawl/:jobId",
    { preHandler: validateJobIdHook },
    adapt(crawlCancelController),
  );
  // WebSocket route for real-time crawl status
  fastify.get(
    "/crawl/:jobId",
    {
      websocket: true,
      preHandler: async (request: FastifyRequest, reply: FastifyReply) => {
        const { jobId } = request.params as { jobId: string };
        if (!isValidJobId(jobId)) {
          return reply.code(400).send({ success: false, error: "Invalid job ID" });
        }
      },
    },
    (socket, request) => {
      crawlStatusWSController(socket, request);
    },
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
