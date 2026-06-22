/**
 * KnowledgeStore — business orchestration layer for the knowledge base.
 *
 * Composes FileManager + FrontmatterParser + PathResolver + IndexStore
 * to provide writeNote / readNote with full frontmatter handling,
 * wikilink extraction, and duplicate-path avoidance.
 */
import path from "node:path";
import type { FileManager } from "./file-manager.js";
import type { IndexStore, NoteMeta } from "./index-store.js";
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

  constructor(deps: { fileManager: FileManager; indexStore: IndexStore }) {
    this.fileManager = deps.fileManager;
    this.indexStore = deps.indexStore;
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
  }): WriteResult {
    const { content, tags: paramTags, path: explicitPath } = params;

    // 1. Empty check
    if (!content || content.trim().length === 0) {
      throw new EmptyContentError();
    }

    // 2. Parse frontmatter
    const parsed = parseFrontmatter(content);

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

    // 6. Avoid collisions — append numeric suffix if file exists
    notePath = this.avoidCollision(notePath);

    // 7. Serialize final markdown
    const now = new Date().toISOString();
    const finalFm: Frontmatter = {
      tags,
      created: parsed.frontmatter.created || now,
      updated: now,
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
