import { Response } from "express";
import { config } from "../config";
import { v7 as uuidv7 } from "uuid";
import {
  BatchScrapeRequest,
  batchScrapeRequestSchema,
  batchScrapeRequestSchemaNoURLValidation,
  URL as urlSchema,
  ScrapeOptions,
  BatchScrapeResponse,
} from "./types";
import {
  addCrawlJobs,
  finishCrawlKickoff,
  getCrawl,
  lockURLs,
  markCrawlActive,
  saveCrawl,
  StoredCrawl,
} from "../lib/crawl-redis";
import { getJobPriority } from "../lib/job-priority";
import { addScrapeJobs } from "../services/queue-jobs";
import { logger as _logger } from "../lib/logger";
import { UNSUPPORTED_SITE_MESSAGE } from "../lib/strings";
import { isUrlBlocked } from "../scraper/WebScraper/utils/blocklist";
import { crawlGroup } from "../services/worker/nuq";
import { logRequest } from "../services/logging/log_job";
import { createWebhookSender, WebhookEvent } from "../services/webhook/index";

export async function batchScrapeController(
  req: any,
  res: Response<BatchScrapeResponse>,
) {
  const preNormalizedBody = { ...req.body };
  if (req.body?.ignoreInvalidURLs === true) {
    req.body = batchScrapeRequestSchemaNoURLValidation.parse(req.body);
  } else {
    req.body = batchScrapeRequestSchema.parse(req.body);
  }

  const zeroDataRetention = req.body.zeroDataRetention ?? false;

  const id = req.body.appendToId ?? uuidv7();
  const logger = _logger.child({
    crawlId: id,
    batchScrapeId: id,
    module: "api/v2",
    method: "batchScrapeController",
    teamId: "local",
    zeroDataRetention,
  });

  let urls: string[] = req.body.urls;
  let unnormalizedURLs = preNormalizedBody.urls;
  let invalidURLs: string[] | undefined = undefined;

  if (req.body.ignoreInvalidURLs) {
    invalidURLs = [];

    let pendingURLs = urls;
    urls = [];
    unnormalizedURLs = [];
    for (const u of pendingURLs) {
      try {
        const nu = urlSchema.parse(u);
        if (!isUrlBlocked(nu, null)) {
          urls.push(nu);
          unnormalizedURLs.push(u);
        } else {
          invalidURLs.push(u);
        }
      } catch (_) {
        invalidURLs.push(u);
      }
    }
  } else {
    if (
      req.body.urls?.some((url: string) =>
        isUrlBlocked(url, null),
      )
    ) {
      if (!res.headersSent) {
        return res.status(403).json({
          success: false,
          error: UNSUPPORTED_SITE_MESSAGE,
        });
      }
    }
  }

  if (urls.length === 0) {
    return res.status(400).json({
      success: false,
      error: "No valid URLs provided",
    });
  }

  logger.debug("Batch scrape " + id + " starting", {
    urlsLength: urls.length,
    appendToId: req.body.appendToId,
  });

  if (!req.body.appendToId) {
    await logRequest({
      id,
      kind: "batch_scrape",
      team_id: "local",
      origin: req.body.origin ?? "api",
      integration: req.body.integration,
      target_hint: urls[0] ?? "",
      zeroDataRetention: zeroDataRetention || false,
    });
  }

  const sc: StoredCrawl = req.body.appendToId
    ? ((await getCrawl(req.body.appendToId)) as StoredCrawl)
    : {
        crawlerOptions: null,
        scrapeOptions: req.body,
        internalOptions: {
          disableSmartWaitCache: true,
          teamId: "local",
          saveScrapeResultToGCS: config.GCS_FIRE_ENGINE_BUCKET_NAME
            ? true
            : false,
          zeroDataRetention,
          bypassBilling: true,
        },
        team_id: "local",
        createdAt: Date.now(),
        maxConcurrency: req.body.maxConcurrency,
        zeroDataRetention,
      };

  if (req.body.appendToId) {
    if (!sc || sc.team_id !== "local") {
      return res.status(404).json({
        success: false,
        error: "Job not found",
      });
    }
  }

  if (!req.body.appendToId) {
    await crawlGroup.addGroup(
      id,
      sc.team_id,
      24 * 60 * 60 * 1000,
    );
    await saveCrawl(id, sc);
    await markCrawlActive(id);
  }

  let jobPriority = 20;

  if (urls.length > 1000) {
    jobPriority = await getJobPriority({
      team_id: "local",
      basePriority: 21,
    });
  }
  logger.debug("Using job priority " + jobPriority, { jobPriority });

  const scrapeOptions: ScrapeOptions = { ...req.body };
  delete (scrapeOptions as any).urls;
  delete (scrapeOptions as any).appendToId;

  const jobs = urls.map(x => ({
    jobId: uuidv7(),
    data: {
      url: x,
      mode: "single_urls" as const,
      team_id: "local",
      crawlerOptions: null,
      scrapeOptions,
      origin: "api",
      integration: req.body.integration,
      billing: { endpoint: "batch_scrape" as const, jobId: id },
      crawl_id: id,
      bypassBilling: true,
      sitemapped: true,
      v1: true,
      webhook: req.body.webhook,
      internalOptions: sc.internalOptions,
      zeroDataRetention,
    },
    priority: jobPriority,
  }));

  await finishCrawlKickoff(id);

  logger.debug("Locking URLs...");
  await lockURLs(
    id,
    sc,
    jobs.map(x => x.data.url),
    logger,
  );
  logger.debug("Adding scrape jobs to Redis...");
  await addCrawlJobs(
    id,
    jobs.map(x => x.jobId),
    logger,
  );
  logger.debug("Adding scrape jobs to BullMQ...");
  await addScrapeJobs(jobs as any);

  if (req.body.webhook) {
    logger.debug("Calling webhook with batch_scrape.started...", {
      webhook: req.body.webhook,
    });
    const sender = await createWebhookSender({
      teamId: "local",
      jobId: id,
      webhook: req.body.webhook,
      v0: false,
    });
    await sender?.send(WebhookEvent.BATCH_SCRAPE_STARTED, { success: true });
  }

  const protocol = req.protocol;

  return res.status(200).json({
    success: true,
    id,
    url: `${protocol}://${req.get("host")}/batch/scrape/${id}`,
    invalidURLs,
  });
}
