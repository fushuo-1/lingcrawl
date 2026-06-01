import { Request, Response } from "express";
import { logger as _logger } from "../../lib/logger";
import { config } from "../../config";
import { generateText } from "ai";
import { getModel } from "../../lib/generic-ai";
import { processJobInternal } from "../../services/worker/scrape-worker";
import { v7 as uuidv7 } from "uuid";
import { scrapeRequestSchema } from "./types";

interface SummaryRequest {
  url: string;
}

export async function summaryController(
  req: Request<{}, any, SummaryRequest>,
  res: Response,
) {
  const logger = _logger.child({ method: "summaryController" });
  const { url } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: "url is required" });
  }

  const hasLLM = !!(config.OPENAI_API_KEY || config.OLLAMA_BASE_URL);
  if (!hasLLM) {
    return res.status(503).json({
      success: false,
      error: "Summary requires LLM configuration. Set OPENAI_API_KEY or OLLAMA_BASE_URL.",
    });
  }

  try {
    // Scrape the page
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
        origin: "summary",
        startTime: Date.now(),
        zeroDataRetention: false,
        apiKeyId: null,
        concurrencyLimited: false,
      },
    };

    const scrapeResult = await processJobInternal(job as any);
    const pageContent = scrapeResult?.markdown || "";

    if (!pageContent) {
      return res.status(200).json({
        success: true,
        data: {
          summary: "No content could be extracted from this page.",
          title: scrapeResult?.metadata?.title || "",
          sourceURL: url,
        },
      });
    }

    // Call LLM for summary
    const model = getModel("gpt-4o-mini");

    const result = await generateText({
      model,
      prompt: `Summarize the following web page content in 2-4 sentences. Focus on the main topic and key points. Return only the summary text.\n\nPage title: ${scrapeResult?.metadata?.title || "Unknown"}\n\nPage content:\n\n${pageContent.substring(0, 15000)}`,
    });

    return res.status(200).json({
      success: true,
      data: {
        summary: result.text,
        title: scrapeResult?.metadata?.title || "",
        sourceURL: url,
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("Summary failed", { error, url });
    return res.status(500).json({ success: false, error: `Summary failed: ${error}` });
  }
}
