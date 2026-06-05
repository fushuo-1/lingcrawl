import { z } from "zod";
import { integrationSchema } from "../../utils/integration";
import {
  baseScrapeOptions,
  extractTransform,
  waitForRefine,
  waitForRefineOpts,
} from "./scrape";
import {
  jsonFormatWithOptions,
  queryFormatWithOptions,
  screenshotFormatWithOptions,
} from "./common";

// Search source type definitions
// These allow fine-grained control over each search source type
// Similar to how scrape formats work with jsonFormatWithOptions, etc.

const webSearchSourceOptions = z.strictObject({
  type: z.literal("web"),
  tbs: z.string().optional(), // Time-based search (e.g., "qdr:d" for past day)
  filter: z.string().optional(), // Search filter
  lang: z.string().optional(), // Language override for this source
  country: z.string().optional(), // Country override for this source
  location: z.string().optional(), // Location override for this source
});

const imagesSearchSourceOptions = z.strictObject({
  type: z.literal("images"),
});

const newsSearchSourceOptions = z.strictObject({
  type: z.literal("news"),
});

// Category source type definitions
const githubCategoryOptions = z.strictObject({
  type: z.literal("github"),
});

const researchCategoryOptions = z.strictObject({
  type: z.literal("research"),
});

const pdfCategoryOptions = z.strictObject({
  type: z.literal("pdf"),
});

export const searchRequestSchema = z
  .strictObject({
    query: z.string(),
    limit: z.int().positive().finite().max(100).optional().prefault(10),
    tbs: z.string().optional(),
    filter: z.string().optional(),
    sources: z
      .union([
        // Array of strings (simple format)
        z.array(z.enum(["web", "images", "news"])),
        // Array of objects (advanced format)
        z.array(
          z.union([
            webSearchSourceOptions,
            imagesSearchSourceOptions,
            newsSearchSourceOptions,
          ]),
        ),
      ])
      .optional()
      .prefault(["web"]),
    categories: z
      .union([
        // Array of strings (simple format)
        z.array(z.enum(["github", "research", "pdf"])),
        // Array of objects (advanced format)
        z.array(
          z.union([
            githubCategoryOptions,
            researchCategoryOptions,
            pdfCategoryOptions,
          ]),
        ),
      ])
      .optional(),
    lang: z.string().optional(),
    enterprise: z.array(z.enum(["default", "anon", "zdr"])).optional(),
    country: z.string().optional(),
    location: z.string().optional(),
    origin: z.string().optional().prefault("api"),
    integration: integrationSchema.optional().transform(val => val || null),
    timeout: z.int().positive().finite().prefault(60000),
    ignoreInvalidURLs: z.boolean().optional().prefault(false),
    asyncScraping: z.boolean().optional().prefault(false),
    __searchPreviewToken: z.string().optional(),
    scrapeOptions: baseScrapeOptions
      .extend({
        formats: z
          .preprocess(
            val => {
              if (!Array.isArray(val)) return val;
              return val.map(format => {
                if (typeof format === "string") {
                  return { type: format };
                }
                return format;
              });
            },
            z
              .union([
                z.strictObject({ type: z.literal("markdown") }),
                z.strictObject({ type: z.literal("html") }),
                z.strictObject({ type: z.literal("rawHtml") }),
                z.strictObject({ type: z.literal("links") }),
                z.strictObject({ type: z.literal("images") }),
                z.strictObject({ type: z.literal("summary") }),
                jsonFormatWithOptions,
                queryFormatWithOptions,
                screenshotFormatWithOptions,
              ])
              .array()
              .optional()
              .prefault([]),
          )
          .refine(x => {
            return x.filter(f => f.type === "screenshot").length <= 1;
          }, "You may only specify one screenshot format"),
      })
      .optional(),
    __agentInterop: z
      .object({
        auth: z.string(),
        requestId: z.string(),
        shouldBill: z.boolean(),
      })
      .optional(),
  })
  .refine(x => waitForRefine(x.scrapeOptions), waitForRefineOpts)
  .transform(x => {
    const country =
      x.country !== undefined ? x.country : x.location ? undefined : "us";

    // Transform string array sources to object format
    let sources = x.sources;
    if (sources && Array.isArray(sources) && sources.length > 0) {
      // Check if it's a string array by checking the first element
      if (typeof sources[0] === "string") {
        // It's a string array, transform to object array
        sources = (sources as string[]).map(s => {
          switch (s) {
            case "web":
              return {
                type: "web" as const,
                tbs: x.tbs,
                filter: x.filter,
                lang: x.lang,
                country,
                location: x.location,
              };
            case "images":
              return {
                type: "images" as const,
                // Images don't inherit global params in the simple format
              };
            case "news":
              return {
                type: "news" as const,
                tbs: x.tbs,
                lang: x.lang,
                country,
                location: x.location,
              };
            default:
              return { type: s as any };
          }
        });
      }
      // Otherwise it's already an object array, keep as is
    }

    // Transform string array categories to object format
    let categories = x.categories;
    if (categories && Array.isArray(categories) && categories.length > 0) {
      // Check if it's a string array by checking the first element
      if (typeof categories[0] === "string") {
        // It's a string array, transform to object array
        categories = (categories as string[]).map(c => {
          switch (c) {
            case "github":
              return {
                type: "github" as const,
              };
            case "research":
              return {
                type: "research" as const,
              };
            case "pdf":
              return {
                type: "pdf" as const,
              };
            default:
              return { type: c as any };
          }
        });
      }
      // Otherwise it's already an object array, keep as is
    }

    return {
      ...x,
      country,
      sources,
      categories,
      scrapeOptions: extractTransform(x.scrapeOptions),
    };
  });

export type SearchRequest = z.infer<typeof searchRequestSchema>;
export type SearchRequestInput = z.input<typeof searchRequestSchema>;
