import { NextFunction, Request, Response } from "express";
import { createIdempotencyKey } from "../services/idempotency/create";
import { validateIdempotencyKey } from "../services/idempotency/validate";
import { isUrlBlocked } from "../scraper/WebScraper/utils/blocklist";
import { logger } from "../lib/logger";
import {
  httpRequestDurationSeconds,
  getRoutePattern,
} from "../lib/http-metrics";
import { UNSUPPORTED_SITE_MESSAGE } from "../lib/strings";
import { validate as isUuid } from "uuid";

export function idempotencyMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  (async () => {
    if (req.headers["x-idempotency-key"]) {
      const isIdempotencyValid = await validateIdempotencyKey(req);
      if (!isIdempotencyValid) {
        if (!res.headersSent) {
          return res
            .status(409)
            .json({ success: false, error: "Idempotency key already used" });
        }
      }
      createIdempotencyKey(req);
    }
    next();
  })().catch(err => next(err));
}

export function blocklistMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (typeof req.body?.url === "string" && isUrlBlocked(req.body.url, null)) {
    if (!res.headersSent) {
      return res.status(403).json({
        success: false,
        error: UNSUPPORTED_SITE_MESSAGE,
      });
    }
  }
  next();
}

export function isValidJobId(jobId: string | undefined): jobId is string {
  return typeof jobId === "string" && isUuid(jobId);
}

export function validateJobIdParam(
  req: Request<{ jobId?: string }>,
  res: Response,
  next: NextFunction,
) {
  if (!isValidJobId(req.params.jobId)) {
    return res.status(400).json({
      success: false,
      error: "Invalid job ID format. Job ID must be a valid UUID.",
    });
  }
  next();
}

export function requestTimingMiddleware(version: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = new Date().getTime();

    (req as any).requestTiming = {
      startTime,
      version,
    };

    const originalJson = res.json.bind(res);
    res.json = function (body: any) {
      const requestTime = new Date().getTime() - startTime;

      const durationSeconds = requestTime / 1000;
      const route = getRoutePattern(req);
      const status = String(res.statusCode);

      httpRequestDurationSeconds
        .labels(version, req.method, route, status)
        .observe(durationSeconds);

      if (body?.success !== false) {
        logger.info(`${version} request completed`, {
          version,
          path: req.path,
          method: req.method,
          startTime,
          requestTime,
          statusCode: res.statusCode,
        });
      }

      return originalJson(body);
    };

    next();
  };
}

export function wrap(
  controller: (req: Request, res: Response) => Promise<any>,
): (req: Request, res: Response, next: NextFunction) => any {
  return (req, res, next) => {
    controller(req, res).catch(err => next(err));
  };
}
