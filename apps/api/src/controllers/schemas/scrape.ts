import { z } from "zod";
import { integrationSchema } from "../../utils/integration";
import {
  attributesFormatWithOptions,
  changeTrackingFormatWithOptions,
  jsonFormatWithOptions,
  locationSchema,
  parsersSchema,
  queryFormatWithOptions,
  screenshotFormatWithOptions,
  URL,
} from "./common";
import { strictWithMessage } from "./crawl";

const ACTIONS_MAX_WAIT_TIME = 60;
const MAX_ACTIONS = 50;
function calculateTotalWaitTime(
  actions: any[] = [],
  waitFor: number = 0,
): number {
  const actionWaitTime = actions.reduce((acc, action) => {
    if (action.type === "wait") {
      if (action.milliseconds) {
        return acc + action.milliseconds;
      }
      // Consider selector actions as 1 second
      if (action.selector) {
        return acc + 1000;
      }
    }
    return acc;
  }, 0);

  return waitFor + actionWaitTime;
}

export const actionSchema = z.union([
  z
    .object({
      type: z.literal("wait"),
      milliseconds: z.int().positive().finite().optional(),
      selector: z.string().optional(),
    })
    .refine(
      data =>
        (data.milliseconds !== undefined || data.selector !== undefined) &&
        !(data.milliseconds !== undefined && data.selector !== undefined),
      {
        error:
          "Either 'milliseconds' or 'selector' must be provided, but not both.",
      },
    ),
  z.object({
    type: z.literal("click"),
    selector: z.string(),
    all: z.boolean().prefault(false),
  }),
  z.object({
    type: z.literal("screenshot"),
    fullPage: z.boolean().prefault(false),
    quality: z.number().min(1).max(100).optional(),
    viewport: z
      .object({
        width: z.int().positive().finite().max(7680), // 8K resolution width
        height: z.int().positive().finite().max(4320), // 8K resolution height
      })
      .optional(),
  }),
  z.object({
    type: z.literal("write"),
    text: z.string(),
  }),
  z.object({
    type: z.literal("press"),
    key: z.string(),
  }),
  z.object({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down"]).optional().prefault("down"),
    selector: z.string().optional(),
  }),
  z.object({
    type: z.literal("scrape"),
  }),
  z.object({
    type: z.literal("executeJavascript"),
    script: z.string(),
  }),
  z.object({
    type: z.literal("pdf"),
    landscape: z.boolean().prefault(false),
    scale: z.number().prefault(1),
    format: z
      .enum([
        "A0",
        "A1",
        "A2",
        "A3",
        "A4",
        "A5",
        "A6",
        "Letter",
        "Legal",
        "Tabloid",
        "Ledger",
      ])
      .prefault("Letter"),
  }),
]);

export const actionsSchema = z
  .array(actionSchema)
  .refine(actions => actions.length <= MAX_ACTIONS, {
    message: `Number of actions cannot exceed ${MAX_ACTIONS}`,
  })
  .refine(
    actions => calculateTotalWaitTime(actions) <= ACTIONS_MAX_WAIT_TIME * 1000,
    {
      message: `Total wait time (waitFor + wait actions) cannot exceed ${ACTIONS_MAX_WAIT_TIME} seconds`,
    },
  );

function transformIframeSelector(selector: string): string {
  return selector.replace(/(?:^|[\s,])iframe(?=\s|$|[.#\[:,])/g, match => {
    const prefix = match.match(/^[\s,]/)?.[0] || "";
    return prefix + 'div[data-original-tag="iframe"]';
  });
}

export const baseScrapeOptions = z.strictObject({
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
          changeTrackingFormatWithOptions,
          screenshotFormatWithOptions,
          attributesFormatWithOptions,
          queryFormatWithOptions,
        ])
        .array()
        .optional()
        .prefault([{ type: "markdown" }]),
    )
    .refine(x => {
      return x.filter(f => f.type === "screenshot").length <= 1;
    }, "You may only specify one screenshot format")
    .refine(x => {
      const hasChangeTracking = x.find(f => f.type === "changeTracking");
      const hasMarkdown = x.find(f => f.type === "markdown");
      return !hasChangeTracking || hasMarkdown;
    }, "The changeTracking format requires the markdown format to be specified as well"),
  headers: z.record(z.string(), z.string()).optional(),
  includeTags: z
    .string()
    .array()
    .transform(tags => tags.map(transformIframeSelector))
    .optional(),
  excludeTags: z
    .string()
    .array()
    .transform(tags => tags.map(transformIframeSelector))
    .optional(),
  onlyMainContent: z.boolean().prefault(true),
  onlyCleanContent: z.boolean().prefault(false),
  timeout: z.int().positive().min(1000).optional(),
  waitFor: z.int().nonnegative().max(60000).prefault(0),
  mobile: z.boolean().prefault(false),
  parsers: parsersSchema.optional(),
  actions: actionsSchema.optional(),

  location: locationSchema,

  skipTlsVerification: z.boolean().optional(),
  removeBase64Images: z.boolean().prefault(true),
  fastMode: z.boolean().prefault(false),
  useMock: z.string().optional(),
  blockAds: z.boolean().prefault(true),
  proxy: z.enum(["basic", "stealth", "enhanced", "auto"]).prefault("auto"),
  maxAge: z.int().gte(0).optional(),
  minAge: z.int().gte(0).optional(),
  storeInCache: z.boolean().prefault(true),
  // @deprecated
  __searchPreviewToken: z.string().optional(),
  __experimental_omce: z.boolean().prefault(false).optional(),
  __experimental_omceDomain: z.string().optional(),
  __experimental_engpicker: z.boolean().prefault(false).optional(),
});

