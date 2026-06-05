import type { Logger } from "winston";
import { config } from "../../config";
import {
  type Document,
  scrapeOptions,
  type ScrapeOptions,
  type TeamFlags,
} from "../../controllers/types";
import { logger as _logger } from "../../lib/logger";
import { FeatureFlag, Engine } from "./engines";
import { hasFormatOfType } from "../../lib/format-utils";
import { urlSpecificParams } from "./lib/urlSpecificParams";
import { loadMock, MockState } from "./lib/mock";
import { getEngineForUrl } from "../WebScraper/utils/engine-forcing";
import {
  AbortInstance,
  AbortManager,
} from "./lib/abortManager";
import { ScrapeJobTimeoutError } from "../../lib/error";
import { rewriteUrl } from "./lib/rewriteUrl";

export type Meta = {
  id: string;
  url: string;
  rewrittenUrl?: string;
  options: ScrapeOptions & { skipTlsVerification: boolean };
  internalOptions: InternalOptions;
  logger: Logger;
  abort: AbortManager;
  featureFlags: Set<FeatureFlag>;
  mock: MockState | null;
  pdfPrefetch:
    | {
        filePath: string;
        url?: string;
        status: number;
        proxyUsed: "basic" | "stealth";
        contentType?: string;
      }
    | null
    | undefined; // undefined: no prefetch yet, null: prefetch came back empty
  documentPrefetch:
    | {
        filePath: string;
        url?: string;
        status: number;
        proxyUsed: "basic" | "stealth";
        contentType?: string;
      }
    | null
    | undefined; // undefined: no prefetch yet, null: prefetch came back empty
  winnerEngine?: Engine;
  abortHandle?: NodeJS.Timeout;
};

export type InternalOptions = {
  teamId: string;
  crawlId?: string;

  priority?: number; // Passed along to fire-engine
  forceEngine?: Engine | Engine[];
  atsv?: boolean; // anti-bot solver, beta

  disableSmartWaitCache?: boolean; // Passed along to fire-engine
  isBackgroundIndex?: boolean;
  externalAbort?: AbortInstance;
  urlInvisibleInCurrentCrawl?: boolean;
  unnormalizedSourceURL?: string;

  bypassBilling?: boolean;
  zeroDataRetention?: boolean;
  teamFlags?: TeamFlags;

  isPreCrawl?: boolean; // Whether this scrape is part of a precrawl job
};

function buildFeatureFlags(
  url: string,
  options: ScrapeOptions,
  internalOptions: InternalOptions,
): Set<FeatureFlag> {
  const flags: Set<FeatureFlag> = new Set();

  if (options.actions !== undefined) {
    flags.add("actions");
  }

  if (hasFormatOfType(options.formats, "screenshot")) {
    if (hasFormatOfType(options.formats, "screenshot")?.fullPage) {
      flags.add("screenshot@fullScreen");
    } else {
      flags.add("screenshot");
    }
  }

  if (options.waitFor !== 0) {
    flags.add("waitFor");
  }

  if (internalOptions.atsv) {
    flags.add("atsv");
  }

  if (options.location) {
    flags.add("location");
  }

  if (options.mobile) {
    flags.add("mobile");
  }

  if (options.skipTlsVerification) {
    flags.add("skipTlsVerification");
  }

  if (options.fastMode) {
    flags.add("useFastMode");
  }

  if (options.proxy === "stealth" || options.proxy === "enhanced") {
    flags.add("stealthProxy");
  }

  const urlO = new URL(
    url.startsWith("/") || url.match(/^[A-Z]:\\/i) ? `file://${url}` : url,
  );
  const lowerPath = urlO.pathname.toLowerCase();

  // Check for document types first (they take precedence over PDF)
  const isDocument =
    lowerPath.endsWith(".docx") ||
    lowerPath.endsWith(".odt") ||
    lowerPath.endsWith(".rtf") ||
    lowerPath.endsWith(".xlsx") ||
    lowerPath.endsWith(".xls") ||
    lowerPath.includes(".docx/") ||
    lowerPath.includes(".odt/") ||
    lowerPath.includes(".rtf/") ||
    lowerPath.includes(".xlsx/") ||
    lowerPath.includes(".xls/");

  if (isDocument) {
    flags.add("document");
  } else if (lowerPath.endsWith(".pdf") || lowerPath.includes(".pdf/")) {
    // Only add PDF flag if it's not a document
    flags.add("pdf");
  }

  if (options.blockAds === false) {
    flags.add("disableAdblock");
  }

  return flags;
}

// The meta object contains all required information to perform a scrape.
// For example, the scrape ID, URL, options, feature flags, logs that occur while scraping.
// The meta object is usually immutable, except for the logs array, and in edge cases (e.g. a new feature is suddenly required)
// Having a meta object that is treated as immutable helps the code stay clean and easily tracable,
// while also retaining the benefits that WebScraper had from its OOP design.
export async function buildMetaObject(
  id: string,
  url: string,
  options: ScrapeOptions,
  internalOptions: InternalOptions,
): Promise<Meta> {
  const urlO = new URL(url);
  const hostname = urlO.protocol === "file:" ? "" : urlO.hostname.replace(/^www\./, "");
  const specParams = hostname ? urlSpecificParams[hostname] : undefined;
  if (specParams !== undefined) {
    options = Object.assign(options, specParams.scrapeOptions);
    internalOptions = Object.assign(
      internalOptions,
      specParams.internalOptions,
    );
  }

  if (internalOptions.forceEngine === undefined) {
    const forcedEngine = getEngineForUrl(url);
    if (forcedEngine !== undefined) {
      internalOptions = Object.assign(internalOptions, {
        forceEngine: forcedEngine,
      });
    }
  }

  const logger = _logger.child({
    module: "ScrapeURL",
    scrapeId: id,
    scrapeURL: url,
    zeroDataRetention: internalOptions.zeroDataRetention,
    teamId: internalOptions.teamId,
    team_id: internalOptions.teamId,
    crawlId: internalOptions.crawlId,
  });

  const abortController = new AbortController();
  const abortHandle =
    options.timeout !== undefined
      ? setTimeout(
          () => abortController.abort(new ScrapeJobTimeoutError()),
          options.timeout,
        )
      : undefined;

  return {
    id,
    url,
    rewrittenUrl: rewriteUrl(url),
    options: {
      ...options,
      skipTlsVerification:
        options.skipTlsVerification ??
        ((options.headers && Object.keys(options.headers).length > 0) ||
        (options.actions && options.actions.length > 0)
          ? false
          : true),
    },
    internalOptions,
    logger,
    abortHandle,
    abort: new AbortManager(
      internalOptions.externalAbort,
      options.timeout !== undefined
        ? {
            signal: abortController.signal,
            tier: "scrape",
            timesOutAt: new Date(Date.now() + options.timeout),
            throwable() {
              return new ScrapeJobTimeoutError();
            },
          }
        : undefined,
    ),
    featureFlags: buildFeatureFlags(url, options, internalOptions),
    mock:
      options.useMock !== undefined
        ? await loadMock(options.useMock, _logger)
        : null,
    pdfPrefetch: undefined,
    documentPrefetch: undefined,
  };
}
