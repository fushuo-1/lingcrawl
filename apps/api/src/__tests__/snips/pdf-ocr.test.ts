import { config } from "../../config";
import { describeIf, itIf } from "../lib";
import { parseWithMinerU } from "../../scraper/scrapeURL/engines/pdf/mineru";
import { MinerUError } from "../../lib/error";
import path from "node:path";
import { existsSync } from "node:fs";

// Conditionally run MinerU tests only when token is configured
const hasMinerUToken = !!config.MINERU_API_TOKEN;
const scannedPdfPath = path.resolve(
  __dirname,
  "../fixtures/scanned-sample.pdf",
);
const hasFixture = existsSync(scannedPdfPath);

describe("PDF OCR via MinerU", () => {
  describeIf(hasMinerUToken && hasFixture)(
    "mode=ocr happy path (requires MINERU_API_TOKEN + fixture)",
    () => {
      it(
        "should return OCR markdown for scanned PDF with mode=ocr",
        async () => {
          const result = await parseWithMinerU(scannedPdfPath, {
            isOcr: true,
          });

          expect(result.markdown).toBeDefined();
          expect(result.markdown.length).toBeGreaterThan(0);
          // Tables array should exist (even if empty)
          expect(Array.isArray(result.tables)).toBe(true);
        },
        180_000, // MinerU can be slow
      );

      itIf(!!config.MINERU_API_TOKEN)(
        "should pass pageRanges to MinerU when specified",
        async () => {
          const result = await parseWithMinerU(scannedPdfPath, {
            isOcr: true,
            pageRanges: "1",
          });

          expect(result.markdown).toBeDefined();
          expect(result.markdown.length).toBeGreaterThan(0);
        },
        180_000,
      );
    },
  );

  describe("token/config missing (unit-level, no real API call)", () => {
    it("should throw MinerUError with MINERU_TOKEN_MISSING when token is not set", async () => {
      // Temporarily override config
      const originalToken = config.MINERU_API_TOKEN;
      const originalEnabled = config.MINERU_OCR_ENABLED;
      try {
        (config as any).MINERU_API_TOKEN = undefined;
        (config as any).MINERU_OCR_ENABLED = true;

        await expect(
          parseWithMinerU("/tmp/fake.pdf", { isOcr: true }),
        ).rejects.toThrow(MinerUError);

        try {
          await parseWithMinerU("/tmp/fake.pdf", { isOcr: true });
        } catch (err) {
          expect((err as MinerUError).code).toBe("MINERU_TOKEN_MISSING");
        }
      } finally {
        (config as any).MINERU_API_TOKEN = originalToken;
        (config as any).MINERU_OCR_ENABLED = originalEnabled;
      }
    });

    it("should throw MinerUError with MINERU_DISABLED when OCR is disabled", async () => {
      const originalEnabled = config.MINERU_OCR_ENABLED;
      try {
        (config as any).MINERU_OCR_ENABLED = false;

        await expect(
          parseWithMinerU("/tmp/fake.pdf", { isOcr: true }),
        ).rejects.toThrow(MinerUError);

        try {
          await parseWithMinerU("/tmp/fake.pdf", { isOcr: true });
        } catch (err) {
          expect((err as MinerUError).code).toBe("MINERU_DISABLED");
        }
      } finally {
        (config as any).MINERU_OCR_ENABLED = originalEnabled;
      }
    });
  });
});
