import { config } from "../../config";
import type { Document, ScrapeOptions } from "../../controllers/types";
import { logger as _logger } from "../../lib/logger";
import { Engine, FeatureFlag } from "./engines";
import { AbortManagerThrownError } from "./lib/abortManager";
import {
  ActionError,
  DNSResolutionError,
  DocumentPrefetchFailed,
  NoEnginesLeftError,
  PDFInsufficientTimeError,
  PDFOCRRequiredError,
  PDFPrefetchFailed,
  ProxySelectionError,
  ScrapeRetryLimitError,
  SiteError,
  SSLError,
  UnsupportedFileError,
} from "./error";
import { InternalOptions, Meta, buildMetaObject } from "./meta";
import { checkRobotsTxt, logScrapeOutcome, runWithRetries } from "./retry";

// Side-effect imports: register engine handlers at module load time
import "./engines/fetch";
import "./engines/playwright";
import "./engines/pdf";

export type ScrapeUrlResponse =
  | {
      success: true;
      document: Document;
      unsupportedFeatures?: Set<FeatureFlag>;
    }
  | {
      success: false;
      error: any;
    };

export type { Meta, InternalOptions };

/**
 * Log a structured warning for known terminal errors before returning
 * a failure response. This is the final error-classification step.
 */
function logTerminalError(meta: Meta, error: unknown): void {
  if (error instanceof NoEnginesLeftError) {
    meta.logger.warn("scrapeURL: All scraping engines failed!", { error });
  } else if (error instanceof SiteError) {
    meta.logger.warn("scrapeURL: Site failed to load in browser", { error });
  } else if (error instanceof SSLError) {
    meta.logger.warn("scrapeURL: SSL error", { error });
  } else if (error instanceof ActionError) {
    meta.logger.warn("scrapeURL: Action(s) failed to complete", { error });
  } else if (error instanceof UnsupportedFileError) {
    meta.logger.warn("scrapeURL: Tried to scrape unsupported file", { error });
  } else if (error instanceof PDFInsufficientTimeError) {
    meta.logger.warn("scrapeURL: Insufficient time to process PDF", { error });
  } else if (error instanceof PDFOCRRequiredError) {
    meta.logger.warn(
      "scrapeURL: PDF requires OCR but fast mode was requested",
      { error },
    );
  } else if (error instanceof PDFPrefetchFailed) {
    meta.logger.warn(
      "scrapeURL: Failed to prefetch PDF that is protected by anti-bot",
      { error },
    );
  } else if (error instanceof DocumentPrefetchFailed) {
    meta.logger.warn(
      "scrapeURL: Failed to prefetch document that is protected by anti-bot",
      { error },
    );
  } else if (error instanceof ProxySelectionError) {
    meta.logger.warn("scrapeURL: Proxy selection error", { error });
  } else if (error instanceof DNSResolutionError) {
    meta.logger.warn("scrapeURL: DNS resolution error", { error });
  } else if (error instanceof ScrapeRetryLimitError) {
    meta.logger.warn("scrapeURL: Retry limit reached", {
      error,
      retryStats: error.stats,
    });
  } else {
    meta.logger.error("scrapeURL: Unexpected error happened", { error });
    // TODO: results?
  }
}

export async function scrapeURL(
  id: string,
  url: string,
  options: ScrapeOptions,
  internalOptions: InternalOptions,
): Promise<ScrapeUrlResponse> {
  const meta = await buildMetaObject(id, url, options, internalOptions);

  const startTime = Date.now();
  meta.logger.info("scrapeURL entered");

  if (meta.rewrittenUrl) {
    meta.logger.info("Rewriting URL");
  }

  // Pre-flight: robots.txt check (may throw CrawlDenialError)
  try {
    await checkRobotsTxt(meta, options, internalOptions);
  } catch (error) {
    if (error instanceof AbortManagerThrownError) {
      throw error.inner;
    }
    return {
      success: false,
      error,
    };
  }

  try {
    const result = await runWithRetries(meta);
    logScrapeOutcome(meta, startTime, result);
    return result;
  } catch (error) {
    meta.logger.debug("scrapeURL metrics", {
      module: "scrapeURL/metrics",
      timeTaken: Date.now() - startTime,
      maxAgeValid: (meta.options.maxAge ?? 0) > 0,
      shouldUseIndex: meta.featureFlags.size > 0, // proxy: see comment
      success: false,
      indexHit: false,
    });

    // Unwrap abort-manager errors to surface the inner cause
    const finalError =
      error instanceof AbortManagerThrownError ? error.inner : error;

    logTerminalError(meta, finalError);

    return {
      success: false,
      error: finalError,
    };
  }
}
