/**
 * MCP tool: `kb_staleness` — 扫描 & 归档过时金融记忆（issue #119 + #120）。
 *
 * scan:    扫描所有金融记忆的过时状态，返回 summary + details
 * archive: 对指定路径执行 Stage 1（软归档）或 Stage 2（硬归档）
 * cleanup: 清理孤立的金融索引记录（path 为 null 或指向不存在的笔记）
 */
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { KnowledgeStore } from "../../kb/knowledge-store.js";
import type { FinancialIndexStore } from "../../financial/financial-index-store.js";
import type { StalenessStage } from "../../financial/staleness.js";
import {
  parse as parseFrontmatter,
  serialize as serializeFrontmatter,
} from "../../kb/frontmatter.js";

/* ------------------------------------------------------------------ */
/*  辅助函数                                                            */
/* ------------------------------------------------------------------ */

/**
 * 计算硬归档目标路径：投资/_archived/YYYY-MM/<title>.md
 */
function archivePath(title: string): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return `投资/_archived/${ym}/${sanitizeFilename(title)}.md`;
}

/**
 * 将标题转为合法文件名（去除不安全字符）。
 */
function sanitizeFilename(title: string): string {
  return title
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

/* ------------------------------------------------------------------ */
/*  注册工具                                                            */
/* ------------------------------------------------------------------ */

export function registerKbStalenessTool(
  server: McpServer,
  knowledgeStore: KnowledgeStore,
  financialIndexStore: FinancialIndexStore,
): void {
  server.tool(
    "kb_staleness",
    "Scan and archive stale financial memories. " +
      "Use action='scan' to get a staleness report; " +
      "use action='archive' with paths to soft-archive (stale → mark stale: true) " +
      "or hard-archive (archived → move to _archived/YYYY-MM/); " +
      "use action='cleanup' to remove orphaned financial index records.",
    {
      action: z
        .enum(["scan", "archive", "cleanup"])
        .describe(
          "scan: 返回所有金融记忆的过时状态; archive: 对指定路径执行归档; cleanup: 清理孤立索引记录。",
        ),
      paths: z
        .array(z.string())
        .optional()
        .describe(
          "archive 操作时必须提供。要归档的笔记路径列表，如 ['投资/AAPL.md']。",
        ),
    },
    async ({ action, paths }) => {
      try {
        if (action === "scan") {
          return handleScan(financialIndexStore);
        }
        if (action === "cleanup") {
          return handleCleanup(financialIndexStore);
        }
        return handleArchive(knowledgeStore, financialIndexStore, paths);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [
            { type: "text" as const, text: `Error: kb_staleness: ${msg}` },
          ],
          isError: true,
        };
      }
    },
  );
}

/* ------------------------------------------------------------------ */
/*  scan 逻辑                                                           */
/* ------------------------------------------------------------------ */

function handleScan(financialIndexStore: FinancialIndexStore) {
  const items = financialIndexStore.scanStaleness();

  const summary = { active: 0, stale: 0, archived: 0 };
  for (const item of items) {
    summary[item.stage as keyof typeof summary]++;
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            items: items.map((i) => ({
              path: i.notePath,
              entity_type: i.entityType,
              ticker: i.ticker,
              updated_at: i.updatedAt,
              days_stale: i.daysStale,
              stage: i.stage,
            })),
            summary,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  cleanup 逻辑                                                        */
/* ------------------------------------------------------------------ */

function handleCleanup(financialIndexStore: FinancialIndexStore) {
  const removed = financialIndexStore.cleanupOrphans();

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(
          {
            success: true,
            removed,
            message: `已清理 ${removed} 条孤立的金融索引记录`,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/* ------------------------------------------------------------------ */
/*  archive 逻辑                                                        */
/* ------------------------------------------------------------------ */

interface ArchiveResult {
  path: string;
  action: "soft_archived" | "hard_archived" | "skipped";
  reason?: string;
}

function handleArchive(
  knowledgeStore: KnowledgeStore,
  financialIndexStore: FinancialIndexStore,
  paths?: string[],
) {
  if (!paths || paths.length === 0) {
    return {
      content: [
        {
          type: "text" as const,
          text: "Error: kb_staleness: paths 参数在 archive 操作时必填。",
        },
      ],
      isError: true,
    };
  }

  const results: ArchiveResult[] = [];

  // 预加载所有金融记忆的过时状态（避免循环内重复查询）
  const allStaleness = financialIndexStore.scanStaleness();
  const stalenessMap = new Map(allStaleness.map((s) => [s.notePath, s.stage]));

  for (const notePath of paths) {
    // 读取笔记，解析 frontmatter
    let frontmatter: Record<string, unknown>;
    let body: string;
    try {
      const read = knowledgeStore.readNote(notePath);
      frontmatter = read.frontmatter as Record<string, unknown>;
      body = read.body;
    } catch {
      results.push({ path: notePath, action: "skipped", reason: "not found" });
      continue;
    }

    const entityType = frontmatter.entity_type as string | undefined;

    // lesson 永不过时
    if (entityType === "lesson") {
      results.push({
        path: notePath,
        action: "skipped",
        reason: "lesson never stale",
      });
      continue;
    }

    // 从预加载的 map 获取当前 stage
    const stage: StalenessStage = stalenessMap.get(notePath) ?? "active";

    if (stage === "active") {
      results.push({
        path: notePath,
        action: "skipped",
        reason: "not stale",
      });
      continue;
    }

    if (stage === "stale") {
      // Stage 1：软归档 — 添加 stale: true 到 frontmatter
      const updatedFm = {
        ...frontmatter,
        stale: true,
      } as typeof frontmatter;
      // 不更新 updated_at（保留原始时间戳）
      const content = serializeFrontmatter(
        updatedFm as Parameters<typeof serializeFrontmatter>[0],
        body,
      );
      knowledgeStore.writeNote({ content, path: notePath, overwrite: true });
      results.push({ path: notePath, action: "soft_archived" });
      continue;
    }

    if (stage === "archived") {
      // Stage 2：硬归档 — 移动到 _archived/YYYY-MM/
      const title =
        (frontmatter.title as string) ||
        (frontmatter.name as string) ||
        notePath.replace(/\.md$/, "").split("/").pop() ||
        "Untitled";
      const newPath = archivePath(title);

      const updatedFm = {
        ...frontmatter,
        stale: true,
        archived: true,
      } as typeof frontmatter;
      const content = serializeFrontmatter(
        updatedFm as Parameters<typeof serializeFrontmatter>[0],
        body,
      );

      // 写入新路径（不覆盖已有归档）
      knowledgeStore.writeNote({ content, path: newPath, overwrite: false });
      // 删除旧笔记（清理磁盘 + 索引 + 金融索引）
      knowledgeStore.deleteNote(notePath);

      results.push({ path: notePath, action: "hard_archived" });
      continue;
    }
  }

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: true, results }, null, 2),
      },
    ],
  };
}
