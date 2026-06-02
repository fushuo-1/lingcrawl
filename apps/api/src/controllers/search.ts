import { Response } from "express";
import { config } from "../config";
import {
  SearchRequest,
  SearchResponse,
  searchRequestSchema,
} from "./types";
import { v7 as uuidv7 } from "uuid";
import { logSearch, logRequest } from "../services/logging/log_job";
import { logger as _logger } from "../lib/logger";
import { CategoryOption } from "../lib/search-query-builder";
import { executeSearch } from "../search/execute";
import { withErrorHandler } from "./error-wrapper";

export const searchController = withErrorHandler(async (
  req: any,
  res: Response<SearchResponse>,
) => {
  const middlewareStartTime =
    (req as any).requestTiming?.startTime || new Date().getTime();
  const controllerStartTime = new Date().getTime();

  const jobId = uuidv7();
  let logger = _logger.child({
    jobId,
    teamId: "local",
    module: "api/v2",
    method: "searchController",
  });

  const middlewareTime = controllerStartTime - middlewareStartTime;
  const isSearchPreview =
    config.SEARCH_PREVIEW_TOKEN !== undefined &&
    config.SEARCH_PREVIEW_TOKEN === req.body.__searchPreviewToken;

  let zeroDataRetention = false;

  req.body = searchRequestSchema.parse(req.body);

  logger = logger.child({
    version: "v2",
    query: req.body.query,
    origin: req.body.origin,
  });

  await logRequest({
    id: jobId,
    kind: "search",
    team_id: "local",
    origin: req.body.origin ?? "api",
    integration: req.body.integration,
    target_hint: req.body.query,
    zeroDataRetention: false,
  });

  const result = await executeSearch(
    {
      query: req.body.query,
      limit: req.body.limit,
      tbs: req.body.tbs,
      filter: req.body.filter,
      lang: req.body.lang,
      country: req.body.country,
      location: req.body.location,
      sources: req.body.sources as Array<{ type: string }>,
      categories: req.body.categories as CategoryOption[],
      enterprise: req.body.enterprise,
      scrapeOptions: req.body.scrapeOptions,
      timeout: req.body.timeout,
    },
    {
      teamId: "local",
      origin: req.body.origin,
      apiKeyId: null,
      flags: null,
      requestId: jobId,
      bypassBilling: true,
      zeroDataRetention: false,
    },
    logger,
  );

  const endTime = new Date().getTime();
  const timeTakenInSeconds = (endTime - middlewareStartTime) / 1000;

  logSearch(
    {
      id: jobId,
      request_id: jobId,
      query: req.body.query,
      is_successful: true,
      error: undefined,
      results: result.response as any,
      num_results: result.totalResultsCount,
      time_taken: timeTakenInSeconds,
      team_id: "local",
      options: req.body,
      credits_cost: 0,
      zeroDataRetention: false,
    },
    false,
  );

  const totalRequestTime = new Date().getTime() - middlewareStartTime;
  const controllerTime = new Date().getTime() - controllerStartTime;

  logger.info("Request metrics", {
    version: "v2",
    jobId,
    mode: "search",
    middlewareStartTime,
    controllerStartTime,
    middlewareTime,
    controllerTime,
    totalRequestTime,
    searchCredits: result.searchCredits,
    scrapeCredits: result.scrapeCredits,
    totalCredits: result.totalCredits,
    scrapeful: result.shouldScrape,
  });

  return res.status(200).json({
    success: true,
    data: result.response,
    creditsUsed: result.totalCredits,
    id: jobId,
  });
});
