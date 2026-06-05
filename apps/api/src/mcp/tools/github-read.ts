import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  parseGitHubUrl,
  fetchRawFile,
  fetchDirectory,
  githubApiFetch,
  type DirEntry,
} from "../../lib/github-fetch.js";

export function registerGithubReadTool(server: McpServer) {
  server.tool(
    "github_read",
    "Read files and directory listings from a GitHub repository. Uses raw.githubusercontent.com for files and GitHub web UI for directories — no API rate limits for public repos. Provide a repo URL to list its root, or add a file path to read file content.",
    {
      repoUrl: z.string().url().describe("GitHub repository URL (e.g. https://github.com/owner/repo)"),
      path: z.string().optional().describe("File or directory path within the repo"),
      ref: z.string().optional().describe("Branch, tag, or commit SHA to read from"),
    },
    async ({ repoUrl, path, ref }) => {
      try {
        const parsed = parseGitHubUrl(repoUrl);
        if (!parsed) {
          return {
            content: [{ type: "text" as const, text: "Error: Invalid GitHub URL. Expected format: https://github.com/owner/repo" }],
          };
        }

        const { owner, repo } = parsed;

        // --- Read file (try raw first, fallback to API) ---
        if (path && !path.endsWith("/")) {
          try {
            const content = await fetchRawFile(owner, repo, ref, path);
            const text = [
              `**File**: ${path}`,
              `**Source**: raw.githubusercontent.com (no API limit)`,
              "",
              "```",
              content || "(empty file)",
              "```",
            ].join("\n");
            return { content: [{ type: "text" as const, text }] };
          } catch {
            // Fallback to API
            const apiPath = `/repos/${owner}/${repo}/contents/${path}`;
            const data = await githubApiFetch(apiPath, ref);
            const content = data.content
              ? Buffer.from(data.content, "base64").toString("utf-8")
              : null;

            const text = [
              `**File**: ${data.path}`,
              `**Size**: ${data.size} bytes`,
              `**Source**: GitHub API (fallback)`,
              "",
              "```",
              content ?? "(binary or empty file)",
              "```",
            ].join("\n");
            return { content: [{ type: "text" as const, text }] };
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
          const tree = entries
            .map((e) => `${e.type === "dir" ? "📁" : "📄"} ${e.path}`)
            .join("\n");
          const text = `**Directory**: ${dirPath || "/"} (${entries.length} items)\n**Source**: GitHub web UI (no API limit)\n\n${tree}`;
          return { content: [{ type: "text" as const, text }] };
        } catch {
          // Fallback to API
          const apiPath = dirPath
            ? `/repos/${owner}/${repo}/contents/${dirPath}`
            : `/repos/${owner}/${repo}/contents/`;
          const data = await githubApiFetch(apiPath, ref);

          if (!Array.isArray(data)) {
            const content = data.content
              ? Buffer.from(data.content, "base64").toString("utf-8")
              : null;
            const text = [
              `**File**: ${data.path}`,
              `**Size**: ${data.size} bytes`,
              `**Source**: GitHub API (fallback)`,
              "",
              "```",
              content ?? "(binary or empty file)",
              "```",
            ].join("\n");
            return { content: [{ type: "text" as const, text }] };
          }

          const tree = data
            .map((item: any) => `${item.type === "dir" ? "📁" : "📄"} ${item.path}`)
            .join("\n");
          const text = `**Directory**: ${dirPath || "/"} (${data.length} items)\n**Source**: GitHub API (fallback)\n\n${tree}`;
          return { content: [{ type: "text" as const, text }] };
        }
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("404")) {
          return {
            content: [{ type: "text" as const, text: "Error: Repository or path not found. Check the URL and path." }],
          };
        }
        if (msg.includes("403") || msg.includes("rate limit")) {
          return {
            content: [{ type: "text" as const, text: "Error: GitHub API rate limit exceeded. Set GITHUB_TOKEN for higher limits." }],
          };
        }
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
        };
      }
    },
  );
}
