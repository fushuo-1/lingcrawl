/**
 * GitHub repository reader — no API rate limits for public repos.
 *
 * Strategy:
 *   - Files: fetch raw content from raw.githubusercontent.com (virtually unlimited)
 *   - Directories: parse GitHub web UI HTML (virtually unlimited)
 *   - Fallback: GitHub REST API (60/hr without token, 5000/hr with token)
 */

// ---------------------------------------------------------------------------
// URL parsing
// ---------------------------------------------------------------------------

export function parseGitHubUrl(
  url: string,
): { owner: string; repo: string } | null {
  try {
    const u = new URL(url);
    if (u.hostname !== "github.com") return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DirEntry {
  name: string;
  path: string;
  type: "file" | "dir";
}

// ---------------------------------------------------------------------------
// 1. Raw file — raw.githubusercontent.com (no rate limit)
// ---------------------------------------------------------------------------

export async function fetchRawFile(
  owner: string,
  repo: string,
  ref: string | undefined,
  path: string,
): Promise<string> {
  const branch = ref ?? "main";
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;
  const res = await fetch(url, {
    headers: { "User-Agent": "LingCrawl" },
  });
  if (!res.ok) {
    throw new Error(`raw.githubusercontent.com ${res.status}`);
  }
  return res.text();
}

// ---------------------------------------------------------------------------
// 2. Directory listing — parse GitHub web UI HTML (no rate limit)
// ---------------------------------------------------------------------------

export async function fetchDirectory(
  owner: string,
  repo: string,
  ref: string | undefined,
  path?: string,
): Promise<DirEntry[]> {
  const branch = ref ?? "main";
  const url = path
    ? `https://github.com/${owner}/${repo}/tree/${branch}/${path}`
    : `https://github.com/${owner}/${repo}/tree/${branch}`;

  const res = await fetch(url, {
    headers: {
      "User-Agent": "LingCrawl",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`GitHub web ${res.status}`);
  }
  const html = await res.text();
  return parseGitHubTreeHtml(html, owner, repo, branch, path);
}

/**
 * Parse the HTML of a GitHub tree page to extract file/directory entries.
 *
 * GitHub's React-based UI embeds data in <react-partial> script tags or
 * in <a> tags within the file list. We use a robust regex approach that
 * works with the current HTML structure.
 */
function parseGitHubTreeHtml(
  html: string,
  owner: string,
  repo: string,
  branch: string,
  basePath?: string,
): DirEntry[] {
  const entries: DirEntry[] = [];
  const seen = new Set<string>();

  // Pattern 1: Links in the file browser table
  // Matches: href="/owner/repo/tree/branch/path" (directories)
  //          href="/owner/repo/blob/branch/path" (files)
  const prefix = `/${owner}/${repo}/`;
  const treePrefix = `${prefix}tree/${branch}/`;
  const blobPrefix = `${prefix}blob/${branch}/`;

  // Regex for tree (directory) links
  const treeRegex = new RegExp(
    `href="${escapeRegex(treePrefix)}([^"]+)"`,
    "g",
  );
  // Regex for blob (file) links
  const blobRegex = new RegExp(
    `href="${escapeRegex(blobPrefix)}([^"]+)"`,
    "g",
  );

  // Extract directories
  for (const match of html.matchAll(treeRegex)) {
    const filePath = decodeURIComponent(match[1]);
    // Only take direct children (no nested paths with /)
    const relativePath = basePath
      ? filePath.slice(basePath.length).replace(/^\//, "")
      : filePath;
    if (!relativePath || relativePath.includes("/")) continue;
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    entries.push({
      name: relativePath,
      path: filePath,
      type: "dir",
    });
  }

  // Extract files
  for (const match of html.matchAll(blobRegex)) {
    const filePath = decodeURIComponent(match[1]);
    const relativePath = basePath
      ? filePath.slice(basePath.length).replace(/^\//, "")
      : filePath;
    if (!relativePath || relativePath.includes("/")) continue;
    if (seen.has(filePath)) continue;
    seen.add(filePath);
    entries.push({
      name: relativePath,
      path: filePath,
      type: "file",
    });
  }

  // Pattern 2: Fallback — look for React payload JSON
  if (entries.length === 0) {
    // GitHub embeds payload in <script type="application/json" data-target="react-app.embeddedData">
    const jsonMatch = html.match(
      /<script[^>]*data-target="react-app.embeddedData"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (jsonMatch) {
      try {
        const payload = JSON.parse(jsonMatch[1]);
        const items =
          payload?.payload?.tree?.items ?? payload?.payload?.fileTree?.items;
        if (Array.isArray(items)) {
          for (const item of items) {
            entries.push({
              name: item.name ?? item.path,
              path: basePath
                ? `${basePath}/${item.name ?? item.path}`
                : (item.name ?? item.path),
              type: item.contentType === "directory" ? "dir" : "file",
            });
          }
        }
      } catch {
        // JSON parse failed, continue
      }
    }
  }

  return entries;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// 3. GitHub REST API fallback
// ---------------------------------------------------------------------------

export async function githubApiFetch(
  path: string,
  ref?: string,
): Promise<any> {
  const token = process.env.GITHUB_TOKEN;
  const url = new URL(`https://api.github.com${path}`);
  if (ref) url.searchParams.set("ref", ref);

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "LingCrawl",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res.json();
}
