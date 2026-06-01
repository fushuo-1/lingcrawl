// Stub: concurrency limit removed in self-hosted mode
export async function pushConcurrencyLimitActiveJob(
  teamId: string,
  jobId: string,
  ttlMs: number,
) {
  // No-op
}

export async function pushCrawlConcurrencyLimitActiveJob(
  crawlId: string,
  jobId: string,
  ttlMs: number,
) {
  // No-op
}

export async function concurrentJobDone(job: any) {
  // No-op
}

export async function getConcurrencyLimitedJobs(
  teamId: string,
): Promise<Set<string>> {
  return new Set();
}

export async function getConcurrencyLimitActiveJobs(
  teamId: string,
  now?: number,
): Promise<any[]> {
  return [];
}

export async function getCrawlConcurrencyLimitActiveJobs(
  crawlId: string,
): Promise<any[]> {
  return [];
}

export async function getConcurrencyQueueJobsCount(
  teamId: string,
): Promise<number> {
  return 0;
}

export async function cleanOldConcurrencyLimitEntries(
  teamId: string,
  now: number,
) {
  // No-op
}

export async function pushConcurrencyLimitedJob(
  teamId: string,
  job: any,
  timeout: number,
) {
  // No-op
}

export async function pushConcurrencyLimitedJobs(
  teamId: string,
  jobs: any[],
) {
  // No-op
}

export function getTeamQueueLimit(maxConcurrency: number): number {
  return maxConcurrency * 2;
}

export class QueueFullError extends Error {
  constructor(current: number, limit: number) {
    super(`Queue full: ${current}/${limit}`);
    this.name = "QueueFullError";
  }
}
