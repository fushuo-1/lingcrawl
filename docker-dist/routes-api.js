"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.apiRouter = void 0;
const express_1 = __importDefault(require("express"));
const types_1 = require("../types");
const express_ws_1 = __importDefault(require("express-ws"));
const search_1 = require("../controllers/search");
const x402_search_1 = require("../controllers/x402-search");
const scrape_1 = require("../controllers/scrape");
const batch_scrape_1 = require("../controllers/batch-scrape");
const crawl_1 = require("../controllers/crawl");
const crawl_params_preview_1 = require("../controllers/crawl-params-preview");
const crawl_status_1 = require("../controllers/crawl-status");
const map_1 = require("../controllers/map");
const crawl_errors_1 = require("../controllers/crawl-errors");
const crawl_ongoing_1 = require("../controllers/crawl-ongoing");
const scrape_status_1 = require("../controllers/scrape-status");
const credit_usage_1 = require("../controllers/credit-usage");
const token_usage_1 = require("../controllers/token-usage");
const crawl_cancel_1 = require("../controllers/crawl-cancel");
const concurrency_check_1 = require("../controllers/concurrency-check");
const crawl_status_ws_1 = require("../controllers/crawl-status-ws");
const extract_1 = require("../controllers/extract");
const extract_status_1 = require("../controllers/extract-status");
const shared_1 = require("./shared");
const queue_status_1 = require("../controllers/queue-status");
const credit_usage_historical_1 = require("../controllers/credit-usage-historical");
const token_usage_historical_1 = require("../controllers/token-usage-historical");
const x402_1 = require("../lib/x402");
const agent_1 = require("../controllers/agent");
const agent_status_1 = require("../controllers/agent-status");
const agent_cancel_1 = require("../controllers/agent-cancel");
const browser_1 = require("../controllers/browser");
const agent_signup_1 = require("../controllers/agent-signup");
const agent_signup_confirm_1 = require("../controllers/agent-signup-confirm");
(0, express_ws_1.default)((0, express_1.default)());
exports.apiRouter = express_1.default.Router();
// Add timing middleware to all v2 routes
exports.apiRouter.use((0, shared_1.requestTimingMiddleware)("v2"));
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
exports.apiRouter.post("/search", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Search), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(), shared_1.blocklistMiddleware, (0, shared_1.wrap)(search_1.searchController));
exports.apiRouter.post("/scrape", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Scrape), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(1), shared_1.blocklistMiddleware, (0, shared_1.wrap)(scrape_1.scrapeController));
exports.apiRouter.get("/scrape/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), shared_1.validateJobIdParam, (0, shared_1.wrap)(scrape_status_1.scrapeStatusController));
exports.apiRouter.post("/batch/scrape", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Scrape), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(), shared_1.blocklistMiddleware, (0, shared_1.wrap)(batch_scrape_1.batchScrapeController));
exports.apiRouter.post("/map", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Map), (0, shared_1.checkCreditsMiddleware)(1), shared_1.blocklistMiddleware, (0, shared_1.wrap)(map_1.mapController));
exports.apiRouter.post("/crawl", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Crawl), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(), shared_1.blocklistMiddleware, shared_1.idempotencyMiddleware, (0, shared_1.wrap)(crawl_1.crawlController));
// [REMOVED] crawl/params-preview - not needed for self-hosted
// apiRouter.post("/crawl/params-preview", ...);
exports.apiRouter.get("/crawl/ongoing", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_ongoing_1.ongoingCrawlsController));
exports.apiRouter.get("/crawl/active", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_ongoing_1.ongoingCrawlsController));
exports.apiRouter.get("/crawl/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), shared_1.validateJobIdParam, (0, shared_1.wrap)(crawl_status_1.crawlStatusController));
exports.apiRouter.delete("/crawl/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), shared_1.validateJobIdParam, (0, shared_1.wrap)(crawl_cancel_1.crawlCancelController));
exports.apiRouter.ws("/crawl/:jobId", ((ws, req, next) => {
    if (!(0, shared_1.isValidJobId)(req.params.jobId)) {
        ws.close(1008, "Invalid job ID");
        return;
    }
    next();
}), crawl_status_ws_1.crawlStatusWSController);
exports.apiRouter.get("/batch/scrape/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), shared_1.validateJobIdParam, (0, shared_1.wrap)((req, res) => (0, crawl_status_1.crawlStatusController)(req, res, true)));
exports.apiRouter.delete("/batch/scrape/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), shared_1.validateJobIdParam, (0, shared_1.wrap)(crawl_cancel_1.crawlCancelController));
exports.apiRouter.get("/batch/scrape/:jobId/errors", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_errors_1.crawlErrorsController));
exports.apiRouter.get("/crawl/:jobId/errors", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), shared_1.validateJobIdParam, (0, shared_1.wrap)(crawl_errors_1.crawlErrorsController));
// [REMOVED] extract, agent, browser, agent-signup, usage routes, x402 - not needed for self-hosted
// apiRouter.post("/extract", ...);
// apiRouter.get("/extract/:jobId", ...);
// apiRouter.post("/agent", ...);
// apiRouter.get("/agent/:jobId", ...);
// apiRouter.delete("/agent/:jobId", ...);
// apiRouter.get("/team/credit-usage", ...);
// apiRouter.get("/team/credit-usage/historical", ...);
// apiRouter.get("/team/token-usage", ...);
// apiRouter.get("/team/token-usage/historical", ...);
// apiRouter.get("/concurrency-check", ...);
// apiRouter.get("/team/queue-status", ...);
// apiRouter.post("/browser", ...);
// apiRouter.get("/browser", ...);
// apiRouter.post("/browser/:sessionId/execute", ...);
// apiRouter.delete("/browser/:sessionId", ...);
// apiRouter.post("/browser/webhook/destroyed", ...);
// apiRouter.post("/agent-signup", ...);
// apiRouter.post("/agent-signup/confirm", ...);
// apiRouter.post("/agent-signup/block", ...);
// if (isX402Enabled()) { apiRouter.post("/x402/search", ...); }
//# sourceMappingURL=v2.js.map