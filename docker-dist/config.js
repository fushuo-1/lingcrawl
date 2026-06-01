"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
require("dotenv/config");
const zod_1 = require("zod");
/* Codecs */
const delimitedList = (separator = ",") => {
    return zod_1.z.codec(zod_1.z.string(), zod_1.z.array(zod_1.z.string()), {
        decode: str => (str ? str.split(separator).map(s => s.trim()) : []),
        encode: arr => arr.join(separator),
    });
};
// Ethereum address schema: validates 0x followed by 40 hex characters
const ethereumAddress = zod_1.z
    .string()
    .transform(s => s.trim())
    .pipe(zod_1.z.union([
    zod_1.z.literal(""), // Allow empty string (treated as undefined below)
    zod_1.z
        .string()
        .regex(/^0x[a-fA-F0-9]{40}$/, "Invalid Ethereum address format"),
]))
    .transform(s => (s === "" ? undefined : s))
    .optional();
/* Schema */
const configSchema = zod_1.z.object({
    // Application
    ENV: zod_1.z.string().optional(),
    HOST: zod_1.z.string().default("localhost"),
    PORT: zod_1.z.coerce.number().default(3002),
    IS_PRODUCTION: zod_1.z.stringbool().optional(),
    IS_KUBERNETES: zod_1.z.stringbool().optional(),
    LINGCRAWL_APP_HOST: zod_1.z.string().default("lingcrawl-app-service"),
    LINGCRAWL_APP_PORT: zod_1.z.string().default("3002"),
    LINGCRAWL_APP_SCHEME: zod_1.z.string().default("http"),
    LOGGING_LEVEL: zod_1.z.string().optional(),
    // Express
    EXPRESS_TRUST_PROXY: zod_1.z.coerce.number().optional(),
    // API Keys & Authentication
    BULL_AUTH_KEY: zod_1.z.string().optional(),
    OPENAI_API_KEY: zod_1.z.string().optional(),
    OPENAI_BASE_URL: zod_1.z.string().optional(),
    OPENROUTER_API_KEY: zod_1.z.string().optional(),
    LLAMAPARSE_API_KEY: zod_1.z.string().optional(),
    STRIPE_SECRET_KEY: zod_1.z.string().optional(),
    AUTUMN_SECRET_KEY: zod_1.z.string().optional(),
    AUTUMN_EXPERIMENT: zod_1.z.string().optional(),
    AUTUMN_EXPERIMENT_PERCENT: zod_1.z.coerce.number().default(100),
    RESEND_API_KEY: zod_1.z.string().optional(),
    PREVIEW_TOKEN: zod_1.z.string().optional(),
    SEARCH_PREVIEW_TOKEN: zod_1.z.string().optional(),
    SEARCH_SERVICE_API_SECRET: zod_1.z.string().optional(),
    // Database & Storage
    POSTGRES_HOST: zod_1.z.string().default("localhost"),
    POSTGRES_PORT: zod_1.z.string().default("5432"),
    POSTGRES_DB: zod_1.z.string().default("postgres"),
    POSTGRES_USER: zod_1.z.string().default("postgres"),
    POSTGRES_PASSWORD: zod_1.z.string().default("postgres"),
    REDIS_URL: zod_1.z.string().optional(),
    REDIS_EVICT_URL: zod_1.z.string().optional(),
    REDIS_RATE_LIMIT_URL: zod_1.z.string().optional(),
    NUQ_DATABASE_URL: zod_1.z.string().optional(),
    NUQ_DATABASE_URL_LISTEN: zod_1.z.string().optional(),
    NUQ_RABBITMQ_URL: zod_1.z.string().optional(),
    // Supabase
    SUPABASE_URL: zod_1.z.string().optional(),
    SUPABASE_ANON_TOKEN: zod_1.z.string().optional(),
    SUPABASE_SERVICE_TOKEN: zod_1.z.string().optional(),
    SUPABASE_REPLICA_URL: zod_1.z.string().optional(),
    INDEX_SUPABASE_URL: zod_1.z.string().optional(),
    INDEX_SUPABASE_SERVICE_TOKEN: zod_1.z.string().optional(),
    SEARCH_INDEX_SUPABASE_URL: zod_1.z.string().optional(),
    // Google Cloud Storage
    GCS_BUCKET_NAME: zod_1.z.string().optional(),
    GCS_CREDENTIALS: zod_1.z.string().optional(),
    GCS_FIRE_ENGINE_BUCKET_NAME: zod_1.z.string().optional(),
    GCS_INDEX_BUCKET_NAME: zod_1.z.string().optional(),
    GCS_MEDIA_BUCKET_NAME: zod_1.z.string().optional(),
    // Fire Engine
    FIRE_ENGINE_BETA_URL: zod_1.z.string().optional(),
    FIRE_ENGINE_STAGING_URL: zod_1.z.string().optional(),
    FIRE_ENGINE_AB_URL: zod_1.z.string().optional(),
    FIRE_ENGINE_AB_RATE: zod_1.z.coerce.number().optional(),
    FIRE_ENGINE_AB_MODE: zod_1.z.enum(["mirror", "split"]).default("mirror"),
    // Indexer
    INDEXER_RABBITMQ_URL: zod_1.z.string().optional(),
    INDEXER_TRAFFIC_SHARE: zod_1.z.coerce.number().default(0.0),
    // ScrapeURL
    SCRAPEURL_AB_HOST: zod_1.z.string().optional(),
    SCRAPEURL_AB_RATE: zod_1.z.coerce.number().optional(),
    SCRAPEURL_AB_EXTEND_MAXAGE: zod_1.z.stringbool().optional(),
    SCRAPEURL_ENGINE_WATERFALL_DELAY_MS: zod_1.z.coerce.number().default(0),
    // Scrape Retry Limits
    SCRAPE_MAX_ATTEMPTS: zod_1.z.coerce.number().int().positive().default(6),
    SCRAPE_MAX_FEATURE_TOGGLES: zod_1.z.coerce.number().int().positive().default(3),
    SCRAPE_MAX_FEATURE_REMOVALS: zod_1.z.coerce.number().int().positive().default(3),
    SCRAPE_MAX_PDF_PREFETCHES: zod_1.z.coerce.number().int().positive().default(2),
    SCRAPE_MAX_DOCUMENT_PREFETCHES: zod_1.z.coerce.number().int().positive().default(2),
    // Search Services
    SEARXNG_ENDPOINT: zod_1.z.string().optional(),
    SEARXNG_ENGINES: zod_1.z.string().optional(),
    SEARXNG_CATEGORIES: zod_1.z.string().optional(),
    SEARCH_SERVICE_URL: zod_1.z.string().optional(),
    SEARCH_INDEX_SAMPLE_RATE: zod_1.z.coerce.number().default(0.1),
    ENABLE_SEARCH_INDEX: zod_1.z.stringbool().optional(),
    // Bailian MCP Search
    BAILIAN_MCP_URL: zod_1.z.string().optional(),
    BAILIAN_API_KEY: zod_1.z.string().optional(),
    // Worker Configuration
    WORKER_PORT: zod_1.z.coerce.number().default(3005),
    NUQ_WORKER_PORT: zod_1.z.coerce.number().default(3000).catch(3000), // todo: investigate why .catch is needed
    NUQ_WORKER_START_PORT: zod_1.z.coerce.number().default(3006),
    NUQ_WORKER_COUNT: zod_1.z.coerce.number().default(5),
    NUQ_PREFETCH_WORKER_PORT: zod_1.z.coerce.number().default(3011).catch(3011), // todo: investigate why .catch is needed
    NUQ_RECONCILER_WORKER_PORT: zod_1.z.coerce.number().default(3012).catch(3012),
    EXTRACT_WORKER_PORT: zod_1.z.coerce.number().default(3004),
    NUQ_WAIT_MODE: zod_1.z.string().optional(),
    // Harness Configuration
    HARNESS_STARTUP_TIMEOUT_MS: zod_1.z.coerce.number().default(60000),
    // Job & Lock Management
    JOB_LOCK_EXTEND_INTERVAL: zod_1.z.coerce.number().default(10000),
    JOB_LOCK_EXTENSION_TIME: zod_1.z.coerce.number().default(60000),
    WORKER_LOCK_DURATION: zod_1.z.coerce.number().default(60000),
    WORKER_STALLED_CHECK_INTERVAL: zod_1.z.coerce.number().default(30000),
    CONNECTION_MONITOR_INTERVAL: zod_1.z.coerce.number().default(10),
    CANT_ACCEPT_CONNECTION_INTERVAL: zod_1.z.coerce.number().default(2000),
    // Proxy
    PROXY_SERVER: zod_1.z.string().optional(),
    PROXY_USERNAME: zod_1.z.string().optional(),
    PROXY_PASSWORD: zod_1.z.string().optional(),
    // External Services
    PLAYWRIGHT_MICROSERVICE_URL: zod_1.z.string().optional(),
    HTML_TO_MARKDOWN_SERVICE_URL: zod_1.z.string().optional(),
    SMART_SCRAPE_API_URL: zod_1.z.string().optional(),
    // PDF Processing
    PDF_MU_V2_BASE_URL: zod_1.z.string().optional(),
    PDF_MU_V2_API_KEY: zod_1.z.string().optional(),
    PDF_MU_V2_EXPERIMENT: zod_1.z.string().optional(),
    PDF_MU_V2_EXPERIMENT_PERCENT: zod_1.z.coerce.number().default(100),
    // RunPod
    RUNPOD_MU_API_KEY: zod_1.z.string().optional(),
    RUNPOD_MU_POD_ID: zod_1.z.string().optional(),
    // PDF Rust Extraction (pdf-inspector)
    PDF_RUST_EXTRACT_ENABLE: zod_1.z.stringbool().optional(),
    PDF_SHADOW_COMPARISON_ENABLE: zod_1.z.stringbool().optional(),
    // Webhooks
    SELF_HOSTED_WEBHOOK_URL: zod_1.z.string().optional(),
    SELF_HOSTED_WEBHOOK_HMAC_SECRET: zod_1.z.string().optional(),
    SLACK_WEBHOOK_URL: zod_1.z.string().optional(),
    SLACK_ADMIN_WEBHOOK_URL: zod_1.z.string().optional(),
    DISABLE_WEBHOOK_DELIVERY: zod_1.z.stringbool().optional(),
    ALLOW_LOCAL_WEBHOOKS: zod_1.z.stringbool().optional(),
    WEBHOOK_USE_RABBITMQ: zod_1.z.stringbool().optional(),
    // LingCrawl Features
    LINGCRAWL_DEBUG_FILTER_LINKS: zod_1.z.stringbool().optional(),
    LINGCRAWL_LOG_TO_FILE: zod_1.z.stringbool().optional(),
    LINGCRAWL_SAVE_MOCKS: zod_1.z.stringbool().optional(),
    LINGCRAWL_INDEX_WRITE_ONLY: zod_1.z.stringbool().optional(),
    DISABLE_BLOCKLIST: zod_1.z.stringbool().optional(),
    FORCED_ENGINE_DOMAINS: zod_1.z.string().optional(),
    DEBUG_BRANDING: zod_1.z.stringbool().optional(),
    // AI/ML
    MODEL_NAME: zod_1.z.string().optional(),
    MODEL_EMBEDDING_NAME: zod_1.z.string().optional(),
    OLLAMA_BASE_URL: zod_1.z.string().optional(),
    VERTEX_CREDENTIALS: zod_1.z.string().optional(),
    // Rate Limiting
    RATE_LIMIT_TEST_API_KEY_SCRAPE: zod_1.z.coerce.number().optional(),
    RATE_LIMIT_TEST_API_KEY_CRAWL: zod_1.z.coerce.number().optional(),
    // Testing
    TEST_API_KEY: zod_1.z.string().optional(),
    TEST_API_URL: zod_1.z.string().default("http://127.0.0.1:3002"),
    TEST_TEAM_ID: zod_1.z.string().optional(),
    TEST_SUITE_SELF_HOSTED: zod_1.z.stringbool().optional(),
    TEST_SUITE_WEBSITE: zod_1.z.string().default("http://127.0.0.1:4321"),
    USE_DB_AUTHENTICATION: zod_1.z.stringbool().optional(),
    // Indexing
    BACKGROUND_INDEX_TEAM_ID: zod_1.z.string().optional(),
    PRECRAWL_TEAM_ID: zod_1.z.string().optional(),
    // Payment (x402)
    X402_ENDPOINT_PRICE_USD: zod_1.z.string().optional(),
    X402_NETWORK: zod_1.z.string().optional(),
    X402_PAY_TO_ADDRESS: ethereumAddress,
    X402_FACILITATOR_URL: zod_1.z.string().url().optional(),
    // System
    MAX_CPU: zod_1.z.coerce.number().default(0.8),
    MAX_RAM: zod_1.z.coerce.number().default(0.8),
    SYS_INFO_MAX_CACHE_DURATION: zod_1.z.coerce.number().default(150),
    USE_GO_MARKDOWN_PARSER: zod_1.z.stringbool().optional(),
    // Sentry
    SENTRY_DSN: zod_1.z.string().optional(),
    SENTRY_TRACE_SAMPLE_RATE: zod_1.z.coerce.number().default(0.01),
    SENTRY_ERROR_SAMPLE_RATE: zod_1.z.coerce.number().default(0.05),
    SENTRY_ENVIRONMENT: zod_1.z.string().default("production"),
    NUQ_POD_NAME: zod_1.z.string().default("main"),
    // Miscellaneous
    IDMUX_URL: zod_1.z.string().optional(),
    GITHUB_RUN_NUMBER: zod_1.z.string().optional(),
    GITHUB_REF_NAME: zod_1.z.string().optional(),
    RESTRICTED_COUNTRIES: delimitedList(",").optional(),
    DISABLE_ENGPICKER: zod_1.z.stringbool().optional(),
    EXTRACT_V3_BETA_URL: zod_1.z.string().optional(),
    AGENT_INTEROP_SECRET: zod_1.z.string().optional(),
    // Wikipedia Enterprise API
    WIKIPEDIA_ENTERPRISE_USERNAME: zod_1.z.string().optional(),
    WIKIPEDIA_ENTERPRISE_PASSWORD: zod_1.z.string().optional(),
    // Browser Service
    BROWSER_SERVICE_URL: zod_1.z.string().optional(),
    BROWSER_SERVICE_API_KEY: zod_1.z.string().optional(),
    BROWSER_SERVICE_WEBHOOK_SECRET: zod_1.z.string().optional(),
    NUQ_PREFETCH_WORKER_HEARTBEAT_URL: zod_1.z.string().optional(),
});
exports.config = configSchema.parse(process.env);
//# sourceMappingURL=config.js.map