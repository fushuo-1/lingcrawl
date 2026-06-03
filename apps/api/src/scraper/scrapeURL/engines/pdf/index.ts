import { Meta } from "../..";
import { EngineScrapeResult, registerEngine } from "..";
import * as marked from "marked";
import { downloadFile, fetchFileToBuffer } from "../utils/downloadFile";
import {
  PDFAntibotError,
  PDFInsufficientTimeError,
  PDFOCRRequiredError,
  PDFPrefetchFailed,
  EngineUnsuccessfulError,
} from "../../error";
import { open, readFile, unlink } from "node:fs/promises";
import type { Response } from "undici";
import {
  shouldParsePDF,
  getPDFMaxPages,
  getPDFMode,
} from "../../../../controllers/types";
import type { PDFMode } from "../../../../controllers/types";
import { processPdf } from "@lingcrawl/lingcrawl-rs";
import { MILLISECONDS_PER_PAGE } from "./types";
import type { PDFProcessorResult } from "./types";
import { emitNativeLogs, extractAndEmitNativeLogs } from "../../../../lib/native-logging";
import { scrapePDFWithParsePDF } from "./pdfParse";
import { isPdfBuffer, PDF_SNIFF_WINDOW } from "./pdfUtils";

/** Check if the PDF is eligible for Rust extraction, returning a rejection reason or null. */
function getIneligibleReason(
  result: ReturnType<typeof processPdf>,
): string | null {
  if (result.pdfType !== "TextBased") return `pdfType=${result.pdfType}`;
  if (result.confidence < 0.95) return `confidence=${result.confidence}`;
  if (result.isComplex) return "complex layout (tables/columns)";
  if (!result.markdown?.length)
    return "empty markdown (unexpected for TextBased)";
  return null;
}

