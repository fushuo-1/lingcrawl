import { config } from "../../../config";
import { Logger } from "winston";

/**
 * Replace image URLs in Markdown with text descriptions from a vision model.
 * Only runs when VISION_OCR_ENABLED is true and a vision API is configured.
 */
export async function visionOcrMarkdown(
  markdown: string,
  logger: Logger,
): Promise<string> {
  if (!config.VISION_OCR_ENABLED || !config.VISION_API_URL || !config.VISION_API_KEY) {
    return markdown;
  }

  // Match markdown images: ![alt](url) — skip data URIs and empty URLs
  const imageRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
  const matches: { full: string; alt: string; url: string; index: number }[] = [];

  let match: RegExpExecArray | null;
  while ((match = imageRegex.exec(markdown)) !== null) {
    const url = match[2].trim();
    if (url.startsWith("data:") || url === "<Base64-Image-Removed>") continue;
    matches.push({ full: match[0], alt: match[1], url, index: match.index });
  }

  if (matches.length === 0) return markdown;

  logger.info(`Vision OCR: processing ${matches.length} image(s)`);

  // Process images concurrently (max 3 at a time to avoid rate limits)
  const results = await Promise.allSettled(
    chunk(matches, 3).map(chunk =>
      Promise.all(chunk.map(img => describeImage(img.url, logger))),
    ),
  );

  // Collect results in order
  const descriptions: (string | null)[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      descriptions.push(...result.value);
    }
  }

  // Replace images in markdown (reverse order to preserve indices)
  let output = markdown;
  for (let i = matches.length - 1; i >= 0; i--) {
    const desc = descriptions[i];
    if (!desc) continue;

    const img = matches[i];
    const altText = img.alt || "图片";
    const replacement = `![${altText}](${img.url})\n> 📷 ${desc}`;
    output = output.slice(0, img.index) + replacement + output.slice(img.index + img.full.length);
  }

  return output;
}

/**
 * Call vision model API to describe an image.
 * Uses Anthropic Messages API format.
 */
async function describeImage(
  imageUrl: string,
  logger: Logger,
): Promise<string | null> {
  try {
    // Download image and convert to base64
    const imageData = await downloadImageAsBase64(imageUrl);
    if (!imageData) return null;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.VISION_OCR_TIMEOUT);

    try {
      const response = await fetch(`${config.VISION_API_URL}/v1/messages`, {
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
                    media_type: imageData.contentType,
                    data: imageData.base64,
                  },
                },
                {
                  type: "text",
                  text: config.VISION_OCR_PROMPT,
                },
              ],
            },
          ],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errText = await response.text();
        logger.warn(`Vision OCR API error: ${response.status} ${errText.slice(0, 200)}`);
        return null;
      }

      const result = (await response.json()) as {
        content?: { type: string; text: string }[];
      };

      const text = result.content?.find(c => c.type === "text")?.text;
      return text?.trim() || null;
    } finally {
      clearTimeout(timeout);
    }
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      logger.warn(`Vision OCR timeout for image: ${imageUrl.slice(0, 100)}`);
    } else {
      logger.warn(`Vision OCR error for image: ${(err as Error).message?.slice(0, 200)}`);
    }
    return null;
  }
}

/**
 * Download an image and return as base64 with content type.
 */
async function downloadImageAsBase64(
  url: string,
): Promise<{ base64: string; contentType: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        },
        signal: controller.signal,
      });

      if (!response.ok) return null;

      const contentType = response.headers.get("content-type") || "image/jpeg";
      const buffer = Buffer.from(await response.arrayBuffer());

      // Skip very large images (>5MB)
      if (buffer.length > 5 * 1024 * 1024) return null;

      return {
        base64: buffer.toString("base64"),
        contentType: contentType.split(";")[0].trim(),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}
