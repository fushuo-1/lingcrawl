import { TextEncoder } from "node:util";

// ── Mocks ─────────────────────────────────────────────────────────────────────

const mockConfig: Record<string, unknown> = {
  MINERU_API_TOKEN: "test-token",
  MINERU_API_URL: "https://mineru.test/api/v4",
  MINERU_OCR_ENABLED: true,
  MINERU_OCR_TIMEOUT: 10000,
  MINERU_MODEL_VERSION: "vlm",
  MINERU_LANGUAGE: "ch",
};

jest.mock("../../config", () => ({
  get config() {
    return mockConfig;
  },
}));

// Keep a reference to the global fetch so we can spy on it
const mockFetch = jest.fn();
(globalThis as any).fetch = mockFetch;

// Mock fs/promises readFile
jest.mock("node:fs/promises", () => ({
  readFile: jest.fn().mockResolvedValue(Buffer.from("%PDF-1.4 fake")),
}));

import {
  mapContentListToTables,
  parseWithMinerU,
  type ContentListItem,
} from "../../scraper/scrapeURL/engines/pdf/mineru";
import {
  MinerUError,
} from "../../lib/error";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeZipBuffer(files: Record<string, string>): Buffer {
  // We'll mock JSZip at module level — for parseWithMinerU tests we need
  // a different approach. We use a minimal in-memory zip mock.
  // Actually, we need to produce a real-ish JSZip compatible object.
  // Since JSZip is loaded at module scope in mineru.ts, we mock it.
  throw new Error("use mock JSZip instead");
}

// We need to mock JSZip so loadAsync returns our test data.
const mockZipFiles: Record<string, string> = {};
jest.mock("jszip", () => {
  return class MockJSZip {
    static async loadAsync(_buffer: Buffer) {
      const instance = new MockJSZip();
      return instance;
    }
    file(pattern: RegExp) {
      const matches: Array<{ async: (type: string) => Promise<string> }> = [];
      for (const [name, content] of Object.entries(mockZipFiles)) {
        if (pattern.test(name)) {
          matches.push({
            async: () => Promise.resolve(content),
          });
        }
      }
      return matches;
    }
  };
});

// ── mapContentListToTables tests ──────────────────────────────────────────────

describe("mapContentListToTables", () => {
  it("maps table items with table_body HTML", () => {
    const items: ContentListItem[] = [
      {
        type: "table",
        table_body:
          "<table><tr><th>Name</th><th>Age</th></tr><tr><td>Alice</td><td>30</td></tr></table>",
      },
    ];

    const result = mapContentListToTables(items);

    expect(result).toHaveLength(1);
    expect(result[0].page).toBe(0);
    expect(result[0].tableIndex).toBe(0);
    expect(result[0].rows).toEqual([
      ["Name", "Age"],
      ["Alice", "30"],
    ]);
    expect(result[0].rowCount).toBe(2);
    expect(result[0].colCount).toBe(2);
    expect(result[0].confidence).toBe(1.0);
  });

  it("returns empty array for empty input", () => {
    expect(mapContentListToTables([])).toEqual([]);
  });

  it("ignores non-table type items", () => {
    const items: ContentListItem[] = [
      { type: "text", text: "hello" },
      { type: "image", img_path: "/img.png" },
      {
        type: "table",
        table_body: "<table><tr><td>x</td></tr></table>",
      },
    ];

    const result = mapContentListToTables(items);
    expect(result).toHaveLength(1);
  });

  it("skips table items missing table_body", () => {
    const items: ContentListItem[] = [
      { type: "table" },
      {
        type: "table",
        table_body: "<table><tr><td>ok</td></tr></table>",
      },
    ];

    const result = mapContentListToTables(items);
    expect(result).toHaveLength(1);
    expect(result[0].rows).toEqual([["ok"]]);
  });

  it("assigns incrementing tableIndex", () => {
    const items: ContentListItem[] = [
      {
        type: "table",
        table_body: "<table><tr><td>A</td></tr></table>",
      },
      {
        type: "text",
        text: "ignored",
      },
      {
        type: "table",
        table_body: "<table><tr><td>B</td></tr></table>",
      },
    ];

    const result = mapContentListToTables(items);
    expect(result).toHaveLength(2);
    expect(result[0].tableIndex).toBe(0);
    expect(result[1].tableIndex).toBe(1);
  });

  it("handles table with nested HTML in cells", () => {
    const items: ContentListItem[] = [
      {
        type: "table",
        table_body:
          "<table><tr><td><b>Bold</b> text</td><td><i>Italic</i></td></tr></table>",
      },
    ];

    const result = mapContentListToTables(items);
    expect(result[0].rows).toEqual([["Bold text", "Italic"]]);
  });
});

// ── parseWithMinerU tests ─────────────────────────────────────────────────────

