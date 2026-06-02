import { Response } from "express";
import { config } from "../config";
import { logger as _logger } from "../lib/logger";
import {
  Document,
  FormatObject,
  ScrapeRequest,
  scrapeRequestSchema,
  ScrapeResponse,
} from "./types";
import { v7 as uuidv7 } from "uuid";
import { hasFormatOfType } from "../lib/format-utils";
import { TransportableError } from "../lib/error";
import { withErrorHandler } from "./error-wrapper";
import { NuQJob } from "../services/worker/nuq";
import { withSpan, setSpanAttributes, SpanKind } from "../lib/otel-tracer";
import { processJobInternal } from "../services/worker/scrape-worker";
import { ScrapeJobData } from "../types";
import { teamConcurrencySemaphore } from "../services/worker/team-semaphore";
import { logRequest } from "../services/logging/log_job";

import { Request } from "express";

export const scrapeController = withErrorHandler(async (
  req: Request<{}, ScrapeResponse, ScrapeRequest>,
  res: Response<ScrapeResponse>,
) => {
  return withSpan(
    "api.scrape.request",
    async span => {
      const middlewareStartTime =
        (req as any).requestTiming?.startTime || new Date().getTime();
      const controllerStartTime = new Date().getTime();

      const jobId = uuidv7();
      const preNormalizedBody = { ...req.body };

      setSpanAttributes(span, {
        "scrape.job_id": jobId,
        "scrape.url": req.body.url,
        "scrape.middleware_time_ms": controllerStartTime - middlewareStartTime,
      });

      await withSpan("api.scrape.validate", async validateSpan => {
        req.body = scrapeRequestSchema.parse(req.body);
        setSpanAttributes(validateSpan, { "validation.success": true });
      });

      const zeroDataRetention = req.body.zeroDataRetention ?? false;
      const teamId = "local";

      const logger = _logger.child({
        method: "scrapeController",
        jobId,
        noq: true,
        scrapeId: jobId,
        teamId,
        zeroDataRetention,
      });

      const middlewareTime = controllerStartTime - middlewareStartTime;

      logger.debug("Scrape " + jobId + " starting", {
        version: "v2",
        scrapeId: jobId,
        request: req.body,
        originalRequest: preNormalizedBody,
      });

      logRequest({
        id: jobId,
        kind: "scrape",
        team_id: teamId,
        origin: req.body.origin ?? "api",
        integration: req.body.integration,
        target_hint: req.body.url,
        zeroDataRetention: zeroDataRetention || false,
        api_key_id: null,
      }).catch(err =>
        logger.warn("Background request log failed", { error: err, jobId }),
      );

      setSpanAttributes(span, {
        "scrape.zero_data_retention": zeroDataRetention,
        "scrape.origin": req.body.origin,
        "scrape.timeout": req.body.timeout,
      });

      const origin = req.body.origin;
      const timeout = req.body.timeout;

      const totalWait =
        (req.body.waitFor ?? 0) +
        (req.body.actions ?? []).reduce(
          (a, x) => (x.type === "wait" ? (x.milliseconds ?? 0) : 0) + a,
          0,
        );

      let lockTime: number | null = null;
      let concurrencyLimited: boolean = false;

      let timeoutHandle: NodeJS.Timeout | null = null;
      let doc: Document | null = null;

      try {
        const lockStart = Date.now();
        const aborter = new AbortController();
        if (timeout) {
          timeoutHandle = setTimeout(() => {
            aborter.abort();
          }, timeout * 0.667);
        }
        req.on("close", () => aborter.abort());

        const concurrency = 8;

        doc = await teamConcurrencySemaphore.withSemaphore(
          teamId,
          jobId,
          concurrency,
          aborter.signal,
          timeout ?? 60_000,
          async limited => {
            lockTime = Date.now() - lockStart;
            concurrencyLimited = limited;

            logger.debug(`Lock acquired for team: ${teamId}`, {
              teamId,
              lockTime,
              limited,
            });

            const doc = await withSpan(
              "api.scrape.wait_for_job",
              async waitSpan => {
                setSpanAttributes(waitSpan, {
                  "wait.timeout":
                    timeout !== undefined ? timeout + totalWait : undefined,
                  "wait.job_id": jobId,
                });

                const job: NuQJob<ScrapeJobData> = {
                  id: jobId,
                  status: "active",
                  createdAt: new Date(),
                  priority: 10,
                  data: {
                    url: req.body.url,
                    mode: "single_urls",
                    team_id: teamId,
                    scrapeOptions: {
                      ...req.body,
                    },
                    internalOptions: {
                      teamId,
                      saveScrapeResultToGCS: false,
                      unnormalizedSourceURL: preNormalizedBody.url,
                      bypassBilling: true,
                      zeroDataRetention,
                      teamFlags: null,
                    },
                    skipNuq: true,
                    origin,
                    integration: req.body.integration,
                    startTime: controllerStartTime,
                    zeroDataRetention,
                    apiKeyId: null,
                    concurrencyLimited: limited,
                  },
                };

                const result = await processJobInternal(job);

                setSpanAttributes(waitSpan, { "wait.success": true });
                return result ?? null;
              },
            );

            return doc;
          },
        );
      } catch (e) {
        setSpanAttributes(span, {
          "scrape.error": e instanceof Error ? e.message : String(e),
          "scrape.error_type":
            e instanceof TransportableError ? e.code : "unknown",
        });
        throw e;
      } finally {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
      }

      if (!hasFormatOfType(req.body.formats, "rawHtml")) {
        if (doc && doc.rawHtml) {
          delete doc.rawHtml;
        }
      }

      const totalRequestTime = new Date().getTime() - middlewareStartTime;
      const controllerTime = new Date().getTime() - controllerStartTime;

      setSpanAttributes(span, {
        "scrape.success": true,
        "scrape.status_code": 200,
        "scrape.total_request_time_ms": totalRequestTime,
        "scrape.controller_time_ms": controllerTime,
        "scrape.total_wait_time_ms": totalWait,
        "scrape.document.status_code": doc?.metadata?.statusCode,
        "scrape.document.content_type": doc?.metadata?.contentType,
        "scrape.document.error": doc?.metadata?.error,
      });

      let usedLlm =
        !!hasFormatOfType(req.body.formats, "json") ||
        !!hasFormatOfType(req.body.formats, "summary") ||
        !!hasFormatOfType(req.body.formats, "branding") ||
        !!hasFormatOfType(req.body.formats, "query");

      if (!usedLlm) {
        const ct = hasFormatOfType(req.body.formats, "changeTracking");
        if (ct && ct.modes?.includes("json")) {
          usedLlm = true;
        }
      }

      const formats: string[] =
        req.body.formats?.map((f: FormatObject) => f?.type) ?? [];

      logger.info("Request metrics", {
        version: "v2",
        scrapeId: jobId,
        mode: "scrape",
        middlewareStartTime,
        controllerStartTime,
        middlewareTime,
        controllerTime,
        totalRequestTime,
        totalWait,
        usedLlm,
        formats,
        concurrencyLimited,
        concurrencyQueueDurationMs: lockTime || undefined,
      });

      return res.status(200).json({
        success: true,
        data: {
          ...doc!,
          metadata: {
            ...doc!.metadata,
            concurrencyLimited,
            concurrencyQueueDurationMs: concurrencyLimited
              ? lockTime || 0
              : undefined,
          },
        },
        scrape_id: origin?.includes("website") ? jobId : undefined,
      });
    },
    {
      attributes: {
        "http.method": "POST",
        "http.route": "/scrape",
      },
      kind: SpanKind.SERVER,
    },
  );
});
