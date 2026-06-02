import { Request, Response } from "express";
import { logger as _logger } from "../lib/logger";
import { processJobInternal } from "../services/worker/scrape-worker";
import { v7 as uuidv7 } from "uuid";
import { scrapeRequestSchema } from "./types";

interface ExtractRequest {
  url: string;
}

async function scrapeUrl(url: string) {
  const jobId = uuidv7();
  const parsed = scrapeRequestSchema.parse({ url, formats: [{ type: "markdown" }] });

  const job = {
    id: jobId,
    status: "active" as const,
    createdAt: new Date(),
    priority: 10,
    data: {
      url: parsed.url,
      mode: "single_urls" as const,
      team_id: "local",
      scrapeOptions: parsed,
      internalOptions: {
        teamId: "local",
        saveScrapeResultToGCS: false,
        unnormalizedSourceURL: url,
        bypassBilling: true,
        zeroDataRetention: false,
        teamFlags: null,
      },
      skipNuq: true,
      origin: "extract",
      startTime: Date.now(),
      zeroDataRetention: false,
      apiKeyId: null,
      concurrencyLimited: false,
    },
  };

  return processJobInternal(job as any);
}

export async function extractController(
  req: Request<{}, any, ExtractRequest>,
  res: Response,
) {
  const logger = _logger.child({ method: "extractController" });
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: "url is required" });
  }

  try {
    const result = await scrapeUrl(url);
    return res.status(200).json({
      success: true,
      data: {
        content: result?.markdown || "",
        title: result?.metadata?.title || "",
        sourceURL: url,
        mode: "fulltext",
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("Extract failed", { error, url });
    return res.status(500).json({ success: false, error: `Extraction failed: ${error}` });
  }
}
