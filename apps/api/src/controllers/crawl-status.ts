import { Response } from "express";
import { config } from "../config";
import {
  CrawlStatusParams,
  CrawlStatusResponse,
  Document,
} from "./types";
import {
  getCrawl,
  getCrawlError,
  getCrawlExpiry,
} from "../lib/crawl-redis";
import { logger } from "../lib/logger";
import { getJobFromGCS } from "../lib/gcs-jobs";
import {
  scrapeQueue,
  NuQJob,
  NuQJobStatus,
  crawlGroup,
} from "../services/worker/nuq";
import { ScrapeJobSingleUrls } from "../types";
import { redisEvictConnection } from "../services/redis";
import { isBaseDomain, extractBaseDomain } from "../lib/url-utils";
import { Request } from "express";
import { withErrorHandler } from "./error-wrapper";

export type PseudoJob<T> = {
  id: string;
  status: NuQJobStatus;
  returnvalue: T | null;
  timestamp: number;
  data: {
    scrapeOptions: any;
    teamId?: string;
  };
  failedReason?: string;
};

export async function getJob(
  id: string,
  _logger = logger,
): Promise<PseudoJob<any> | null> {
  const [nuqJob, gcsJob] = await Promise.all([
    scrapeQueue.getJob(
      id,
      _logger,
    ) as Promise<NuQJob<ScrapeJobSingleUrls> | null>,
    (config.GCS_BUCKET_NAME ? getJobFromGCS(id) : null) as Promise<any | null>,
  ]);

  if (!nuqJob) return null;

  if (nuqJob.data.mode !== "single_urls") {
    return null;
  }

  const data = gcsJob ?? nuqJob.returnvalue;

  const job: PseudoJob<any> = {
    id,
    status: nuqJob.status,
    returnvalue: Array.isArray(data) ? data[0] : data,
    data: {
      scrapeOptions: nuqJob.data.scrapeOptions,
    },
    timestamp: nuqJob.createdAt.valueOf(),
    failedReason: nuqJob.failedReason || undefined,
  };

  return job;
}

export async function getJobs(
  ids: string[],
  _logger = logger,
): Promise<PseudoJob<any>[]> {
  const [nuqJobs, gcsJobs] = await Promise.all([
    scrapeQueue.getJobs(ids, _logger) as Promise<NuQJob<ScrapeJobSingleUrls>[]>,
    config.GCS_BUCKET_NAME
      ? (Promise.all(
          ids.map(async x => ({ id: x, job: await getJobFromGCS(x) })),
        ).then(x => x.filter(x => x.job)) as Promise<
          { id: string; job: any | null }[]
        >)
      : [],
  ]);

  const nuqJobMap = new Map<string, NuQJob<any, any>>();
  const gcsJobMap = new Map<string, any>();

  for (const job of nuqJobs) {
    nuqJobMap.set(job.id, job);
  }

  for (const job of gcsJobs) {
    gcsJobMap.set(job.id, job.job);
  }

  const jobs: PseudoJob<any>[] = [];

  for (const id of ids) {
    const nuqJob = nuqJobMap.get(id);
    const gcsJob = gcsJobMap.get(id);

    if (!nuqJob) continue;

    const data = gcsJob ?? nuqJob.returnvalue;

    const job: PseudoJob<any> = {
      id,
      status: nuqJob.status,
      returnvalue: Array.isArray(data) ? data[0] : data,
      data: {
        scrapeOptions: nuqJob.data.scrapeOptions,
      },
      timestamp: nuqJob.createdAt.valueOf(),
      failedReason: nuqJob.failedReason || undefined,
    };

    jobs.push(job);
  }

  return jobs;
}

