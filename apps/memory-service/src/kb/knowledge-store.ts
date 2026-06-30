/**
 * KnowledgeStore — business orchestration layer for the knowledge base.
 *
 * Composes FileManager + FrontmatterParser + PathResolver + IndexStore
 * to provide writeNote / readNote with full frontmatter handling,
 * wikilink extraction, and duplicate-path avoidance.
 */
import type { FinancialIndexStore, FinancialSlimFields } from "../financial/financial-index-store.js";
import { validateRequiredFields } from "../financial/validators.js";
import path from "node:path";
import type { FileManager } from "./file-manager.js";
import type { IndexStore, Link, NoteMeta } from "./index-store.js";
import {
  type Frontmatter,
  parse as parseFrontmatter,
  serialize as serializeFrontmatter,
} from "./frontmatter.js";
import { resolvePath } from "./path-resolver.js";
import { EmptyContentError, NoteNotFoundError } from "./errors.js";

const WIKILINK_RE = /\[\[([^\]]+)\]\]/g;

export interface WriteResult {
  path: string;
  title: string;
  created: boolean;
}

export interface ReadResult {
  frontmatter: Frontmatter;
  body: string;
}

export class KnowledgeStore {
  private fileManager: FileManager;
  private indexStore: IndexStore;
  private financialIndexStore?: FinancialIndexStore;

  constructor(deps: {
    fileManager: FileManager;
    indexStore: IndexStore;
    financialIndexStore?: FinancialIndexStore;
  }) {
    this.fileManager = deps.fileManager;
    this.indexStore = deps.indexStore;
    this.financialIndexStore = deps.financialIndexStore;
  }

  /**
   * Write a note to the knowledge base.
   *
   * Full flow:
   *  1. Validate content is non-empty
   *  2. Parse frontmatter from content (if present)
   *  3. Merge tags (param > frontmatter > [])
   *  4. Resolve path from title + tags (or use provided path)
   *  5. Avoid collisions by appending numeric suffix
   *  6. Serialize final markdown with frontmatter
   *  7. Write to disk
   *  8. Upsert into index
   *  9. Extract and persist [[wikilinks]]
   */
  writeNote(params: {
    content: string;
    tags?: string[];
    path?: string;
    overwrite?: boolean;
  }): WriteResult {
    const { content, tags: paramTags, path: explicitPath, overwrite } = params;

    // 1. Empty check
    if (!content || content.trim().length === 0) {
      throw new EmptyContentError();
    }

    // 2. Parse frontmatter
    const parsed = parseFrontmatter(content);

    // 2.5 检测是否为金融记忆 — 写磁盘前校验必填字段
    const entityType = parsed.frontmatter.entity_type as string | undefined;
    if (entityType && this.financialIndexStore) {
      // 将 snake_case frontmatter 映射到 camelCase 供 validator 使用
      validateRequiredFields({
        entityType: entityType as any,
        ticker: parsed.frontmatter.ticker as string | undefined,
        direction: parsed.frontmatter.direction as any,
        timeHorizon: parsed.frontmatter.time_horizon as any,
        confidence: parsed.frontmatter.confidence as number | undefined,
        name: parsed.frontmatter.name as string | undefined,
        assetClass: parsed.frontmatter.asset_class as any,
        positionStatus: parsed.frontmatter.position_status as any,
        quantity: parsed.frontmatter.quantity as number | undefined,
        title: parsed.frontmatter.title as string | undefined,
        lessonCategory: parsed.frontmatter.lesson_category as any,
      });
    }

    // 3. Determine title — from frontmatter body's first heading, or generate one
    const title = this.extractTitle(parsed.body);

    // 4. Merge tags: explicit param > frontmatter > empty
    const tags = paramTags ?? parsed.frontmatter.tags ?? [];

    // 5. Resolve path
    let notePath: string;
    if (explicitPath) {
      notePath = explicitPath.endsWith(".md") ? explicitPath : `${explicitPath}.md`;
    } else {
      notePath = resolvePath(title, tags);
    }

    // 6. Avoid collisions — append numeric suffix if file exists (unless overwriting)
    if (!overwrite) {
      notePath = this.avoidCollision(notePath);
    }

    // 7. Serialize final markdown — preserve original created timestamp when overwriting
    const now = new Date().toISOString();
    let originalCreated: string | undefined;
    if (overwrite && this.fileManager.exists(notePath)) {
      try {
        const existing = parseFrontmatter(this.fileManager.read(notePath));
        originalCreated = existing.frontmatter.created;
      } catch { /* ignore parse errors on existing file */ }
    }
    const finalFm: Frontmatter = {
      tags,
      created: parsed.frontmatter.created || originalCreated || now,
      updated: now,
      // 保留金融记忆字段到序列化后的 frontmatter（过滤 undefined）
      ...(entityType ? Object.fromEntries(
        Object.entries({
          entity_type: entityType,
          ticker: parsed.frontmatter.ticker,
          market: parsed.frontmatter.market,
          direction: parsed.frontmatter.direction,
          time_horizon: parsed.frontmatter.time_horizon,
          confidence: parsed.frontmatter.confidence,
          asset_class: parsed.frontmatter.asset_class,
          strategy_status: parsed.frontmatter.strategy_status,
          position_status: parsed.frontmatter.position_status,
          cost_basis: parsed.frontmatter.cost_basis,
          quantity: parsed.frontmatter.quantity,
          target_price: parsed.frontmatter.target_price,
          stop_loss: parsed.frontmatter.stop_loss,
          position_size_percent: parsed.frontmatter.position_size_percent,
          lesson_category: parsed.frontmatter.lesson_category,
          name: parsed.frontmatter.name,
          title: parsed.frontmatter.title,
        }).filter(([, v]) => v !== undefined && v !== null),
      ) : {}),
    };
    const markdown = serializeFrontmatter(finalFm, parsed.body);

    // 8. Write to disk
    this.fileManager.write(notePath, markdown);

    // 9. Upsert into index
    this.indexStore.upsertNote({
      path: notePath,
      title,
      tags,
      content: markdown,
    });

    // 10. Extract and persist wikilinks
    this.updateLinks(notePath, parsed.body);

    // 11. 金融记忆索引写入
    if (entityType && this.financialIndexStore) {
      const createdTs = parsed.frontmatter.created
        ? Math.floor(new Date(parsed.frontmatter.created).getTime() / 1000)
        : Math.floor(Date.now() / 1000);
      const slim: FinancialSlimFields = {
        entityType,
        ticker: parsed.frontmatter.ticker as string | undefined,
        market: parsed.frontmatter.market as string | undefined,
        direction: parsed.frontmatter.direction as string | undefined,
        timeHorizon: parsed.frontmatter.time_horizon as string | undefined,
        confidence: parsed.frontmatter.confidence as number | undefined,
        assetClass: parsed.frontmatter.asset_class as string | undefined,
        strategyStatus: parsed.frontmatter.strategy_status as string | undefined,
        positionStatus: parsed.frontmatter.position_status as string | undefined,
        costBasis: parsed.frontmatter.cost_basis as number | undefined,
        quantity: parsed.frontmatter.quantity as number | undefined,
        targetPrice: parsed.frontmatter.target_price as number | undefined,
        stopLoss: parsed.frontmatter.stop_loss as number | undefined,
        positionSizePercent: parsed.frontmatter.position_size_percent as number | undefined,
        lessonCategory: parsed.frontmatter.lesson_category as string | undefined,
        tags,
        createdAt: createdTs,
        updatedAt: Math.floor(Date.now() / 1000),
      };
      this.financialIndexStore.upsert(notePath, slim);
    }

    return { path: notePath, title, created: true };
  }

