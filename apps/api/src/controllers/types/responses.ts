import type { ScrapeActionContent } from "../../lib/entities";
import { ErrorCodes } from "../../lib/error";
import type { CrawlerOptions } from "../schemas/crawl";
import type { JsonValue } from "../../types/common";

export type Document = {
  title?: string;
  description?: string;
  url?: string;
  markdown?: string;
  html?: string;
  rawHtml?: string;
  links?: string[];
  images?: string[];
  screenshot?: string;
  extract?: JsonValue;
  json?: JsonValue;
  summary?: string;
  answer?: string;
  warning?: string;
  attributes?: {
    selector: string;
    attribute: string;
    values: string[];
  }[];
  actions?: {
    screenshots?: string[];
    scrapes?: ScrapeActionContent[];
    javascriptReturns?: {
      type: string;
      value: unknown;
    }[];
    pdfs?: string[];
  };
  changeTracking?: {
    previousScrapeAt: string | null;
    changeStatus: "new" | "same" | "changed" | "removed";
    visibility: "visible" | "hidden";
    diff?: {
      text: string;
      json: {
        files: Array<{
          from: string | null;
          to: string | null;
          chunks: Array<{
            content: string;
            changes: Array<{
              type: string;
              normal?: boolean;
              ln?: number;
              ln1?: number;
              ln2?: number;
              content: string;
            }>;
          }>;
        }>;
      };
    };
    json?: JsonValue;
  };
  metadata: {
    title?: string;
    description?: string;
    language?: string;
    keywords?: string;
    robots?: string;
    ogTitle?: string;
    ogDescription?: string;
    ogUrl?: string;
    ogImage?: string;
    ogAudio?: string;
    ogDeterminer?: string;
    ogLocale?: string;
    ogLocaleAlternate?: string[];
    ogSiteName?: string;
    ogVideo?: string;
    favicon?: string;
    dcTermsCreated?: string;
    dcDateCreated?: string;
    dcDate?: string;
    dcTermsType?: string;
    dcType?: string;
    dcTermsAudience?: string;
    dcTermsSubject?: string;
    dcSubject?: string;
    dcDescription?: string;
    dcTermsKeywords?: string;
    modifiedTime?: string;
    publishedTime?: string;
    articleTag?: string;
    articleSection?: string;
    url?: string;
    sourceURL?: string;
    statusCode: number;
    scrapeId?: string;
    error?: string;
    numPages?: number;
    contentType?: string;
    timezone?: string;
    proxyUsed: "basic" | "stealth";
    cacheState?: "hit" | "miss";
    cachedAt?: string;
    creditsUsed?: number;
    postprocessorsUsed?: string[];
    indexId?: string; // ID used to store the document in the index (GCS)
    concurrencyLimited?: boolean;
    concurrencyQueueDurationMs?: number;
    // [key: string]: string | string[] | number | { smartScrape: number; other: number; total: number } | undefined;
  };
  serpResults?: {
    title: string;
    description: string;
    url: string;
  };
  pdfTables?: {
    page: number;
    tableIndex: number;
    rows: string[][];
    rowCount: number;
    colCount: number;
    confidence: number;
  }[];
  pdfImages?: {
    page: number;
    index: number;
    width: number;
    height: number;
    format: string;
    data: string;
  }[];
  pdfMetadata?: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string;
    creator?: string;
    producer?: string;
    creationDate?: string;
    modDate?: string;
    pageCount: number;
    pdfVersion?: string;
  };
};

export type ErrorResponse = {
  success: false;
  code?: ErrorCodes;
  error: string;
  details?: JsonValue;
};

export type ScrapeResponse =
  | ErrorResponse
  | {
      success: true;
      warning?: string;
      data: Document;
      scrape_id?: string;
    };

