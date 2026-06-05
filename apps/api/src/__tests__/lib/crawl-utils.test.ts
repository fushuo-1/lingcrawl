// Mock the redis service module so we can test crawl-utils without a live Redis.
// We provide a chainable pipeline mock and configurable sadd return values.
jest.mock("../../services/redis", () => {
  const mockPipeline = {
    sadd: jest.fn().mockReturnThis(),
    scard: jest.fn().mockReturnThis(),
    expire: jest.fn().mockReturnThis(),
    exec: jest.fn().mockResolvedValue([
      [null, 1], // sadd result
      [null, 1], // expire result
    ]),
  };
  return {
    redisEvictConnection: {
      pipeline: jest.fn(() => mockPipeline),
      scard: jest.fn().mockResolvedValue(0),
    },
  };
});

// Mock the WebScraper/crawler-factory re-export target so we don't pull in
// the full scrapeURL module chain (which has a circular import that breaks
// the Jest ESM transform at load time).
jest.mock("../../scraper/WebScraper/crawler-factory", () => ({
  crawlToCrawler: jest.fn(),
}));

import { redisEvictConnection } from "../../services/redis";
import {
  normalizeURL,
  generateURLPermutations,
  lockURL,
  lockURLs,
  lockURLsIndividually,
} from "../../lib/crawl-utils";
import type { StoredCrawl } from "../../lib/crawl-redis";

function makeStoredCrawl(overrides: Partial<StoredCrawl> = {}): StoredCrawl {
  return {
    crawlerOptions: {},
    scrapeOptions: {} as any,
    internalOptions: {} as any,
    team_id: "test-team",
    createdAt: Date.now(),
    ...overrides,
  } as StoredCrawl;
}

describe("crawl-utils", () => {
  describe("normalizeURL", () => {
    it("normalizes a basic URL", () => {
      const sc = makeStoredCrawl();
      const out = normalizeURL("https://example.com/path", sc);
      // URL constructor lowercases host
      expect(out).toBe("https://example.com/path");
    });

    it("lowercases uppercase host", () => {
      const sc = makeStoredCrawl();
      const out1 = normalizeURL("https://example.com/path", sc);
      const out2 = normalizeURL("https://EXAMPLE.com/path", sc);
      expect(out1).toBe(out2);
    });

    it("strips query string when ignoreQueryParameters is set", () => {
      const sc = makeStoredCrawl({
        crawlerOptions: { ignoreQueryParameters: true } as any,
      });
      const out = normalizeURL("https://example.com/?utm_source=x", sc);
      expect(out).not.toContain("utm_source");
      expect(out).not.toContain("?");
    });

    it("keeps hash-routes (#/ and #!/)", () => {
      const sc = makeStoredCrawl();
      const hashRoute = normalizeURL("https://example.com/#/route", sc);
      expect(hashRoute).toContain("#/route");

      const bangRoute = normalizeURL("https://example.com/#!/path", sc);
      expect(bangRoute).toContain("#!/path");
    });

    it("strips short/non-route hashes", () => {
      const sc = makeStoredCrawl();
      const out = normalizeURL("https://example.com/#section", sc);
      expect(out).not.toContain("#section");
    });
  });

  describe("generateURLPermutations", () => {
    it("returns at least one permutation for a valid URL", () => {
      const perms = generateURLPermutations("https://example.com/path");
      expect(perms.length).toBeGreaterThan(0);
    });

    it("all permutations are URL instances", () => {
      const perms = generateURLPermutations("https://example.com/path");
      for (const p of perms) {
        expect(p).toBeInstanceOf(URL);
      }
    });

    it("includes canonical form (https, no www)", () => {
      const perms = generateURLPermutations("https://example.com/path");
      const hrefs = perms.map(p => p.href);
      expect(hrefs).toContain("https://example.com/path");
    });

    it("includes www variant when input has no www", () => {
      const perms = generateURLPermutations("https://example.com/path");
      const hrefs = perms.map(p => p.href);
      expect(hrefs.some(h => h.includes("www.example.com"))).toBe(true);
    });

    it("includes http variant when input is https", () => {
      const perms = generateURLPermutations("https://example.com/path");
      const hrefs = perms.map(p => p.href);
      expect(hrefs.some(h => h.startsWith("http://example.com"))).toBe(true);
    });

    it("deduplicates permutations (no exact duplicates)", () => {
      const perms = generateURLPermutations("https://example.com/path");
      const hrefs = perms.map(p => p.href);
      const unique = new Set(hrefs);
      expect(unique.size).toBe(hrefs.length);
    });
  });

  describe("lockURL", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns true for a new URL (sadd returns 1)", async () => {
      const sc = makeStoredCrawl();
      const result = await lockURL("crawl-1", sc, "https://example.com/page1");
      expect(result).toBe(true);
      expect(redisEvictConnection.pipeline).toHaveBeenCalled();
    });

    it("returns false when sadd indicates duplicate (sadd returns 0)", async () => {
      // Override the mock for this test
      const pipeline = {
        sadd: jest.fn().mockReturnThis(),
        scard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([[null, 0]]),
      };
      (redisEvictConnection.pipeline as jest.Mock).mockReturnValue(pipeline);

      const sc = makeStoredCrawl();
      const result = await lockURL("crawl-2", sc, "https://example.com/seen");
      expect(result).toBe(false);
    });
  });

  describe("lockURLs", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns true for empty input", async () => {
      const sc = makeStoredCrawl();
      const result = await lockURLs("crawl-3", sc, []);
      expect(result).toBe(true);
    });

    it("returns true when all URLs are new", async () => {
      const pipeline = {
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 2], // visited_unique sadd
          [null, 1], // visited_unique expire
          [null, 2], // visited sadd
          [null, 1], // visited expire
        ]),
      };
      (redisEvictConnection.pipeline as jest.Mock).mockReturnValue(pipeline);

      const sc = makeStoredCrawl();
      const result = await lockURLs(
        "crawl-4",
        sc,
        ["https://example.com/a", "https://example.com/b"],
      );
      expect(result).toBe(true);
    });

    it("returns false when not all URLs are new", async () => {
      const pipeline = {
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, 1], // visited_unique sadd - only 1 added
          [null, 1],
          [null, 1],
          [null, 1],
        ]),
      };
      (redisEvictConnection.pipeline as jest.Mock).mockReturnValue(pipeline);

      const sc = makeStoredCrawl();
      const result = await lockURLs(
        "crawl-5",
        sc,
        ["https://example.com/a", "https://example.com/b"],
      );
      expect(result).toBe(false);
    });
  });

  describe("lockURLsIndividually", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("filters out URLs that are already locked", async () => {
      // First call returns sadd=1 (new), second call returns sadd=0 (duplicate)
      let callIndex = 0;
      const pipeline = {
        sadd: jest.fn().mockReturnThis(),
        scard: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockImplementation(() => {
          const result = callIndex === 0 ? 1 : 0;
          callIndex++;
          return Promise.resolve([[null, result]]);
        }),
      };
      (redisEvictConnection.pipeline as jest.Mock).mockReturnValue(pipeline);

      const sc = makeStoredCrawl();
      const jobs = [
        { id: "j1", url: "https://example.com/new" },
        { id: "j2", url: "https://example.com/seen" },
      ];
      const out = await lockURLsIndividually("crawl-6", sc, jobs);
      expect(out.length).toBe(1);
      expect(out[0].id).toBe("j1");
    });
  });
});
