import { Logger } from "winston";
import {
  isVisionApiConfigured,
  describeImageBase64,
} from "../../../services/vision-api";

/**
 * Replace image URLs in Markdown with text descriptions from a vision model.
 * Only runs when VISION_API_URL and VISION_API_KEY are configured.
 */
export async function visionOcrMarkdown(
  markdown: string,
  logger: Logger,
): Promise<string> {
  if (!isVisionApiConfigured()) {
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
 * 下载 URL 图片并调 Vision API 描述。
 */
async function describeImage(
  imageUrl: string,
  logger: Logger,
): Promise<string | null> {
  try {
    const imageData = await downloadImageAsBase64(imageUrl);
    if (!imageData) return null;
    return describeImageBase64(imageData.base64, imageData.contentType, logger);
  } catch (err) {
    logger.warn(`Vision OCR error for image: ${(err as Error).message?.slice(0, 200)}`);
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
