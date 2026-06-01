import express from "express";
import { config } from "../config";
import { RateLimiterMode } from "../types";
import expressWs from "express-ws";
import { searchController } from "../controllers/search";
// import { x402SearchController } from "../controllers/x402-search";
import { scrapeController } from "../controllers/scrape";
import { batchScrapeController } from "../controllers/batch-scrape";
import { crawlController } from "../controllers/crawl";
// import { crawlParamsPreviewController } from "../controllers/crawl-params-preview";
import { crawlStatusController } from "../controllers/crawl-status";
import { mapController } from "../controllers/map";
import { crawlErrorsController } from "../controllers/crawl-errors";
import { ongoingCrawlsController } from "../controllers/crawl-ongoing";
import { scrapeStatusController } from "../controllers/scrape-status";
// import { creditUsageController } from "../controllers/credit-usage";
// import { tokenUsageController } from "../controllers/token-usage";
import { crawlCancelController } from "../controllers/crawl-cancel";
// import { concurrencyCheckController } from "../controllers/concurrency-check";
import { crawlStatusWSController } from "../controllers/crawl-status-ws";
// import { extractController } from "../controllers/extract";
// import { extractStatusController } from "../controllers/extract-status";
import {
  authMiddleware,
  checkCreditsMiddleware,
  blocklistMiddleware,
  countryCheck,
  idempotencyMiddleware,
  requestTimingMiddleware,
  wrap,
  isValidJobId,
  validateJobIdParam,
} from "./shared";
// import { queueStatusController } from "../controllers/queue-status";
// import { creditUsageHistoricalController } from "../controllers/credit-usage-historical";
// import { tokenUsageHistoricalController } from "../controllers/token-usage-historical";
// import {
//   paymentMiddleware,
//   getX402ResourceServer,
//   createX402RouteConfig,
//   isX402Enabled,
// } from "../lib/x402";
// import { agentController } from "../controllers/agent";
// import { agentStatusController } from "../controllers/agent-status";
// import { agentCancelController } from "../controllers/agent-cancel";
// import {
//   browserCreateController,
//   browserExecuteController,
//   browserDeleteController,
//   browserListController,
//   browserWebhookDestroyedController,
// } from "../controllers/browser";
// import { agentSignupController } from "../controllers/agent-signup";
// import {
//   agentSignupConfirmController,
//   agentSignupBlockController,
// } from "../controllers/agent-signup-confirm";

expressWs(express());

export const apiRouter = express.Router();

// Add timing middleware to all v2 routes
apiRouter.use(requestTimingMiddleware("api"));

// Configure payment middleware to enable micropayment-protected endpoints
// This middleware handles payment verification and processing for premium API features
// x402 payments protocol - https://github.com/coinbase/x402
// apiRouter.use(
//   paymentMiddleware(
//     (config.X402_PAY_TO_ADDRESS as `0x${string}`) ||
//       "0x0000000000000000000000000000000000000000",
//     {
//       "POST /x402/search": {
//         price: config.X402_ENDPOINT_PRICE_USD as string,
//         network: config.X402_NETWORK as
//           | "base-sepolia"
//           | "base"
//           | "avalanche-fuji"
//           | "avalanche"
//           | "iotex",
//         config: {
//           discoverable: true,
//           description:
//             "The search endpoint combines web search (SERP) with LingCrawl's scraping capabilities to return full page content for any query. Requires micropayment via X402 protocol",
//           mimeType: "application/json",
//           maxTimeoutSeconds: 120,
//           inputSchema: {
//             body: {
//               query: {
//                 type: "string",
//                 description: "Search query to find relevant web pages",
//                 required: true,
//               },
//               sources: {
//                 type: "array",
//                 description: "Sources to search (web, news, images)",
//                 required: false,
//               },
//               limit: {
//                 type: "number",
//                 description: "Maximum number of results to return (max 10)",
//                 required: false,
//               },
//               scrapeOptions: {
//                 type: "object",
//                 description: "Options for scraping the found pages",
//                 required: false,
//               },
//               asyncScraping: {
//                 type: "boolean",
//                 description: "Whether to return job IDs for async scraping",
//                 required: false,
//               },
//             },
//           },
//           outputSchema: {
//             type: "object",
//             properties: {
//               success: { type: "boolean" },
//               data: {
//                 type: "object",
//                 properties: {
//                   web: {
//                     type: "array",
//                     items: {
//                       type: "object",
//                       properties: {
//                         url: { type: "string" },
//                         title: { type: "string" },
//                         description: { type: "string" },
//                         markdown: { type: "string" },
//                       },
//                     },
//                   },
//                   news: {
//                     type: "array",
//                     items: {
//                       type: "object",
//                       properties: {
//                         url: { type: "string" },
//                         title: { type: "string" },
//                         snippet: { type: "string" },
//                         markdown: { type: "string" },
//                       },
//                     },
//                   },
//                   images: {
//                     type: "array",
//                     items: {
//                       type: "object",
//                       properties: {
//                         url: { type: "string" },
//                         title: { type: "string" },
//                         markdown: { type: "string" },
//                       },
//                     },
//                   },
//                 },
//               },
//               scrapeIds: {
//                 type: "object",
//                 description:
//                   "Job IDs for async scraping (if asyncScraping is true)",
//                 properties: {
//                   web: { type: "array", items: { type: "string" } },
//                   news: { type: "array", items: { type: "string" } },
//                   images: { type: "array", items: { type: "string" } },
//                 },
//               },
//               creditsUsed: { type: "number" },
//             },
//           },
//         },
//       },
//     },
//     facilitator,
//   ),
// );

