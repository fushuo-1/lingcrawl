/**
 * Unit tests for `memory/snapshot.ts` — the pure renderer for the
 * `memory://notes` and `memory://user` MCP resources.
 *
 * No IO, no Date.now(): every test passes an explicit `takenAt` so the
 * output is fully deterministic.
 */
import { renderNotes, renderUserProfile } from "../../../memory/snapshot.js";
import type { MemoryEntry, Usage } from "../../../memory/types.js";

/* ------------------------------ fixtures -------------------------------- */

const TS = "2026-06-08 14:23:01";

function entry(
  id: number,
  content: string,
  target: "memory" | "user" = "memory",
): MemoryEntry {
  return { id, target, content, createdAt: 1, updatedAt: 1 };
}

function usage(pct: number, used = 0, limit = 2200): Usage {
  return { target: "memory", used, limit, pct };
}

const userUsage = (pct: number, used = 0, limit = 1375): Usage => ({
  target: "user",
  used,
  limit,
  pct,
});

/* ---------------------------- renderNotes ------------------------------ */

describe("renderNotes — capacity bar", () => {
  it("formats the bar as `[pct% — used/limit chars]` with locale-grouped numbers", () => {
    const out = renderNotes([], usage(67, 1474, 2200), TS);
    expect(out).toContain("[67% — 1,474/2,200 chars]");
  });

  it("renders 0% with 0/limit when the store is empty", () => {
    const out = renderNotes([], usage(0, 0, 2200), TS);
    expect(out).toContain("[0% — 0/2,200 chars]");
  });

  it("renders 100% when at limit", () => {
    const out = renderNotes([], usage(100, 2200, 2200), TS);
    expect(out).toContain("[100% — 2,200/2,200 chars]");
  });

  it("renders values over 100% (over-limit) without clamping", () => {
    // Caller decides whether to reject over-limit writes; the renderer
    // just formats whatever the Usage says.
    const out = renderNotes([], usage(112, 2464, 2200), TS);
    expect(out).toContain("[112% — 2,464/2,200 chars]");
  });

  it("locale-groups numbers >= 1000 with a comma", () => {
    const out = renderNotes([], usage(50, 12345, 24690), TS);
    expect(out).toContain("[50% — 12,345/24,690 chars]");
  });
});

