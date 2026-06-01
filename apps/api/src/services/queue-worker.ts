import "dotenv/config";
import { config } from "../config";
import "./sentry";
import { setSentryServiceTag } from "./sentry";
import * as Sentry from "@sentry/node";
import {
  getRedisConnection,
} from "./queue-service";
import { Job, Queue, Worker } from "bullmq";
import { logger as _logger } from "../lib/logger";
import systemMonitor from "./system-monitor";
import { v7 as uuidv7 } from "uuid";
import { configDotenv } from "dotenv";
import Express from "express";
import { robustFetch } from "../scraper/scrapeURL/lib/fetch";
import { initializeBlocklist } from "../scraper/WebScraper/utils/blocklist";
import { initializeEngineForcing } from "../scraper/WebScraper/utils/engine-forcing";
import { crawlFinishedQueue, NuQJob, scrapeQueue } from "./worker/nuq";
import { finishCrawlSuper } from "./worker/crawl-logic";
import { getCrawl } from "../lib/crawl-redis";
import { TransportableError } from "../lib/error";

configDotenv();

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const jobLockExtendInterval = config.JOB_LOCK_EXTEND_INTERVAL;
const jobLockExtensionTime = config.JOB_LOCK_EXTENSION_TIME;

const cantAcceptConnectionInterval = config.CANT_ACCEPT_CONNECTION_INTERVAL;
const connectionMonitorInterval = config.CONNECTION_MONITOR_INTERVAL;
const gotJobInterval = config.CONNECTION_MONITOR_INTERVAL;

const runningJobs: Set<string> = new Set();

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
let isWorkerStalled = false;

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

let cantAcceptConnectionCount = 0;

const workerFun = async (
  queue: Queue,
  processJobInternal: (token: string, job: Job) => Promise<any>,
) => {
  const logger = _logger.child({ module: "queue-worker", method: "workerFun" });

  const worker = new Worker(queue.name, null, {
    connection: getRedisConnection(),
    lockDuration: 60 * 1000, // 60 seconds
    stalledInterval: 60 * 1000, // 60 seconds
    maxStalledCount: 10, // 10 times
  });

  worker.startStalledCheckTimer();

  const monitor = await systemMonitor;

  while (true) {
    if (isShuttingDown) {
      _logger.info("No longer accepting new jobs. SIGINT");
      break;
    }
    const token = uuidv7();
    const canAcceptConnection = await monitor.acceptConnection();
    if (!canAcceptConnection) {
      console.log("Can't accept connection due to RAM/CPU load");
      logger.info("Can't accept connection due to RAM/CPU load");
      cantAcceptConnectionCount++;

      isWorkerStalled = cantAcceptConnectionCount >= 25;

      if (isWorkerStalled) {
        logger.error("WORKER STALLED", {
          cpuUsage: await monitor.checkCpuUsage(),
          memoryUsage: await monitor.checkMemoryUsage(),
        });
      }

      await sleep(cantAcceptConnectionInterval); // more sleep
      continue;
    } else if (!currentLiveness) {
      logger.info("Not accepting jobs because the liveness check failed");

      await sleep(cantAcceptConnectionInterval);
      continue;
    } else {
      cantAcceptConnectionCount = 0;
    }

    const job = await worker.getNextJob(token);
    if (job) {
      if (job.id) {
        runningJobs.add(job.id);
      }

      processJobInternal(token, job).finally(() => {
        if (job.id) {
          runningJobs.delete(job.id);
        }
      });

      await sleep(gotJobInterval);
    } else {
      await sleep(connectionMonitorInterval);
    }
  }
};

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
  if (config.USE_DB_AUTHENTICATION) {
    // networking check for Kubernetes environments
    const host = config.LINGCRAWL_APP_HOST;
    const port = config.LINGCRAWL_APP_PORT;
    const scheme = config.LINGCRAWL_APP_SCHEME;

    robustFetch({
      url: `${scheme}://${host}:${port}`,
      method: "GET",
      mock: null,
      logger: _logger,
      abort: AbortSignal.timeout(5000),
      ignoreResponse: true,
      useCacheableLookup: false,
    })
      .then(() => {
        currentLiveness = true;
        res.status(200).json({ ok: true });
      })
      .catch(e => {
        _logger.error("WORKER NETWORKING CHECK FAILED", { error: e });
        currentLiveness = false;
        res.status(500).json({ ok: false });
      });
  } else {
    currentLiveness = true;
    res.status(200).json({ ok: true });
  }
});

const workerPort = config.WORKER_PORT || config.PORT;
app.listen(workerPort, () => {
  _logger.info(`Liveness endpoint is running on port ${workerPort}`);
});

(async () => {
  setSentryServiceTag("queue-worker");

  await initializeBlocklist().catch(e => {
    _logger.error("Failed to initialize blocklist", { error: e });
    process.exit(1);
  });

  initializeEngineForcing();

  await Promise.all([
    crawlFinishWorker(),
  ]);

  _logger.info("All workers exited. Waiting for all jobs to finish...");

  while (runningJobs.size > 0) {
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  _logger.info("All jobs finished. Shutting down...");
  process.exit(0);
})();
