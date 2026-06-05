import type { Document } from "../../controllers/types";
import type { Engine, EngineScrapeResult, FeatureFlag } from "./engines";
import type { Meta } from "./meta";
import { postprocessors } from "./postprocessors";
import { executeTransformers } from "./transformers";

/**
 * Run all applicable postprocessors against the engine result.
 * Each postprocessor is wrapped in a try/catch so a single failure
 * does not abort the whole pipeline.
 */
export async function runPostprocessors(
  meta: Meta,
  engineResult: EngineScrapeResult,
): Promise<EngineScrapeResult> {
  for (const postprocessor of postprocessors) {
    if (
      postprocessor.shouldRun(
        meta,
        new URL(engineResult.url),
        engineResult.postprocessorsUsed,
      )
    ) {
      meta.logger.info("Running postprocessor " + postprocessor.name);
      try {
        engineResult = await postprocessor.run(
          {
            ...meta,
            logger: meta.logger.child({
              method: "postprocessors/" + postprocessor.name,
            }),
          },
          engineResult,
        );
      } catch (error) {
        meta.logger.warn(
          "Failed to run postprocessor " + postprocessor.name,
          {
            error,
          },
        );
      }
    }
  }
  return engineResult;
}

/**
 * Build the final Document object from a successful engine result,
 * including cache info and PDF metadata.
 */
export function buildDocument(
  meta: Meta,
  engineResult: EngineScrapeResult,
  fallbackList: { engine: Engine }[],
): Document {
  return {
    markdown: engineResult.markdown,
    rawHtml: engineResult.html,
    screenshot: engineResult.screenshot,
    actions: engineResult.actions,
    metadata: {
      sourceURL: meta.internalOptions.unnormalizedSourceURL ?? meta.url,
      url: engineResult.url,
      statusCode: engineResult.statusCode,
      error: engineResult.error,
      numPages: engineResult.pdfMetadata?.numPages,
      ...(engineResult.pdfMetadata?.title
        ? { title: engineResult.pdfMetadata.title }
        : {}),
      contentType: engineResult.contentType,
      timezone: engineResult.timezone,
      proxyUsed: engineResult.proxyUsed ?? "basic",
      ...(fallbackList.find(x =>
        ["index", "index;documents"].includes(x.engine),
      )
        ? engineResult.cacheInfo
          ? {
              cacheState: "hit",
              cachedAt: engineResult.cacheInfo.created_at.toISOString(),
            }
          : {
              cacheState: "miss",
            }
        : {}),
      postprocessorsUsed: engineResult.postprocessorsUsed,
    },
    ...(engineResult.pdfTables ? { pdfTables: engineResult.pdfTables } : {}),
    ...(engineResult.pdfImages ? { pdfImages: engineResult.pdfImages } : {}),
    ...(engineResult.pdfEnhancedMetadata ? { pdfMetadata: engineResult.pdfEnhancedMetadata } : {}),
  };
}

/**
 * Attach an unsupported-feature warning to the document if the winning
 * engine reported any.
 */
export function applyUnsupportedFeaturesWarning(
  document: Document,
  meta: Meta,
  engine: Engine,
  unsupportedFeatures: Set<FeatureFlag>,
): Document {
  if (unsupportedFeatures.size === 0) {
    return document;
  }
  const warning = `The engine used does not support the following features: ${[...unsupportedFeatures].join(", ")} -- your scrape may be partial.`;
  meta.logger.warn(warning, {
    engine,
    unsupportedFeatures,
  });
  document.warning =
    document.warning !== undefined
      ? document.warning + " " + warning
      : warning;
  return document;
}

/**
 * Run document transformers (summary, JSON extraction, etc.) on the document.
 */
export async function executeDocumentTransformers(
  meta: Meta,
  document: Document,
): Promise<Document> {
  return await executeTransformers(meta, document);
}