function crawlStatusHandler(isBatch: boolean) {
  return withErrorHandler(async (
    req: Request<CrawlStatusParams, CrawlStatusResponse, undefined>,
    res: Response<CrawlStatusResponse>,
  ) => {
  const uuidReg =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!req.params.jobId || !uuidReg.test(req.params.jobId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid job ID",
    });
  }

  const start =
    typeof req.query.skip === "string" ? parseInt(req.query.skip, 10) : 0;
  const end =
    typeof req.query.limit === "string"
      ? start + parseInt(req.query.limit, 10) - 1
      : undefined;

  const group = await crawlGroup.getGroup(req.params.jobId);
  const groupAnyJob = await scrapeQueue.getGroupAnyJob(
    req.params.jobId,
    "local",
  );
  const sc = await getCrawl(req.params.jobId);

  if (!group || (!groupAnyJob && !sc)) {
    return res.status(404).json({ success: false, error: "Job not found" });
  }

  const zeroDataRetention = !!(
    groupAnyJob?.data?.zeroDataRetention ?? sc?.zeroDataRetention
  );

  const numericStats = await scrapeQueue.getGroupNumericStats(
    req.params.jobId,
    logger.child({ zeroDataRetention }),
  );

  const crawlError = await getCrawlError(req.params.jobId);

  let outputBulkA: {
    status?: "completed" | "scraping" | "cancelled" | "failed";
    completed?: number;
    total?: number;
    creditsUsed?: number;
  } = {
    status: group.status === "active" ? "scraping" : group.status,
    completed: numericStats.completed ?? 0,
    total:
      (numericStats.completed ?? 0) +
      (numericStats.active ?? 0) +
      (numericStats.queued ?? 0) +
      (numericStats.backlog ?? 0),
    creditsUsed: 0,
  };

  if (
    crawlError &&
    outputBulkA.total === 0 &&
    outputBulkA.status === "completed"
  ) {
    outputBulkA.status = "failed";
  }

  if (outputBulkA.status === "failed" && crawlError) {
    return res.status(200).json({
      success: false,
      error: crawlError,
      status: "failed",
      completed: 0,
      total: 0,
      creditsUsed: 0,
      expiresAt: (await getCrawlExpiry(req.params.jobId)).toISOString(),
      data: [],
    });
  }

  const doneJobs = await scrapeQueue.getCrawlJobsForListing(
    req.params.jobId,
    end !== undefined ? end - start + 1 : 100,
    start,
    logger.child({ zeroDataRetention }),
  );

  let scrapes: Document[] = [];
  let iteratedOver = 0;
  let bytes = 0;
  const bytesLimit = 10485760;

  const scrapeBlobs = await Promise.all(
    doneJobs.map(
      async x =>
        [x.id, x.returnvalue ?? (await getJobFromGCS(x.id))?.[0]] as const,
    ),
  );

  for (const [id, scrape] of scrapeBlobs) {
    if (scrape) {
      scrapes.push(scrape);
      bytes += JSON.stringify(scrape).length;
    } else {
      logger.warn("Job was considered done, but returnvalue is undefined!", {
        jobId: id,
        returnvalue: scrape,
        zeroDataRetention,
      });
    }

    iteratedOver++;

    if (bytes > bytesLimit) {
      break;
    }
  }

  if (bytes > bytesLimit && scrapes.length !== 1) {
    scrapes.splice(scrapes.length - 1, 1);
    iteratedOver--;
  }

  const outputBulkB = {
    data: scrapes,
    next:
      (outputBulkA.total ?? 0) > start + iteratedOver ||
      outputBulkA.status !== "completed"
        ? `${req.protocol}://${req.get("host")}/${isBatch ? "batch/scrape" : "crawl"}/${req.params.jobId}?skip=${start + iteratedOver}${req.query.limit ? `&limit=${req.query.limit}` : ""}`
        : undefined,
  };

  let warning: string | undefined;
  try {
    const robotsBlocked = await redisEvictConnection.smembers(
      "crawl:" + req.params.jobId + ":robots_blocked",
    );
    const rbCount = robotsBlocked?.length ?? 0;
    const statusNow = outputBulkA.status ?? "scraping";
    if (rbCount > 0 && statusNow !== "scraping") {
      warning =
        "One or more pages were unable to be crawled because the robots.txt file prevented this. Please use the /scrape endpoint instead.";
    }
  } catch (error) {
    logger.debug("Failed to check robots blocked URLs", {
      error,
      zeroDataRetention,
    });
  }

  const resultCount =
    outputBulkA.completed ?? outputBulkA.total ?? outputBulkB.data.length;
  const currentStatus = outputBulkA.status ?? "scraping";
  if (!warning && currentStatus !== "scraping" && resultCount <= 1) {
    const crawl = await getCrawl(req.params.jobId);
    if (crawl && crawl.originUrl && !isBaseDomain(crawl.originUrl)) {
      const isUsingCrawlEntireDomain =
        crawl.crawlerOptions?.crawlEntireDomain === true;
      if (!isUsingCrawlEntireDomain) {
        const baseDomain = extractBaseDomain(crawl.originUrl);
        if (baseDomain) {
          warning = `Only ${resultCount} result(s) found. For broader coverage, try crawling with crawlEntireDomain=true or start from a higher-level path like ${baseDomain}`;
        }
      }
    }
  }

  return res.status(200).json({
    success: true,
    status: outputBulkA.status ?? "scraping",
    completed: outputBulkA.completed ?? 0,
    total: outputBulkA.total ?? 0,
    creditsUsed: 0,
    expiresAt: (await getCrawlExpiry(req.params.jobId)).toISOString(),
    next: outputBulkB.next,
    data: outputBulkB.data,
    ...(warning && { warning }),
  });
  });
}

export const crawlStatusController = crawlStatusHandler(false);
export const batchCrawlStatusController = crawlStatusHandler(true);
