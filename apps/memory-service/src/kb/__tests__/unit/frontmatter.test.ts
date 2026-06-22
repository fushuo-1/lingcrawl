import { parse, serialize } from "../../frontmatter.js";

describe("frontmatter", () => {
  describe("parse", () => {
    it("parses full frontmatter with inline tag list", () => {
      const md = `---
tags: [AI, 技术知识]
created: 2025-01-01T00:00:00.000Z
updated: 2025-06-01T12:00:00.000Z
---
Hello world`;
      const result = parse(md);
      expect(result.frontmatter.tags).toEqual(["AI", "技术知识"]);
      expect(result.frontmatter.created).toBe("2025-01-01T00:00:00.000Z");
      expect(result.frontmatter.updated).toBe("2025-06-01T12:00:00.000Z");
      expect(result.body).toBe("Hello world");
    });

    it("parses frontmatter with block list tags", () => {
      const md = `---
tags:
  - FPGA
  - 嵌入式
created: 2025-01-01T00:00:00.000Z
updated: 2025-06-01T12:00:00.000Z
---
Body text here`;
      const result = parse(md);
      expect(result.frontmatter.tags).toEqual(["FPGA", "嵌入式"]);
      expect(result.body).toBe("Body text here");
    });

    it("handles empty tags list", () => {
      const md = `---
tags: []
created: 2025-01-01T00:00:00.000Z
updated: 2025-06-01T12:00:00.000Z
---
Content`;
      const result = parse(md);
      expect(result.frontmatter.tags).toEqual([]);
      expect(result.body).toBe("Content");
    });

    it("returns defaults when no frontmatter present", () => {
      const md = "Just plain markdown";
      const result = parse(md);
      expect(result.frontmatter.tags).toEqual([]);
      expect(result.frontmatter.created).toBeTruthy();
      expect(result.frontmatter.updated).toBeTruthy();
      expect(result.body).toBe("Just plain markdown");
    });

    it("returns defaults when frontmatter has no closing delimiter", () => {
      const md = `---
tags: [AI]
unclosed`;
      const result = parse(md);
      expect(result.frontmatter.tags).toEqual([]);
      expect(result.body).toBe(md);
    });

    it("strips BOM if present", () => {
      const md = `﻿---
tags: [AI]
created: 2025-01-01T00:00:00.000Z
updated: 2025-01-01T00:00:00.000Z
---
Body`;
      const result = parse(md);
      expect(result.frontmatter.tags).toEqual(["AI"]);
      expect(result.body).toBe("Body");
    });
  });

  describe("serialize", () => {
    it("produces valid frontmatter with tags", () => {
      const result = serialize(
        {
          tags: ["AI", "FPGA"],
          created: "2025-01-01T00:00:00.000Z",
          updated: "2025-06-01T12:00:00.000Z",
        },
        "Hello world",
      );
      expect(result).toContain("---");
      expect(result).toContain("tags: [AI, FPGA]");
      expect(result).toContain("created: 2025-01-01T00:00:00.000Z");
      expect(result).toContain("Hello world");

      // Round-trip
      const parsed = parse(result);
      expect(parsed.frontmatter.tags).toEqual(["AI", "FPGA"]);
      expect(parsed.body.trim()).toBe("Hello world");
    });

    it("serializes empty tags as []", () => {
      const result = serialize(
        { tags: [], created: "2025-01-01T00:00:00.000Z", updated: "2025-01-01T00:00:00.000Z" },
        "Body",
      );
      expect(result).toContain("tags: []");
    });

    it("round-trips correctly", () => {
      const original = {
        tags: ["调试经验", "嵌入式"],
        created: "2025-03-15T08:00:00.000Z",
        updated: "2025-06-20T10:30:00.000Z",
      };
      const body = "# Title\n\nSome content with **bold** text.";
      const serialized = serialize(original, body);
      const parsed = parse(serialized);

      expect(parsed.frontmatter).toEqual(original);
      expect(parsed.body.trim()).toBe(body);
    });
  });
});
