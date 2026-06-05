import { Request, Response } from "../lib/express-types";
import { logger as _logger } from "../lib/logger";
import { withErrorHandler } from "./error-wrapper";
import {
  parseGitHubUrl,
  fetchRawFile,
  fetchDirectory,
  githubApiFetch,
  type DirEntry,
} from "../lib/github-fetch";

interface GitHubReadRequest {
  url: string;
  path?: string;
  ref?: string;
}

export const githubReadController = withErrorHandler(async (
  req: Request<{}, any, GitHubReadRequest>,
  res: Response,
) => {
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

  try {
    // --- Read file (try raw first, fallback to API) ---
    if (path && !path.endsWith("/")) {
      try {
        const content = await fetchRawFile(owner, repo, ref, path);
        return res.status(200).json({
          success: true,
          data: {
            type: "file",
            name: path.split("/").pop(),
            path,
            content,
            url: `https://github.com/${owner}/${repo}/blob/${ref ?? "main"}/${path}`,
          },
        });
      } catch (rawErr) {
        logger.info("Raw file fetch failed, falling back to API", {
          error: rawErr instanceof Error ? rawErr.message : String(rawErr),
        });
        // Fallback to API
        const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
        const data = await githubApiFetch(apiPath, ref);
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
    }

    // --- List directory (try HTML parsing first, fallback to API) ---
    const dirPath = path?.replace(/\/$/, "");
    try {
      const entries: DirEntry[] = await fetchDirectory(
        owner,
        repo,
        ref,
        dirPath || undefined,
      );
      return res.status(200).json({
        success: true,
        data: {
          type: "directory",
          path: dirPath || "/",
          tree: entries.map((e) => ({
            name: e.name,
            path: e.path,
            type: e.type,
            url: `https://github.com/${owner}/${repo}/${e.type === "dir" ? "tree" : "blob"}/${ref ?? "main"}/${e.path}`,
          })),
          count: entries.length,
        },
      });
    } catch (htmlErr) {
      logger.info("HTML directory fetch failed, falling back to API", {
        error: htmlErr instanceof Error ? htmlErr.message : String(htmlErr),
      });
      // Fallback to API
      const apiPath = dirPath
        ? `/repos/${owner}/${repo}/contents/${dirPath}`
        : `/repos/${owner}/${repo}/contents/`;
      const data = await githubApiFetch(apiPath, ref);

      if (!Array.isArray(data)) {
        return res.status(200).json({
          success: true,
          data: {
            type: "file",
            name: data.name,
            path: data.path,
            size: data.size,
            content: data.content
              ? Buffer.from(data.content, "base64").toString("utf-8")
              : null,
            sha: data.sha,
            url: data.html_url,
          },
        });
      }

      const tree = data.map((item: any) => ({
        name: item.name,
        path: item.path,
        type: item.type,
        size: item.size,
        sha: item.sha,
        url: item.html_url,
      }));

      return res.status(200).json({
        success: true,
        data: {
          type: "directory",
          path: dirPath || "/",
          tree,
          count: tree.length,
        },
      });
    }
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
});
