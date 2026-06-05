/**
 * Smoke test: extract a local PDF using the same code path as the pdf engine.
 * Run: pnpm --filter @lingcrawl/api exec tsx scripts/test-local-pdf.ts <path>
 */
import { extractWithPdfjs } from "../src/scraper/scrapeURL/engines/pdf/pdfjsExtract";
import { statSync } from "node:fs";
import { resolve } from "node:path";

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("usage: tsx scripts/test-local-pdf.ts <path-to-pdf>");
    process.exit(2);
  }

  const filePath = resolve(arg);
  const stat = statSync(filePath);
  console.log(`[info] file: ${filePath}`);
  console.log(`[info] size: ${stat.size} bytes`);

  const started = Date.now();
  const result = await extractWithPdfjs(filePath, {
    maxPages: 5,
    includeTables: true,
    includeImages: false,
  });
  const ms = Date.now() - started;

  console.log(`[ok]   parsed in ${ms} ms`);
  console.log(`[meta] pages=${result.enhancedMetadata?.pageCount} title=${result.enhancedMetadata?.title ?? "(none)"}`);
  console.log(`[md]   length=${result.markdown?.length ?? 0} chars`);
  console.log(`[tbl]  tables=${result.tables?.length ?? 0}`);
  console.log("--- markdown preview (first 800 chars) ---");
  console.log((result.markdown ?? "").slice(0, 800));
}

main().catch(err => {
  console.error("[fail]", err);
  process.exit(1);
});
