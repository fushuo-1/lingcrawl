/**
 * Domain-level request throttle with mutex queue.
 * Ensures requests to the same domain are serialized with minimum interval.
 * Uses a promise chain to prevent concurrent requests from bypassing the delay.
 */

import { config } from "../../../config";
import { Logger } from "winston";

const domainQueues = new Map<string, Promise<void>>();

const ZHIHU_DOMAINS = ["zhihu.com", "zhuanlan.zhihu.com"];

function isZhihuDomain(hostname: string): boolean {
  const h = hostname.replace(/^www\./, "");
  return ZHIHU_DOMAINS.some(d => h === d || h.endsWith("." + d));
}

/**
 * Queue a request to a zhihu domain. Each request waits for the previous one
 * to complete plus the configured interval. This prevents concurrent requests
 * from bypassing the throttle.
 */
export async function throttleZhihu(url: string, logger: Logger): Promise<void> {
  const interval = config.ZHIHU_RATE_LIMIT_MS;
  if (interval <= 0) return;

  let hostname: string;
  try {
    hostname = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return;
  }

  if (!isZhihuDomain(hostname)) return;

  // Chain onto the existing queue for this domain
  const prev = domainQueues.get(hostname) ?? Promise.resolve();

  const myTurn = prev.then(async () => {
    logger.info(`Throttle: zhihu request proceeding`, {
      module: "throttle",
      hostname,
      interval,
    });
    // Wait the configured interval after the previous request
    await new Promise(resolve => setTimeout(resolve, interval));
  });

  // Register this request in the queue (catch to prevent unhandled rejection)
  domainQueues.set(hostname, myTurn.catch(() => {}));

  // Wait for our turn
  await myTurn;
}
