import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

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
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(url.toString(), { headers });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status}: ${body}`);
  }
  return res.json();
}

export function registerGithubReadTool(server: McpServer) {
  server.tool(
    "github_read",
    "Read files and directory listings from a GitHub repository. Provide a repo URL to list its root, or add a file path to read file content.",
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
        const apiPath = path
          ? `/repos/${owner}/${repo}/contents/${path}`
          : `/repos/${owner}/${repo}/contents/`;

        const data = await githubFetch(apiPath, ref);

        if (!Array.isArray(data)) {
          const content = data.content
            ? Buffer.from(data.content, "base64").toString("utf-8")
            : null;

          const text = [
            `**File**: ${data.path}`,
            `**Size**: ${data.size} bytes`,
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

        const text = `**Directory**: ${path || "/"} (${data.length} items)\n\n${tree}`;
        return { content: [{ type: "text" as const, text }] };
      } catch (e: any) {
        const msg = e.message || String(e);
        if (msg.includes("404")) {
          return {
            content: [{ type: "text" as const, text: `Error: Repository or path not found. Check the URL and path.` }],
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
