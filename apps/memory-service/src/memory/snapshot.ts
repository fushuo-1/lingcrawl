/**
 * SnapshotRenderer — pure functions that turn `MemoryEntry[]` + `Usage` into
 * the markdown body of the MCP `memory://notes` and `memory://user` resources.
 *
 * The renderer is intentionally side-effect free:
 *   - No IO, no Date.now(), no Math.random()
 *   - `takenAt` is the caller-supplied ISO-8601 / formatted timestamp; the
 *     resource provider is responsible for capturing "now" once per session
 *     and threading the same string into both resources so the prefix cache
 *     stays stable.
 *
 * Stable contract — see PRD #65 §3 (Resource Rendering Format) and issue #71.
 */
import type { MemoryEntry, Usage } from "./types.js";

/* -------------------------------------------------------------------------- */
/*                                Internals                                   */
/* -------------------------------------------------------------------------- */

/** Format the `[pct% — used/limit chars]` capacity bar. The em-dash and
 *  locale-grouped numbers match the PRD example exactly. */
function formatCapacityBar(usage: Usage): string {
  const used = usage.used.toLocaleString("en-US");
  const limit = usage.limit.toLocaleString("en-US");
  return `[${usage.pct}% — ${used}/${limit} chars]`;
}

/** A `<Section Name>: ` prefix designates the entry's section.
 *  Returns `null` when the content is unprefixed (renderer falls back to
 *  `## General`). The trailing colon+space is required to avoid mistaking
 *  prose for a section tag. */
const SECTION_PREFIX_RE = /^([A-Z][A-Za-z0-9 &/'-]{0,40}):\s/;

function splitSection(content: string): { section: string; body: string } {
  const m = SECTION_PREFIX_RE.exec(content);
  if (!m) return { section: "General", body: content };
  return { section: m[1], body: content.slice(m[0].length) };
}

/** Group entries by section. Sections are returned in alphabetical order
 *  (stable across renders — good for prefix-cache hits). Entries within a
 *  section are sorted by `id` ASC so insertion order is preserved. */
function groupBySection(
  entries: MemoryEntry[],
): Array<{ section: string; entries: MemoryEntry[] }> {
  const buckets = new Map<string, MemoryEntry[]>();
  for (const e of entries) {
    const { section, body } = splitSection(e.content);
    // The section prefix is stripped from the body before rendering; the
    // entry's `id` is preserved so we can sort by insertion order below.
    (buckets.get(section) ?? buckets.set(section, []).get(section)!).push({
      ...e,
      content: body,
    });
  }
  const sections = Array.from(buckets.keys()).sort((a, b) =>
    a.localeCompare(b),
  );
  return sections.map((section) => ({
    section,
    entries: (buckets.get(section) ?? []).sort((a, b) => a.id - b.id),
  }));
}

/** Append the constant header (`# Title`, blank, capacity bar, blank, `---`,
 *  blank) shared by both resources. The `---` here is the H1↔body divider. */
function pushHeader(lines: string[], title: string, bar: string): void {
  lines.push(`# ${title}`, "", bar, "", "---", "");
}

/** Append the constant footer: blank, `---`, blank, snapshot line. The
 *  `---` here is the body↔footer divider. */
function pushFooter(lines: string[], takenAt: string): void {
  lines.push("", "---", "", `*Snapshot taken at session start: ${takenAt}*`);
}

/* -------------------------------------------------------------------------- */
/*                                 Public API                                 */
/* -------------------------------------------------------------------------- */

/**
 * Render the `memory://notes` resource body. Entries whose content starts
 * with `<Section Name>: ` are grouped under `## <Section Name>`; everything
 * else falls into `## General`. Sections are sorted alphabetically;
 * entries within a section are sorted by `id` ASC.
 */
export function renderNotes(
  entries: MemoryEntry[],
  usage: Usage,
  takenAt: string,
): string {
  const lines: string[] = [];
  pushHeader(lines, "Agent's Personal Notes", formatCapacityBar(usage));

  if (entries.length === 0) {
    lines.push("_Empty — no entries yet._");
  } else {
    for (const g of groupBySection(entries)) {
      lines.push(`## ${g.section}`);
      for (const e of g.entries) {
        lines.push(e.content, "");
      }
    }
    // Drop the trailing blank the last entry left behind, replace with `---`.
    lines.pop();
  }

  pushFooter(lines, takenAt);
  return lines.join("\n");
}

/**
 * Render the `memory://user` resource body. User profile facts are
 * typically few, so we don't group them — entries are listed in `id` ASC
 * order and separated by a `---` divider.
 */
export function renderUserProfile(
  entries: MemoryEntry[],
  usage: Usage,
  takenAt: string,
): string {
  const lines: string[] = [];
  pushHeader(lines, "User Profile", formatCapacityBar(usage));

  if (entries.length === 0) {
    lines.push("_Empty — no entries yet._");
  } else {
    const sorted = [...entries].sort((a, b) => a.id - b.id);
    for (let i = 0; i < sorted.length; i++) {
      if (i > 0) lines.push("", "---", "");
      lines.push(sorted[i].content);
    }
  }

  pushFooter(lines, takenAt);
  return lines.join("\n");
}
