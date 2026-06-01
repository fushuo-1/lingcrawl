import { generateURLPermutations } from "./crawl-redis";

describe("generateURLPermutations", () => {
  it("generates permutations correctly", () => {
    const bareHttps = generateURLPermutations("https://lingcrawl.dev").map(
      x => x.href,
    );
    expect(bareHttps.length).toBe(16);
    expect(bareHttps.includes("https://lingcrawl.dev/")).toBe(true);
    expect(bareHttps.includes("https://lingcrawl.dev/index.html")).toBe(true);
    expect(bareHttps.includes("https://lingcrawl.dev/index.php")).toBe(true);
    expect(bareHttps.includes("https://www.lingcrawl.dev/")).toBe(true);
    expect(bareHttps.includes("https://www.lingcrawl.dev/index.html")).toBe(
      true,
    );
    expect(bareHttps.includes("https://www.lingcrawl.dev/index.php")).toBe(
      true,
    );
    expect(bareHttps.includes("http://lingcrawl.dev/")).toBe(true);
    expect(bareHttps.includes("http://lingcrawl.dev/index.html")).toBe(true);
    expect(bareHttps.includes("http://lingcrawl.dev/index.php")).toBe(true);
    expect(bareHttps.includes("http://www.lingcrawl.dev/")).toBe(true);
    expect(bareHttps.includes("http://www.lingcrawl.dev/index.html")).toBe(
      true,
    );
    expect(bareHttps.includes("http://www.lingcrawl.dev/index.php")).toBe(true);

    const bareHttp = generateURLPermutations("http://lingcrawl.dev").map(
      x => x.href,
    );
    expect(bareHttp.length).toBe(16);
    expect(bareHttp.includes("https://lingcrawl.dev/")).toBe(true);
    expect(bareHttp.includes("https://lingcrawl.dev/index.html")).toBe(true);
    expect(bareHttp.includes("https://lingcrawl.dev/index.php")).toBe(true);
    expect(bareHttp.includes("https://www.lingcrawl.dev/")).toBe(true);
    expect(bareHttp.includes("https://www.lingcrawl.dev/index.html")).toBe(
      true,
    );
    expect(bareHttp.includes("https://www.lingcrawl.dev/index.php")).toBe(true);
    expect(bareHttp.includes("http://lingcrawl.dev/")).toBe(true);
    expect(bareHttp.includes("http://lingcrawl.dev/index.html")).toBe(true);
    expect(bareHttp.includes("http://lingcrawl.dev/index.php")).toBe(true);
    expect(bareHttp.includes("http://www.lingcrawl.dev/")).toBe(true);
    expect(bareHttp.includes("http://www.lingcrawl.dev/index.html")).toBe(true);
    expect(bareHttp.includes("http://www.lingcrawl.dev/index.php")).toBe(true);

    const wwwHttps = generateURLPermutations("https://www.lingcrawl.dev").map(
      x => x.href,
    );
    expect(wwwHttps.length).toBe(16);
    expect(wwwHttps.includes("https://lingcrawl.dev/")).toBe(true);
    expect(wwwHttps.includes("https://lingcrawl.dev/index.html")).toBe(true);
    expect(wwwHttps.includes("https://lingcrawl.dev/index.php")).toBe(true);
    expect(wwwHttps.includes("https://www.lingcrawl.dev/")).toBe(true);
    expect(wwwHttps.includes("https://www.lingcrawl.dev/index.html")).toBe(
      true,
    );
    expect(wwwHttps.includes("https://www.lingcrawl.dev/index.php")).toBe(true);
    expect(wwwHttps.includes("http://lingcrawl.dev/")).toBe(true);
    expect(wwwHttps.includes("http://lingcrawl.dev/index.html")).toBe(true);
    expect(wwwHttps.includes("http://lingcrawl.dev/index.php")).toBe(true);
    expect(wwwHttps.includes("http://www.lingcrawl.dev/")).toBe(true);
    expect(wwwHttps.includes("http://www.lingcrawl.dev/index.html")).toBe(true);
    expect(wwwHttps.includes("http://www.lingcrawl.dev/index.php")).toBe(true);

    const wwwHttp = generateURLPermutations("http://www.lingcrawl.dev").map(
      x => x.href,
    );
    expect(wwwHttp.length).toBe(16);
    expect(wwwHttp.includes("https://lingcrawl.dev/")).toBe(true);
    expect(wwwHttp.includes("https://lingcrawl.dev/index.html")).toBe(true);
    expect(wwwHttp.includes("https://lingcrawl.dev/index.php")).toBe(true);
    expect(wwwHttp.includes("https://www.lingcrawl.dev/")).toBe(true);
    expect(wwwHttp.includes("https://www.lingcrawl.dev/index.html")).toBe(true);
    expect(wwwHttp.includes("https://www.lingcrawl.dev/index.php")).toBe(true);
    expect(wwwHttp.includes("http://lingcrawl.dev/")).toBe(true);
    expect(wwwHttp.includes("http://lingcrawl.dev/index.html")).toBe(true);
    expect(wwwHttp.includes("http://lingcrawl.dev/index.php")).toBe(true);
    expect(wwwHttp.includes("http://www.lingcrawl.dev/")).toBe(true);
    expect(wwwHttp.includes("http://www.lingcrawl.dev/index.html")).toBe(true);
    expect(wwwHttp.includes("http://www.lingcrawl.dev/index.php")).toBe(true);
  });
});
