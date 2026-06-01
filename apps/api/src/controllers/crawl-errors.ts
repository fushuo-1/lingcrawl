import { Response } from "express";
import {
  CrawlErrorsResponse,
  CrawlStatusParams,
} from "./types";
import { getCrawl, getCrawlJobs } from "../../lib/crawl-redis";
import { redisEvictConnection } from "../../../src/services/redis";
import { configDotenv } from "dotenv";
import { logger as _logger } from "../../lib/logger";
import { deserializeTransportableError } from "../../lib/error-serde";
import { TransportableError } from "../../lib/error";
import { scrapeQueue } from "../../services/worker/nuq";
configDotenv();

export async function crawlErrorsController(
  req: any,
  res: Response<CrawlErrorsResponse>,
) {
  const sc = await getCrawl(req.params.jobId);

  if (sc) {
    const logger = _logger.child({
      crawlId: req.params.jobId,
      zeroDataRetention: sc.zeroDataRetention ?? false,
    });

    const failedJobs = (
      await scrapeQueue.getJobsWithStatus(
        await getCrawlJobs(req.params.jobId),
        "failed",
        logger,
      )
    ).filter(x => x.failedReason);

    res.status(200).json({
      errors: failedJobs
        .map(x => {
          if (x.data.mode !== "single_urls") {
            return null;
          }
          const error = deserializeTransportableError(
            x.failedReason!,
          ) as TransportableError | null;
          if (error?.code === "SCRAPE_RACED_REDIRECT_ERROR") {
            return null;
          }
          return {
            id: x.id,
            timestamp:
              x.finishedAt !== undefined
                ? new Date(x.finishedAt).toISOString()
                : undefined,
            url: x.data.url,
            ...(error
              ? {
                  code: error.code,
                  error: error.message,
                }
              : {
                  error: x.failedReason!,
                }),
          };
        })
        .filter(x => x !== null),
      robotsBlocked: await redisEvictConnection.smembers(
        "crawl:" + req.params.jobId + ":robots_blocked",
      ),
    });
  } else {
    return res.status(404).json({ success: false, error: "Job not found" });
  }
}
