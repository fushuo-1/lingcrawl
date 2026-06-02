import { Response } from "express";
import { config } from "../../config";
import { v7 as uuidv7 } from "uuid";
import {
  CrawlRequest,
  crawlRequestSchema,
  CrawlResponse,
  toV0CrawlerOptions,
} from "./types";
import {
  crawlToCrawler,
  saveCrawl,
  StoredCrawl,
  markCrawlActive,
} from "../../lib/crawl-redis";
import { _addScrapeJobToBullMQ } from "../../services/queue-jobs";
import { logger as _logger } from "../../lib/logger";
import { crawlGroup } from "../../services/worker/nuq";
import { logRequest } from "../../services/logging/log_job";

export async function crawlController(
  req: any,
  res: Response<CrawlResponse>,
) {
  req.body = crawlRequestSchema.parse(req.body);

  const zeroDataRetention = req.body.zeroDataRetention ?? false;

  const id = uuidv7();
  const logger = _logger.child({
    crawlId: id,
    module: "api/v2",
    method: "crawlController",
    teamId: "local",
    zeroDataRetention,
  });

  logger.debug("Crawl " + id + " starting", {
    request: req.body,
  });

  await logRequest({
    id,
    kind: "crawl",
    team_id: "local",
    origin: req.body.origin ?? "api",
    integration: req.body.integration,
    target_hint: req.body.url,
    zeroDataRetention: zeroDataRetention || false,
  });

  const crawlerOptions = {
    ...req.body,
    url: undefined,
    scrapeOptions: undefined,
    prompt: undefined,
  };
  const scrapeOptions = req.body.scrapeOptions;

  if (Array.isArray(crawlerOptions.includePaths)) {
    for (const x of crawlerOptions.includePaths) {
      try {
        new RegExp(x);
      } catch (e) {
        return res.status(400).json({ success: false, error: e.message });
      }
    }
  }

  if (Array.isArray(crawlerOptions.excludePaths)) {
    for (const x of crawlerOptions.excludePaths) {
      try {
        new RegExp(x);
      } catch (e) {
        return res.status(400).json({ success: false, error: e.message });
      }
    }
  }

  const sc: StoredCrawl = {
    originUrl: req.body.url,
    crawlerOptions: toV0CrawlerOptions(crawlerOptions),
    scrapeOptions,
    internalOptions: {
      disableSmartWaitCache: true,
      teamId: "local",
      saveScrapeResultToGCS: config.GCS_FIRE_ENGINE_BUCKET_NAME ? true : false,
      zeroDataRetention,
    },
    team_id: "local",
    createdAt: Date.now(),
    maxConcurrency: req.body.maxConcurrency,
    zeroDataRetention,
  };

  const crawler = crawlToCrawler(id, sc, null);

  try {
    sc.robots = await crawler.getRobotsTxt(scrapeOptions.skipTlsVerification);
  } catch (e) {
    logger.debug("Failed to get robots.txt (this is probably fine!)", {
      error: e,
    });
  }

  await crawlGroup.addGroup(
    id,
    sc.team_id,
    24 * 60 * 60 * 1000,
  );

  await saveCrawl(id, sc);

  await markCrawlActive(id);

  await _addScrapeJobToBullMQ(
    {
      url: req.body.url,
      mode: "kickoff" as const,
      team_id: "local",
      crawlerOptions,
      scrapeOptions: sc.scrapeOptions,
      internalOptions: sc.internalOptions,
      origin: req.body.origin,
      integration: req.body.integration,
      billing: { endpoint: "crawl", jobId: id },
      crawl_id: id,
      webhook: req.body.webhook,
      v1: true,
      zeroDataRetention: zeroDataRetention || false,
    },
    uuidv7(),
  );

  const protocol = req.protocol;

  return res.status(200).json({
    success: true,
    id,
    url: `${protocol}://${req.get("host")}/crawl/${id}`,
  });
}
