/**
 * Vision API 集成测试
 *
 * 测试 vision-api.ts 的核心逻辑，mock fetch 调用。
 * 不依赖 @lingcrawl/lingcrawl-rs，可在本地直接运行。
 */

// Mock config 模块，避免加载 .env 和原生模块
jest.mock("../../config", () => ({
  config: {
    VISION_API_URL: "https://vision.example.com",
    VISION_API_KEY: "test-key-123",
    VISION_MODEL: "test-model",
    VISION_OCR_TIMEOUT: 10000,
    VISION_OCR_PROMPT: undefined,
  },
}));

import type { Logger } from "winston";
import {
  isVisionApiConfigured,
  describeImageBase64,
  describeImagesBatch,
} from "../../services/vision-api";

const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn(),
} as unknown as Logger;

describe("Vision API", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    (mockLogger.info as jest.Mock).mockClear();
    (mockLogger.warn as jest.Mock).mockClear();
  });

  // ── isVisionApiConfigured ────────────────────────────────────────────────

  describe("isVisionApiConfigured", () => {
    it("should return true when URL and Key are both set", () => {
      expect(isVisionApiConfigured()).toBe(true);
    });
  });

  // ── describeImageBase64 ──────────────────────────────────────────────────

  describe("describeImageBase64", () => {
    it("should return description on success", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "这是一张柱状图" }],
        }),
      } as any);

      const result = await describeImageBase64(
        "iVBORw0KGgo=",
        "image/png",
        mockLogger,
      );

      expect(result).toBe("这是一张柱状图");
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // 验证请求参数
      const call = (globalThis.fetch as jest.Mock).mock.calls[0];
      expect(call[0]).toBe("https://vision.example.com/v1/messages");
      expect(call[1].method).toBe("POST");
      expect(call[1].headers["x-api-key"]).toBe("test-key-123");
      expect(call[1].headers["anthropic-version"]).toBe("2023-06-01");

      const body = JSON.parse(call[1].body);
      expect(body.model).toBe("test-model");
      expect(body.max_tokens).toBe(512);
      expect(body.messages[0].content[0].type).toBe("image");
      expect(body.messages[0].content[0].source.type).toBe("base64");
      expect(body.messages[0].content[0].source.data).toBe("iVBORw0KGgo=");
      expect(body.messages[0].content[0].source.media_type).toBe("image/png");
      expect(body.messages[0].content[1].type).toBe("text");
    });

    it("should use custom prompt when provided", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "ok" }],
        }),
      } as any);

      await describeImageBase64(
        "dGVzdA==",
        "image/jpeg",
        mockLogger,
        "提取图表数据",
      );

      const body = JSON.parse(
        (globalThis.fetch as jest.Mock).mock.calls[0][1].body,
      );
      expect(body.messages[0].content[1].text).toBe("提取图表数据");
    });

    it("should return null on HTTP error", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "Rate limited",
      } as any);

      const result = await describeImageBase64(
        "dGVzdA==",
        "image/png",
        mockLogger,
      );

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("429"),
      );
    });

    it("should return null on network error", async () => {
      jest
        .spyOn(globalThis, "fetch")
        .mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await describeImageBase64(
        "dGVzdA==",
        "image/png",
        mockLogger,
      );

      expect(result).toBeNull();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining("ECONNREFUSED"),
      );
    });

    it("should return null when response has no text content", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({ content: [{ type: "image", source: {} }] }),
      } as any);

      const result = await describeImageBase64(
        "dGVzdA==",
        "image/png",
        mockLogger,
      );

      expect(result).toBeNull();
    });
  });

  // ── describeImagesBatch ──────────────────────────────────────────────────

  describe("describeImagesBatch", () => {
    it("should return empty array for empty input", async () => {
      const result = await describeImagesBatch([], mockLogger);
      expect(result).toEqual([]);
    });

    it("should process single image", async () => {
      jest.spyOn(globalThis, "fetch").mockResolvedValue({
        ok: true,
        json: async () => ({
          content: [{ type: "text", text: "描述1" }],
        }),
      } as any);

      const result = await describeImagesBatch(
        [{ base64: "aW1nMQ==", contentType: "image/png" }],
        mockLogger,
      );

      expect(result).toEqual(["描述1"]);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("should batch 7 images into chunks of 3", async () => {
      let callCount = 0;
      jest.spyOn(globalThis, "fetch").mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: `desc-${callCount}` }],
          }),
        } as any;
      });

      const images = Array.from({ length: 7 }, (_, i) => ({
        base64: `aW1n${i}`,
        contentType: "image/png",
      }));

      const result = await describeImagesBatch(images, mockLogger);

      expect(result).toHaveLength(7);
      expect(result.every((r) => r !== null)).toBe(true);
      expect(callCount).toBe(7);
    });

    it("should handle partial failures gracefully", async () => {
      jest
        .spyOn(globalThis, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "desc-A" }],
          }),
        } as any)
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Server error",
        } as any)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            content: [{ type: "text", text: "desc-C" }],
          }),
        } as any);

      const result = await describeImagesBatch(
        [
          { base64: "aW1nMQ==", contentType: "image/png" },
          { base64: "aW1nMg==", contentType: "image/png" },
          { base64: "aW1nMw==", contentType: "image/png" },
        ],
        mockLogger,
      );

      expect(result).toHaveLength(3);
      expect(result[0]).toBe("desc-A");
      expect(result[1]).toBeNull(); // failed
      expect(result[2]).toBe("desc-C");
    });
  });
});
