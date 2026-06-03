import { Response } from "express";
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
import { buildSyncScrapeJob } from "../services/job-factory";
import { processJobInternal } from "../services/worker/scrape-worker";
import { teamConcurrencySemaphore } from "../services/worker/team-semaphore";
import { logRequest } from "../services/logging/log_job";

import { Request } from "express";

export const scrapeController = withErrorHandler(async (
  req: Request<{}, ScrapeResponse, ScrapeRequest>,
  res: Response<ScrapeResponse>,
) => {
  const middlewareStartTime =
    (req as any).requestTiming?.startTime || new Date().getTime();
  const controllerStartTime = new Date().getTime();

  const jobId = uuidv7();
  const preNormalizedBody = { ...req.body };

  req.body = scrapeRequestSchema.parse(req.body);

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

        const job = buildSyncScrapeJob({
          jobId,
          url: req.body.url,
          scrapeOptions: { ...req.body },
          origin,
          integration: req.body.integration,
          startTime: controllerStartTime,
          zeroDataRetention,
          concurrencyLimited: limited,
          unnormalizedSourceURL: preNormalizedBody.url,
        });

        const result = await processJobInternal(job);
        return result ?? null;
      },
    );
  } catch (e) {
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

  let usedLlm =
    !!hasFormatOfType(req.body.formats, "json") ||
    !!hasFormatOfType(req.body.formats, "summary") ||
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
});
