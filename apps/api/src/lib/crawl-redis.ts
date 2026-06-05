import { InternalOptions } from "../scraper/scrapeURL";
import { ScrapeOptions } from "../controllers/types";
import { redisEvictConnection } from "../services/redis";
import { logger as _logger } from "./logger";
import type { Logger } from "winston";

export type StoredCrawl = {
  originUrl?: string;
  crawlerOptions: any;
  scrapeOptions: Omit<ScrapeOptions, "timeout">;
  internalOptions: InternalOptions;
  team_id: string;
  robots?: string;
  cancelled?: boolean;
  createdAt: number;
  maxConcurrency?: number;
  zeroDataRetention?: boolean;
};

// Re-exports for backwards compatibility — these were moved out of this file
// but existing imports from "./crawl-redis" should keep working.
export {
  normalizeURL,
  generateURLPermutations,
  lockURL,
  lockURLs,
  lockURLsIndividually,
} from "./crawl-utils";
export { crawlToCrawler } from "../scraper/WebScraper/crawler-factory";

export async function saveCrawl(id: string, crawl: StoredCrawl) {
  _logger.debug("Saving crawl " + id + " to Redis...", {
    crawl,
    module: "crawl-redis",
    method: "saveCrawl",
    crawlId: id,
    teamId: crawl.team_id,
    zeroDataRetention: crawl.zeroDataRetention,
  });

  await redisEvictConnection.set(
    "crawl:" + id,
    JSON.stringify(crawl),
    "EX",
    24 * 60 * 60,
  );
  await redisEvictConnection.sadd("crawls_by_team_id:" + crawl.team_id, id);
  await redisEvictConnection.expire(
    "crawls_by_team_id:" + crawl.team_id,
    24 * 60 * 60,
  );
}

export async function recordRobotsBlocked(crawlId: string, url: string) {
  await redisEvictConnection.sadd("crawl:" + crawlId + ":robots_blocked", url);
  await redisEvictConnection.expire(
    "crawl:" + crawlId + ":robots_blocked",
    24 * 60 * 60,
  );
}

export async function markCrawlActive(id: string) {
  await redisEvictConnection.sadd("active_crawls", id);
}

export async function getCrawl(id: string): Promise<StoredCrawl | null> {
  const x = await redisEvictConnection.get("crawl:" + id);

  if (x === null) {
    return null;
  }

  await redisEvictConnection.expire("crawl:" + id, 24 * 60 * 60);
  const crawl = JSON.parse(x);

  return crawl;
}

export async function getCrawlExpiry(id: string): Promise<Date> {
  const d = new Date();
  const ttl = await redisEvictConnection.pttl("crawl:" + id);
  d.setMilliseconds(d.getMilliseconds() + ttl);
  d.setMilliseconds(0);
  return d;
}

export async function addCrawlJob(
  id: string,
  job_id: string,
  __logger: Logger = _logger,
) {
  __logger.debug("Adding crawl job " + job_id + " to Redis...", {
    jobId: job_id,
    module: "crawl-redis",
    method: "addCrawlJob",
    crawlId: id,
  });

  const pipeline = redisEvictConnection.pipeline();
  pipeline.sadd("crawl:" + id + ":jobs", job_id);
  pipeline.expire("crawl:" + id + ":jobs", 24 * 60 * 60);
  pipeline.sadd("crawl:" + id + ":jobs_qualified", job_id);
  pipeline.expire("crawl:" + id + ":jobs_qualified", 24 * 60 * 60);
  await pipeline.exec();
}

export async function addCrawlJobs(
  id: string,
  job_ids: string[],
  __logger: Logger = _logger,
) {
  if (job_ids.length === 0) return true;

  __logger.debug("Adding crawl jobs to Redis...", {
    jobIds: job_ids,
    module: "crawl-redis",
    method: "addCrawlJobs",
    crawlId: id,
  });
  const pipeline = redisEvictConnection.pipeline();
  pipeline.sadd("crawl:" + id + ":jobs", ...job_ids);
  pipeline.expire("crawl:" + id + ":jobs", 24 * 60 * 60);
  pipeline.sadd("crawl:" + id + ":jobs_qualified", ...job_ids);
  pipeline.expire("crawl:" + id + ":jobs_qualified", 24 * 60 * 60);
  await pipeline.exec();
}

