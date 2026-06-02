import { Response } from "express";
import { logger } from "../lib/logger";
import { getCrawl, saveCrawl } from "../lib/crawl-redis";
import * as Sentry from "@sentry/node";
import { configDotenv } from "dotenv";
import { crawlGroup } from "../services/worker/nuq";
import { withErrorHandler } from "./error-wrapper";
configDotenv();

export const crawlCancelController = withErrorHandler(async (
  req: any,
  res: Response,
) => {
  try {
    const sc = await getCrawl(req.params.jobId);
    if (!sc) {
      return res.status(404).json({ error: "Job not found" });
    }

    const group = await crawlGroup.getGroup(req.params.jobId);
    if (!group) {
      return res.status(404).json({ error: "Job not found" });
    }

    if (group.status === "completed") {
      return res.status(409).json({ error: "Crawl is already completed" });
    }

    try {
      sc.cancelled = true;
      await saveCrawl(req.params.jobId, sc);
    } catch (error) {
      logger.error(error);
    }

    res.json({
      status: "cancelled",
    });
  } catch (error) {
    Sentry.captureException(error);
    throw error;
  }
});
