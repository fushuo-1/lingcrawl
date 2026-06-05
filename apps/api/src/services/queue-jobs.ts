import { v7 as uuidv7 } from "uuid";
import { ScrapeJobData } from "../types";
import { logger as _logger } from "../lib/logger";

export class QueueFullError extends Error {
  constructor(current: number, limit: number) {
    super(`Queue full: ${current}/${limit}`);
    this.name = "QueueFullError";
  }
}
import { Document } from "../controllers/types";
import { Logger } from "winston";
import { ScrapeJobTimeoutError, TransportableError } from "../lib/error";
import { deserializeTransportableError } from "../lib/error-serde";
import { abTestJob } from "./ab-test";
import { NuQJob, scrapeQueue } from "./worker/nuq";
import { getCrawl } from "../lib/crawl-redis";

export async function _addScrapeJobToBullMQ(
  webScraperOptions: ScrapeJobData,
  jobId: string,
  priority: number = 0,
  listenable: boolean = false,
): Promise<NuQJob<ScrapeJobData>> {
  if (webScraperOptions.mode === "single_urls") {
    abTestJob(webScraperOptions);
  }

  return await scrapeQueue.addJob(jobId, webScraperOptions, {
    priority,
    listenable,
    ownerId: webScraperOptions.team_id ?? undefined,
    groupId: webScraperOptions.crawl_id ?? undefined,
  });
}

async function _addScrapeJobsToBullMQ(
  jobs: {
    data: any;
    jobId: string;
    priority: number;
    listenable?: boolean;
  }[],
): Promise<NuQJob<ScrapeJobData>[]> {
  for (const job of jobs) {
    if (job.data.mode === "single_urls") {
      abTestJob(job.data);
    }
  }

  return await scrapeQueue.addJobs(
    jobs.map(job => ({
      id: job.jobId,
      data: job.data,
      options: {
        priority: job.priority,
        listenable: job.listenable ?? false,
        ownerId: job.data.team_id ?? undefined,
        groupId: job.data.crawl_id ?? undefined,
      },
    })),
  );
}

async function addScrapeJobRaw(
  webScraperOptions: ScrapeJobData,
  jobId: string,
  priority: number = 0,
  directToBullMQ: boolean = false,
  listenable: boolean = false,
): Promise<NuQJob<ScrapeJobData> | null> {
  return await _addScrapeJobToBullMQ(
    webScraperOptions,
    jobId,
    priority,
    listenable,
  );
}

export async function addScrapeJob(
  webScraperOptions: ScrapeJobData,
  jobId: string = uuidv7(),
  priority: number = 0,
  directToBullMQ: boolean = false,
  listenable: boolean = false,
): Promise<NuQJob<ScrapeJobData> | null> {
  return await addScrapeJobRaw(
    webScraperOptions,
    jobId,
    priority,
    directToBullMQ,
    listenable,
  );
}

export async function addScrapeJobs(
  jobs: {
    jobId: string;
    data: ScrapeJobData;
    priority: number;
    listenable?: boolean;
  }[],
) {
  if (jobs.length === 0) return true;

  const jobsByTeam = new Map<
    string,
    {
      jobId: string;
      data: ScrapeJobData;
      priority: number;
      listenable?: boolean;
    }[]
  >();

  for (const job of jobs) {
    if (!jobsByTeam.has(job.data.team_id)) {
      jobsByTeam.set(job.data.team_id, []);
    }
    jobsByTeam.get(job.data.team_id)!.push(job);
  }

  for (const [teamId, teamJobs] of jobsByTeam) {
    // == Buckets for jobs ==
    let jobsForcedToCQ: {
      data: ScrapeJobData;
      jobId: string;
      priority: number;
      listenable?: boolean;
    }[] = [];

    let jobsPotentiallyInCQ: {
      data: ScrapeJobData;
      jobId: string;
      priority: number;
      listenable?: boolean;
    }[] = [];

    // == Select jobs by crawl ID ==
    const jobsByCrawlID = new Map<
      string,
      {
        data: ScrapeJobData;
        jobId: string;
        priority: number;
        listenable?: boolean;
      }[]
    >();

    const jobsWithoutCrawlID: {
      data: ScrapeJobData;
      jobId: string;
      priority: number;
      listenable?: boolean;
    }[] = [];

    for (const job of teamJobs) {
      if (job.data.crawl_id) {
        if (!jobsByCrawlID.has(job.data.crawl_id)) {
          jobsByCrawlID.set(job.data.crawl_id, []);
        }
        jobsByCrawlID.get(job.data.crawl_id)!.push(job);
      } else {
        jobsWithoutCrawlID.push(job);
      }
    }

    // == Select jobs by crawl ID ==
    for (const [crawlID, crawlJobs] of jobsByCrawlID) {
      const crawl = await getCrawl(crawlID);
      const concurrencyLimit = !crawl
        ? null
        : crawl.crawlerOptions?.delay === undefined &&
            crawl.maxConcurrency === undefined
          ? null
          : (crawl.maxConcurrency ?? 1);

      if (concurrencyLimit === null) {
        // All jobs may be in the CQ depending on the global team concurrency limit
        jobsPotentiallyInCQ.push(...crawlJobs);
      } else {
        const crawlConcurrency = 0;
        const freeSlots = Math.max(concurrencyLimit - crawlConcurrency, 0);

        // The first n jobs may be in the CQ depending on the global team concurrency limit
        jobsPotentiallyInCQ.push(...crawlJobs.slice(0, freeSlots));

        // Every job after that must be in the CQ, as the crawl concurrency limit has been reached
        jobsForcedToCQ.push(...crawlJobs.slice(freeSlots));
      }
    }

    // All jobs without a crawl ID may be in the CQ depending on the global team concurrency limit
    jobsPotentiallyInCQ.push(...jobsWithoutCrawlID);

    // Add all jobs directly to BullMQ (no concurrency limits in self-hosted)
    await _addScrapeJobsToBullMQ(
      [...jobsPotentiallyInCQ, ...jobsForcedToCQ].map(job => ({
        jobId: job.jobId,
        data: job.data,
        priority: job.priority,
        listenable: job.listenable,
      })),
    );
  }
}

export async function waitForJob(
  job: NuQJob<ScrapeJobData> | string,
  timeout: number | null,
  zeroDataRetention: boolean,
  logger: Logger = _logger,
): Promise<Document> {
  const jobId = typeof job == "string" ? job : job.id;
  const isConcurrencyLimited = !!(typeof job === "string");

  let timeoutHandle: NodeJS.Timeout | null = null;
  let doc: Document | null = null;
  try {
    doc = await Promise.race(
      [
        scrapeQueue.waitForJob(
          jobId,
          timeout !== null ? timeout + 100 : null,
          logger,
        ),
        timeout !== null
          ? new Promise<Document>((_resolve, reject) => {
              timeoutHandle = setTimeout(() => {
                reject(
                  new ScrapeJobTimeoutError(
                    "Scrape timed out" +
                      (isConcurrencyLimited
                        ? " after waiting in the concurrency limit queue"
                        : ""),
                  ),
                );
              }, timeout);
            })
          : null,
      ].filter(x => x !== null),
    );
  } catch (e) {
    if (e instanceof TransportableError) {
      throw e;
    } else if (e instanceof Error) {
      const x = deserializeTransportableError(e.message);
      if (x) {
        throw x;
      } else {
        throw e;
      }
    } else {
      throw e;
    }
  } finally {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
  }

  logger.debug("Got job");

  if (!doc) {
    throw new Error("Job not found");
  }

  return doc;
}