type ScrapeOptionsBase = z.infer<typeof baseScrapeOptions>;

export const waitForRefine = (obj?: ScrapeOptionsBase): boolean => {
  if (obj && obj.waitFor && obj.timeout) {
    if (typeof obj.timeout !== "number" || obj.timeout <= 0) {
      return false;
    }
    return obj.waitFor <= obj.timeout / 2;
  }
  return true;
};
export const waitForRefineOpts = {
  message: "waitFor must not exceed half of timeout",
  path: ["waitFor"],
};

// Base transform function that handles both nullable and non-nullable cases
// Uses generic type to preserve all fields from extended schemas
const extractTransformImpl = <T extends ScrapeOptionsBase | undefined>(
  obj: T,
): T extends undefined ? undefined : T => {
  if (!obj) return obj as T extends undefined ? undefined : T;
  // Handle timeout
  let result = { ...obj };
  if (
    obj.formats.find(x => typeof x === "object" && x.type === "json") &&
    obj.timeout === 30000
  ) {
    result = { ...result, timeout: 60000 };
  }

  const changeTracking = obj.formats?.find(
    x => typeof x === "object" && x.type === "changeTracking",
  );

  if (changeTracking && (obj.waitFor === undefined || obj.waitFor < 5000)) {
    result = { ...result, waitFor: 5000 };
  }

  if (changeTracking && obj.timeout === 30000) {
    result = { ...result, timeout: 60000 };
  }

  if (
    (obj.proxy === "stealth" ||
      obj.proxy === "enhanced" ||
      obj.proxy === "auto") &&
    obj.timeout === 30000
  ) {
    result = { ...result, timeout: 120000 };
  }

  return result as T extends undefined ? undefined : T;
};

// Type-safe wrapper for nullable cases (used in optional scrapeOptions)
const extractTransform = (
  obj?: ScrapeOptionsBase,
): ScrapeOptionsBase | undefined => {
  return extractTransformImpl(obj);
};

// Type-safe wrapper for non-nullable cases (used in required scrapeOptions schema)
// This ensures TypeScript knows the output is always ScrapeOptionsBase, not undefined
export const extractTransformRequired = <T extends ScrapeOptionsBase>(obj: T): T => {
  return extractTransformImpl(obj)! as T;
};

export const scrapeOptions = strictWithMessage(baseScrapeOptions)
  .refine(
    obj => {
      if (!obj.actions) return true;
      return (
        calculateTotalWaitTime(obj.actions, obj.waitFor) <=
        ACTIONS_MAX_WAIT_TIME * 1000
      );
    },
    {
      message: `Total wait time (waitFor + wait actions) cannot exceed ${ACTIONS_MAX_WAIT_TIME} seconds`,
    },
  )
  .refine(waitForRefine, waitForRefineOpts)
  .transform(extractTransformRequired);

export type BaseScrapeOptions = z.infer<typeof baseScrapeOptions>;

export type ScrapeOptions = BaseScrapeOptions;

const scrapeRequestSchemaBase = baseScrapeOptions.extend({
  url: URL,
  origin: z.string().optional().prefault("api"),
  integration: integrationSchema.optional().transform(val => val || null),
  zeroDataRetention: z.boolean().optional(),
  __agentInterop: z
    .object({
      auth: z.string(),
      requestId: z.string(),
      shouldBill: z.boolean(),
      boostConcurrency: z.boolean().optional(),
    })
    .optional(),
});

export const scrapeRequestSchema = strictWithMessage(scrapeRequestSchemaBase)
  .refine(waitForRefine, waitForRefineOpts)
  .transform(extractTransformRequired);

export type ScrapeRequest = z.infer<typeof scrapeRequestSchema>;
// Use z.input on the base schema before strict() to preserve optional fields with defaults
// This is needed because zod v4's .strict() changes type inference for optional fields
// We explicitly make formats optional since it has .prefault() which should make it optional
export type ScrapeRequestInput = Omit<
  z.input<typeof baseScrapeOptions>,
  "formats"
> & {
  formats?: z.input<typeof baseScrapeOptions>["formats"];
} & {
  url: z.input<typeof URL>;
  origin?: string;
  integration?: z.input<typeof integrationSchema> | null;
  zeroDataRetention?: boolean;
};

export { calculateTotalWaitTime, ACTIONS_MAX_WAIT_TIME, extractTransform };
export type Action = z.infer<typeof actionSchema>;