describe("parseWithMinerU", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    // Reset config defaults
    mockConfig.MINERU_API_TOKEN = "test-token";
    mockConfig.MINERU_OCR_ENABLED = true;
    mockConfig.MINERU_OCR_TIMEOUT = 10000;
    // Reset zip mock files
    Object.keys(mockZipFiles).forEach((k) => delete mockZipFiles[k]);
  });

  it("throws MinerUDisabledError when MINERU_OCR_ENABLED is false", async () => {
    mockConfig.MINERU_OCR_ENABLED = false;

    await expect(
      parseWithMinerU("/tmp/test.pdf", { isOcr: true }),
    ).rejects.toThrow(MinerUError);

    try {
      await parseWithMinerU("/tmp/test.pdf", { isOcr: true });
    } catch (err) {
      expect((err as MinerUError).code).toBe("MINERU_DISABLED");
    }
  });

  it("throws MinerUTokenMissingError when token is not set", async () => {
    mockConfig.MINERU_API_TOKEN = undefined;

    await expect(
      parseWithMinerU("/tmp/test.pdf", { isOcr: true }),
    ).rejects.toThrow(MinerUError);

    try {
      await parseWithMinerU("/tmp/test.pdf", { isOcr: true });
    } catch (err) {
      expect((err as MinerUError).code).toBe("MINERU_TOKEN_MISSING");
    }
  });

  it("completes full happy path: submit -> poll -> download zip -> parse", async () => {
    // Set up zip mock content
    mockZipFiles["result/full.md"] = "# Title\n\nSome content";
    mockZipFiles["result/test_content_list.json"] = JSON.stringify([
      { type: "text", text: "intro" },
      {
        type: "table",
        table_body:
          "<table><tr><th>Col A</th><th>Col B</th></tr><tr><td>1</td><td>2</td></tr></table>",
      },
    ]);

    // Mock fetch calls in order:
    // 1. POST submit -> batch_id + file_url
    // 2. PUT upload -> 200
    // 3. GET poll (running) -> running
    // 4. GET poll (done) -> done + full_zip_url
    // 5. GET download zip -> zip buffer
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            batch_id: "batch-123",
            file_urls: ["https://upload.mineru.test/batch-123/test.pdf"],
          },
        }),
      })
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            extract_result: [{ state: "running" }],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            extract_result: [
              {
                state: "done",
                full_zip_url: "https://mineru.test/results/batch-123.zip",
              },
            ],
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0), // JSZip is mocked
      });

    const result = await parseWithMinerU("/tmp/test.pdf", { isOcr: true });

    expect(result.markdown).toBe("# Title\n\nSome content");
    expect(result.tables).toHaveLength(1);
    expect(result.tables[0].rows).toEqual([
      ["Col A", "Col B"],
      ["1", "2"],
    ]);

    // Verify fetch was called with correct args
    expect(mockFetch).toHaveBeenCalledTimes(5);

    // Submit call
    const submitCall = mockFetch.mock.calls[0];
    expect(submitCall[0]).toBe(
      "https://mineru.test/api/v4/file-urls/batch",
    );
    expect(submitCall[1].method).toBe("POST");
    const submitBody = JSON.parse(submitCall[1].body);
    expect(submitBody.is_ocr).toBe(true);
    expect(submitBody.model_version).toBe("vlm");
    expect(submitBody.language).toBe("ch");
    expect(submitBody.enable_table).toBe(true);
    expect(submitBody.enable_formula).toBe(true);
  });

  it("includes pageRanges in submit body when provided", async () => {
    mockZipFiles["full.md"] = "content";
    mockZipFiles["test_content_list.json"] = "[]";

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: { batch_id: "b1", file_urls: ["https://u"] },
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: { extract_result: [{ state: "done", full_zip_url: "https://z" }] },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => new ArrayBuffer(0),
      });

    await parseWithMinerU("/tmp/test.pdf", {
      isOcr: false,
      pageRanges: "1-3,5",
    });

    const submitBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(submitBody.files[0].page_ranges).toBe("1-3,5");
  });

  it("throws on MinerU failed state", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: { batch_id: "b1", file_urls: ["https://u"] },
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: {
            extract_result: [
              { state: "failed", err_msg: "corrupted PDF" },
            ],
          },
        }),
      });

    await expect(
      parseWithMinerU("/tmp/test.pdf", { isOcr: true }),
    ).rejects.toThrow(/corrupted PDF/);
  });

  it("throws on polling timeout", async () => {
    mockConfig.MINERU_OCR_TIMEOUT = 100; // very short timeout

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          code: 0,
          data: { batch_id: "b1", file_urls: ["https://u"] },
        }),
      })
      .mockResolvedValueOnce({ ok: true })
      // All subsequent polls return "running"
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          code: 0,
          data: { extract_result: [{ state: "running" }] },
        }),
      });

    await expect(
      parseWithMinerU("/tmp/test.pdf", { isOcr: true }),
    ).rejects.toThrow(/timed out/);
  });
});