export interface URLTrace {
  url: string;
  status: "mapped" | "scraped" | "error";
  timing: {
    discoveredAt: string;
    scrapedAt?: string;
    completedAt?: string;
  };
  error?: string;
  warning?: string;
  contentStats?: {
    rawContentLength: number;
    processedContentLength: number;
    tokensUsed: number;
  };
  relevanceScore?: number;
  usedInCompletion?: boolean;
  extractedFields?: string[];
}

export interface ExtractResponse {
  success: boolean;
  error?: string;
  data?: JsonValue;
  scrape_id?: string;
  id?: string;
  warning?: string;
  urlTrace?: URLTrace[];
  sources?: {
    [key: string]: string[];
  };
  tokensUsed?: number;
  creditsUsed?: number;
}

export type AgentResponse =
  | ErrorResponse
  | {
      success: boolean;
      id: string;
    };

export type AgentStatusResponse =
  | ErrorResponse
  | {
      success: boolean;
      status: "processing" | "completed" | "failed";
      error?: string;
      data?: JsonValue;
      model?: "spark-1-pro" | "spark-1-mini";
      expiresAt: string;
      creditsUsed?: number;
    };

export type AgentCancelResponse =
  | ErrorResponse
  | {
      success: boolean;
    };

export type CrawlResponse =
  | ErrorResponse
  | {
      success: true;
      id: string;
      url: string;
    };

export type BatchScrapeResponse =
  | ErrorResponse
  | {
      success: true;
      id: string;
      url: string;
      invalidURLs?: string[];
    };

// Map document interface (transitioned from v1)
export interface MapDocument {
  url: string;
  title?: string;
  description?: string;
}

// V2 Map Response with dictionary format
export type MapResponse =
  | ErrorResponse
  | {
      success: true;
      links?: MapDocument[];
      warning?: string;
    };

export type CrawlStatusParams = {
  jobId: string;
};

export type ConcurrencyCheckParams = {
  teamId: string;
};

export type ConcurrencyCheckResponse =
  | ErrorResponse
  | {
      success: true;
      concurrency: number;
      maxConcurrency: number;
    };

export type CrawlStatusResponse =
  | ErrorResponse
  | {
      success: true;
      status: "scraping" | "completed" | "failed" | "cancelled";
      completed: number;
      total: number;
      creditsUsed: number;
      expiresAt: string;
      next?: string;
      data: Document[];
      warning?: string;
    }
  | {
      success: false;
      status: "failed";
      error: string;
      completed: number;
      total: number;
      creditsUsed: number;
      expiresAt: string;
      data: Document[];
    };

export type OngoingCrawlsResponse =
  | ErrorResponse
  | {
      success: true;
      crawls: {
        id: string;
        teamId: string;
        url: string;
        created_at: string;
        options: CrawlerOptions;
      }[];
    };

export type CrawlErrorsResponse =
  | ErrorResponse
  | {
      errors: {
        id: string;
        timestamp?: string;
        url: string;
        code?: ErrorCodes;
        error: string;
      }[];
      robotsBlocked: string[];
    };

export type TeamFlags = {
  ignoreRobots?: boolean;
  unblockedDomains?: string[];
  forceZDR?: boolean;
  allowZDR?: boolean;
  zdrCost?: number;
  checkRobotsOnScrape?: boolean;
  crawlTtlHours?: number;
  ipWhitelist?: boolean;
  bypassCreditChecks?: boolean;
} | null;

export type SearchResponse =
  | ErrorResponse
  | {
      success: true;
      warning?: string;
      data: Document[];
      creditsUsed: number;
      id: string;
    }
  | {
      success: true;
      warning?: string;
      data: import("../../lib/entities").SearchV2Response;
      creditsUsed: number;
      id: string;
    }
  | {
      success: true;
      warning?: string;
      data: import("../../lib/entities").SearchV2Response;
      scrapeIds: {
        web?: string[];
        news?: string[];
        images?: string[];
      };
      creditsUsed: number;
      id: string;
    };

export type TokenUsage = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  step?: string;
  model?: string;
};
