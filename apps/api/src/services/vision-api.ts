import { config } from "../config";
import type { Logger } from "winston";

/**
 * Vision API 公共客户端 — 供 PDF 图片描述和 web 页面图片 OCR 共用。
 * 接受 base64 + contentType，直接调 Anthropic Messages API 格式的 Vision 端点。
 */

// Guard：只需 VISION_API_URL + VISION_API_KEY 即可调用
export function isVisionApiConfigured(): boolean {
  return !!(config.VISION_API_URL && config.VISION_API_KEY);
}

/**
 * 调 Vision API 描述单张图片（base64 输入）。
 * 未配置或调用失败时返回 null，不抛错。
 */
export async function describeImageBase64(
  base64: string,
  contentType: string,
  logger: Logger,
  prompt?: string,
): Promise<string | null> {
  if (!isVisionApiConfigured()) return null;

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    config.VISION_OCR_TIMEOUT,
  );

  try {
    const response = await fetch(
      `${config.VISION_API_URL}/v1/messages`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.VISION_API_KEY!,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: config.VISION_MODEL || "claude-sonnet-4-6",
          max_tokens: 512,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: contentType,
                    data: base64,
                  },
                },
                {
                  type: "text",
                  text:
                    prompt ||
                    config.VISION_OCR_PROMPT ||
                    "请描述这张图片的内容。如果是图表，请提取关键数据；如果是示意图，请说明其结构和含义。用中文回答。",
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const errText = await response.text();
      logger.warn(
        `Vision API error: ${response.status} ${errText.slice(0, 200)}`,
      );
      return null;
    }

    const result = (await response.json()) as {
      content?: { type: string; text: string }[];
    };

    const text = result.content?.find((c) => c.type === "text")?.text;
    return text?.trim() || null;
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logger.warn("Vision API timeout");
    } else {
      logger.warn(`Vision API error: ${(err as Error).message?.slice(0, 200)}`);
    }
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 批量描述图片，每 3 张并发，避免 rate limit。
 */
export async function describeImagesBatch(
  images: Array<{ base64: string; contentType: string }>,
  logger: Logger,
): Promise<(string | null)[]> {
  if (!isVisionApiConfigured() || images.length === 0) return [];

  const results: (string | null)[] = [];
  const chunkSize = 3;

  for (let i = 0; i < images.length; i += chunkSize) {
    const chunk = images.slice(i, i + chunkSize);
    const chunkResults = await Promise.all(
      chunk.map((img) =>
        describeImageBase64(img.base64, img.contentType, logger),
      ),
    );
    results.push(...chunkResults);
  }

  return results;
}
