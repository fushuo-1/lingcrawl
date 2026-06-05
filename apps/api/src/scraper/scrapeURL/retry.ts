import { config } from "../../config";
import type { ScrapeOptions } from "../../controllers/types";
import { getCrawl } from "../../lib/crawl-redis";
import { CrawlDenialError } from "../../lib/error";
import {
  createRobotsChecker,
  fetchRobotsTxt,
  isUrlAllowedByRobots,
} from "../../lib/robots-txt";
import type { Meta, InternalOptions } from "./meta";
import {
  AddFeatureError,
  RemoveFeatureError,
} from "./signals";
import {
  PDFAntibotError,
  DocumentAntibotError,
} from "./error";
import { ScrapeRetryTracker } from "./retryTracker";
import { scrapeURLLoop } from "./waterfall";
import { shouldUseIndex } from "./engines";
import type { ScrapeUrlResponse } from "./index";

/**
 * Check robots.txt if enabled in team flags. Throws CrawlDenialError
 * if the URL is disallowed. Failures to fetch robots.txt are logged
 * and ignored (fail-open).
 */
export async function checkRobotsTxt(
  meta: Meta,
  options: ScrapeOptions,
  internalOptions: InternalOptions,
): Promise<void> {
  if (!internalOptions.teamFlags?.checkRobotsOnScrape) {
    return;
  }

  const urlToCheck = meta.rewrittenUrl || meta.url;
  meta.logger.info("Checking robots.txt", { url: urlToCheck });

  const urlObj = new URL(urlToCheck);
  const isRobotsTxtPath = urlObj.pathname === "/robots.txt";

  if (isRobotsTxtPath) {
    return;
  }

  try {
    let robotsTxt: string | undefined;
    if (internalOptions.crawlId) {
      const crawl = await getCrawl(internalOptions.crawlId);
      robotsTxt = crawl?.robots;
    }

    if (!robotsTxt) {
      const { content } = await fetchRobotsTxt(
        {
          url: urlToCheck,
          zeroDataRetention: internalOptions.zeroDataRetention || false,
          location: options.location,
        },
        meta.id,
        meta.logger,
        meta.abort.asSignal(),
      );
      robotsTxt = content;
    }

    const checker = createRobotsChecker(urlToCheck, robotsTxt);
    const isAllowed = isUrlAllowedByRobots(urlToCheck, checker.robots);

    if (!isAllowed) {
      meta.logger.info("URL blocked by robots.txt", {
        url: urlToCheck,
      });
      throw new CrawlDenialError("URL blocked by robots.txt");
    }
  } catch (error) {
    if (error instanceof CrawlDenialError) {
      throw error;
    }
    meta.logger.debug("Failed to fetch robots.txt, allowing scrape", {
      error,
      url: urlToCheck,
    });
  }
}

/**
 * Initialize the retry tracker with configured limits from environment.
 */
export function createRetryTracker(meta: Meta): ScrapeRetryTracker {
  return new ScrapeRetryTracker(
    {
      maxAttempts: config.SCRAPE_MAX_ATTEMPTS,
      maxFeatureToggles: config.SCRAPE_MAX_FEATURE_TOGGLES,
      maxFeatureRemovals: config.SCRAPE_MAX_FEATURE_REMOVALS,
      maxPdfPrefetches: config.SCRAPE_MAX_PDF_PREFETCHES,
      maxDocumentPrefetches: config.SCRAPE_MAX_DOCUMENT_PREFETCHES,
    },
    meta.logger,
  );
}

/**
 * Run the scrape loop, handling retryable errors (AddFeatureError,
 * RemoveFeatureError, PDF/Document antibot) until a terminal result
 * is reached.
 */
export async function runWithRetries(
  meta: Meta,
): Promise<ScrapeUrlResponse> {
  const retryTracker = createRetryTracker(meta);

  while (true) {
    try {
      return await scrapeURLLoop(meta);
    } catch (error) {
      if (
        error instanceof AddFeatureError &&
        (meta.internalOptions.forceEngine === undefined ||
          Array.isArray(meta.internalOptions.forceEngine))
      ) {
        retryTracker.record("feature_toggle", error);
        meta.logger.debug(
          "More feature flags requested by scraper: adding " +
            error.featureFlags.join(", "),
          { error, existingFlags: meta.featureFlags },
        );
        meta.featureFlags = new Set(
          [...meta.featureFlags].concat(error.featureFlags),
        );
        if (error.pdfPrefetch) {
          meta.pdfPrefetch = error.pdfPrefetch;
        }
        if (error.documentPrefetch) {
          meta.documentPrefetch = error.documentPrefetch;
        }
      } else if (
        error instanceof RemoveFeatureError &&
        (meta.internalOptions.forceEngine === undefined ||
          Array.isArray(meta.internalOptions.forceEngine))
      ) {
        retryTracker.record("feature_removal", error);
        meta.logger.debug(
          "Incorrect feature flags reported by scraper: removing " +
            error.featureFlags.join(","),
          { error, existingFlags: meta.featureFlags },
        );
        meta.featureFlags = new Set(
          [...meta.featureFlags].filter(
            x => !error.featureFlags.includes(x),
          ),
        );
      } else if (
        error instanceof PDFAntibotError &&
        meta.internalOptions.forceEngine === undefined
      ) {
        if (meta.pdfPrefetch !== undefined) {
          meta.logger.error(
            "PDF was prefetched and still blocked by antibot, failing",
          );
          throw error;
        } else {
          retryTracker.record("pdf_antibot", error);
          meta.logger.debug(
            "PDF was blocked by anti-bot, prefetching with chrome-cdp",
          );
          meta.featureFlags = new Set(
            [...meta.featureFlags].filter(x => x !== "pdf"),
          );
        }
      } else if (
        error instanceof DocumentAntibotError &&
        meta.internalOptions.forceEngine === undefined
      ) {
        if (meta.documentPrefetch !== undefined) {
          meta.logger.error(
            "Document was prefetched and still blocked by antibot, failing",
          );
          throw error;
        } else {
          retryTracker.record("document_antibot", error);
          meta.logger.debug(
            "Document was blocked by anti-bot, prefetching with chrome-cdp",
          );
          meta.featureFlags = new Set(
            [...meta.featureFlags].filter(x => x !== "document"),
          );
        }
      } else {
        throw error;
      }
    }
  }
}

/**
 * Log the outcome of a scrape attempt (success or failure) for metrics.
 */
export function logScrapeOutcome(
  meta: Meta,
  startTime: number,
  result: ScrapeUrlResponse,
): void {
  meta.logger.debug("scrapeURL metrics", {
    module: "scrapeURL/metrics",
    timeTaken: Date.now() - startTime,
    maxAgeValid: (meta.options.maxAge ?? 0) > 0,
    shouldUseIndex: shouldUseIndex(meta),
    success: result.success,
    indexHit:
      result.success && result.document.metadata.cacheState === "hit",
  });
}
