// Stub: webhook service - no-op in self-hosted mode
export enum WebhookEvent {
  CRAWL_STARTED = "crawl.started",
  CRAWL_PAGE = "crawl.page",
  CRAWL_COMPLETED = "crawl.completed",
  BATCH_SCRAPE_STARTED = "batch_scrape.started",
  BATCH_SCRAPE_PAGE = "batch_scrape.page",
  BATCH_SCRAPE_COMPLETED = "batch_scrape.completed",
}

interface WebhookSender {
  send(event: WebhookEvent, data: any): Promise<void>;
}

export async function createWebhookSender(params: {
  teamId: string;
  jobId: string;
  webhook: any;
  v0: boolean;
}): Promise<WebhookSender | null> {
  if (!params.webhook) return null;

  return {
    async send(event: WebhookEvent, data: any) {
      // No-op: webhook delivery not implemented in self-hosted mode
    },
  };
}
