import path from "node:path";
import { resolvePath, sanitizeFilename, getDefaultCategory } from "../../path-resolver.js";

describe("path-resolver", () => {
  describe("sanitizeFilename", () => {
    it("removes unsafe filesystem characters", () => {
      expect(sanitizeFilename('file\\/:*?"<>|name')).toBe("filename");
    });

    it("trims whitespace", () => {
      expect(sanitizeFilename("  hello  ")).toBe("hello");
    });

    it("preserves Chinese characters", () => {
      expect(sanitizeFilename("我的笔记")).toBe("我的笔记");
    });

    it("preserves spaces", () => {
      expect(sanitizeFilename("my note title")).toBe("my note title");
    });
  });

  describe("getDefaultCategory", () => {
    it("returns '随想'", () => {
      expect(getDefaultCategory()).toBe("随想");
    });
  });

  describe("resolvePath", () => {
    it("uses matching category tag as directory", () => {
      const p = resolvePath("Test Note", ["AI", "其他"]);
      expect(p).toMatch(/^AI[/\\]/);
      expect(p).toMatch(/Test Note\.md$/);
    });

    it("uses first non-category tag as subdirectory", () => {
      const p = resolvePath("Test Note", ["技术知识", "机器学习"]);
      expect(p).toMatch(/^技术知识[/\\]机器学习[/\\]Test Note\.md$/);
    });

    it("defaults to '随想' when no category tag matches", () => {
      const p = resolvePath("Random Note", ["生活"]);
      expect(p).toMatch(/^随想[/\\]/);
    });

    it("defaults to '随想' when tags are empty", () => {
      const p = resolvePath("Note", []);
      expect(p).toBe(`随想${path.sep}Note.md`);
    });

    it("sanitizes title for filename", () => {
      const p = resolvePath('What is FPGA?', ["FPGA"]);
      expect(p).toContain("What is FPGA.md");
    });

    it("uses 'untitled' when title is all unsafe chars", () => {
      const p = resolvePath("\\/:*?", ["AI"]);
      expect(p).toContain("untitled.md");
    });

    it("picks first matching category when multiple categories present", () => {
      const p = resolvePath("Note", ["FPGA", "AI"]);
      expect(p).toMatch(/^FPGA[/\\]/);
    });

    it("ignores category tags when looking for subcategory", () => {
      const p = resolvePath("Note", ["AI", "FPGA", "自定义"]);
      // "AI" is the first category tag → directory
      // "FPGA" is also a category tag → skipped for subcategory
      // "自定义" is not a category → subcategory
      expect(p).toMatch(/^AI[/\\]自定义[/\\]Note\.md$/);
    });
  });
});
