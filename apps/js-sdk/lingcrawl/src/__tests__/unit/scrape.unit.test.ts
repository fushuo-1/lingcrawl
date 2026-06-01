/**
 * Minimal unit test for v2 scrape (no mocking; sanity check payload path)
 */
import { LingCrawlClient } from "../../../v2/client";

describe("v2.scrape unit", () => {
  test("constructor requires apiKey", () => {
    expect(() => new LingCrawlClient({ apiKey: "", apiUrl: "https://api.lingcrawl.dev" })).toThrow();
  });
});