apiRouter.post(
  "/search",
  authMiddleware(RateLimiterMode.Search),
  countryCheck,
  checkCreditsMiddleware(),
  blocklistMiddleware,
  wrap(searchController),
);

apiRouter.post(
  "/scrape",
  authMiddleware(RateLimiterMode.Scrape),
  countryCheck,
  checkCreditsMiddleware(1),
  blocklistMiddleware,
  wrap(scrapeController),
);

apiRouter.get(
  "/scrape/:jobId",
  authMiddleware(RateLimiterMode.CrawlStatus),
  validateJobIdParam,
  wrap(scrapeStatusController),
);

apiRouter.post(
  "/batch/scrape",
  authMiddleware(RateLimiterMode.Scrape),
  countryCheck,
  checkCreditsMiddleware(),
  blocklistMiddleware,
  wrap(batchScrapeController),
);

apiRouter.post(
  "/map",
  authMiddleware(RateLimiterMode.Map),
  checkCreditsMiddleware(1),
  blocklistMiddleware,
  wrap(mapController),
);

apiRouter.post(
  "/crawl",
  authMiddleware(RateLimiterMode.Crawl),
  countryCheck,
  checkCreditsMiddleware(),
  blocklistMiddleware,
  idempotencyMiddleware,
  wrap(crawlController),
);

// [REMOVED] crawl/params-preview - not needed for self-hosted
/*
apiRouter.post("/crawl/params-preview", ...);
*/

apiRouter.get(
  "/crawl/ongoing",
  authMiddleware(RateLimiterMode.CrawlStatus),
  wrap(ongoingCrawlsController),
);

apiRouter.get(
  "/crawl/active",
  authMiddleware(RateLimiterMode.CrawlStatus),
  wrap(ongoingCrawlsController),
);

apiRouter.get(
  "/crawl/:jobId",
  authMiddleware(RateLimiterMode.CrawlStatus),
  validateJobIdParam,
  wrap(crawlStatusController),
);

apiRouter.delete(
  "/crawl/:jobId",
  authMiddleware(RateLimiterMode.CrawlStatus),
  validateJobIdParam,
  wrap(crawlCancelController),
);

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

apiRouter.get(
  "/batch/scrape/:jobId",
  authMiddleware(RateLimiterMode.CrawlStatus),
  validateJobIdParam,
  wrap((req: any, res: any) => crawlStatusController(req, res, true)),
);

apiRouter.delete(
  "/batch/scrape/:jobId",
  authMiddleware(RateLimiterMode.CrawlStatus),
  validateJobIdParam,
  wrap(crawlCancelController),
);

apiRouter.get(
  "/batch/scrape/:jobId/errors",
  authMiddleware(RateLimiterMode.CrawlStatus),
  wrap(crawlErrorsController),
);

apiRouter.get(
  "/crawl/:jobId/errors",
  authMiddleware(RateLimiterMode.CrawlStatus),
  validateJobIdParam,
  wrap(crawlErrorsController),
);

// [REMOVED] extract, agent, browser, agent-signup, usage routes - not needed for self-hosted
/*
apiRouter.post("/extract", ...);
apiRouter.get("/extract/:jobId", ...);
apiRouter.post("/agent", ...);
apiRouter.get("/agent/:jobId", ...);
apiRouter.delete("/agent/:jobId", ...);
apiRouter.get("/team/credit-usage", ...);
apiRouter.get("/team/credit-usage/historical", ...);
apiRouter.get("/team/token-usage", ...);
apiRouter.get("/team/token-usage/historical", ...);
apiRouter.get("/concurrency-check", ...);
apiRouter.get("/team/queue-status", ...);
apiRouter.post("/browser", ...);
apiRouter.get("/browser", ...);
apiRouter.post("/browser/:sessionId/execute", ...);
apiRouter.delete("/browser/:sessionId", ...);
apiRouter.post("/browser/webhook/destroyed", ...);
apiRouter.post("/agent-signup", ...);
apiRouter.post("/agent-signup/confirm", ...);
apiRouter.post("/agent-signup/block", ...);
if (isX402Enabled()) { apiRouter.post("/x402/search", ...); }
*/
