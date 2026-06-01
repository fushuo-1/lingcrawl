import { Request, Response } from "express";
import { logger as _logger } from "../../lib/logger";
import { config } from "../../config";
import { generateText, generateObject } from "ai";
import { getModel } from "../../lib/generic-ai";
import { processJobInternal } from "../../services/worker/scrape-worker";
import { v7 as uuidv7 } from "uuid";
import { scrapeRequestSchema } from "./types";

interface ExtractRequest {
  url: string;
  prompt?: string;
  schema?: Record<string, any>;
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
  const { url, prompt, schema } = req.body;

  if (!url) {
    return res.status(400).json({ success: false, error: "url is required" });
  }

  const hasLLM = !!(config.OPENAI_API_KEY || config.OLLAMA_BASE_URL);
  const useLLM = hasLLM && (schema || prompt);

  // Mode A: Free — return full page markdown
  if (!useLLM) {
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
      logger.error("Extract (mode A) failed", { error, url });
      return res.status(500).json({ success: false, error: `Extraction failed: ${error}` });
    }
  }

  // Mode B: LLM — extract structured data
  try {
    const scrapeResult = await scrapeUrl(url);
    const pageContent = scrapeResult?.markdown || "";

    if (!pageContent) {
      return res.status(200).json({
        success: true,
        data: { content: "", title: "", sourceURL: url, mode: "llm" },
      });
    }

    const model = getModel("gpt-4o-mini");
    const truncatedContent = pageContent.substring(0, 15000);

    if (schema) {
      // Structured extraction with schema
      const result = await generateObject({
        model,
        schema: schema as any,
        prompt: `${prompt || "Extract the requested information from this page."}\n\nPage content:\n\n${truncatedContent}`,
      });

      return res.status(200).json({
        success: true,
        data: {
          content: result.object,
          title: scrapeResult?.metadata?.title || "",
          sourceURL: url,
          mode: "llm",
        },
      });
    } else {
      // Text extraction with prompt
      const result = await generateText({
        model,
        prompt: `${prompt || "Extract the key information from this page."}\n\nPage content:\n\n${truncatedContent}`,
      });

      return res.status(200).json({
        success: true,
        data: {
          content: result.text,
          title: scrapeResult?.metadata?.title || "",
          sourceURL: url,
          mode: "llm",
        },
      });
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("Extract (mode B) failed", { error, url });
    return res.status(500).json({ success: false, error: `LLM extraction failed: ${error}` });
  }
}