describe("renderNotes — empty state", () => {
  it("shows the empty placeholder when there are no entries", () => {
    const out = renderNotes([], usage(0, 0, 2200), TS);
    expect(out).toContain("_Empty — no entries yet._");
    // Still includes header, bar, divider, and snapshot footer.
    expect(out).toMatch(/^# Agent's Personal Notes/);
    expect(out).toContain("---");
    expect(out).toContain(
      `*Snapshot taken at session start: ${TS}*`,
    );
  });
});

describe("renderNotes — single entry", () => {
  it("renders one entry under ## General when it has no section prefix", () => {
    const e = entry(1, "single fact");
    const out = renderNotes([e], usage(0, 11, 2200), TS);
    expect(out).toContain("## General");
    expect(out).toContain("single fact");
    // Only one ## heading — the section — not the H1.
    expect((out.match(/^## /gm) ?? []).length).toBe(1);
  });
});

describe("renderNotes — section grouping", () => {
  it("groups entries with `<Section Name>: ` prefix under that section", () => {
    const out = renderNotes(
      [
        entry(1, "Project Conventions: uses pnpm"),
        entry(2, "Environment Facts: Windows 11"),
      ],
      usage(0, 0, 2200),
      TS,
    );
    expect(out).toContain("## Environment Facts");
    expect(out).toContain("Windows 11");
    expect(out).toContain("## Project Conventions");
    expect(out).toContain("uses pnpm");
  });

  it("sorts sections alphabetically regardless of entry order", () => {
    const out = renderNotes(
      [
        entry(1, "Project Conventions: a"),
        entry(2, "Environment Facts: b"),
        entry(3, "About Me: c"),
      ],
      usage(0, 0, 2200),
      TS,
    );
    const idxAbout = out.indexOf("## About Me");
    const idxEnv = out.indexOf("## Environment Facts");
    const idxProj = out.indexOf("## Project Conventions");
    expect(idxAbout).toBeGreaterThan(-1);
    expect(idxEnv).toBeGreaterThan(idxAbout);
    expect(idxProj).toBeGreaterThan(idxEnv);
  });

  it("sorts entries within a section by id ASC", () => {
    const out = renderNotes(
      [
        entry(7, "Project Conventions: seventh"),
        entry(2, "Project Conventions: second"),
        entry(5, "Project Conventions: fifth"),
      ],
      usage(0, 0, 2200),
      TS,
    );
    const second = out.indexOf("second");
    const fifth = out.indexOf("fifth");
    const seventh = out.indexOf("seventh");
    expect(second).toBeGreaterThan(-1);
    expect(fifth).toBeGreaterThan(second);
    expect(seventh).toBeGreaterThan(fifth);
  });

  it("routes unprefixed entries to ## General", () => {
    const out = renderNotes(
      [
        entry(1, "Project Conventions: pc"),
        entry(2, "loose fact"),
      ],
      usage(0, 0, 2200),
      TS,
    );
    expect(out).toContain("## General");
    expect(out).toContain("loose fact");
    expect(out).toContain("## Project Conventions");
    expect(out).toContain("pc");
  });

  it("strips the section prefix from the rendered body", () => {
    const out = renderNotes(
      [entry(1, "Project Conventions: the body")],
      usage(0, 0, 2200),
      TS,
    );
    // The rendered body should be the post-prefix text, not the prefix+body.
    expect(out).toContain("the body");
    expect(out).not.toContain("Project Conventions: the body");
  });
});

describe("renderNotes — multi-line content", () => {
  it("preserves a single newline inside an entry verbatim", () => {
    const e = entry(1, "line one\nline two");
    const out = renderNotes([e], usage(0, 0, 2200), TS);
    expect(out).toContain("line one\nline two");
  });

  it("preserves multiple newlines and trailing whitespace", () => {
    const e = entry(1, "a\nb\n\nc\n");
    const out = renderNotes([e], usage(0, 0, 2200), TS);
    expect(out).toContain("a\nb\n\nc\n");
  });

  it("preserves a newline inside a prefixed entry", () => {
    const e = entry(1, "Project Conventions: line1\nline2");
    const out = renderNotes([e], usage(0, 0, 2200), TS);
    expect(out).toContain("## Project Conventions");
    expect(out).toContain("line1\nline2");
  });
});

describe("renderNotes — scale", () => {
  it("renders ten entries without dropping or duplicating any body", () => {
    const entries: MemoryEntry[] = Array.from({ length: 10 }, (_, i) =>
      entry(i + 1, `fact ${i + 1}`),
    );
    const out = renderNotes(entries, usage(0, 0, 2200), TS);
    for (let i = 1; i <= 10; i++) {
      expect(out).toContain(`fact ${i}`);
    }
  });
});

describe("renderNotes — purity", () => {
  it("is referentially transparent: same input → identical output", () => {
    const entries = [
      entry(1, "Project Conventions: a"),
      entry(2, "Environment Facts: b"),
    ];
    const u = usage(0, 0, 2200);
    expect(renderNotes(entries, u, TS)).toBe(renderNotes(entries, u, TS));
  });

  it("does not mutate the input array or its entries", () => {
    const entries = [
      entry(1, "Project Conventions: a"),
      entry(2, "loose"),
    ];
    const snapshot = entries.map((e) => ({ ...e }));
    renderNotes(entries, usage(0, 0, 2200), TS);
    expect(entries).toEqual(snapshot);
  });
});

/* --------------------------- renderUserProfile -------------------------- */

describe("renderUserProfile — capacity bar", () => {
  it("uses the user limit (default 1375) in the formatted bar", () => {
    const out = renderUserProfile([], userUsage(0, 0, 1375), TS);
    expect(out).toContain("[0% — 0/1,375 chars]");
  });

  it("uses the user limit from Usage, not a hardcoded value", () => {
    const out = renderUserProfile([], userUsage(50, 500, 1000), TS);
    expect(out).toContain("[50% — 500/1,000 chars]");
  });
});

describe("renderUserProfile — empty state", () => {
  it("shows the empty placeholder when there are no entries", () => {
    const out = renderUserProfile([], userUsage(0, 0, 1375), TS);
    expect(out).toContain("_Empty — no entries yet._");
    expect(out).toContain(`*Snapshot taken at session start: ${TS}*`);
  });
});

describe("renderUserProfile — layout", () => {
  it("does NOT group entries into ## sections (uses --- dividers instead)", () => {
    const out = renderUserProfile(
      [
        entry(1, "Project Conventions: a"),
        entry(2, "Environment Facts: b"),
      ],
      userUsage(0, 0, 1375),
      TS,
    );
    // No section headers in the user profile.
    expect(out).not.toContain("## Project Conventions");
    expect(out).not.toContain("## Environment Facts");
    // Entries appear verbatim (prefix kept — we don't strip in the user view).
    expect(out).toContain("Project Conventions: a");
    expect(out).toContain("Environment Facts: b");
  });

  it("separates multiple entries with --- dividers", () => {
    const out = renderUserProfile(
      [entry(1, "first"), entry(2, "second")],
      userUsage(0, 0, 1375),
      TS,
    );
    // The H1, bar, and snapshot footer also have surrounding ---, so
    // count every horizontal-rule line.
    const rules = out.match(/^---$/gm) ?? [];
    // H1↔body (1) + entry1↔entry2 (1) + body↔footer (1) = 3
    expect(rules.length).toBe(3);
  });

  it("lists entries in id ASC order", () => {
    const out = renderUserProfile(
      [
        entry(5, "fifth"),
        entry(2, "second"),
        entry(9, "ninth"),
      ],
      userUsage(0, 0, 1375),
      TS,
    );
    const i2 = out.indexOf("second");
    const i5 = out.indexOf("fifth");
    const i9 = out.indexOf("ninth");
    expect(i2).toBeGreaterThan(-1);
    expect(i5).toBeGreaterThan(i2);
    expect(i9).toBeGreaterThan(i5);
  });

  it("preserves multi-line content verbatim", () => {
    const e = entry(1, "line one\nline two");
    const out = renderUserProfile([e], userUsage(0, 0, 1375), TS);
    expect(out).toContain("line one\nline two");
  });
});

describe("renderUserProfile — purity", () => {
  it("is referentially transparent", () => {
    const entries = [entry(1, "x"), entry(2, "y")];
    const u = userUsage(0, 0, 1375);
    expect(renderUserProfile(entries, u, TS)).toBe(
      renderUserProfile(entries, u, TS),
    );
  });
});
