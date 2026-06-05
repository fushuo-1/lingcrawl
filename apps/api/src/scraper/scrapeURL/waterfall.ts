import { config } from "../../config";
import { type Document, scrapeOptions } from "../../controllers/types";
import { parseMarkdown } from "../../lib/html-to-markdown";
import { hasFormatOfType } from "../../lib/format-utils";
import { ActionsNotSupportedError } from "../../lib/error";
import {
  AbortInstance,
  AbortManagerThrownError,
} from "./lib/abortManager";
import {
  buildFallbackList,
  Engine,
  EngineScrapeResult,
  FeatureFlag,
  getEngineMaxReasonableTime,
  scrapeURLWithEngine,
} from "./engines";
import { htmlTransform } from "./lib/removeUnwantedElements";
import { ZDRViolationError, NoEnginesLeftError, SiteError, SSLError, ActionError, UnsupportedFileError, PDFAntibotError, PDFOCRRequiredError, PDFInsufficientTimeError, DocumentAntibotError, DNSResolutionError, NoCachedDataError, ProxySelectionError } from "./error";
import { ScrapeJobTimeoutError } from "../../lib/error";
import type { Meta } from "./meta";
import {
  AddFeatureError,
  EngineError,
  EngineSnipedError,
  EngineUnsuccessfulError,
  FEPageLoadFailed,
  IndexMissError,
  RemoveFeatureError,
  WaterfallNextEngineSignal,
} from "./signals";
import type { ScrapeUrlResponse } from "./index";
import {
  applyUnsupportedFeaturesWarning,
  buildDocument,
  executeDocumentTransformers,
  runPostprocessors,
} from "./response";
import { scrapeURL } from "./index";

const MAX_HTML_SIZE_FOR_MARKDOWN_CHECK = 300 * 1024; // 300KB

export async function scrapeURLLoopIter(
  meta: Meta,
  engine: Engine,
  snipeAbort,
): Promise<EngineScrapeResult> {
  const abort = meta.abort.child(snipeAbort);
  try {
    const engineResult = await scrapeURLWithEngine(
      {
        ...meta,
        abort,
      },
      engine,
    );

    const hasMarkdown = hasFormatOfType(meta.options.formats, "markdown");
    const hasChangeTracking = hasFormatOfType(
      meta.options.formats,
      "changeTracking",
    );
    const hasJson = hasFormatOfType(meta.options.formats, "json");
    const hasSummary = hasFormatOfType(meta.options.formats, "summary");
    const hasQuery = hasFormatOfType(meta.options.formats, "query");
    const needsMarkdown =
      hasMarkdown || hasChangeTracking || hasJson || hasSummary || hasQuery;

    let checkMarkdown: string;
    const htmlSize = engineResult.html?.length ?? 0;
    const shouldSkipMarkdownCheck = htmlSize > MAX_HTML_SIZE_FOR_MARKDOWN_CHECK;

    if (
      meta.internalOptions.teamId === "sitemap" ||
      meta.internalOptions.teamId === "robots-txt"
    ) {
      checkMarkdown = engineResult.html?.trim() ?? "";
    } else if (!needsMarkdown) {
      checkMarkdown = engineResult.html?.trim() ?? "";
    } else if (shouldSkipMarkdownCheck) {
      // Skip markdown conversion for large HTML to avoid slowdowns
      meta.logger.debug(
        "Skipping markdown conversion for quality check due to large HTML size",
        {
          htmlSize,
          threshold: MAX_HTML_SIZE_FOR_MARKDOWN_CHECK,
        },
      );
      checkMarkdown = engineResult.html?.trim() ?? "";
    } else {
      const requestId = meta.id || meta.internalOptions.crawlId;
      checkMarkdown = await parseMarkdown(
        await htmlTransform(
          engineResult.html,
          meta.url,
          scrapeOptions.parse({ onlyMainContent: true }),
        ),
        { logger: meta.logger, requestId },
      );

      if (checkMarkdown.trim().length === 0) {
        checkMarkdown = await parseMarkdown(
          await htmlTransform(
            engineResult.html,
            meta.url,
            scrapeOptions.parse({ onlyMainContent: false }),
          ),
          { logger: meta.logger, requestId },
        );
      }
    }

    // Success factors
    const isLongEnough = checkMarkdown.trim().length > 0;
    const isGoodStatusCode =
      (engineResult.statusCode >= 200 && engineResult.statusCode < 300) ||
      engineResult.statusCode === 304;
    const hasNoPageError = engineResult.error === undefined;
    const isLikelyProxyError = [401, 403, 429].includes(
      engineResult.statusCode,
    );

    if (
      isLikelyProxyError &&
      meta.options.proxy === "auto" &&
      !meta.featureFlags.has("stealthProxy")
    ) {
      meta.logger.info(
        "Scrape via " +
          engine +
          " deemed unsuccessful due to proxy inadequacy. Adding stealthProxy flag.",
        {
          factors: { isLongEnough, isGoodStatusCode, hasNoPageError },
          statusCode: engineResult.statusCode,
          length: engineResult.html?.trim().length ?? 0,
        },
      );
      throw new AddFeatureError(["stealthProxy"]);
    }

    // NOTE: TODO: what to do when status code is bad is tough...
    // we cannot just rely on text because error messages can be brief and not hit the limit
    // should we just use all the fallbacks and pick the one with the longest text? - mogery
    if (isLongEnough || !isGoodStatusCode) {
      meta.logger.info("Scrape via " + engine + " deemed successful.", {
        factors: { isLongEnough, isGoodStatusCode, hasNoPageError },
      });
      return engineResult;
    } else {
      meta.logger.warn("Scrape via " + engine + " deemed unsuccessful.", {
        factors: { isLongEnough, isGoodStatusCode, hasNoPageError },
        length: engineResult.html?.trim().length ?? 0,
      });
      throw new EngineUnsuccessfulError(engine);
    }
  } finally {
    abort?.dispose();
  }
}