export async function scrapePDF(meta: Meta): Promise<EngineScrapeResult> {
  const shouldParse = shouldParsePDF(meta.options.parsers);
  const maxPages = getPDFMaxPages(meta.options.parsers);
  const mode: PDFMode = getPDFMode(meta.options.parsers);

  if (!shouldParse) {
    if (meta.pdfPrefetch !== undefined && meta.pdfPrefetch !== null) {
      const content = (await readFile(meta.pdfPrefetch.filePath)).toString(
        "base64",
      );
      return {
        url: meta.pdfPrefetch.url ?? meta.rewrittenUrl ?? meta.url,
        statusCode: meta.pdfPrefetch.status,

        html: content,
        markdown: content,

        proxyUsed: meta.pdfPrefetch.proxyUsed,
      };
    } else {
      const file = await fetchFileToBuffer(
        meta.rewrittenUrl ?? meta.url,
        meta.options.skipTlsVerification,
        {
          headers: meta.options.headers,
          signal: meta.abort.asSignal(),
        },
      );

      if (!isPdfBuffer(file.buffer)) {
        // downloaded content isn't a valid PDF
        if (meta.pdfPrefetch === undefined) {
          // for non-PDF URLs, this is expected, not anti-bot
          if (!meta.featureFlags.has("pdf")) {
            throw new EngineUnsuccessfulError("pdf");
          } else {
            throw new PDFAntibotError();
          }
        } else {
          throw new PDFPrefetchFailed();
        }
      }

      const content = file.buffer.toString("base64");
      return {
        url: file.response.url,
        statusCode: file.response.status,

        html: content,
        markdown: content,

        proxyUsed: "basic",
      };
    }
  }

  const { response, tempFilePath } =
    meta.pdfPrefetch !== undefined && meta.pdfPrefetch !== null
      ? { response: meta.pdfPrefetch, tempFilePath: meta.pdfPrefetch.filePath }
      : await downloadFile(
          meta.id,
          meta.rewrittenUrl ?? meta.url,
          meta.options.skipTlsVerification,
          {
            headers: meta.options.headers,
            signal: meta.abort.asSignal(),
          },
        );

  try {
    // Validate the downloaded file is actually a PDF by checking magic bytes
    const header = Buffer.alloc(PDF_SNIFF_WINDOW);
    const fh = await open(tempFilePath, "r");
    let headerBytesRead: number;
    try {
      ({ bytesRead: headerBytesRead } = await fh.read(
        header,
        0,
        PDF_SNIFF_WINDOW,
        0,
      ));
    } finally {
      await fh.close();
    }

    if (!isPdfBuffer(header.subarray(0, headerBytesRead))) {
      if (meta.pdfPrefetch === undefined) {
        if (!meta.featureFlags.has("pdf")) {
          throw new EngineUnsuccessfulError("pdf");
        } else {
          throw new PDFAntibotError();
        }
      } else {
        throw new PDFPrefetchFailed();
      }
    }

    let result: PDFProcessorResult | null = null;
    let effectivePageCount: number = 0;
    let metadataTitle: string | undefined;
    const logger = meta.logger.child({ method: "scrapePDF/processPdf" });

    // Rust extraction
    try {
      const nativeCtx = { scrapeId: meta.id, url: meta.rewrittenUrl ?? meta.url };
      const startedAt = Date.now();
      const pdfResult = processPdf(tempFilePath, maxPages ?? undefined, nativeCtx);
      emitNativeLogs(pdfResult.logs, meta.logger, "pdf.process");
      const durationMs = Date.now() - startedAt;

      logger.info("processPdf completed", {
        durationMs,
        pdfType: pdfResult.pdfType,
        pageCount: pdfResult.pageCount,
        confidence: pdfResult.confidence,
        isComplex: pdfResult.isComplex,
        markdownLength: pdfResult.markdown?.length ?? 0,
        url: meta.rewrittenUrl ?? meta.url,
        mode,
      });

      effectivePageCount = maxPages
        ? Math.min(pdfResult.pageCount, maxPages)
        : pdfResult.pageCount;
      metadataTitle = pdfResult.title ?? undefined;

      const ineligibleReason = getIneligibleReason(pdfResult);
      const eligible = !ineligibleReason;

      logger.info("Rust PDF eligibility", {
        rust_pdf_eligible: eligible,
        reason: ineligibleReason ?? "eligible",
        url: meta.rewrittenUrl ?? meta.url,
        pdfType: pdfResult.pdfType,
        isComplex: pdfResult.isComplex,
        pageCount: pdfResult.pageCount,
        confidence: pdfResult.confidence,
        mode,
      });

      // In fast mode, if the PDF requires OCR, fail immediately.
      if (
        mode === "fast" &&
        (pdfResult.pdfType === "Scanned" ||
          pdfResult.pdfType === "ImageBased")
      ) {
        throw new PDFOCRRequiredError(pdfResult.pdfType);
      }

      if (eligible && pdfResult.markdown) {
        const html = await marked.parse(pdfResult.markdown, { async: true });
        result = { markdown: pdfResult.markdown, html };
      }
    } catch (error) {
      if (error instanceof PDFOCRRequiredError) {
        throw error;
      }
      extractAndEmitNativeLogs(error, meta.logger, "pdf.process");
      logger.warn("processPdf failed, falling back to pdfParse", {
        error,
        url: meta.rewrittenUrl ?? meta.url,
      });
    }

    // Time budget check for pdfParse fallback.
    if (
      !result &&
      effectivePageCount > 0 &&
      effectivePageCount * MILLISECONDS_PER_PAGE >
        (meta.abort.scrapeTimeout() ?? Infinity)
    ) {
      throw new PDFInsufficientTimeError(
        effectivePageCount,
        effectivePageCount * MILLISECONDS_PER_PAGE + 5000,
      );
    }

    // Fallback to pdfParse (skipped in fast mode).
    if (!result && mode !== "fast") {
      result = await scrapePDFWithParsePDF(
        {
          ...meta,
          logger: meta.logger.child({
            method: "scrapePDF/scrapePDFWithParsePDF",
          }),
        },
        tempFilePath,
      );
    }

    return {
      url: response.url ?? meta.rewrittenUrl ?? meta.url,
      statusCode: response.status,
      html: result?.html ?? "",
      markdown: result?.markdown ?? "",
      pdfMetadata: {
        numPages: effectivePageCount,
        title: metadataTitle,
      },

      proxyUsed: "basic",
    };
  } finally {
    // Always clean up temp file after we're done with it
    try {
      await unlink(tempFilePath);
    } catch (error) {
      // Ignore errors when cleaning up temp files
      meta.logger?.warn("Failed to clean up temporary PDF file", {
        error,
        tempFilePath,
      });
    }
  }
}

export function pdfMaxReasonableTime(meta: Meta): number {
  return 120000; // Infinity, really
}

registerEngine({
  name: "pdf",
  handler: scrapePDF,
  maxReasonableTime: pdfMaxReasonableTime,
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
    disableAdblock: true,
  },
  quality: -20,
});
