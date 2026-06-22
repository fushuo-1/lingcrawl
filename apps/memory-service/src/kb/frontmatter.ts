/**
 * FrontmatterParser — parse/serialize YAML frontmatter in Markdown notes.
 *
 * No external dependencies; hand-rolls a minimal YAML parser for the
 * constrained frontmatter format we use (tags list, created/updated dates).
 */
export interface Frontmatter {
  tags: string[];
  created: string; // ISO 8601
  updated: string; // ISO 8601
}

export interface ParsedNote {
  frontmatter: Frontmatter;
  body: string; // content without frontmatter
}

const FM_DELIMITER = "---";

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Parse a simple YAML list: `[a, b, c]` or `- a\n- b`.
 * Returns an array of trimmed strings; ignores empty entries.
 */
function parseYamlList(raw: string): string[] {
  const trimmed = raw.trim();
  // Inline list: [a, b, c]
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((s) => s.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  // Block list: - item
  return trimmed
    .split("\n")
    .map((line) => line.replace(/^\s*-\s*/, "").trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

/**
 * Parse a single YAML key-value line. Returns `[key, value]` or null.
 */
function parseYamlLine(line: string): [string, string] | null {
  const match = line.match(/^(\w+)\s*:\s*(.*)$/);
  if (!match) return null;
  return [match[1], match[2].trim()];
}

export function parse(markdown: string): ParsedNote {
  const text = markdown.replace(/^﻿/, ""); // strip BOM
  const lines = text.split("\n");

  // Must start with opening delimiter
  if (lines[0]?.trim() !== FM_DELIMITER) {
    return {
      frontmatter: { tags: [], created: nowISO(), updated: nowISO() },
      body: text,
    };
  }

  // Find closing delimiter
  let closeIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === FM_DELIMITER) {
      closeIndex = i;
      break;
    }
  }

  if (closeIndex === -1) {
    // No closing delimiter — treat entire text as body
    return {
      frontmatter: { tags: [], created: nowISO(), updated: nowISO() },
      body: text,
    };
  }

  const fmLines = lines.slice(1, closeIndex);
  const body = lines.slice(closeIndex + 1).join("\n");

  // Parse frontmatter fields
  const fm: Record<string, string> = {};
  let currentKey: string | null = null;
  let multilineValue: string[] = [];

  for (const line of fmLines) {
    // If we're collecting a multiline value (block list)
    if (currentKey && line.match(/^\s+-\s/)) {
      multilineValue.push(line);
      continue;
    }
    // Flush multiline
    if (currentKey && multilineValue.length > 0) {
      fm[currentKey] = multilineValue.join("\n");
      currentKey = null;
      multilineValue = [];
    }

    const kv = parseYamlLine(line);
    if (kv) {
      const [key, value] = kv;
      // Check if value is empty (multiline list follows)
      if (value === "" || value === "[]") {
        currentKey = key;
        multilineValue = [];
        if (value === "[]") {
          fm[key] = "[]";
          currentKey = null;
        }
      } else {
        fm[key] = value;
      }
    }
  }
  // Flush remaining multiline
  if (currentKey && multilineValue.length > 0) {
    fm[currentKey] = multilineValue.join("\n");
  }

  const tags = fm.tags ? parseYamlList(fm.tags) : [];
  const created = fm.created?.replace(/^["']|["']$/g, "") || nowISO();
  const updated = fm.updated?.replace(/^["']|["']$/g, "") || nowISO();

  return {
    frontmatter: { tags, created, updated },
    body,
  };
}

export function serialize(frontmatter: Frontmatter, body: string): string {
  const tagsYaml =
    frontmatter.tags.length > 0
      ? `[${frontmatter.tags.join(", ")}]`
      : "[]";

  const fm = [
    FM_DELIMITER,
    `tags: ${tagsYaml}`,
    `created: ${frontmatter.created}`,
    `updated: ${frontmatter.updated}`,
    FM_DELIMITER,
  ].join("\n");

  // Ensure body starts with a newline after closing delimiter
  const bodyContent = body.startsWith("\n") ? body : `\n${body}`;
  return `${fm}${bodyContent}`;
}
