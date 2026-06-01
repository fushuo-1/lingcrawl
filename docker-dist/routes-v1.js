"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.v1Router = void 0;
const express_1 = __importDefault(require("express"));
const crawl_1 = require("../controllers/v1/crawl");
// import { crawlStatusController } from "../../src/controllers/v1/crawl-status";
const scrape_1 = require("../../src/controllers/v1/scrape");
const crawl_status_1 = require("../controllers/v1/crawl-status");
const map_1 = require("../controllers/v1/map");
const types_1 = require("../types");
const express_ws_1 = __importDefault(require("express-ws"));
const crawl_status_ws_1 = require("../controllers/v1/crawl-status-ws");
const crawl_cancel_1 = require("../controllers/v1/crawl-cancel");
const scrape_status_1 = require("../controllers/v1/scrape-status");
const concurrency_check_1 = require("../controllers/v1/concurrency-check");
const batch_scrape_1 = require("../controllers/v1/batch-scrape");
const extract_1 = require("../controllers/v1/extract");
const extract_status_1 = require("../controllers/v1/extract-status");
const credit_usage_1 = require("../controllers/v1/credit-usage");
const search_1 = require("../controllers/v1/search");
const x402_search_1 = require("../controllers/v1/x402-search");
const crawl_errors_1 = require("../controllers/v1/crawl-errors");
const generate_llmstxt_1 = require("../controllers/v1/generate-llmstxt");
const generate_llmstxt_status_1 = require("../controllers/v1/generate-llmstxt-status");
const deep_research_1 = require("../controllers/v1/deep-research");
const deep_research_status_1 = require("../controllers/v1/deep-research-status");
const token_usage_1 = require("../controllers/v1/token-usage");
const crawl_ongoing_1 = require("../controllers/v1/crawl-ongoing");
const shared_1 = require("./shared");
const queue_status_1 = require("../controllers/v1/queue-status");
const credit_usage_historical_1 = require("../controllers/v1/credit-usage-historical");
const token_usage_historical_1 = require("../controllers/v1/token-usage-historical");
const x402_1 = require("../lib/x402");
(0, express_ws_1.default)((0, express_1.default)());
exports.v1Router = express_1.default.Router();
// Add timing middleware to all v1 routes
exports.v1Router.use((0, shared_1.requestTimingMiddleware)("v1"));
// Configure payment middleware to enable micropayment-protected endpoints
// This middleware handles payment verification and processing for premium API features
// x402 payments protocol - https://github.com/coinbase/x402
// v1Router.use(
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
//             },
//           },
//           outputSchema: {
//             type: "object",
//             properties: {
//               success: { type: "boolean" },
//               data: {
//                 type: "array",
//                 items: {
//                   type: "object",
//                   properties: {
//                     url: { type: "string" },
//                     title: { type: "string" },
//                     description: { type: "string" },
//                     markdown: { type: "string" },
//                   },
//                 },
//               },
//             },
//           },
//         },
//       },
//     },
//     facilitator,
//   ),
// );
exports.v1Router.post("/scrape", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Scrape), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(1), shared_1.blocklistMiddleware, (0, shared_1.wrap)(scrape_1.scrapeController));
exports.v1Router.post("/crawl", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Crawl), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(), shared_1.blocklistMiddleware, shared_1.idempotencyMiddleware, (0, shared_1.wrap)(crawl_1.crawlController));
exports.v1Router.post("/batch/scrape", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Scrape), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(), shared_1.blocklistMiddleware, shared_1.idempotencyMiddleware, (0, shared_1.wrap)(batch_scrape_1.batchScrapeController));
exports.v1Router.post("/search", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Search), shared_1.countryCheck, (0, shared_1.checkCreditsMiddleware)(), (0, shared_1.wrap)(search_1.searchController));
exports.v1Router.post("/map", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.Map), (0, shared_1.checkCreditsMiddleware)(1), shared_1.blocklistMiddleware, (0, shared_1.wrap)(map_1.mapController));
exports.v1Router.get("/crawl/ongoing", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_ongoing_1.ongoingCrawlsController));
// Public facing, same as ongoing
exports.v1Router.get("/crawl/active", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_ongoing_1.ongoingCrawlsController));
exports.v1Router.get("/crawl/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_status_1.crawlStatusController));
exports.v1Router.get("/batch/scrape/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), 
// Yes, it uses the same controller as the normal crawl status controller
(0, shared_1.wrap)((req, res) => (0, crawl_status_1.crawlStatusController)(req, res, true)));
exports.v1Router.get("/crawl/:jobId/errors", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_errors_1.crawlErrorsController));
exports.v1Router.get("/batch/scrape/:jobId/errors", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(crawl_errors_1.crawlErrorsController));
exports.v1Router.get("/scrape/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), (0, shared_1.wrap)(scrape_status_1.scrapeStatusController));
// [REMOVED] concurrency-check, extract, llmstxt, deep-research, credit/token usage, queue-status, x402
// v1Router.get("/concurrency-check", ...);
// v1Router.post("/extract", ...);
// v1Router.get("/extract/:jobId", ...);
// v1Router.post("/llmstxt", ...);
// v1Router.get("/llmstxt/:jobId", ...);
// v1Router.post("/deep-research", ...);
// v1Router.get("/deep-research/:jobId", ...);
// v1Router.get("/team/credit-usage", ...);
// v1Router.get("/team/credit-usage/historical", ...);
// v1Router.get("/team/token-usage", ...);
// v1Router.get("/team/token-usage/historical", ...);
// v1Router.get("/team/queue-status", ...);
// if (isX402Enabled()) { v1Router.post("/x402/search", ...); }
exports.v1Router.ws("/crawl/:jobId", crawl_status_ws_1.crawlStatusWSController);
exports.v1Router.delete("/crawl/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), crawl_cancel_1.crawlCancelController);
exports.v1Router.delete("/batch/scrape/:jobId", (0, shared_1.authMiddleware)(types_1.RateLimiterMode.CrawlStatus), crawl_cancel_1.crawlCancelController);
//# sourceMappingURL=v1.js.map