// Smoke test for local PDF extraction inside the api container.
// Usage (inside container): node /tmp/test-local-pdf.js /tmp/sample.pdf
const path = require("node:path");
const { statSync } = require("node:fs");

(async () => {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: node test-local-pdf.js <pdf-path>");
    process.exit(2);
  }
  const filePath = path.resolve(arg);
  const stat = statSync(filePath);
  console.log(`[info] file: ${filePath}`);
  console.log(`[info] size: ${stat.size} bytes`);

  const { extractWithPdfjs } = require("/app/dist/src/scraper/scrapeURL/engines/pdf/pdfjsExtract.js");

  const started = Date.now();
  const result = await extractWithPdfjs(filePath, {
    maxPages: 3,
    includeTables: true,
    includeImages: false,
  });
  const ms = Date.now() - started;

  console.log(`[ok]   parsed in ${ms} ms`);
  console.log(`[meta] pages=${result.enhancedMetadata && result.enhancedMetadata.pageCount} title=${(result.enhancedMetadata && result.enhancedMetadata.title) || "(none)"}`);
  console.log(`[md]   length=${(result.markdown || "").length} chars`);
  console.log(`[tbl]  tables=${(result.tables || []).length}`);
  console.log("--- markdown preview (first 600 chars) ---");
  console.log((result.markdown || "").slice(0, 600));
})().catch(err => {
  console.error("[fail]", err && err.stack || err);
  process.exit(1);
});
