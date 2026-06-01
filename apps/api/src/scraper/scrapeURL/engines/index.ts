import { ScrapeActionContent } from "../../../lib/entities";
import { config } from "../../../config";
import { Meta } from "..";
import { pdfMaxReasonableTime, scrapePDF } from "./pdf";
import { fetchMaxReasonableTime, scrapeURLWithFetch } from "./fetch";
import {
  playwrightMaxReasonableTime,
  scrapeURLWithPlaywright,
} from "./playwright";
import { hasFormatOfType } from "../../../lib/format-utils";
import { getPDFMaxPages } from "../../../controllers/types";
import type { PdfMetadata } from "./pdf/types";
import { BrandingProfile } from "../../../types/branding";
import { BrandingNotSupportedError } from "../error";

export type Engine =
  | "playwright"
  | "fetch"
  | "pdf";

const usePlaywright =
  config.PLAYWRIGHT_MICROSERVICE_URL !== "" &&
  config.PLAYWRIGHT_MICROSERVICE_URL !== undefined;

const engines: Engine[] = [
  ...(usePlaywright ? ["playwright" as const] : []),
  "fetch",
  "pdf",
];

const featureFlags = [
  "actions",
  "waitFor",
  "screenshot",
  "screenshot@fullScreen",
  "pdf",
  "document",
  "atsv",
  "location",
  "mobile",
  "skipTlsVerification",
  "useFastMode",
  "stealthProxy",
  "branding",
  "disableAdblock",
] as const;

export type FeatureFlag = (typeof featureFlags)[number];

const featureFlagOptions: {
  [F in FeatureFlag]: {
    priority: number;
  };
} = {
  actions: { priority: 20 },
  waitFor: { priority: 1 },
  screenshot: { priority: 10 },
  "screenshot@fullScreen": { priority: 10 },
  pdf: { priority: 100 },
  document: { priority: 100 },
  atsv: { priority: 90 },
  useFastMode: { priority: 90 },
  location: { priority: 10 },
  mobile: { priority: 10 },
  skipTlsVerification: { priority: 10 },
  stealthProxy: { priority: 20 },
  branding: { priority: 20 },
  disableAdblock: { priority: 10 },
} as const;

export type EngineScrapeResult = {
  url: string;

  html: string;
  markdown?: string;
  statusCode: number;
  error?: string;

  screenshot?: string;
  actions?: {
    screenshots: string[];
    scrapes: ScrapeActionContent[];
    javascriptReturns: {
      type: string;
      value: unknown;
    }[];
    pdfs: string[];
  };

  branding?: BrandingProfile;

  pdfMetadata?: PdfMetadata;

  cacheInfo?: {
    created_at: Date;
  };

  contentType?: string;

  youtubeTranscriptContent?: any;
  postprocessorsUsed?: string[];

  proxyUsed: "basic" | "stealth";
  timezone?: string;
};

const engineHandlers: {
  [E in Engine]: (meta: Meta) => Promise<EngineScrapeResult>;
} = {
  playwright: scrapeURLWithPlaywright,
  fetch: scrapeURLWithFetch,
  pdf: scrapePDF,
};

const engineMRTs: {
  [E in Engine]: (meta: Meta) => number;
} = {
  playwright: playwrightMaxReasonableTime,
  fetch: fetchMaxReasonableTime,
  pdf: pdfMaxReasonableTime,
};

