import { TransportableError, ErrorCodes, ScrapeJobTimeoutError, UnknownError, SitemapError, CrawlDenialError } from "../../lib/error";
import { PDFInsufficientTimeError, ScrapeRetryLimitError } from "../../scraper/scrapeURL/error";

describe("error-factory (defineError)", () => {
  describe("basic creation", () => {
    it("creates ScrapeJobTimeoutError with correct code", () => {
      const err = new ScrapeJobTimeoutError();
      expect(err.code).toBe("SCRAPE_TIMEOUT");
      expect(err).toBeInstanceOf(TransportableError);
      expect(err).toBeInstanceOf(ScrapeJobTimeoutError);
      expect(err).toBeInstanceOf(Error);
    });

    it("creates ScrapeJobTimeoutError with custom message", () => {
      const err = new ScrapeJobTimeoutError("custom timeout msg");
      expect(err.message).toBe("custom timeout msg");
      expect(err.code).toBe("SCRAPE_TIMEOUT");
    });

    it("SitemapError accepts message and cause", () => {
      const cause = new Error("xml parse failure");
      const err = new SitemapError("bad sitemap", cause);
      expect(err.code).toBe("SCRAPE_SITEMAP_ERROR");
      expect(err.message).toBe("bad sitemap");
      expect(err.cause).toBe(cause);
    });

    it("UnknownError wraps inner error", () => {
      const inner = new Error("boom");
      const err = new UnknownError(inner);
      expect(err.code).toBe("UNKNOWN_ERROR");
      expect(err.message).toContain("boom");
      expect(err.cause).toBe(inner.cause);
      expect(err.stack).toBe(inner.stack);
    });
  });

  describe("fields preserved (errors with fields)", () => {
    it("CrawlDenialError preserves reason field", () => {
      const err = new CrawlDenialError("blocked");
      expect(err.code).toBe("CRAWL_DENIAL");
      expect(err.reason).toBe("blocked");
    });

    it("PDFInsufficientTimeError code is set and message includes page count", () => {
      const err = new PDFInsufficientTimeError(42, 30000);
      expect(err.code).toBe("SCRAPE_PDF_INSUFFICIENT_TIME_ERROR");
      expect(err.message).toContain("42 pages");
      expect(err.message).toContain("30000ms");
    });

    it("ScrapeRetryLimitError preserves reason and stats", () => {
      const stats = {
        totalAttempts: 5,
        addFeatureAttempts: 1,
        removeFeatureAttempts: 1,
        pdfAntibotAttempts: 1,
        documentAntibotAttempts: 1,
      };
      const err = new ScrapeRetryLimitError("global", stats);
      expect(err.code).toBe("SCRAPE_RETRY_LIMIT");
      expect(err.reason).toBe("global");
      expect(err.stats).toEqual(stats);
    });
  });

  describe("code matches ErrorCodes", () => {
    it("ScrapeJobTimeoutError code is valid ErrorCodes", () => {
      const codes: ErrorCodes[] = [
        "SCRAPE_TIMEOUT",
        "MAP_TIMEOUT",
        "UNKNOWN_ERROR",
        "CRAWL_DENIAL",
        "SCRAPE_PDF_INSUFFICIENT_TIME_ERROR",
      ];
      const err = new ScrapeJobTimeoutError();
      expect(codes).toContain(err.code);
    });
  });

  describe("serialize()", () => {
    it("returns shape with cause, stack, message", () => {
      const err = new ScrapeJobTimeoutError("hello");
      const s = err.serialize();
      expect(s).toHaveProperty("message", "hello");
      expect(s).toHaveProperty("stack");
      expect(s).toHaveProperty("cause");
    });

    it("includes custom fields for errors with fields", () => {
      const err = new CrawlDenialError("robots.txt");
      const s = err.serialize();
      expect(s).toHaveProperty("message");
      expect(s).toHaveProperty("reason", "robots.txt");
      expect(s).toHaveProperty("stack");
      expect(s).toHaveProperty("cause");
    });
  });

  describe("deserialize() round-trip", () => {
    it("round-trips a no-field error", () => {
      const original = new ScrapeJobTimeoutError("roundtrip msg");
      const Ctor = original.constructor as typeof TransportableError;
      const data = original.serialize();
      const restored = Ctor.deserialize("SCRAPE_TIMEOUT", data);

      expect(restored).toBeInstanceOf(ScrapeJobTimeoutError);
      expect(restored.code).toBe("SCRAPE_TIMEOUT");
      expect(restored.message).toBe("roundtrip msg");
      expect(restored.stack).toBe(original.stack);
    });

    it("round-trips an error with fields (CrawlDenialError)", () => {
      const original = new CrawlDenialError("spam-detected");
      const Ctor = original.constructor as typeof TransportableError;
      const data = original.serialize();
      const restored = Ctor.deserialize("CRAWL_DENIAL", data);

      expect(restored).toBeInstanceOf(CrawlDenialError);
      expect(restored.code).toBe("CRAWL_DENIAL");
      expect((restored as any).reason).toBe("spam-detected");
    });

    it("preserves stack across serialize/deserialize", () => {
      const original = new ScrapeJobTimeoutError("stack test");
      const originalStack = original.stack;
      const Ctor = original.constructor as typeof TransportableError;
      const data = original.serialize();
      const restored = Ctor.deserialize("SCRAPE_TIMEOUT", data);

      expect(restored.stack).toBe(originalStack);
      expect(typeof restored.stack).toBe("string");
      expect(restored.stack!.length).toBeGreaterThan(0);
    });
  });
});
