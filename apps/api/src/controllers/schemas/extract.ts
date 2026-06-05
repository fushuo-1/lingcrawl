import { z } from "zod";
import Ajv from "ajv";
import addFormats from "ajv-formats";
import { integrationSchema } from "../../utils/integration";
import {
  baseScrapeOptions,
  extractTransform,
  waitForRefine,
  waitForRefineOpts,
} from "./scrape";
import {
  OPENAI_SCHEMA_ERROR_MESSAGE,
  normalizeSchemaForOpenAI,
  validateSchemaForOpenAI,
} from "../helpers/schema-utils";
import { URL } from "./common";

const ajv = new Ajv();
const agentAjv = new Ajv();
addFormats(agentAjv);

const agentExtractModelValue = "fire-1";
export const isAgentExtractModelValid = (x: string | undefined) =>
  x?.toLowerCase() === agentExtractModelValue;

export const agentOptionsExtract = z.strictObject({
  model: z.string().prefault(agentExtractModelValue),
});

const extractOptions = z
  .strictObject({
    urls: URL.array()
      .max(10, "Maximum of 10 URLs allowed per request while in beta.")
      .optional(),
    prompt: z.string().max(10000).optional(),
    systemPrompt: z.string().max(10000).optional(),
    schema: z
      .any()
      .optional()
      .refine(
        val => {
          if (!val) return true; // Allow undefined schema
          try {
            const validate = ajv.compile(val);
            return typeof validate === "function";
          } catch (e) {
            return false;
          }
        },
        {
          error: "Invalid JSON schema.",
        },
      )
      .transform(val => normalizeSchemaForOpenAI(val))
      .refine(val => validateSchemaForOpenAI(val), {
        message: OPENAI_SCHEMA_ERROR_MESSAGE,
      }),
    limit: z.int().positive().finite().optional(),
    ignoreSitemap: z.boolean().prefault(false),
    includeSubdomains: z.boolean().prefault(true),
    allowExternalLinks: z.boolean().prefault(false),
    enableWebSearch: z.boolean().prefault(false),
    scrapeOptions: baseScrapeOptions.optional(),
    origin: z.string().optional().prefault("api"),
    integration: integrationSchema.optional().transform(val => val || null),
    urlTrace: z.boolean().prefault(false),
    timeout: z.int().positive().min(1000).optional(),
    agent: agentOptionsExtract.optional(),
    __experimental_streamSteps: z.boolean().prefault(false),
    __experimental_llmUsage: z.boolean().prefault(false),
    __experimental_showSources: z.boolean().prefault(false),
    showSources: z.boolean().prefault(false),
    // These two below don't do anything anymore
    __experimental_cacheKey: z.string().optional(),
    __experimental_cacheMode: z
      .enum(["direct", "save", "load"])
      .prefault("direct")
      .optional(),
    __experimental_showCostTracking: z.boolean().prefault(false),
    ignoreInvalidURLs: z.boolean().prefault(true),
  })
  .refine(obj => obj.urls || obj.prompt, {
    error: "Either 'urls' or 'prompt' must be provided.",
  })
  .transform(obj => ({
    ...obj,
    allowExternalLinks: obj.allowExternalLinks || obj.enableWebSearch,
  }))
  .refine(
    x => (x.scrapeOptions ? waitForRefine(x.scrapeOptions) : true),
    waitForRefineOpts,
  )
  .transform(x => ({
    ...x,
    scrapeOptions: extractTransform(x.scrapeOptions),
  }));

export const extractRequestSchema = extractOptions;
export type ExtractRequest = z.infer<typeof extractRequestSchema>;
export type ExtractRequestInput = z.input<typeof extractRequestSchema>;

export const agentRequestSchema = z.strictObject({
  urls: URL.array().optional(),
  prompt: z.string().max(10000),
  schema: z
    .any()
    .optional()
    .superRefine((val, ctx) => {
      if (!val) return; // Allow undefined schema
      try {
        agentAjv.compile(val);
      } catch (e) {
        const message =
          e instanceof Error
            ? e.message
            : typeof e === "string"
              ? e
              : "Unknown error";
        ctx.addIssue({
          code: "custom",
          message: `Invalid JSON schema: ${message}`,
        });
      }
    }),
  origin: z.string().optional().prefault("api"),
  integration: integrationSchema.optional().transform(val => val || null),
  maxCredits: z.number().optional(),
  strictConstrainToURLs: z.boolean().optional(),

  overrideWhitelist: z.string().optional(),
  model: z.enum(["spark-1-pro", "spark-1-mini"]).default("spark-1-pro"),
});

export type AgentRequest = z.infer<typeof agentRequestSchema>;
// export type AgentRequestInput = z.input<typeof agentRequestSchema>;
