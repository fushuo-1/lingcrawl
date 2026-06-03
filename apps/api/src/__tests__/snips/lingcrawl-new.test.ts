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

describe("GitHub Read endpoint", () => {
  it(
    "returns repo file list for a public repo",
    async () => {
      const { status, data } = await apiPost("/v2/github/read", {
        url: "https://github.com/octocat/Hello-World",
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
    },
    scrapeTimeout,
  );

  it(
    "returns file content when path is specified",
    async () => {
      const { status, data } = await apiPost("/v2/github/read", {
        url: "https://github.com/octocat/Hello-World",
        path: "README",
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data.content).toBeDefined();
    },
    scrapeTimeout,
  );

  it(
    "returns 400 for invalid github url",
    async () => {
      const { status } = await apiPost("/v2/github/read", {
        url: "https://not-github.com/foo",
      });
      expect(status).toBe(400);
    },
    15000,
  );
});

describe("Links endpoint", () => {
  it(
    "returns internal and external links",
    async () => {
      const { status, data } = await apiPost("/v2/links", {
        url: "https://example.com",
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.links).toBeDefined();
      expect(data.links.internal).toBeDefined();
      expect(data.links.external).toBeDefined();
    },
    scrapeTimeout,
  );
});

describe("Extract endpoint (free mode)", () => {
  it(
    "returns full page markdown",
    async () => {
      const { status, data } = await apiPost("/v2/extract", {
        url: "https://example.com",
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.data).toBeDefined();
      expect(data.data.markdown).toBeDefined();
    },
    scrapeTimeout,
  );
});

describe("Summary endpoint", () => {
  const hasAI = false;

  (hasAI ? it : it.skip)(
    "returns a summary for a page",
    async () => {
      const { status, data } = await apiPost("/v2/summary", {
        url: "https://example.com",
      });
      expect(status).toBe(200);
      expect(data.success).toBe(true);
      expect(data.summary).toBeDefined();
      expect(data.summary.length).toBeGreaterThan(0);
    },
    scrapeTimeout,
  );

  it(
    "returns 503 when no LLM is configured",
    async () => {
      // This test only makes sense when no AI is configured
      if (hasAI) return;
      const { status } = await apiPost("/v2/summary", {
        url: "https://example.com",
      });
      expect(status).toBe(503);
    },
    scrapeTimeout,
  );
});