class WrappedEngineError extends Error {
  name = "WrappedEngineError";
  public engine: Engine;
  public error: any;

  constructor(engine: Engine, error: any) {
    super("WrappedEngineError");
    this.engine = engine;
    this.error = error;
  }
}

type EngineScrapeResultWithContext = {
  engine: Engine;
  unsupportedFeatures: Set<FeatureFlag>;
  result: EngineScrapeResult;
};

export async function scrapeURLLoop(meta: Meta): Promise<ScrapeUrlResponse> {
    meta.logger.info(
      `Scraping URL ${JSON.stringify(meta.rewrittenUrl ?? meta.url)}...`,
    );

    if (meta.internalOptions.zeroDataRetention) {
      if (meta.featureFlags.has("screenshot")) {
        throw new ZDRViolationError("screenshot");
      }

      if (meta.featureFlags.has("screenshot@fullScreen")) {
        throw new ZDRViolationError("screenshot@fullScreen");
      }

      if (
        meta.options.actions &&
        meta.options.actions.find(x => x.type === "screenshot")
      ) {
        throw new ZDRViolationError("screenshot action");
      }

      if (
        meta.options.actions &&
        meta.options.actions.find(x => x.type === "pdf")
      ) {
        throw new ZDRViolationError("pdf action");
      }
    }

    // TODO: handle sitemap data, see WebScraper/index.ts:280
    // TODO: ScrapeEvents

    const fallbackList = await buildFallbackList(meta);

    // Check if actions are requested but no engines support them
    if (meta.featureFlags.has("actions")) {
      if (
        fallbackList.length === 0 ||
        fallbackList.every(engine => engine.unsupportedFeatures.has("actions"))
      ) {
        throw new ActionsNotSupportedError(
          "Actions are not supported by any available engines. Actions require Fire Engine (fire-engine) to be enabled.",
        );
      }
    }

    const snipeAbortController = new AbortController();
    const snipeAbort: AbortInstance = {
      signal: snipeAbortController.signal,
      tier: "engine",
      throwable() {
        return new EngineSnipedError();
      },
    };

    type EngineBundlePromise = {
      engine: Engine;
      unsupportedFeatures: Set<FeatureFlag>;
      promise: Promise<EngineScrapeResultWithContext>;
    };

    const remainingEngines = [...fallbackList];
    let enginePromises: EngineBundlePromise[] = [];
    const enginesAttempted: string[] = [];

    meta.abort.throwIfAborted();

    let result: EngineScrapeResultWithContext | null = null;

    while (remainingEngines.length > 0) {
      const { engine, unsupportedFeatures } = remainingEngines.shift()!;
      enginesAttempted.push(engine);

      const waitUntilWaterfall =
        getEngineMaxReasonableTime(meta, engine) +
        config.SCRAPEURL_ENGINE_WATERFALL_DELAY_MS;

      if (
        !isFinite(waitUntilWaterfall) ||
        isNaN(waitUntilWaterfall) ||
        waitUntilWaterfall <= 0
      ) {
        meta.logger.warn("Invalid waitUntilWaterfall value", {
          waitUntilWaterfall,
          timeout: meta.options.timeout,
          actions: !!meta.options.actions,
          hasJson: !!meta.options.formats?.find(x => x.type === "json"),
          remainingEngines: remainingEngines.length,
        });
      }

      meta.logger.info("Scraping via " + engine + "...", {
        waitUntilWaterfall,
      });

      enginePromises.push({
        engine,
        unsupportedFeatures,
        promise: (async () => {
          try {
            return {
              engine,
              unsupportedFeatures,
              result: await scrapeURLLoopIter(meta, engine, snipeAbort),
            };
          } catch (error) {
            throw new WrappedEngineError(engine, error);
          }
        })(),
      });

      while (true) {
        let timeouts: NodeJS.Timeout[] = [];
        try {
          result = await Promise.race([
            ...enginePromises.map(x => x.promise),
            ...(remainingEngines.length > 0
              ? [
                  new Promise<EngineScrapeResultWithContext>((_, reject) => {
                    timeouts.push(
                      setTimeout(() => {
                        reject(new WaterfallNextEngineSignal());
                      }, waitUntilWaterfall),
                    );
                  }),
                ]
              : []),
            new Promise<EngineScrapeResultWithContext>((_, reject) => {
              timeouts.push(
                setTimeout(() => {
                  try {
                    meta.abort.throwIfAborted();

                    // Fallback error if above doesn't throw
                    const usingDefaultTimeout =
                      meta.abort.scrapeTimeout() === undefined;
                    throw new ScrapeJobTimeoutError(
                      usingDefaultTimeout
                        ? "Scrape timed out due to maximum length of 5 minutes"
                        : "Scrape timed out",
                    );
                  } catch (error) {
                    reject(error);
                  }
                }, meta.abort.scrapeTimeout() ?? 300000),
              );
            }),
          ]);
          break;
        } catch (error) {
          if (error instanceof WrappedEngineError) {
            if (error.error instanceof EngineError) {
              meta.logger.warn(
                "Engine " + error.engine + " could not scrape the page.",
                {
                  error: error.error,
                },
              );
            } else if (error.error instanceof IndexMissError) {
              meta.logger.warn(
                "Engine " +
                  error.engine +
                  " could not find the page in the index.",
                {
                  error: error.error,
                },
              );
            } else if (
              error.error instanceof AddFeatureError ||
              error.error instanceof RemoveFeatureError ||
              error.error instanceof SiteError ||
              error.error instanceof SSLError ||
              error.error instanceof DNSResolutionError ||
              error.error instanceof ActionError ||
              error.error instanceof UnsupportedFileError ||
              error.error instanceof PDFAntibotError ||
              error.error instanceof PDFOCRRequiredError ||
              error.error instanceof DocumentAntibotError ||
              error.error instanceof PDFInsufficientTimeError ||
              error.error instanceof ProxySelectionError ||
              error.error instanceof NoCachedDataError
            ) {
              throw error.error;
            } else if (error.error instanceof FEPageLoadFailed) {
              // This is the internal timeout bug on f-e and should be treated as an EngineError.
              meta.logger.warn("FEPageLoadFailed encountered", {
                error: error.error,
              });
            } else if (error.error instanceof AbortManagerThrownError) {
              if (error.error.tier === "engine") {
                meta.logger.warn(
                  "Engine " + error.engine + " timed out while scraping.",
                  { error: error.error },
                );
              } else {
                throw error.error;
              }
            } else {
              meta.logger.warn(
                "An unexpected error happened while scraping with " +
                  error.engine +
                  ".",
                { error },
              );
            }

            // Filter out the failed engine
            enginePromises = enginePromises.filter(
              x => x.engine !== error.engine,
            );

            // If we don't have any engines waterfalled, let's waterfall the next engine
            if (enginePromises.length === 0) {
              break;
            }

            // Otherwise, just keep racing
          } else if (
            error instanceof AddFeatureError ||
            error instanceof RemoveFeatureError
          ) {
            throw error;
          } else if (error instanceof WaterfallNextEngineSignal) {
            // It's time to waterfall the next engine
            break;
          } else if (error instanceof ScrapeJobTimeoutError) {
            throw error;
          } else if (error instanceof AbortManagerThrownError) {
            if (error.tier === "engine") {
              meta.logger.warn(
                "Engine-scoped timeout error received here. Weird!",
                { error },
              );
            }

            throw error;
          } else {
            meta.logger.warn("Unexpected error while racing engines", {
              error,
            });
            throw error;
          }
        } finally {
          for (const to of timeouts) {
            clearTimeout(to);
          }
        }
      }

      if (result === null) {
        meta.logger.info("Waterfalling to next engine...", {
          waitUntilWaterfall,
        });
      } else {
        break;
      }
    }

    snipeAbortController.abort();

    if (result === null) {
      throw new NoEnginesLeftError(fallbackList.map(x => x.engine));
    }

    meta.winnerEngine = result.engine;
    let engineResult: EngineScrapeResult = result.result;

    // Auto-extract embedded PDFs detected by playwright (e.g. LCSC datasheets)
    if (engineResult.embeddedPdfUrl) {
      meta.logger.info("Embedded PDF detected, fetching with PDF engine", {
        pdfUrl: engineResult.embeddedPdfUrl,
      });
      try {
        const pdfResult = await scrapeURL(
          meta.id,
          engineResult.embeddedPdfUrl,
          {
            ...meta.options,
            formats: meta.options.formats?.map(f =>
              f.type === "markdown" ? f : { type: "markdown" as const },
            ),
          },
          {
            ...meta.internalOptions,
            forceEngine: "pdf",
          },
        );
        if (pdfResult.success) {
          return pdfResult;
        }
        meta.logger.warn("PDF engine failed for embedded PDF, falling back to HTML result", {
          pdfUrl: engineResult.embeddedPdfUrl,
        });
      } catch (err) {
        meta.logger.warn("Error fetching embedded PDF, falling back to HTML result", {
          pdfUrl: engineResult.embeddedPdfUrl,
          error: err,
        });
      }
    }

    engineResult = await runPostprocessors(meta, engineResult);

    let document: Document = buildDocument(meta, engineResult, fallbackList);
    document = applyUnsupportedFeaturesWarning(
      document,
      meta,
      result.engine,
      result.unsupportedFeatures,
    );

    // NOTE: for sitemap, we don't need all the transformers, need to skip unused ones
    document = await executeDocumentTransformers(meta, document);

    return {
      success: true,
      document,
      unsupportedFeatures: result.unsupportedFeatures,
    };
}
