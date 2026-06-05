import { z } from "zod";
import { integrationSchema } from "../../utils/integration";
import { URL } from "./common";
import {
  baseScrapeOptions,
  extractTransformRequired,
  waitForRefine,
  waitForRefineOpts,
} from "./scrape";
import { strictWithMessage } from "./crawl";

const batchScrapeRequestSchemaBase = baseScrapeOptions.extend({
  urls: URL.array().min(1),
  origin: z.string().optional().prefault("api"),
  integration: integrationSchema.optional().transform(val => val || null),
  appendToId: z.uuid().optional(),
  ignoreInvalidURLs: z.boolean().prefault(true),
  maxConcurrency: z.int().positive().optional(),
  zeroDataRetention: z.boolean().optional(),
  __agentInterop: z
    .object({
      auth: z.string(),
      requestId: z.string(),
      shouldBill: z.boolean(),
    })
    .optional(),
});

export const batchScrapeRequestSchema = strictWithMessage(
  batchScrapeRequestSchemaBase,
)
  .refine(waitForRefine, waitForRefineOpts)
  .transform(extractTransformRequired);

const batchScrapeRequestSchemaNoURLValidationBase = baseScrapeOptions.extend({
  urls: z.string().array().min(1),
  origin: z.string().optional().prefault("api"),
  integration: integrationSchema.optional().transform(val => val || null),
  appendToId: z.uuid().optional(),
  ignoreInvalidURLs: z.boolean().prefault(true),
  maxConcurrency: z.int().positive().optional(),
  zeroDataRetention: z.boolean().optional(),
  __agentInterop: z
    .object({
      auth: z.string(),
      requestId: z.string(),
      shouldBill: z.boolean(),
    })
    .optional(),
});

export const batchScrapeRequestSchemaNoURLValidation = strictWithMessage(
  batchScrapeRequestSchemaNoURLValidationBase,
)
  .refine(waitForRefine, waitForRefineOpts)
  .transform(extractTransformRequired);

export type BatchScrapeRequest = z.infer<typeof batchScrapeRequestSchema>;
// Use z.input on the base schema before strict() to preserve optional fields with defaults
// We explicitly make formats optional since it has .prefault() which should make it optional
export type BatchScrapeRequestInput = Omit<
  z.input<typeof baseScrapeOptions>,
  "formats"
> & {
  formats?: z.input<typeof baseScrapeOptions>["formats"];
} & {
  urls: z.input<typeof URL>[];
  origin?: string;
  integration?: z.input<typeof integrationSchema> | null;
  appendToId?: string;
  ignoreInvalidURLs?: boolean;
  maxConcurrency?: number;
  zeroDataRetention?: boolean;
};
