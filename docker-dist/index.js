"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const config_1 = require("./config");
require("./services/sentry");
const sentry_1 = require("./services/sentry");
const Sentry = __importStar(require("@sentry/node"));
const express_1 = __importDefault(require("express"));
const body_parser_1 = __importDefault(require("body-parser"));
const cors_1 = __importDefault(require("cors"));
const queue_service_1 = require("./services/queue-service");
const v0_1 = require("./routes/v0");
const os_1 = __importDefault(require("os"));
const logger_1 = require("./lib/logger");
const admin_1 = require("./routes/admin");
const node_http_1 = __importDefault(require("node:http"));
const node_https_1 = __importDefault(require("node:https"));
const v1_1 = require("./routes/v1");
const express_ws_1 = __importDefault(require("express-ws"));
const zod_1 = require("zod");
const concurrency_limit_1 = require("./lib/concurrency-limit");
const uuid_1 = require("uuid");
const agentLivecastWS_1 = require("./services/agentLivecastWS");
const cacheableLookup_1 = require("./scraper/scrapeURL/lib/cacheableLookup");
const v2_1 = require("./routes/api");
const nuq_1 = require("./services/worker/nuq");
const deployment_1 = require("./lib/deployment");
const blocklist_1 = require("./scraper/WebScraper/utils/blocklist");
const engine_forcing_1 = require("./scraper/WebScraper/utils/engine-forcing");
const response_time_1 = __importDefault(require("response-time"));
const webhook_1 = require("./services/webhook");
const indexer_queue_1 = require("./services/indexing/indexer-queue");
const { createBullBoard } = require("@bull-board/api");
const { BullMQAdapter } = require("@bull-board/api/bullMQAdapter");
const { ExpressAdapter } = require("@bull-board/express");
const numCPUs = config_1.config.ENV === "local" ? 2 : os_1.default.cpus().length;
logger_1.logger.info(`Number of CPUs: ${numCPUs} available`);
logger_1.logger.info("Network info dump", {
    networkInterfaces: os_1.default.networkInterfaces(),
});
// Install cacheable lookup for all other requests
cacheableLookup_1.cacheableLookup.install(node_http_1.default.globalAgent);
cacheableLookup_1.cacheableLookup.install(node_https_1.default.globalAgent);
// Initialize Express with WebSocket support
const expressApp = (0, express_1.default)();
const ws = (0, express_ws_1.default)(expressApp);
const app = ws.app;
global.isProduction = config_1.config.IS_PRODUCTION;
(0, sentry_1.setSentryServiceTag)("api");
app.use(body_parser_1.default.urlencoded({ extended: true }));
app.use(body_parser_1.default.json({ limit: "10mb" }));
app.use((0, cors_1.default)()); // Add this line to enable CORS
app.use((0, response_time_1.default)());
app.disable("x-powered-by");
if (config_1.config.EXPRESS_TRUST_PROXY) {
    app.set("trust proxy", config_1.config.EXPRESS_TRUST_PROXY);
}
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath(`/admin/${config_1.config.BULL_AUTH_KEY}/queues`);
const { addQueue, removeQueue, setQueues, replaceQueues } = createBullBoard({
    queues: [
        new BullMQAdapter((0, queue_service_1.getGenerateLlmsTxtQueue)()),
        new BullMQAdapter((0, queue_service_1.getDeepResearchQueue)()),
        new BullMQAdapter((0, queue_service_1.getBillingQueue)()),
        new BullMQAdapter((0, queue_service_1.getPrecrawlQueue)()),
    ],
    serverAdapter: serverAdapter,
});
app.use(`/admin/${config_1.config.BULL_AUTH_KEY}/queues`, serverAdapter.getRouter());
app.get("/", (_, res) => {
    res.json({
        message: "LingCrawl API",
        documentation_url: "https://docs.lingcrawl.dev",
    });
});
app.get("/e2e-test", (_, res) => {
    res.status(200).send("OK");
});
// register router
app.use(v0_1.v0Router);
app.use("/v1", v1_1.v1Router);
app.use("/v2", v2_1.apiRouter);
app.use(admin_1.adminRouter);
const DEFAULT_PORT = config_1.config.PORT;
const HOST = config_1.config.HOST;
async function startServer(port = DEFAULT_PORT) {
    try {
        await (0, blocklist_1.initializeBlocklist)();
        (0, engine_forcing_1.initializeEngineForcing)();
    }
    catch (error) {
        logger_1.logger.error("Failed to initialize blocklist and engine forcing", {
            error,
        });
        throw error;
    }
    // Attach WebSocket proxy to the Express app
    (0, agentLivecastWS_1.attachWsProxy)(app);
    const server = app.listen(Number(port), HOST, () => {
        logger_1.logger.info(`Worker ${process.pid} listening on port ${port}`);
    });
    const exitHandler = async () => {
        logger_1.logger.info("SIGTERM signal received: closing HTTP server");
        if (config_1.config.IS_KUBERNETES) {
            // Account for GCE load balancer drain timeout
            logger_1.logger.info("Waiting 60s for GCE load balancer drain timeout");
            await new Promise(resolve => setTimeout(resolve, 60000));
        }
        server.close(() => {
            logger_1.logger.info("Server closed.");
            (0, nuq_1.nuqShutdown)().finally(() => {
                (0, webhook_1.shutdownWebhookQueue)().finally(() => {
                    (0, indexer_queue_1.shutdownIndexerQueue)().finally(() => {
                        logger_1.logger.info("NUQ shutdown complete");
                        process.exit(0);
                    });
                });
            });
        });
    };
    if (require.main === module) {
        process.on("SIGTERM", exitHandler);
        process.on("SIGINT", exitHandler);
    }
    return server;
}
if (require.main === module) {
    startServer().catch(error => {
        logger_1.logger.error("Failed to start server", { error });
        process.exit(1);
    });
}
app.get("/is-production", (req, res) => {
    res.send({ isProduction: global.isProduction });
});
app.use((err, req, res, next) => {
    if (err instanceof concurrency_limit_1.QueueFullError) {
        res.status(429).json({
            success: false,
            error: err.message,
        });
    }
    else if (err instanceof zod_1.ZodError) {
        // In zod v4, ZodError uses 'issues' instead of 'errors'
        const issues = err.issues;
        if (Array.isArray(issues) &&
            issues.find(x => x.message === "URL uses unsupported protocol")) {
            logger_1.logger.warn("Unsupported protocol error: " + JSON.stringify(req.body));
        }
        // Check for unrecognized_keys errors and replace with custom message
        const hasUnrecognizedKeys = issues.some(e => e.code === "unrecognized_keys");
        const strictMessage = "Unrecognized key in body -- please review the v2 API documentation for request body changes";
        const customErrorMessage = hasUnrecognizedKeys
            ? strictMessage
            : issues.length > 0 && issues[0].code === "custom"
                ? issues[0].message
                : "Bad Request";
        res.status(400).json({
            success: false,
            code: "BAD_REQUEST",
            error: customErrorMessage,
            details: issues,
        });
    }
    else {
        next(err);
    }
});
Sentry.setupExpressErrorHandler(app);
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError &&
        "status" in err &&
        err.status === 400 &&
        "body" in err) {
        return res.status(400).json({
            success: false,
            code: "BAD_REQUEST_INVALID_JSON",
            error: "Bad request, malformed JSON",
        });
    }
    const id = res.sentry ?? (0, uuid_1.v7)();
    logger_1.logger.error("Error occurred in request! (" + req.path + ") -- ID " + id + " -- ", {
        error: err,
        errorId: id,
        path: req.path,
        teamId: req.acuc?.team_id,
        team_id: req.acuc?.team_id,
    });
    res.status(500).json({
        success: false,
        code: "UNKNOWN_ERROR",
        error: (0, deployment_1.getErrorContactMessage)(id),
    });
});
logger_1.logger.info(`Worker ${process.pid} started`);
//# sourceMappingURL=index.js.map