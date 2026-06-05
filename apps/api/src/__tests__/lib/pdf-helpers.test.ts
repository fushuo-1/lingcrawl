import {
  shouldParsePDF,
  getPDFMaxPages,
  getPDFMode,
  getPDFPages,
  getPDFIncludeTables,
  getPDFIncludeImages,
  needsPdfjsEngine,
} from "../../controllers/helpers/pdf";
import type { Parsers } from "../../controllers/schemas/common";

describe("pdf helpers (controllers/helpers/pdf.ts)", () => {
  describe("shouldParsePDF", () => {
    it("returns true when no parsers specified (default = pdf)", () => {
      expect(shouldParsePDF(undefined)).toBe(true);
    });

    it("returns true for .pdf URLs via array entry", () => {
      // The function takes Parsers[], not URLs directly. Verify when
      // "pdf" is present in the parsers array, returns true.
      const parsers: Parsers = ["pdf"];
      expect(shouldParsePDF(parsers)).toBe(true);
    });

    it("returns true when parsers contains an object with type=pdf", () => {
      const parsers: Parsers = [{ type: "pdf" }];
      expect(shouldParsePDF(parsers)).toBe(true);
    });

    it("returns false when parsers does not include pdf", () => {
      const parsers: Parsers = [];
      expect(shouldParsePDF(parsers)).toBe(false);
    });
  });

  describe("getPDFMaxPages", () => {
    it("returns undefined when no parsers", () => {
      expect(getPDFMaxPages(undefined)).toBeUndefined();
    });

    it("returns undefined when no PDF parser present", () => {
      expect(getPDFMaxPages([])).toBeUndefined();
    });

    it("returns maxPages from PDF parser object", () => {
      const parsers: Parsers = [{ type: "pdf", maxPages: 25 }];
      expect(getPDFMaxPages(parsers)).toBe(25);
    });

    it("returns undefined when PDF parser has no maxPages set", () => {
      const parsers: Parsers = [{ type: "pdf" }];
      expect(getPDFMaxPages(parsers)).toBeUndefined();
    });
  });

  describe("getPDFMode", () => {
    it('returns "auto" when no parsers', () => {
      expect(getPDFMode(undefined)).toBe("auto");
    });

    it('returns "auto" for string "pdf" entry', () => {
      const parsers: Parsers = ["pdf"];
      expect(getPDFMode(parsers)).toBe("auto");
    });

    it('returns "fast" when mode is "fast"', () => {
      const parsers: Parsers = [{ type: "pdf", mode: "fast" }];
      expect(getPDFMode(parsers)).toBe("fast");
    });

    it('returns "ocr" when mode is "ocr"', () => {
      const parsers: Parsers = [{ type: "pdf", mode: "ocr" }];
      expect(getPDFMode(parsers)).toBe("ocr");
    });

    it('returns "auto" when mode omitted on object', () => {
      const parsers: Parsers = [{ type: "pdf" }];
      expect(getPDFMode(parsers)).toBe("auto");
    });
  });

  describe("getPDFPages", () => {
    it("returns undefined when no parsers", () => {
      expect(getPDFPages(undefined)).toBeUndefined();
    });

    it("returns undefined when no pages specified", () => {
      const parsers: Parsers = [{ type: "pdf" }];
      expect(getPDFPages(parsers)).toBeUndefined();
    });

    it("returns pages string from PDF parser", () => {
      const parsers: Parsers = [{ type: "pdf", pages: "1-5,10" }];
      expect(getPDFPages(parsers)).toBe("1-5,10");
    });

    it("returns single page string", () => {
      const parsers: Parsers = [{ type: "pdf", pages: "3" }];
      expect(getPDFPages(parsers)).toBe("3");
    });
  });

  describe("getPDFIncludeTables", () => {
    it("returns false when no parsers", () => {
      expect(getPDFIncludeTables(undefined)).toBe(false);
    });

    it("returns false when not specified", () => {
      const parsers: Parsers = [{ type: "pdf" }];
      expect(getPDFIncludeTables(parsers)).toBe(false);
    });

    it("returns true when includeTables is true", () => {
      const parsers: Parsers = [{ type: "pdf", includeTables: true }];
      expect(getPDFIncludeTables(parsers)).toBe(true);
    });

    it("returns false when includeTables is explicitly false", () => {
      const parsers: Parsers = [{ type: "pdf", includeTables: false }];
      expect(getPDFIncludeTables(parsers)).toBe(false);
    });
  });

  describe("getPDFIncludeImages", () => {
    it("returns false when no parsers", () => {
      expect(getPDFIncludeImages(undefined)).toBe(false);
    });

    it("returns false when not specified", () => {
      const parsers: Parsers = [{ type: "pdf" }];
      expect(getPDFIncludeImages(parsers)).toBe(false);
    });

    it("returns true when includeImages is true", () => {
      const parsers: Parsers = [{ type: "pdf", includeImages: true }];
      expect(getPDFIncludeImages(parsers)).toBe(true);
    });

    it("returns false when includeImages is explicitly false", () => {
      const parsers: Parsers = [{ type: "pdf", includeImages: false }];
      expect(getPDFIncludeImages(parsers)).toBe(false);
    });
  });

  describe("needsPdfjsEngine", () => {
    it("returns false when no parsers", () => {
      expect(needsPdfjsEngine(undefined)).toBe(false);
    });

    it("returns false for basic PDF parsing (no pages/tables/images)", () => {
      const parsers: Parsers = [{ type: "pdf", mode: "fast" }];
      expect(needsPdfjsEngine(parsers)).toBe(false);
    });

    it("returns true when pages is specified", () => {
      const parsers: Parsers = [{ type: "pdf", pages: "1-5" }];
      expect(needsPdfjsEngine(parsers)).toBe(true);
    });

    it("returns true when includeTables is true", () => {
      const parsers: Parsers = [{ type: "pdf", includeTables: true }];
      expect(needsPdfjsEngine(parsers)).toBe(true);
    });

    it("returns true when includeImages is true", () => {
      const parsers: Parsers = [{ type: "pdf", includeImages: true }];
      expect(needsPdfjsEngine(parsers)).toBe(true);
    });

    it("returns true when all features are enabled", () => {
      const parsers: Parsers = [
        { type: "pdf", pages: "1-10", includeTables: true, includeImages: true },
      ];
      expect(needsPdfjsEngine(parsers)).toBe(true);
    });
  });
});
