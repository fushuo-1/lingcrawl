import { ScrapeActionContent } from "../../../lib/entities";
import { Meta } from "..";
import { hasFormatOfType } from "../../../lib/format-utils";
import { getPDFMaxPages } from "../../../controllers/types";
import type { PdfMetadata } from "./pdf/types";

export type Engine =
  | "playwright"
  | "fetch"
  | "pdf"
  | (string & {});  // Allow additional engine strings

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
  "disableAdblock",
] as const;

export type FeatureFlag = (typeof featureFlags)[number];

export interface EngineDescriptor {
  name: Engine;
  handler: (meta: Meta) => Promise<EngineScrapeResult>;
  maxReasonableTime: (meta: Meta) => number;
  features: { [F in FeatureFlag]: boolean };
  quality: number;
}

const registry = new Map<Engine, EngineDescriptor>();

export function registerEngine(desc: EngineDescriptor): void {
  registry.set(desc.name, desc);
}

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

  pdfMetadata?: PdfMetadata;

  cacheInfo?: {
    created_at: Date;
  };

  contentType?: string;

  youtubeTranscriptContent?: any;
  postprocessorsUsed?: string[];

  embeddedPdfUrl?: string;

  proxyUsed: "basic" | "stealth";
  timezone?: string;
};

export async function buildFallbackList(meta: Meta): Promise<
  {
    engine: Engine;
    unsupportedFeatures: Set<FeatureFlag>;
  }[]
> {
  const engines = [...registry.keys()];

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
      : engines;

  for (const engine of currentEngines) {
    const desc = registry.get(engine as Engine);
    if (desc === undefined) continue;

    const supportedFlags = new Set([
      ...Object.entries(desc.features)
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

  if (selectedEngines.some(x => registry.get(x.engine)!.quality > 0)) {
    selectedEngines = selectedEngines.filter(
      x => registry.get(x.engine)!.quality > 0,
    );
  }

  if (meta.internalOptions.forceEngine === undefined) {
    selectedEngines.sort(
      (a, b) =>
        b.supportScore - a.supportScore ||
        registry.get(b.engine)!.quality - registry.get(a.engine)!.quality,
    );
  }

  meta.logger.info("Selected engines", {
    selectedEngines,
  });

  return selectedEngines;
}

export async function scrapeURLWithEngine(
  meta: Meta,
  engine: Engine,
): Promise<EngineScrapeResult> {
  const desc = registry.get(engine);
  if (desc === undefined) {
    throw new Error(`No engine registered for "${engine}"`);
  }

  const logger = meta.logger.child({
    method: desc.handler.name ?? "scrapeURLWithEngine",
    engine,
  });

  const featureFlags = new Set(meta.featureFlags);
  if (desc.features.stealthProxy) {
    featureFlags.add("stealthProxy");
  }

  const _meta = {
    ...meta,
    logger,
    featureFlags,
  };

  return await desc.handler(_meta);
}

export function getEngineMaxReasonableTime(meta: Meta, engine: Engine): number {
  const desc = registry.get(engine);
  if (desc === undefined) {
    meta.logger.warn("No MRT for engine", { engine });
    return 30000;
  }
  return desc.maxReasonableTime(meta);
}

// Stub: shouldUseIndex removed in self-hosted mode
export function shouldUseIndex(...args: any[]): boolean {
  return false;
}
