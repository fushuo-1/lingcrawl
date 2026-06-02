import { config } from "../../config";
import { scrapeTimeout } from "./lib";

const TEST_API_URL = config.TEST_API_URL || "http://localhost:3002";

async function apiPost(path: string, body: any): Promise<any> {
  const res = await fetch(`${TEST_API_URL}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

describe("Scrape endpoint", () => {
  it(
    "returns markdown for a simple page",
    async () => {
      const { status, data } = await apiPost("/v2/scrape", {
        url: "https://example.com",
        formats: ["markdown"],
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.markdown).toBeDefined();
      expect(data.data.markdown.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it(
    "returns 400 for missing url",
    async () => {
      const { status, data } = await apiPost("/v2/scrape", {});
      expect(status).toBe(400);
    },
    15000,
  );
});

describe("Map endpoint", () => {
  it(
    "returns links for a site",
    async () => {
      const { status, data } = await apiPost("/v2/map", {
        url: "https://example.com",
        limit: 5,
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(Array.isArray(data.links)).toBe(true);
    },
    scrapeTimeout,
  );
});

describe("Search endpoint", () => {
  const hasSearch = !!config.SEARXNG_ENDPOINT;

  (hasSearch ? it : it.skip)(
    "returns search results",
    async () => {
      const { status, data } = await apiPost("/v2/search", {
        query: "example",
        limit: 3,
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    },
    scrapeTimeout,
  );
});

describe("Crawl endpoint", () => {
  it(
    "starts a crawl and returns job id",
    async () => {
      const { status, data } = await apiPost("/v2/crawl", {
        url: "https://example.com",
        limit: 2,
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.id).toBeDefined();
      expect(data.url).toBeDefined();
    },
    15000,
  );
});

describe("Batch scrape endpoint", () => {
  it(
    "starts a batch scrape and returns job id",
    async () => {
      const { status, data } = await apiPost("/v2/batch/scrape", {
        urls: ["https://example.com"],
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.id).toBeDefined();
      expect(data.url).toBeDefined();
    },
    15000,
  );

  it(
    "returns 400 for empty urls",
    async () => {
      const { status, data } = await apiPost("/v2/batch/scrape", {
        urls: [],
      });
      expect(status).toBe(400);
    },
    15000,
  );
});
