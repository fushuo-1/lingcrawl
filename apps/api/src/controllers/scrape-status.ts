import { getJob } from "./crawl-status";
import { logger as _logger } from "../lib/logger";
import { withErrorHandler } from "./error-wrapper";

export const scrapeStatusController = withErrorHandler(async (req: any, res: any) => {
  const uuidReg =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!req.params.jobId || !uuidReg.test(req.params.jobId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid job ID",
    });
  }

  const logger = _logger.child({
    module: "scrape-status",
    method: "scrapeStatusController",
    jobId: req.params.jobId,
    scrapeId: req.params.jobId,
  });

  const jobData = await getJob(req.params.jobId, logger);
  const data = Array.isArray(jobData?.returnvalue)
    ? jobData?.returnvalue[0]
    : jobData?.returnvalue;

  if (!data) {
    return res.status(404).json({
      success: false,
      error: "Job not found.",
    });
  }

  return res.status(200).json({
    success: true,
    data,
  });
});
