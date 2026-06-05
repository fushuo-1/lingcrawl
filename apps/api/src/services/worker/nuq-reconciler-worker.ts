import "dotenv/config";
import { config } from "../../config";
import { logger as _logger } from "../../lib/logger";
import { Counter, register } from "prom-client";
import http from "node:http";

const RECONCILER_INTERVAL_MS = 60 * 1000;

const reconcilerRunsTotal = new Counter({
  name: "concurrency_queue_reconciler_runs_total",
  help: "Total completed concurrency queue reconciler runs",
});

const reconcilerFailuresTotal = new Counter({
  name: "concurrency_queue_reconciler_failures_total",
  help: "Total failed concurrency queue reconciler runs",
});

const reconcilerJobsRecoveredTotal = new Counter({
  name: "concurrency_queue_reconciler_jobs_recovered_total",
  help: "Total drifted jobs recovered by the reconciler",
});

(async () => {
  let isShuttingDown = false;
  let reconcilerInFlight = false;

  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      try {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(await register.metrics());
      } catch (error) {
        _logger.error("Failed to collect metrics", { error });
        res.writeHead(500);
        res.end("Failed to collect metrics");
      }
    } else if (req.url === "/health") {
      res.writeHead(200);
      res.end("OK");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(config.NUQ_RECONCILER_WORKER_PORT, () => {
    _logger.info("NuQ reconciler worker started", {
      port: config.NUQ_RECONCILER_WORKER_PORT,
    });
  });

  async function shutdown() {
    if (isShuttingDown) return;
    isShuttingDown = true;
    _logger.info("NuQ reconciler worker shutting down");

    while (reconcilerInFlight) {
      _logger.info("Waiting for in-flight reconciliation to complete...");
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    server.close(() => {
      _logger.info("NuQ reconciler worker shut down");
      process.exit(0);
    });
  }

  if (require.main === module) {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  while (!isShuttingDown) {
    if (!reconcilerInFlight) {
      reconcilerInFlight = true;

      try {
        const summary = { jobsRequeued: 0, jobsStarted: 0 };

        reconcilerRunsTotal.inc();
        reconcilerJobsRecoveredTotal.inc(
          summary.jobsRequeued + summary.jobsStarted,
        );

        _logger.info("Concurrency queue reconciler run complete", summary);
      } catch (error) {
        reconcilerFailuresTotal.inc();
        _logger.error("Concurrency queue reconciler run failed", { error });
      } finally {
        reconcilerInFlight = false;
      }
    }

    await new Promise(resolve => setTimeout(resolve, RECONCILER_INTERVAL_MS));
  }
})();