export async function addCrawlJobDone(
  id: string,
  job_id: string,
  success: boolean,
  __logger: Logger = _logger,
) {
  __logger.debug("Adding done crawl job to Redis...", {
    jobId: job_id,
    module: "crawl-redis",
    method: "addCrawlJobDone",
    crawlId: id,
  });
  const pipeline = redisEvictConnection.pipeline();
  pipeline.sadd("crawl:" + id + ":jobs_done", job_id);
  pipeline.expire("crawl:" + id + ":jobs_done", 24 * 60 * 60);

  if (success) {
    pipeline.zadd("crawl:" + id + ":jobs_donez_ordered", Date.now(), job_id);
  } else {
    // in case it's already been pushed, make sure it's removed
    pipeline.zrem("crawl:" + id + ":jobs_donez_ordered", job_id);
  }

  pipeline.expire("crawl:" + id + ":jobs_donez_ordered", 24 * 60 * 60);
  await pipeline.exec();
}

export async function getDoneJobsOrderedLength(
  id: string,
  until: number = Infinity,
): Promise<number> {
  await redisEvictConnection.expire(
    "crawl:" + id + ":jobs_donez_ordered",
    24 * 60 * 60,
  );
  return await redisEvictConnection.zcount(
    "crawl:" + id + ":jobs_donez_ordered",
    -Infinity,
    until,
  );
}

export async function getDoneJobsOrdered(
  id: string,
  start = 0,
  end = -1,
): Promise<string[]> {
  await redisEvictConnection.expire(
    "crawl:" + id + ":jobs_donez_ordered",
    24 * 60 * 60,
  );
  return await redisEvictConnection.zrange(
    "crawl:" + id + ":jobs_donez_ordered",
    start,
    end,
  );
}

export async function getDoneJobsOrderedUntil(
  id: string,
  until: number = Infinity,
  start = 0,
  count = -1,
): Promise<string[]> {
  await redisEvictConnection.expire(
    "crawl:" + id + ":jobs_donez_ordered",
    24 * 60 * 60,
  );
  return await redisEvictConnection.zrangebyscore(
    "crawl:" + id + ":jobs_donez_ordered",
    -Infinity,
    until,
    "LIMIT",
    start,
    count,
  );
}

async function isCrawlFinished(id: string) {
  await redisEvictConnection.expire(
    "crawl:" + id + ":kickoff:finish",
    24 * 60 * 60,
  );
  return (
    (await redisEvictConnection.scard("crawl:" + id + ":jobs_done")) ===
      (await redisEvictConnection.scard("crawl:" + id + ":jobs")) &&
    (await isCrawlKickoffFinished(id))
  );
}

export async function isCrawlKickoffFinished(id: string) {
  await redisEvictConnection.expire(
    "crawl:" + id + ":kickoff:finish",
    24 * 60 * 60,
  );
  return (
    (await redisEvictConnection.get("crawl:" + id + ":kickoff:finish")) !==
      null &&
    (await redisEvictConnection.scard("crawl:" + id + ":sitemap_jobs_done")) ===
      (await redisEvictConnection.scard("crawl:" + id + ":sitemap_jobs"))
  );
}

export async function finishCrawlKickoff(id: string) {
  await redisEvictConnection.set(
    "crawl:" + id + ":kickoff:finish",
    "yes",
    "EX",
    24 * 60 * 60,
  );
}

export async function setCrawlError(id: string, error: string) {
  await redisEvictConnection.set(
    "crawl:" + id + ":error",
    error,
    "EX",
    24 * 60 * 60,
  );
}

export async function getCrawlError(id: string): Promise<string | null> {
  return await redisEvictConnection.get("crawl:" + id + ":error");
}

export async function finishCrawl(id: string, __logger: Logger = _logger) {
  __logger.debug("Marking crawl as finished.", {
    module: "crawl-redis",
    method: "finishCrawl",
    crawlId: id,
  });

  await redisEvictConnection.set(
    "crawl:" + id + ":finish",
    "yes",
    "EX",
    24 * 60 * 60,
  );

  await redisEvictConnection.srem("active_crawls", id);

  const crawl = await getCrawl(id);
  if (crawl && crawl.team_id) {
    await redisEvictConnection.srem("crawls_by_team_id:" + crawl.team_id, id);
    await redisEvictConnection.expire(
      "crawls_by_team_id:" + crawl.team_id,
      24 * 60 * 60,
    );
  }

  // Clear visited sets to save memory
  await redisEvictConnection.del("crawl:" + id + ":visited");
  await redisEvictConnection.del("crawl:" + id + ":visited_unique");
}

export async function getCrawlJobs(id: string): Promise<string[]> {
  return await redisEvictConnection.smembers("crawl:" + id + ":jobs");
}

export async function getCrawlQualifiedJobCount(id: string): Promise<number> {
  return await redisEvictConnection.scard("crawl:" + id + ":jobs_qualified");
}
