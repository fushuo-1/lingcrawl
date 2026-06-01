import request from "supertest";
import { config } from "../../config";

const TEST_URL = "http://127.0.0.1:3002";

describe("E2E Tests for Map API Routes", () => {
  it.concurrent(
    "(feat-search)should return links containing 'smart-crawl'",
    async () => {
      const response = await request(TEST_URL)
        .post("/v1/map")
        .set("Authorization", `Bearer ${config.TEST_API_KEY}`)
        .set("Content-Type", "application/json")
        .send({
          url: "https://lingcrawl.dev",
          sitemapOnly: false,
          search: "smart-crawl",
        });

      console.log(response.body);
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty("links");
      expect(response.body.links.length).toBeGreaterThan(0);
      expect(response.body.links[0]).toContain("lingcrawl.dev/smart-crawl");
    },
    60000,
  );

  it.concurrent(
    "(feat-subdomains) should return mapped links for lingcrawl.dev with subdomains included",
    async () => {
      const response = await request(TEST_URL)
        .post("/v1/map")
        .set("Authorization", `Bearer ${config.TEST_API_KEY}`)
        .set("Content-Type", "application/json")
        .send({
          url: "https://lingcrawl.dev",
          sitemapOnly: false,
          includeSubdomains: true,
        });

      console.log(response.body);
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty("links");
      expect(response.body.links.length).toBeGreaterThan(0);
      expect(response.body.links[response.body.links.length - 1]).toContain(
        "docs.lingcrawl.dev",
      );
    },
    60000,
  );

  it.concurrent(
    "(feat-sitemap-only) should return mapped links for lingcrawl.dev with sitemap only",
    async () => {
      const response = await request(TEST_URL)
        .post("/v1/map")
        .set("Authorization", `Bearer ${config.TEST_API_KEY}`)
        .set("Content-Type", "application/json")
        .send({
          url: "https://lingcrawl.dev",
          sitemapOnly: true,
        });

      console.log(response.body);
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty("links");
      expect(response.body.links.length).toBeGreaterThan(0);
      expect(response.body.links[response.body.links.length - 1]).not.toContain(
        "docs.lingcrawl.dev",
      );
    },
    60000,
  );

  it.concurrent(
    "(feat-limit) should return mapped links for lingcrawl.dev with a limit",
    async () => {
      const response = await request(TEST_URL)
        .post("/v1/map")
        .set("Authorization", `Bearer ${config.TEST_API_KEY}`)
        .set("Content-Type", "application/json")
        .send({
          url: "https://lingcrawl.dev",
          sitemapOnly: false,
          limit: 10,
        });

      console.log(response.body);
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty("links");
      expect(response.body.links.length).toBeLessThanOrEqual(10);
    },
    60000,
  );

  it.concurrent(
    "(feat-sitemap-large) should return more than 1900 links for geekflare sitemap",
    async () => {
      const response = await request(TEST_URL)
        .post("/v1/map")
        .set("Authorization", `Bearer ${config.TEST_API_KEY}`)
        .set("Content-Type", "application/json")
        .send({
          url: "https://geekflare.com/sitemap_index.xml",
          sitemapOnly: true,
        });

      console.log(response.body);
      expect(response.statusCode).toBe(200);
      expect(response.body).toHaveProperty("links");
      expect(response.body.links.length).toBeGreaterThan(1900);
    },
    60000,
  );
});