  /**
   * Read a note from the knowledge base.
   */
  readNote(notePath: string): ReadResult {
    const raw = this.fileManager.read(notePath);
    const parsed = parseFrontmatter(raw);
    return { frontmatter: parsed.frontmatter, body: parsed.body };
  }

  /**
   * List notes with optional filters. Delegates to IndexStore.
   */
  listNotes(filters?: {
    pathPrefix?: string;
    tags?: string[];
    limit?: number;
  }): NoteMeta[] {
    return this.indexStore.listNotes(filters);
  }

  /**
   * Get backlinks for a note — which other notes link to it via [[title]].
   */
  getBacklinks(notePath: string): Link[] {
    const meta = this.indexStore.getNoteMeta(notePath);
    if (!meta) throw new NoteNotFoundError(notePath);
    return this.indexStore.getBacklinks(meta.title);
  }

  /**
   * Get all broken links — [[target]] where target note does not exist.
   */
  getBrokenLinks(): Link[] {
    return this.indexStore.getBrokenLinks();
  }

  /**
   * Check sync status of a single note.
   * Returns whether the note is indexed, on disk, and in sync.
   */
  checkNoteSync(notePath: string): {
    indexed: boolean;
    onDisk: boolean;
    inSync: boolean;
  } {
    const indexed = this.indexStore.getNoteMeta(notePath) !== null;
    const onDisk = this.fileManager.exists(notePath);
    const inSync = indexed && onDisk;
    return { indexed, onDisk, inSync };
  }

  /**
   * Delete a note from the knowledge base.
   * Removes the file, the index entry, links, and clears any financial memory note_path.
   */
  deleteNote(notePath: string): boolean {
    const existed = this.fileManager.exists(notePath);
    if (existed) {
      this.fileManager.delete(notePath);
    }
    const indexed = this.indexStore.deleteNote(notePath);
    this.indexStore.removeLinksForNote(notePath);
    this.financialIndexStore?.delete(notePath);
    return existed || indexed;
  }

