import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { createIdempotencyKey } from "../services/idempotency/create";
import { validateIdempotencyKey } from "../services/idempotency/validate";
import { isUrlBlocked } from "../scraper/WebScraper/utils/blocklist";
import { logger } from "../lib/logger";
import { httpRequestDurationSeconds } from "../lib/http-metrics";
import { UNSUPPORTED_SITE_MESSAGE } from "../lib/strings";
import { validate as isUuid } from "uuid";

export async function idempotencyHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  if (request.headers["x-idempotency-key"]) {
    const isIdempotencyValid = await validateIdempotencyKey(
      request.headers as Record<string, string | string[] | undefined>,
    );
    if (!isIdempotencyValid) {
      return reply.code(409).send({
        success: false,
        error: "Idempotency key already used",
      });
    }
    createIdempotencyKey(
      request.headers as Record<string, string | string[] | undefined>,
    );
  }
}

export async function blocklistHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const body = request.body as { url?: unknown } | undefined;
  if (typeof body?.url === "string" && isUrlBlocked(body.url, null as any)) {
    return reply.code(403).send({
      success: false,
      error: UNSUPPORTED_SITE_MESSAGE,
    });
  }
}

export function isValidJobId(jobId: string | undefined): jobId is string {
  return typeof jobId === "string" && isUuid(jobId);
}

export async function validateJobIdHook(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = request.params as { jobId?: string };
  if (!isValidJobId(params.jobId)) {
    return reply.code(400).send({
      success: false,
      error: "Invalid job ID format. Job ID must be a valid UUID.",
    });
  }
}

const UUID_REGEX =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function getRoutePattern(request: FastifyRequest): string {
  const routeOptions = (request as any).routeOptions;
  if (routeOptions?.url) {
    return routeOptions.url;
  }
  return request.url.replace(UUID_REGEX, ":id");
}

export async function registerTimingHooks(fastify: FastifyInstance) {
  fastify.addHook("onRequest", async (request) => {
    (request as any).requestTiming = {
      startTime: Date.now(),
      version: "api",
    };
  });

  fastify.addHook("onResponse", async (request, reply) => {
    const timing = (request as any).requestTiming;
    if (!timing) return;
    const duration = (Date.now() - timing.startTime) / 1000;
    const route = getRoutePattern(request);
    const status = String(reply.statusCode);

    httpRequestDurationSeconds
      .labels(timing.version, request.method, route, status)
      .observe(duration);

    if (reply.statusCode < 400) {
      logger.info(`${timing.version} request completed`, {
        version: timing.version,
        path: request.url,
        method: request.method,
        startTime: timing.startTime,
        requestTime: Date.now() - timing.startTime,
        statusCode: reply.statusCode,
      });
    }
  });
}
