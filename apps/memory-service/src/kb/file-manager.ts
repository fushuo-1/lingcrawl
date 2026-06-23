/**
 * FileManager — atomic disk CRUD for knowledge-base Markdown files.
 *
 * Writes go through a .tmp file + rename to ensure atomicity.
 * All paths are relative to the `baseDir` provided at construction.
 */
import fs from "node:fs";
import path from "node:path";
import { NoteNotFoundError } from "./errors.js";

export interface DirEntry {
  name: string;
  path: string; // relative to baseDir
  isDirectory: boolean;
}

export class FileManager {
  private baseDir: string;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
  }

  /** Resolve a relative path against baseDir and validate it stays inside. */
  private resolve(relativePath: string): string {
    const full = path.resolve(this.baseDir, relativePath);
    if (!full.startsWith(path.resolve(this.baseDir))) {
      throw new Error(`Path escapes base directory: ${relativePath}`);
    }
    return full;
  }

  /**
   * Write content atomically — writes to a .tmp sibling then renames.
   * Creates parent directories as needed.
   */
  write(relativePath: string, content: string): void {
    const full = this.resolve(relativePath);
    const dir = path.dirname(full);
    fs.mkdirSync(dir, { recursive: true });

    const tmpPath = full + ".tmp";
    fs.writeFileSync(tmpPath, content, "utf-8");
    // On Windows, rename fails if target exists — unlink first.
    try {
      fs.unlinkSync(full);
    } catch {
      // ignore — target may not exist yet
    }
    fs.renameSync(tmpPath, full);
  }

  /** Read file content. Throws NoteNotFoundError if the file does not exist. */
  read(relativePath: string): string {
    const full = this.resolve(relativePath);
    if (!fs.existsSync(full)) {
      throw new NoteNotFoundError(relativePath);
    }
    return fs.readFileSync(full, "utf-8");
  }

  /** Check whether a file exists. */
  exists(relativePath: string): boolean {
    const full = this.resolve(relativePath);
    return fs.existsSync(full);
  }

  /** Delete a file. No-op if it does not exist. */
  delete(relativePath: string): void {
    const full = this.resolve(relativePath);
    try {
      fs.unlinkSync(full);
    } catch {
      // ignore — already gone
    }
  }

  /**
   * List immediate children of a directory.
   * Returns empty array if directory does not exist.
   */
  listDir(relativePath?: string): DirEntry[] {
    const full = relativePath ? this.resolve(relativePath) : this.baseDir;
    if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) {
      return [];
    }
    const entries = fs.readdirSync(full, { withFileTypes: true });
    return entries.map((e) => ({
      name: e.name,
      path: relativePath ? path.join(relativePath, e.name) : e.name,
      isDirectory: e.isDirectory(),
    }));
  }

  /**
   * Recursively scan baseDir for all .md files.
   * Returns relative paths with mtime.
   */
  listAllMarkdown(): Array<{ relativePath: string; mtime: number }> {
    const results: Array<{ relativePath: string; mtime: number }> = [];
    const walk = (dir: string, rel: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullRel = rel ? path.join(rel, entry.name) : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), fullRel);
        } else if (entry.name.endsWith(".md")) {
          const stat = fs.statSync(path.join(dir, entry.name));
          results.push({ relativePath: fullRel, mtime: stat.mtimeMs });
        }
      }
    };
    walk(this.baseDir, "");
    return results;
  }
}
