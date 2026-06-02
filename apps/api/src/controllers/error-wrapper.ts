import { Request, Response } from "express";
import { ZodError } from "zod";
import {
  ErrorCodes,
  TransportableError,
} from "../lib/error";
import { logger } from "../lib/logger";

const errorCodeToStatusCode: Partial<Record<ErrorCodes, number>> = {
  BAD_REQUEST: 400,
  BAD_REQUEST_INVALID_JSON: 400,
  SCRAPE_ACTIONS_NOT_SUPPORTED: 400,
  SCRAPE_NO_CACHED_DATA: 404,
  CRAWL_DENIAL: 403,
  SCRAPE_TIMEOUT: 408,
  MAP_TIMEOUT: 408,
  SCRAPE_DNS_RESOLUTION_ERROR: 200,
};

function statusCodeForError(error: TransportableError): number {
  return errorCodeToStatusCode[error.code] ?? 500;
}

export function withErrorHandler(
  handler: (req: Request, res: Response) => Promise<any>,
): (req: Request, res: Response) => Promise<void> {
  return async (req: Request, res: Response) => {
    try {
      await handler(req, res);
    } catch (error) {
      if (error instanceof ZodError) {
        res.status(400).json({
          success: false,
          error: {
            message: "Invalid request body",
            details: error.issues.map(e => ({
              path: e.path.join("."),
              message: e.message,
            })),
          },
        });
      } else if (error instanceof TransportableError) {
        const statusCode = statusCodeForError(error);
        const body: any = {
          success: false,
          error: error.message,
          code: error.code,
        };
        res.status(statusCode).json(body);
      } else if (
        error instanceof Error &&
        error.message?.includes("timeout")
      ) {
        res.status(408).json({
          success: false,
          error: {
            message: "Request timed out",
          },
        });
      } else {
        logger.error("Unhandled error in controller", { error });
        res.status(500).json({
          success: false,
          error: {
            message: "Internal server error",
          },
        });
      }
    }
  };
}
