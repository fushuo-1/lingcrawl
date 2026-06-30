/**
 * PathResolver — determines the file path for a knowledge-base note
 * based on its title and tags.
 */
import path from "node:path";

const CATEGORY_TAGS: Record<string, string> = {
  "调试经验": "调试经验",
  "技术知识": "技术知识",
  "嵌入式": "嵌入式",
  "FPGA": "FPGA",
  "AI": "AI",
  "项目": "项目",
  "学习笔记": "学习笔记",
  "随想": "随想",
  "投资": "投资",
};

const UNSAFE_CHARS = /[\\/:*?"<>|]/g;

export function sanitizeFilename(title: string): string {
  return title.replace(UNSAFE_CHARS, "").trim();
}

export function getDefaultCategory(): string {
  return "随想";
}

export function resolvePath(title: string, tags: string[]): string {
  // 1. Find first matching category tag
  let category: string | undefined;
  for (const tag of tags) {
    if (CATEGORY_TAGS[tag]) {
      category = CATEGORY_TAGS[tag];
      break;
    }
  }
  if (!category) {
    category = getDefaultCategory();
  }

  // 2. Sub-category from remaining non-category tags (first one)
  let subcategory: string | undefined;
  for (const tag of tags) {
    if (!CATEGORY_TAGS[tag]) {
      subcategory = tag;
      break;
    }
  }

  // 3. Sanitize filename
  const filename = sanitizeFilename(title);
  const safeFilename = filename || "untitled";

  // 4. Build relative path
  if (subcategory) {
    return path.join(category, subcategory, `${safeFilename}.md`);
  }
  return path.join(category, `${safeFilename}.md`);
}
