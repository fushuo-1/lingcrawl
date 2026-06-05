import { z } from "zod";
import { locationSchema, URL } from "./common";
import { integrationSchema } from "../../utils/integration";
import {
  baseScrapeOptions,
  extractTransformRequired,
  waitForRefine,
  waitForRefineOpts,
} from "./scrape";

export const crawlerOptions = z.strictObject({
  includePaths: z.string().array().prefault([]),
  excludePaths: z.string().array().prefault([]),
  maxDiscoveryDepth: z.number().optional(),
  limit: z.number().prefault(10000), // default?
  crawlEntireDomain: z.boolean().optional(),
  allowExternalLinks: z.boolean().prefault(false),
  allowSubdomains: z.boolean().prefault(false),
  ignoreRobotsTxt: z.boolean().prefault(false),
  sitemap: z.enum(["skip", "include", "only"]).prefault("include"),
  deduplicateSimilarURLs: z.boolean().prefault(true),
  ignoreQueryParameters: z.boolean().prefault(false),
  regexOnFullURL: z.boolean().prefault(false),
  delay: z.number().positive().optional(),
});

export type CrawlerOptions = z.infer<typeof crawlerOptions>;

const strictMessage =
  "Unrecognized key in body -- please review the v2 API documentation for request body changes";

// Helper function to add strict validation
// In zod v4, .strict() doesn't accept arguments
// The custom error message is handled in the error handler (see src/index.ts)
// We use a type assertion to preserve the input type so optional fields with defaults remain optional
// The 'as any' is necessary because zod v4's .strict() changes type inference in a way that makes
// optional fields with defaults appear required, even though they're not at runtime
export function strictWithMessage<T extends z.ZodObject<any>>(schema: T): T {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return schema.strict() as any as T;
}

const crawlRequestSchemaBase = crawlerOptions.extend({
  url: URL,
  origin: z.string().optional().prefault("api"),
  integration: integrationSchema.optional().transform(val => val || null),
  scrapeOptions: baseScrapeOptions.prefault(() => baseScrapeOptions.parse({})),
  limit: z.number().prefault(10000),
  maxConcurrency: z.int().positive().optional(),
  zeroDataRetention: z.boolean().optional(),
  prompt: z.string().max(10000).optional(),
});

export const crawlRequestSchema = strictWithMessage(crawlRequestSchemaBase)
  .refine(x => waitForRefine(x.scrapeOptions), waitForRefineOpts)
  .transform(x => {
    const scrapeOptionsValue = x.scrapeOptions ?? baseScrapeOptions.parse({});
    return {
      ...x,
      url: x.url,
      scrapeOptions: extractTransformRequired(scrapeOptionsValue),
    };
  });

export type CrawlRequest = z.infer<typeof crawlRequestSchema>;
export type CrawlRequestInput = z.input<typeof crawlRequestSchema>;

export const MAX_MAP_LIMIT = 100000;

const mapRequestSchemaBase = crawlerOptions
  .omit({ sitemap: true, ignoreQueryParameters: true })
  .extend({
    url: URL,
    origin: z.string().optional().prefault("api"),
    integration: integrationSchema.optional().transform(val => val || null),
    includeSubdomains: z.boolean().prefault(true),
    ignoreQueryParameters: z.boolean().prefault(true),
    search: z.string().optional(),
    sitemap: z.enum(["only", "include", "skip"]).prefault("include"),
    limit: z.number().min(1).max(MAX_MAP_LIMIT).prefault(5000),
    timeout: z.number().positive().finite().optional(),
    useMock: z.string().optional(),
    filterByPath: z.boolean().prefault(true),
    useIndex: z.boolean().prefault(true),
    ignoreCache: z.boolean().prefault(false),
    location: locationSchema,
    headers: z.record(z.string(), z.string()).optional(),
  });

export const mapRequestSchema = strictWithMessage(mapRequestSchemaBase);

export type MapRequest = z.infer<typeof mapRequestSchema>;
export type MapRequestInput = z.input<typeof mapRequestSchema>;
