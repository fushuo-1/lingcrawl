import express from "express";
import expressWs from "express-ws";
import { searchController } from "../controllers/search";
import { scrapeController } from "../controllers/scrape";
import { batchScrapeController } from "../controllers/batch-scrape";
import { crawlController } from "../controllers/crawl";
import { crawlStatusController } from "../controllers/crawl-status";
import { mapController } from "../controllers/map";
import { crawlErrorsController } from "../controllers/crawl-errors";
import { ongoingCrawlsController } from "../controllers/crawl-ongoing";
import { scrapeStatusController } from "../controllers/scrape-status";
import { crawlCancelController } from "../controllers/crawl-cancel";
import { crawlStatusWSController } from "../controllers/crawl-status-ws";
import {
  blocklistMiddleware,
  idempotencyMiddleware,
  requestTimingMiddleware,
  wrap,
  isValidJobId,
  validateJobIdParam,
} from "./shared";

expressWs(express());

export const apiRouter = express.Router();

apiRouter.use(requestTimingMiddleware("api"));

// Search
apiRouter.post("/search", blocklistMiddleware, wrap(searchController));

// Scrape
apiRouter.post("/scrape", blocklistMiddleware, wrap(scrapeController));
apiRouter.get("/scrape/:jobId", validateJobIdParam, wrap(scrapeStatusController));

// Batch Scrape
apiRouter.post("/batch/scrape", blocklistMiddleware, wrap(batchScrapeController));
apiRouter.get("/batch/scrape/:jobId", validateJobIdParam, wrap((req: any, res: any) => crawlStatusController(req, res, true)));
apiRouter.delete("/batch/scrape/:jobId", validateJobIdParam, wrap(crawlCancelController));
apiRouter.get("/batch/scrape/:jobId/errors", wrap(crawlErrorsController));

// Map
apiRouter.post("/map", blocklistMiddleware, wrap(mapController));

// Crawl
apiRouter.post("/crawl", blocklistMiddleware, idempotencyMiddleware, wrap(crawlController));
apiRouter.get("/crawl/ongoing", wrap(ongoingCrawlsController));
apiRouter.get("/crawl/active", wrap(ongoingCrawlsController));
apiRouter.get("/crawl/:jobId", validateJobIdParam, wrap(crawlStatusController));
apiRouter.delete("/crawl/:jobId", validateJobIdParam, wrap(crawlCancelController));
apiRouter.ws(
  "/crawl/:jobId",
  ((ws: any, req: express.Request, next: (err?: unknown) => void) => {
    if (!isValidJobId(req.params.jobId)) {
      ws.close(1008, "Invalid job ID");
      return;
    }
    next();
  }) as any,
  crawlStatusWSController,
);
apiRouter.get("/crawl/:jobId/errors", validateJobIdParam, wrap(crawlErrorsController));