const engineOptions: {
  [E in Engine]: {
    features: { [F in FeatureFlag]: boolean };
    quality: number;
  };
} = {
  playwright: {
    features: {
      actions: false,
      waitFor: true,
      screenshot: false,
      "screenshot@fullScreen": false,
      pdf: false,
      document: false,
      atsv: false,
      location: false,
      mobile: false,
      skipTlsVerification: true,
      useFastMode: false,
      stealthProxy: false,
      branding: false,
      disableAdblock: false,
    },
    quality: 20,
  },
  fetch: {
    features: {
      actions: false,
      waitFor: false,
      screenshot: false,
      "screenshot@fullScreen": false,
      pdf: false,
      document: false,
      atsv: false,
      location: false,
      mobile: false,
      skipTlsVerification: true,
      useFastMode: true,
      stealthProxy: false,
      branding: false,
      disableAdblock: false,
    },
    quality: 5,
  },
  pdf: {
    features: {
      actions: false,
      waitFor: false,
      screenshot: false,
      "screenshot@fullScreen": false,
      pdf: true,
      document: false,
      atsv: false,
      location: false,
      mobile: false,
      skipTlsVerification: false,
      useFastMode: true,
      stealthProxy: true,
      branding: false,
      disableAdblock: true,
    },
    quality: -20,
  },
};

export async function buildFallbackList(meta: Meta): Promise<
  {
    engine: Engine;
    unsupportedFeatures: Set<FeatureFlag>;
  }[]
> {
  const _engines: Engine[] = [...engines];

  const prioritySum = [...meta.featureFlags].reduce(
    (a, x) => a + featureFlagOptions[x].priority,
    0,
  );
  const priorityThreshold = Math.floor(prioritySum / 2);
  let selectedEngines: {
    engine: Engine;
    supportScore: number;
    unsupportedFeatures: Set<FeatureFlag>;
  }[] = [];

  const currentEngines =
    meta.internalOptions.forceEngine !== undefined
      ? Array.isArray(meta.internalOptions.forceEngine)
        ? meta.internalOptions.forceEngine
        : [meta.internalOptions.forceEngine]
      : _engines;

  for (const engine of currentEngines) {
    const supportedFlags = new Set([
      ...Object.entries(engineOptions[engine].features)
        .filter(
          ([k, v]) => meta.featureFlags.has(k as FeatureFlag) && v === true,
        )
        .map(([k, _]) => k),
    ]);
    const supportScore = [...supportedFlags].reduce(
      (a, x) => a + featureFlagOptions[x].priority,
      0,
    );

    const unsupportedFeatures = new Set([...meta.featureFlags]);
    for (const flag of meta.featureFlags) {
      if (supportedFlags.has(flag)) {
        unsupportedFeatures.delete(flag);
      }
    }

    if (supportScore >= priorityThreshold) {
      selectedEngines.push({ engine, supportScore, unsupportedFeatures });
    }
  }

  if (selectedEngines.some(x => engineOptions[x.engine].quality > 0)) {
    selectedEngines = selectedEngines.filter(
      x => engineOptions[x.engine].quality > 0,
    );
  }

  if (meta.internalOptions.forceEngine === undefined) {
    selectedEngines.sort(
      (a, b) =>
        b.supportScore - a.supportScore ||
        engineOptions[b.engine].quality - engineOptions[a.engine].quality,
    );
  }

  meta.logger.info("Selected engines", {
    selectedEngines,
  });

  if (meta.featureFlags.has("branding")) {
    throw new BrandingNotSupportedError(
      "Branding extraction is not supported in the trimmed version.",
    );
  }

  return selectedEngines;
}

export async function scrapeURLWithEngine(
  meta: Meta,
  engine: Engine,
): Promise<EngineScrapeResult> {
  const fn = engineHandlers[engine];
  const logger = meta.logger.child({
    method: fn.name ?? "scrapeURLWithEngine",
    engine,
  });

  const featureFlags = new Set(meta.featureFlags);
  if (engineOptions[engine].features.stealthProxy) {
    featureFlags.add("stealthProxy");
  }

  const _meta = {
    ...meta,
    logger,
    featureFlags,
  };

  return await fn(_meta);
}

export function getEngineMaxReasonableTime(meta: Meta, engine: Engine): number {
  const mrt = engineMRTs[engine];
  if (mrt === undefined) {
    meta.logger.warn("No MRT for engine", { engine });
    return 30000;
  }
  return mrt(meta);
}
