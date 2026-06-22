/**
 * Knowledge-base error types — issue #94.
 */
export class NoteNotFoundError extends Error {
  constructor(path: string) {
    super(`Note not found: ${path}`);
    this.name = "NoteNotFoundError";
  }
}

export class EmptyContentError extends Error {
  constructor() {
    super("Content must not be empty");
    this.name = "EmptyContentError";
  }
}

export class InvalidFrontmatterError extends Error {
  constructor(detail: string) {
    super(`Invalid frontmatter: ${detail}`);
    this.name = "InvalidFrontmatterError";
  }
}
