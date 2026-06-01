import { Queue } from "bullmq";
import { config } from "../config";
import { logger } from "../lib/logger";
import IORedis from "ioredis";
import { addExtractJob, ExtractJobData } from "./extract-queue";

let loggingQueue: Queue;
let indexQueue: Queue;
let billingQueue: Queue;
let precrawlQueue: Queue;
let redisConnection: IORedis;

export function getRedisConnection(): IORedis {
  if (!redisConnection) {
    redisConnection = new IORedis(config.REDIS_URL!, {
      maxRetriesPerRequest: null,
    });
    redisConnection.on("connect", () => logger.info("Redis connected"));
    redisConnection.on("reconnecting", () => logger.warn("Redis reconnecting"));
    redisConnection.on("error", err => logger.warn("Redis error", { err }));
  }
  return redisConnection;
}

const billingQueueName = "{billingQueue}";
export const precrawlQueueName = "{precrawlQueue}";

export async function addExtractJobToQueue(
  extractId: string,
  data: ExtractJobData,
): Promise<void> {
  await addExtractJob(extractId, data);
}

export function getBillingQueue() {
  if (!billingQueue) {
    billingQueue = new Queue(billingQueueName, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: {
          age: 60, // 1 minute
        },
        removeOnFail: {
          age: 3600, // 1 hour
        },
      },
    });
  }
  return billingQueue;
}

export function getPrecrawlQueue() {
  if (!precrawlQueue) {
    precrawlQueue = new Queue(precrawlQueueName, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: {
          age: 24 * 60 * 60, // 1 day
        },
        removeOnFail: {
          age: 24 * 60 * 60, // 1 day
        },
      },
    });
  }
  return precrawlQueue;
}
