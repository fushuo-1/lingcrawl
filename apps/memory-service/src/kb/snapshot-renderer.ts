/**
 * SnapshotRenderer — pure functions for rendering MCP Resource content.
 *
 * Renders knowledge-base note metadata into markdown tables and directory
 * trees for the `kb://recent` and `kb://index` resources.
 */
import type { NoteMeta } from "./index-store.js";

/**
 * Render a markdown table of the most recently updated notes.
 *
 * Output format:
 * ```
 * # Knowledge Base — Recent Notes
 *
 * | Path | Title | Tags | Updated |
 * |------|-------|------|---------|
 * | 调试经验/Docker/xxx.md | xxx | [调试经验, Docker] | 2026-06-22 |
 * ```
 */
export function renderRecent(notes: NoteMeta[]): string {
  if (notes.length === 0) {
    return "# Knowledge Base — Recent Notes\n\nNo notes yet.";
  }

  const lines: string[] = [
    "# Knowledge Base — Recent Notes",
    "",
    "| Path | Title | Tags | Updated |",
    "|------|-------|------|---------|",
  ];

  for (const note of notes) {
    const tagStr =
      note.tags.length > 0
        ? `[${note.tags.join(", ")}]`
        : "—";
    const updated = formatUnixDate(note.updatedAt);
    lines.push(`| ${note.path} | ${note.title} | ${tagStr} | ${updated} |`);
  }

  return lines.join("\n");
}

/**
 * Render a directory tree of all notes grouped by path segments.
 *
 * Output format:
 * ```
 * # Knowledge Base — Index
 *
 * ## 调试经验/
 * - Docker/
 *   - 构建后磁盘膨胀.md
 *   - 容器网络不通.md
 * - TypeScript/
 *   - 类型体操.md
 *
 * ## 技术知识/
 * ...
 * ```
 */
export function renderIndex(notes: NoteMeta[]): string {
  if (notes.length === 0) {
    return "# Knowledge Base — Index\n\nNo notes yet.";
  }

  // Build a tree structure from paths
  const tree = buildTree(notes);

  const lines: string[] = ["# Knowledge Base — Index", ""];
  renderTreeLevel(tree, lines, 0);

  return lines.join("\n");
}

/* ---- Internal helpers ---- */

interface TreeNode {
  children: Map<string, TreeNode>;
  /** Non-null means this node is a leaf note file. */
  notePath: string | null;
}

function buildTree(notes: NoteMeta[]): TreeNode {
  const root: TreeNode = { children: new Map(), notePath: null };

  for (const note of notes) {
    const segments = note.path.split(/[\\/]/);
    let current = root;

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      const isLeaf = i === segments.length - 1;

      if (!current.children.has(seg)) {
        current.children.set(seg, {
          children: new Map(),
          notePath: null,
        });
      }
      const child = current.children.get(seg)!;

      if (isLeaf) {
        child.notePath = note.path;
      }
      current = child;
    }
  }

  return root;
}

function renderTreeLevel(
  node: TreeNode,
  lines: string[],
  depth: number,
): void {
  // Sort: directories first (nodes with children), then files; alphabetical within each group
  const entries = [...node.children.entries()].sort(([aName, aNode], [bName, bNode]) => {
    const aIsDir = aNode.children.size > 0;
    const bIsDir = bNode.children.size > 0;
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return aName.localeCompare(bName);
  });

  for (const [name, child] of entries) {
    const indent = "  ".repeat(depth);
    const hasChildren = child.children.size > 0;

    if (hasChildren) {
      // Directory node: render as heading (depth 0 → ##) or indented bullet
      if (depth === 0) {
        lines.push(`## ${name}/`);
      } else {
        lines.push(`${indent}- ${name}/`);
      }
      renderTreeLevel(child, lines, depth + 1);
      // Add blank line between top-level directories
      if (depth === 0) {
        lines.push("");
      }
    } else {
      // Leaf file
      lines.push(`${indent}- ${name}`);
    }
  }
}

/** Convert unix seconds to YYYY-MM-DD. */
function formatUnixDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10);
}
