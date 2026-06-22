/**
 * Unit tests for `snapshot-renderer.ts` (issue #97).
 *
 * Pure-function tests — no database, no filesystem.
 */
import { renderRecent, renderIndex } from "../../snapshot-renderer.js";
import type { NoteMeta } from "../../index-store.js";

function makeNote(overrides: Partial<NoteMeta> & { path: string; title: string }): NoteMeta {
  return {
    id: 1,
    tags: [],
    createdAt: 1719000000, // 2024-06-22
    updatedAt: 1719000000,
    ...overrides,
  };
}

/* ----- renderRecent ----- */

describe("renderRecent", () => {
  it("returns empty-state message when no notes", () => {
    const result = renderRecent([]);
    expect(result).toContain("No notes yet");
    expect(result).toContain("Knowledge Base — Recent Notes");
  });

  it("renders a single note in table format", () => {
    const notes = [
      makeNote({
        path: "AI/test.md",
        title: "Test Note",
        tags: ["AI"],
        updatedAt: 1719100000,
      }),
    ];
    const result = renderRecent(notes);
    expect(result).toContain("# Knowledge Base — Recent Notes");
    expect(result).toContain("| Path | Title | Tags | Updated |");
    expect(result).toContain("| AI/test.md | Test Note | [AI] |");
    // 1719100000 seconds = 2024-06-22T16:26:40Z
    expect(result).toContain("2024-06-22");
  });

  it("renders multiple notes", () => {
    const notes = [
      makeNote({
        path: "AI/a.md",
        title: "A",
        tags: ["AI", "NLP"],
        updatedAt: 1719200000,
      }),
      makeNote({
        path: "dev/b.md",
        title: "B",
        tags: [],
        updatedAt: 1719100000,
      }),
    ];
    const result = renderRecent(notes);
    expect(result).toContain("| AI/a.md | A | [AI, NLP] |");
    expect(result).toContain("| dev/b.md | B | — |");
  });

  it("uses em dash for notes with no tags", () => {
    const notes = [
      makeNote({ path: "x.md", title: "X", tags: [] }),
    ];
    const result = renderRecent(notes);
    expect(result).toContain("—");
  });
});

/* ----- renderIndex ----- */

describe("renderIndex", () => {
  it("returns empty-state message when no notes", () => {
    const result = renderIndex([]);
    expect(result).toContain("No notes yet");
    expect(result).toContain("Knowledge Base — Index");
  });

  it("renders a flat list of files in one directory", () => {
    const notes = [
      makeNote({ path: "AI/alpha.md", title: "Alpha" }),
      makeNote({ path: "AI/beta.md", title: "Beta" }),
    ];
    const result = renderIndex(notes);
    expect(result).toContain("## AI/");
    expect(result).toContain("- alpha.md");
    expect(result).toContain("- beta.md");
  });

  it("renders nested directories", () => {
    const notes = [
      makeNote({ path: "调试经验/Docker/构建后磁盘膨胀.md", title: "构建后磁盘膨胀" }),
      makeNote({ path: "调试经验/Docker/容器网络不通.md", title: "容器网络不通" }),
      makeNote({ path: "调试经验/TypeScript/类型体操.md", title: "类型体操" }),
    ];
    const result = renderIndex(notes);

    // Top-level directory
    expect(result).toContain("## 调试经验/");
    // Sub-directories
    expect(result).toContain("- Docker/");
    expect(result).toContain("- TypeScript/");
    // Files
    expect(result).toContain("  - 构建后磁盘膨胀.md");
    expect(result).toContain("  - 容器网络不通.md");
    expect(result).toContain("  - 类型体操.md");
  });

  it("renders multiple top-level directories sorted alphabetically", () => {
    const notes = [
      makeNote({ path: "Z-dir/z.md", title: "Z" }),
      makeNote({ path: "A-dir/a.md", title: "A" }),
    ];
    const result = renderIndex(notes);

    const aIdx = result.indexOf("## A-dir/");
    const zIdx = result.indexOf("## Z-dir/");
    expect(aIdx).toBeGreaterThanOrEqual(0);
    expect(zIdx).toBeGreaterThanOrEqual(0);
    expect(aIdx).toBeLessThan(zIdx);
  });

  it("handles mixed directory and file nodes at the same level", () => {
    const notes = [
      makeNote({ path: "root-file.md", title: "Root File" }),
      makeNote({ path: "sub/nested.md", title: "Nested" }),
    ];
    const result = renderIndex(notes);
    expect(result).toContain("## sub/");
    expect(result).toContain("- nested.md");
    expect(result).toContain("- root-file.md");
  });
});
