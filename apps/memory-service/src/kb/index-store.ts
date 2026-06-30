/**
 * IndexStore — SQLite index layer for knowledge-base notes.
 *
 * Provides CRUD, full-text search, listing, and link management.
 * All methods are synchronous (better-sqlite3 is sync).
 */
import type Database from "better-sqlite3";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface NoteMeta {
  id: number;
  path: string;
  title: string;
  tags: string[];
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface SearchHit extends NoteMeta {
  snippet: string;
  score: number;
}

export interface Link {
  sourcePath: string;
  targetTitle: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function rowToNoteMeta(row: Record<string, unknown>): NoteMeta {
  return {
    id: row.id as number,
    path: row.path as string,
    title: row.title as string,
    tags: JSON.parse(row.tags as string) as string[],
    content: row.content as string,
    createdAt: row.created_at as number,
    updatedAt: row.updated_at as number,
  };
}

/* ------------------------------------------------------------------ */
/*  IndexStore                                                         */
/* ------------------------------------------------------------------ */

export class IndexStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /* ---- Notes CRUD ---- */

  upsertNote(meta: {
    path: string;
    title: string;
    tags: string[];
    content: string;
  }): void {
    this.db
      .prepare(
        `INSERT INTO notes (path, title, tags, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
         ON CONFLICT(path) DO UPDATE SET
           title = excluded.title,
           tags = excluded.tags,
           content = excluded.content,
           updated_at = unixepoch()`,
      )
      .run(meta.path, meta.title, JSON.stringify(meta.tags), meta.content);
  }

  deleteNote(path: string): boolean {
    const info = this.db
      .prepare("DELETE FROM notes WHERE path = ?")
      .run(path);
    return info.changes > 0;
  }

  updateNotePath(oldPath: string, newPath: string): void {
    this.db
      .prepare("UPDATE notes SET path = ? WHERE path = ?")
      .run(newPath, oldPath);
    this.db
      .prepare("UPDATE links SET source_path = ? WHERE source_path = ?")
      .run(newPath, oldPath);
  }

  listAllNotes(): NoteMeta[] {
    const rows = this.db
      .prepare("SELECT * FROM notes ORDER BY path")
      .all() as Record<string, unknown>[];
    return rows.map(rowToNoteMeta);
  }

  getNoteMeta(path: string): NoteMeta | null {
    const row = this.db
      .prepare("SELECT * FROM notes WHERE path = ?")
      .get(path) as Record<string, unknown> | undefined;
    return row ? rowToNoteMeta(row) : null;
  }

  /* ---- Search ---- */

  searchNotes(
    query: string,
    filters?: { tags?: string[]; pathPrefix?: string; limit?: number; excludeArchived?: boolean },
  ): SearchHit[] {
    const limit = filters?.limit ?? 50;
    const conditions: string[] = [];
    const params: unknown[] = [];

    // FTS query
    conditions.push("notes_fts MATCH ?");
    params.push(query);

    // Optional filters
    if (filters?.pathPrefix) {
      conditions.push("n.path LIKE ?");
      params.push(`${filters.pathPrefix}%`);
    }
    if (filters?.tags?.length) {
      // JSON array contains any of the requested tags
      const tagConds = filters.tags.map((t) => `n.tags LIKE ?`);
      conditions.push(`(${tagConds.join(" OR ")})`);
      for (const t of filters.tags) {
        params.push(`%"${t}"%`);
      }
    }
    // 排除 _archived/ 路径下的笔记
    if (filters?.excludeArchived) {
      conditions.push("n.path NOT LIKE '%/_archived/%'");
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const sql = `
      SELECT n.*, snippet(notes_fts, 1, '<b>', '</b>', '…', 32) AS snippet,
             rank AS score
      FROM notes_fts
      JOIN notes n ON n.id = notes_fts.rowid
      ${where}
      ORDER BY rank
      LIMIT ?
    `;
    params.push(limit);

    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    return rows.map((row) => ({
      ...rowToNoteMeta(row),
      snippet: (row.snippet as string) ?? "",
      score: (row.score as number) ?? 0,
    }));
  }

  /* ---- List ---- */

  listNotes(
    filters?: { pathPrefix?: string; tags?: string[]; limit?: number },
  ): NoteMeta[] {
    const limit = filters?.limit ?? 200;
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (filters?.pathPrefix) {
      conditions.push("path LIKE ?");
      params.push(`${filters.pathPrefix}%`);
    }
    if (filters?.tags?.length) {
      const tagConds = filters.tags.map(() => `tags LIKE ?`);
      conditions.push(`(${tagConds.join(" OR ")})`);
      for (const t of filters.tags) {
        params.push(`%"${t}"%`);
      }
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    params.push(limit);

    const rows = this.db
      .prepare(`SELECT * FROM notes ${where} ORDER BY updated_at DESC LIMIT ?`)
      .all(...params) as Record<string, unknown>[];

    return rows.map(rowToNoteMeta);
  }

  recentNotes(limit: number = 20): NoteMeta[] {
    const rows = this.db
      .prepare("SELECT * FROM notes ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Record<string, unknown>[];

    return rows.map(rowToNoteMeta);
  }

  /* ---- Links ---- */

  addLink(sourcePath: string, targetTitle: string): void {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO links (source_path, target_title) VALUES (?, ?)`,
      )
      .run(sourcePath, targetTitle);
  }

  removeLinksForNote(sourcePath: string): void {
    this.db
      .prepare("DELETE FROM links WHERE source_path = ?")
      .run(sourcePath);
  }

  getBacklinks(targetTitle: string): Link[] {
    const rows = this.db
      .prepare("SELECT source_path, target_title FROM links WHERE target_title = ?")
      .all(targetTitle) as { source_path: string; target_title: string }[];

    return rows.map((r) => ({
      sourcePath: r.source_path,
      targetTitle: r.target_title,
    }));
  }

  getBrokenLinks(): Link[] {
    const rows = this.db
      .prepare(
        `SELECT l.source_path, l.target_title
         FROM links l
         LEFT JOIN notes n ON n.title = l.target_title
         WHERE n.id IS NULL`,
      )
      .all() as { source_path: string; target_title: string }[];

    return rows.map((r) => ({
      sourcePath: r.source_path,
      targetTitle: r.target_title,
    }));
  }
}
