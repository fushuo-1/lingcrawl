import "dotenv/config";
import { configDotenv } from "dotenv";
import path from "path";

// Fallback: load .env from repo root when running from apps/api/
configDotenv({ path: path.resolve(__dirname, "..", "..", "..", ".env"), override: false });

import { z } from "zod";

/* Schema */
const configSchema = z.object({
  
  // Application
  ENV: z.string().optional(),
  HOST: z.string().default("localhost"),
  PORT: z.coerce.number().default(3002),
  LOGGING_LEVEL: z.string().optional(),

  // Database & Storage
  POSTGRES_HOST: z.string().default("localhost"),
  POSTGRES_PORT: z.string().default("5432"),
  POSTGRES_DB: z.string().default("postgres"),
  POSTGRES_USER: z.string().default("postgres"),
  POSTGRES_PASSWORD: z.string().default("postgres"),
  REDIS_URL: z.string().optional(),
  REDIS_EVICT_URL: z.string().optional(),
  REDIS_RATE_LIMIT_URL: z.string().optional(),
  NUQ_DATABASE_URL: z.string().optional(),
  NUQ_DATABASE_URL_LISTEN: z.string().optional(),
  NUQ_RABBITMQ_URL: z.string().optional(),

  // ScrapeURL
  SCRAPEURL_ENGINE_WATERFALL_DELAY_MS: z.coerce.number().default(0),

  // Scrape Retry Limits
  SCRAPE_MAX_ATTEMPTS: z.coerce.number().int().positive().default(6),
  SCRAPE_MAX_FEATURE_TOGGLES: z.coerce.number().int().positive().default(3),
  SCRAPE_MAX_FEATURE_REMOVALS: z.coerce.number().int().positive().default(3),
  SCRAPE_MAX_PDF_PREFETCHES: z.coerce.number().int().positive().default(2),
  SCRAPE_MAX_DOCUMENT_PREFETCHES: z.coerce.number().int().positive().default(2),

  // Search Services
  SEARXNG_ENDPOINT: z.string().optional(),
  SEARXNG_ENGINES: z.string().optional(),
  SEARXNG_CATEGORIES: z.string().optional(),

  // Worker Configuration
  WORKER_PORT: z.coerce.number().default(3005),
  NUQ_WORKER_PORT: z.coerce.number().default(3000).catch(3000),
  NUQ_WORKER_START_PORT: z.coerce.number().default(3006),
  NUQ_WORKER_COUNT: z.coerce.number().default(5),
  NUQ_PREFETCH_WORKER_PORT: z.coerce.number().default(3011).catch(3011),
  NUQ_PREFETCH_WORKER_HEARTBEAT_URL: z.string().optional(),
  NUQ_RECONCILER_WORKER_PORT: z.coerce.number().default(3012).catch(3012),
  EXTRACT_WORKER_PORT: z.coerce.number().default(3004),
  NUQ_WAIT_MODE: z.string().optional(),

  // Harness Configuration
  HARNESS_STARTUP_TIMEOUT_MS: z.coerce.number().default(60000),

  // Proxy
  PROXY_SERVER: z.string().optional(),
  PROXY_USERNAME: z.string().optional(),
  PROXY_PASSWORD: z.string().optional(),

  // SSRF / Local Network Access
  ALLOW_LOCAL_NETWORK: z.stringbool().optional(),

  // GitHub
  GITHUB_TOKEN: z.string().optional(),

  // LingCrawl Features
  LINGCRAWL_LOG_TO_FILE: z.stringbool().optional(),
  FORCED_ENGINE_DOMAINS: z.string().optional(),
  USE_GO_MARKDOWN_PARSER: z.stringbool().optional(),
  PLAYWRIGHT_MICROSERVICE_URL: z.string().optional(),
  BLOCK_MEDIA: z.stringbool().optional(),

  // System
  MAX_CPU: z.coerce.number().default(0.8),
  MAX_RAM: z.coerce.number().default(0.8),
  SYS_INFO_MAX_CACHE_DURATION: z.coerce.number().default(150),

  // Deployment environment
  IS_PRODUCTION: z.stringbool().optional(),
  IS_KUBERNETES: z.stringbool().optional(),
  FIRE_ENGINE_BETA_URL: z.string().optional(),
  SEARCH_PREVIEW_TOKEN: z.string().optional(),

  NUQ_POD_NAME: z.string().default("main"),

  // Testing
  TEST_API_KEY: z.string().optional(),
  TEST_API_URL: z.string().default("http://127.0.0.1:3002"),
  TEST_TEAM_ID: z.string().optional(),
  TEST_SUITE_SELF_HOSTED: z.stringbool().optional(),
  TEST_SUITE_WEBSITE: z.string().default("http://127.0.0.1:4321"),
});

export const config = configSchema.parse(process.env);
