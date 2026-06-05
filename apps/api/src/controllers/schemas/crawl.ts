import { z } from "zod";
import { locationSchema, strictWithMessage, URL } from "./common";
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
  currentDiscoveryDepth: z.number().optional(),
  urlInvisibleInCurrentCrawl: z.boolean().optional(),
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
