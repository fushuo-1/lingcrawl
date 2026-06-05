jest.mock("uuid", () => ({
  v7: jest.fn(() => "job-1"),
}));

import { scrapeSearchResults } from "./scrape";
import { processJobInternal } from "../services/worker/scrape-worker";

jest.mock("../services/worker/scrape-worker", () => ({
  processJobInternal: jest.fn().mockResolvedValue({
    markdown: "body",
    metadata: { creditsUsed: 1, statusCode: 200, proxyUsed: "basic" },
  }),
}));

describe("scrapeSearchResults", () => {
  it("spawns scrape jobs with correct options", async () => {
    await scrapeSearchResults(
      [
        {
          url: "https://example.com",
          title: "Example",
          description: "Desc",
        },
      ],
      {
        teamId: "team-1",
        origin: "api",
        timeout: 60_000,
        scrapeOptions: {} as any,
        apiKeyId: 123,
        requestId: "req-1",
        bypassBilling: true,
      },
      { debug: jest.fn(), info: jest.fn(), error: jest.fn() } as any,
      null as any,
    );

    expect(processJobInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          url: "https://example.com",
        }),
      }),
    );
  });
});