  /**
   * Sync the SQLite index with the actual files on disk.
   * Detects added, updated, removed, and renamed notes.
   *
   * When dryRun is true, returns detailed file lists without modifying anything.
   */
  syncIndex(dryRun = false): {
    added: number;
    updated: number;
    removed: number;
    renamed: number;
    addedPaths?: string[];
    removedPaths?: string[];
    renamedPaths?: Array<{ oldPath: string; newPath: string }>;
  } {
    const indexedList = this.indexStore.listAllNotes();
    const indexedByPath = new Map(indexedList.map((n) => [n.path, n]));
    const indexedByContent = new Map(indexedList.map((n) => [n.content, n]));
    const onDisk = this.fileManager.listAllMarkdown();

    const addedPaths: string[] = [];
    const removedPaths: string[] = [];
    const renamedPaths: Array<{ oldPath: string; newPath: string }> = [];
    let added = 0,
      updated = 0,
      removed = 0,
      renamed = 0;

    // Detect renames and updates among files on disk
    for (const { relativePath } of onDisk) {
      const raw = this.fileManager.read(relativePath);
      const parsed = parseFrontmatter(raw);
      const title = this.extractTitle(parsed.body);
      const tags = parsed.frontmatter.tags ?? [];

      if (indexedByPath.has(relativePath)) {
        // Existing path — just update index
        if (!dryRun) {
          this.indexStore.upsertNote({ path: relativePath, title, tags, content: raw });
          this.indexStore.removeLinksForNote(relativePath);
          this.updateLinks(relativePath, parsed.body);
        }
        updated++;
        indexedByPath.delete(relativePath);
        continue;
      }

      // Path not in index — could be a new file or a renamed file
      const renamedFrom = indexedByContent.get(raw);
      if (renamedFrom && renamedFrom.path !== relativePath) {
        // Rename detected: same content, different path
        renamedPaths.push({ oldPath: renamedFrom.path, newPath: relativePath });
        if (!dryRun) {
          this.indexStore.updateNotePath(renamedFrom.path, relativePath);
          this.indexStore.upsertNote({ path: relativePath, title, tags, content: raw });
          this.indexStore.removeLinksForNote(relativePath);
          this.updateLinks(relativePath, parsed.body);
          this.financialIndexStore?.updateNotePath(renamedFrom.path, relativePath);
        }
        renamed++;
        indexedByPath.delete(renamedFrom.path);
        continue;
      }

      // New file
      addedPaths.push(relativePath);
      if (!dryRun) {
        this.indexStore.upsertNote({ path: relativePath, title, tags, content: raw });
        this.indexStore.removeLinksForNote(relativePath);
        this.updateLinks(relativePath, parsed.body);
      }
      added++;
    }

    // Remaining entries in indexedByPath are files deleted from disk
    for (const [notePath] of indexedByPath) {
      removedPaths.push(notePath);
      if (!dryRun) {
        this.indexStore.deleteNote(notePath);
        this.indexStore.removeLinksForNote(notePath);
        this.financialIndexStore?.delete(notePath);
      }
      removed++;
    }

    return dryRun
      ? { added, updated, removed, renamed, addedPaths, removedPaths, renamedPaths }
      : { added, updated, removed, renamed };
  }

  /* ---- Helpers ---- */

  /**
   * Extract title from the first heading in the body, or derive from
   * the first non-empty line, or fall back to "Untitled".
   */
  private extractTitle(body: string): string {
    const lines = body.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // # Heading
      const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
      if (headingMatch) {
        return headingMatch[1].trim();
      }
      // Use first non-empty line as title (truncated)
      return trimmed.length > 80 ? trimmed.slice(0, 80) : trimmed;
    }
    return "Untitled";
  }

  /**
   * If a file already exists at `notePath`, append -2, -3, ... until we find
   * a free name.
   */
  private avoidCollision(notePath: string): string {
    if (!this.fileManager.exists(notePath)) {
      return notePath;
    }

    const ext = path.extname(notePath); // ".md"
    const base = notePath.slice(0, -ext.length);
    let suffix = 2;
    while (true) {
      const candidate = `${base}-${suffix}${ext}`;
      if (!this.fileManager.exists(candidate)) {
        return candidate;
      }
      suffix += 1;
    }
  }

  /**
   * Extract [[target]] wikilinks from body, remove old links for this note,
   * and re-add the new ones.
   */
  private updateLinks(notePath: string, body: string): void {
    const targets = new Set<string>();
    let match: RegExpExecArray | null;
    WIKILINK_RE.lastIndex = 0;
    while ((match = WIKILINK_RE.exec(body)) !== null) {
      targets.add(match[1].trim());
    }

    this.indexStore.removeLinksForNote(notePath);
    for (const target of targets) {
      this.indexStore.addLink(notePath, target);
    }
  }
}
