import { Request, Response } from "express";
import { processJobInternal } from "../services/worker/scrape-worker";
import { scrapeRequestSchema } from "./types";
import { withErrorHandler } from "./error-wrapper";
import { buildSyncScrapeJob } from "../services/job-factory";

interface ExtractRequest {
  url: string;
}

async function scrapeUrl(url: string) {
  const parsed = scrapeRequestSchema.parse({ url, formats: [{ type: "markdown" }] });

  const job = buildSyncScrapeJob({
    url: parsed.url,
    scrapeOptions: parsed,
    origin: "extract",
    unnormalizedSourceURL: url,
  });

  return processJobInternal(job as any);
}

export const extractController = withErrorHandler(async (
  req: Request<{}, any, ExtractRequest>,
  res: Response,
) => {
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: "url is required" });
  }

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
});
