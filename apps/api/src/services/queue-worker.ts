import "dotenv/config";
import { config } from "../config";
import { logger as _logger } from "../lib/logger";
import { configDotenv } from "dotenv";
import Express from "express";
import { initializeBlocklist } from "../scraper/WebScraper/utils/blocklist";
import { initializeEngineForcing } from "../scraper/WebScraper/utils/engine-forcing";
import { crawlFinishedQueue, NuQJob, scrapeQueue } from "./worker/nuq";
import { finishCrawlSuper } from "./worker/crawl-logic";
import { getCrawl } from "../lib/crawl-redis";

configDotenv();

async function processFinishCrawlJobInternal(_job: NuQJob) {
  const job = await crawlFinishedQueue.getJob(_job.id);

  if (!job) {
    throw new Error("crawlFinish job disappeared");
  }

  if (!job.groupId) {
    throw new Error("crawlFinish job with no groupId");
  }

  if (!job.ownerId) {
    throw new Error("crawlFinish job with no ownerId");
  }

  const sc = await getCrawl(job.groupId);

  if (!sc) {
    throw new Error("crawlFinish job with sc expired");
  }

  const anyJob = await scrapeQueue.getGroupAnyJob(job.groupId, job.ownerId);

  if (!anyJob) {
    throw new Error("crawlFinish couldn't find anyJob");
  }

  await finishCrawlSuper(anyJob);
}

let isShuttingDown = false;

if (require.main === module) {
  process.on("SIGINT", () => {
    _logger.debug("Received SIGINT. Shutting down gracefully...");
    isShuttingDown = true;
  });

  process.on("SIGTERM", () => {
    _logger.debug("Received SIGTERM. Shutting down gracefully...");
    isShuttingDown = true;
  });
}

const crawlFinishWorker = async () => {
  const __logger = _logger.child({
    module: "extract-worker",
    method: "crawlFinishWorker",
  });

  let noJobTimeout = 1500;

  while (!isShuttingDown) {
    const job = await crawlFinishedQueue.getJobToProcess();

    if (job === null) {
      __logger.info("No jobs to process", { module: "nuq/metrics" });
      await new Promise(resolve => setTimeout(resolve, noJobTimeout));
      if (!config.NUQ_RABBITMQ_URL) {
        noJobTimeout = Math.min(noJobTimeout * 2, 10000);
      }
      continue;
    }

    noJobTimeout = 500;

    const logger = __logger.child({
      zeroDataRetention: job.data?.zeroDataRetention ?? false,
      crawlId: job.groupId,
    });

    logger.info("Acquired job");

    const lockRenewInterval = setInterval(async () => {
      logger.info("Renewing lock");
      if (!(await crawlFinishedQueue.renewLock(job.id, job.lock!, logger))) {
        logger.warn("Failed to renew lock");
        clearInterval(lockRenewInterval);
        return;
      }
      logger.info("Renewed lock");
    }, 15000);

    let processResult:
      | {
          ok: true;
          data: Awaited<ReturnType<typeof processFinishCrawlJobInternal>>;
        }
      | { ok: false; error: any };

    try {
      processResult = {
        ok: true,
        data: await processFinishCrawlJobInternal(job),
      };
    } catch (error) {
      processResult = { ok: false, error };
    }

    clearInterval(lockRenewInterval);

    if (processResult.ok) {
      if (
        !(await crawlFinishedQueue.jobFinish(
          job.id,
          job.lock!,
          processResult.data,
          logger,
        ))
      ) {
        logger.warn("Could not update job status");
      }
    } else {
      if (
        !(await crawlFinishedQueue.jobFail(
          job.id,
          job.lock!,
          processResult.error instanceof Error
            ? processResult.error.message
            : typeof processResult.error === "string"
              ? processResult.error
              : JSON.stringify(processResult.error),
          logger,
        ))
      ) {
        logger.warn("Could not update job status");
      }
    }
  }
};

// Start all workers
const app = Express();

let currentLiveness: boolean = true;

app.get("/liveness", (req, res) => {
  _logger.info("Liveness endpoint hit");
  currentLiveness = true;
  res.status(200).json({ ok: true });
});

const workerPort = config.WORKER_PORT || config.PORT;
app.listen(workerPort, () => {
  _logger.info(`Liveness endpoint is running on port ${workerPort}`);
});

(async () => {
  await initializeBlocklist().catch(e => {
    _logger.error("Failed to initialize blocklist", { error: e });
    process.exit(1);
  });

  initializeEngineForcing();

  await Promise.all([
    crawlFinishWorker(),
  ]);

  _logger.info("All workers exited. Shutting down...");
  process.exit(0);
})();
