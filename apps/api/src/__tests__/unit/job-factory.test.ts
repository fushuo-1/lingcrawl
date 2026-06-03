jest.mock("uuid", () => ({
  v7: jest.fn(() => "test-uuid-00000000-0000-0000-0000-000000000000"),
}));

import { buildSyncScrapeJob } from "../../services/job-factory";

describe("buildSyncScrapeJob", () => {
  const minimalScrapeOptions = { formats: [{ type: "markdown" as const }] } as any;

  it("builds a job with defaults for a basic scrape", () => {
    const job = buildSyncScrapeJob({
      url: "https://example.com",
      scrapeOptions: minimalScrapeOptions,
    });

    // NuQJob shell
    expect(job.id).toBe("test-uuid-00000000-0000-0000-0000-000000000000");
    expect(job.status).toBe("active");
    expect(job.createdAt).toBeInstanceOf(Date);
    expect(job.priority).toBe(10);

    // Data
    expect(job.data.url).toBe("https://example.com");
    expect(job.data.mode).toBe("single_urls");
    expect(job.data.team_id).toBe("local");
    expect(job.data.scrapeOptions).toBe(minimalScrapeOptions);
    expect(job.data.skipNuq).toBe(true);
    expect(job.data.apiKeyId).toBeNull();
    expect(job.data.integration).toBeNull();
    expect(job.data.concurrencyLimited).toBe(false);
    expect(job.data.zeroDataRetention).toBe(false);
    expect(job.data.origin).toBe("api");

    // internalOptions
    const io = job.data.internalOptions!;
    expect(io.teamId).toBe("local");
    expect(io.bypassBilling).toBe(true);
    expect(io.zeroDataRetention).toBe(false);
    expect(io.teamFlags).toBeNull();
    expect(io.unnormalizedSourceURL).toBe("https://example.com");
  });

  it("applies all optional overrides", () => {
    const fixedTime = 1700000000000;
    const job = buildSyncScrapeJob({
      url: "https://example.com/page",
      scrapeOptions: minimalScrapeOptions,
      origin: "extract",
      integration: "sdk",
      startTime: fixedTime,
      zeroDataRetention: true,
      concurrencyLimited: true,
      unnormalizedSourceURL: "https://example.com/page?raw=true",
    });

    expect(job.data.origin).toBe("extract");
    expect(job.data.integration).toBe("sdk");
    expect(job.data.startTime).toBe(fixedTime);
    expect(job.data.zeroDataRetention).toBe(true);
    expect(job.data.concurrencyLimited).toBe(true);

    expect(job.data.internalOptions!.unnormalizedSourceURL).toBe(
      "https://example.com/page?raw=true",
    );
    expect(job.data.internalOptions!.zeroDataRetention).toBe(true);
  });

  it("returns correct job structure with all required fields", () => {
    const job = buildSyncScrapeJob({
      url: "https://example.com",
      scrapeOptions: minimalScrapeOptions,
    });

    // Verify top-level NuQJob shape
    expect(job).toHaveProperty("id");
    expect(job).toHaveProperty("status");
    expect(job).toHaveProperty("createdAt");
    expect(job).toHaveProperty("priority");
    expect(job).toHaveProperty("data");

    // Verify data shape
    expect(job.data).toHaveProperty("url");
    expect(job.data).toHaveProperty("mode");
    expect(job.data).toHaveProperty("team_id");
    expect(job.data).toHaveProperty("scrapeOptions");
    expect(job.data).toHaveProperty("internalOptions");
    expect(job.data).toHaveProperty("skipNuq");
    expect(job.data).toHaveProperty("origin");
    expect(job.data).toHaveProperty("integration");
    expect(job.data).toHaveProperty("startTime");
    expect(job.data).toHaveProperty("zeroDataRetention");
    expect(job.data).toHaveProperty("apiKeyId");
    expect(job.data).toHaveProperty("concurrencyLimited");

    // Verify internalOptions shape
    expect(job.data.internalOptions).toHaveProperty("teamId");
    expect(job.data.internalOptions).toHaveProperty("unnormalizedSourceURL");
    expect(job.data.internalOptions).toHaveProperty("bypassBilling");
    expect(job.data.internalOptions).toHaveProperty("zeroDataRetention");
    expect(job.data.internalOptions).toHaveProperty("teamFlags");
  });

  it("uses the url as unnormalizedSourceURL when not provided", () => {
    const job = buildSyncScrapeJob({
      url: "https://example.com/path?q=1",
      scrapeOptions: minimalScrapeOptions,
    });

    expect(job.data.internalOptions!.unnormalizedSourceURL).toBe(
      "https://example.com/path?q=1",
    );
  });

  it("uses the provided jobId instead of generating one", () => {
    const job = buildSyncScrapeJob({
      url: "https://example.com",
      scrapeOptions: minimalScrapeOptions,
      jobId: "custom-job-id-1234",
    });

    expect(job.id).toBe("custom-job-id-1234");
  });
});
