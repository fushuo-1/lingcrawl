import "dotenv/config";
import { config } from "../../config";
import {
  scrapeQueue,
  nuqGetLocalMetrics,
  nuqHealthCheck,
  nuqShutdown,
  crawlFinishedQueue,
} from "./nuq";
import http from "node:http";
import { logger } from "../../lib/logger";

(async () => {
  const server = http.createServer(async (req, res) => {
    if (req.url === "/metrics") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end(nuqGetLocalMetrics());
    } else if (req.url === "/health") {
      if (await nuqHealthCheck()) {
        res.writeHead(200);
        res.end("OK");
      } else {
        res.writeHead(500);
        res.end("Not OK");
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(config.NUQ_PREFETCH_WORKER_PORT, () => {
    logger.info("NuQ prefetch worker metrics server started");
  });

  async function shutdown() {
    server.close();
    await nuqShutdown();
    process.exit(0);
  }

  if (require.main === module) {
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);
  }

  try {
    await Promise.all([
      (async () => {
        while (true) {
          await crawlFinishedQueue.prefetchJobs();
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      })(),
      (async () => {
        while (true) {
          if (config.NUQ_PREFETCH_WORKER_HEARTBEAT_URL) {
            fetch(config.NUQ_PREFETCH_WORKER_HEARTBEAT_URL).catch(() => {});
          }
          await scrapeQueue.prefetchJobs();
          await new Promise(resolve => setTimeout(resolve, 250));
        }
      })(),
    ]);
  } catch (error) {
    logger.error("Error in prefetch worker", { error });
    process.exit(1);
  }

  logger.info("All prefetch workers exited. Shutting down...");
  await shutdown();
})();
