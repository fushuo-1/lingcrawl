import { Request, Response } from "express";
import { logger as _logger } from "../../lib/logger";

interface GitHubReadRequest {
  url: string;
  path?: string;
  ref?: string;
}

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
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

async function githubFetch(path: string, ref?: string) {
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

export async function githubReadController(
  req: Request<{}, any, GitHubReadRequest>,
  res: Response,
) {
  const logger = _logger.child({
    method: "githubReadController",
  });

  const { url, path, ref } = req.body;

  if (!url) {
    return res.status(400).json({
      success: false,
      error: "url is required",
    });
  }

  const parsed = parseGitHubUrl(url);
  if (!parsed) {
    return res.status(400).json({
      success: false,
      error: "Invalid GitHub URL. Expected format: https://github.com/owner/repo",
    });
  }

  const { owner, repo } = parsed;
  const apiPath = path
    ? `/repos/${owner}/${repo}/contents/${path}`
    : `/repos/${owner}/${repo}/contents/`;

  try {
    const data = await githubFetch(apiPath, ref);

    // If path points to a single file
    if (!Array.isArray(data)) {
      const content = data.content
        ? Buffer.from(data.content, "base64").toString("utf-8")
        : null;

      return res.status(200).json({
        success: true,
        data: {
          type: "file",
          name: data.name,
          path: data.path,
          size: data.size,
          content,
          sha: data.sha,
          url: data.html_url,
        },
      });
    }

    // If path points to a directory (or repo root)
    const tree = data.map((item: any) => ({
      name: item.name,
      path: item.path,
      type: item.type, // "file" or "dir"
      size: item.size,
      sha: item.sha,
      url: item.html_url,
    }));

    return res.status(200).json({
      success: true,
      data: {
        type: "directory",
        path: path || "/",
        tree,
        count: tree.length,
      },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logger.error("GitHub read failed", { error, owner, repo, path });

    if (error.includes("404")) {
      return res.status(404).json({
        success: false,
        error: `Repository or path not found: ${owner}/${repo}${path ? "/" + path : ""}`,
      });
    }

    if (error.includes("403") || error.includes("rate limit")) {
      return res.status(429).json({
        success: false,
        error: "GitHub API rate limit exceeded. Set GITHUB_TOKEN for higher limits.",
      });
    }

    return res.status(500).json({
      success: false,
      error: `GitHub API error: ${error}`,
    });
  }
}
