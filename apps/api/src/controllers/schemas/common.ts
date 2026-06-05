import { z } from "zod";
import { protocolIncluded, checkUrl } from "../../lib/validateUrl";
import { countries } from "../../lib/validate-country";
import { OPENAI_SCHEMA_ERROR_MESSAGE, normalizeSchemaForOpenAI, validateSchemaForOpenAI } from "../helpers/schema-utils";

// Base URL schema with common validation logic
export const URL = z.preprocess(
  x => {
    if (!protocolIncluded(x as string)) {
      x = `http://${x}`;
    }

    // transforming the query parameters is breaking certain sites, so we're not doing it - mogery
    // try {
    //   const urlObj = new URL(x as string);
    //   if (urlObj.search) {
    //     const searchParams = new URLSearchParams(urlObj.search.substring(1));
    //     return `${urlObj.origin}${urlObj.pathname}?${searchParams.toString()}`;
    //   }
    // } catch (e) {
    // }

    return x;
  },
  z
    .url()
    .regex(/^(https?|file):\/\//i, "URL uses unsupported protocol")
    .refine(x => {
      // file:// URLs don't need TLD validation
      if (x.startsWith("file://")) return true;
      return /(\.[a-zA-Z0-9-Ѐ-ӿԀ-ԯⷠ-ⷿꙀ-ꚟ]{2,}|\.xn--[a-zA-Z0-9-]{1,})(:\d+)?([\/?#]|$)/i.test(
        x,
      );
    }, "URL must have a valid top-level domain or be a valid path")
    .refine(x => {
      try {
        checkUrl(x as string);
        return true;
      } catch (_) {
        return false;
      }
    }, "Invalid URL"),
  // .refine((x) => !isUrlBlocked(x as string), UNSUPPORTED_SITE_MESSAGE),
);

const SPECIAL_COUNTRIES = ["us-generic", "us-whitelist"];

export const locationSchema = z
  .object({
    country: z
      .string()
      .optional()
      .refine(
        val =>
          !val ||
          Object.keys(countries).includes(val.toUpperCase()) ||
          SPECIAL_COUNTRIES.includes(val.toLowerCase()),
        "Invalid country code. Use a valid ISO 3166-1 alpha-2 country code.",
      )
      .transform(val => {
        if (!val) return "us-generic";
        return val.toLowerCase();
      }),
    languages: z.array(z.string()).optional(),
  })
  .optional();

// Format schemas
export const jsonFormatWithOptions = z.strictObject({
  type: z.literal("json"),
  schema: z
    .any()
    .optional()
    .transform(val => normalizeSchemaForOpenAI(val))
    .refine(val => validateSchemaForOpenAI(val), {
      message: OPENAI_SCHEMA_ERROR_MESSAGE,
    }),
  prompt: z.string().max(10000).optional(),
});

export type JsonFormatWithOptions = z.output<typeof jsonFormatWithOptions>;

export const changeTrackingFormatWithOptions = z.strictObject({
  type: z.literal("changeTracking"),
  prompt: z.string().optional(),
  schema: z
    .any()
    .optional()
    .transform(val => normalizeSchemaForOpenAI(val))
    .refine(val => validateSchemaForOpenAI(val), {
      message: OPENAI_SCHEMA_ERROR_MESSAGE,
    }),
  modes: z.enum(["json", "git-diff"]).array().optional().prefault([]),
  tag: z.string().or(z.null()).prefault(null),
});

export type ChangeTrackingFormatWithOptions = z.output<
  typeof changeTrackingFormatWithOptions
>;

export const screenshotFormatWithOptions = z.object({
  type: z.literal("screenshot"),
  fullPage: z.boolean().prefault(false),
  quality: z.number().min(1).max(100).optional(),
  viewport: z
    .object({
      width: z.int().positive().finite().max(7680), // 8K resolution width
      height: z.int().positive().finite().max(4320), // 8K resolution height
    })
    .optional(),
});

export type ScreenshotFormatWithOptions = z.output<typeof screenshotFormatWithOptions>;

export const attributesFormatWithOptions = z.strictObject({
  type: z.literal("attributes"),
  selectors: z
    .array(
      z.strictObject({
        selector: z.string().describe("CSS selector to find elements"),
        attribute: z
          .string()
          .describe(
            "Attribute name to extract (e.g., 'data-vehicle-name' or 'id')",
          ),
      }),
    )
    .describe("Extract specific attributes from elements"),
});

export type AttributesFormatWithOptions = z.output<typeof attributesFormatWithOptions>;

export const queryFormatWithOptions = z.strictObject({
  type: z.literal("query"),
  prompt: z.string().max(10000),
});

export type QueryFormatWithOptions = z.output<typeof queryFormatWithOptions>;

export type FormatObject =
  | { type: "markdown" }
  | { type: "html" }
  | { type: "rawHtml" }
  | { type: "links" }
  | { type: "images" }
  | { type: "summary" }
  | JsonFormatWithOptions
  | ChangeTrackingFormatWithOptions
  | ScreenshotFormatWithOptions
  | AttributesFormatWithOptions
  | QueryFormatWithOptions;

export const pdfModeSchema = z.enum(["fast", "auto", "ocr"]);

export type PDFMode = z.infer<typeof pdfModeSchema>;

export const pdfParserWithOptions = z.strictObject({
  type: z.literal("pdf"),
  mode: pdfModeSchema.optional(),
  maxPages: z.int().positive().finite().max(10000).optional(),
  pages: z.string().optional(), // page range, e.g. "1-5,10" or "3,7,12-20"
  includeTables: z.boolean().optional(),
  includeImages: z.boolean().optional(),
});

export const parsersSchema = z
  .array(z.union([z.literal("pdf"), pdfParserWithOptions]))
  .prefault(["pdf"]);

export type Parsers = z.infer<typeof parsersSchema>;
