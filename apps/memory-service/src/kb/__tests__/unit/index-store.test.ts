import Database from "better-sqlite3";
import { applySchema } from "../../../db/migrations.js";
import { IndexStore } from "../../../kb/index-store.js";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  applySchema(db);
  return db;
}

describe("IndexStore", () => {
  let db: Database.Database;
  let store: IndexStore;

  beforeEach(() => {
    db = createTestDb();
    store = new IndexStore(db);
  });

  afterEach(() => {
    db.close();
  });

  describe("upsertNote / getNoteMeta", () => {
    it("inserts and retrieves a note", () => {
      store.upsertNote({
        path: "AI/Test.md",
        title: "Test",
        tags: ["AI"],
        content: "Hello world",
      });
      const meta = store.getNoteMeta("AI/Test.md");
      expect(meta).not.toBeNull();
      expect(meta!.path).toBe("AI/Test.md");
      expect(meta!.title).toBe("Test");
      expect(meta!.tags).toEqual(["AI"]);
      expect(meta!.id).toBeGreaterThan(0);
      expect(meta!.createdAt).toBeGreaterThan(0);
      expect(meta!.updatedAt).toBeGreaterThan(0);
    });

    it("upserts (updates) an existing note on conflict", () => {
      store.upsertNote({
        path: "AI/Test.md",
        title: "Old Title",
        tags: ["AI"],
        content: "old content",
      });
      store.upsertNote({
        path: "AI/Test.md",
        title: "New Title",
        tags: ["AI", "FPGA"],
        content: "new content",
      });
      const meta = store.getNoteMeta("AI/Test.md");
      expect(meta!.title).toBe("New Title");
      expect(meta!.tags).toEqual(["AI", "FPGA"]);
    });

    it("returns null for non-existent path", () => {
      expect(store.getNoteMeta("nope.md")).toBeNull();
    });
  });

  describe("deleteNote", () => {
    it("deletes an existing note and returns true", () => {
      store.upsertNote({
        path: "AI/Test.md",
        title: "Test",
        tags: [],
        content: "body",
      });
      expect(store.deleteNote("AI/Test.md")).toBe(true);
      expect(store.getNoteMeta("AI/Test.md")).toBeNull();
    });

    it("returns false for non-existent note", () => {
      expect(store.deleteNote("nope.md")).toBe(false);
    });
  });

  describe("searchNotes", () => {
    beforeEach(() => {
      store.upsertNote({
        path: "AI/LLM.md",
        title: "Large Language Models",
        tags: ["AI"],
        content: "LLMs are neural networks trained on text data",
      });
      store.upsertNote({
        path: "FPGA/Verilog.md",
        title: "Verilog Basics",
        tags: ["FPGA"],
        content: "Verilog is a hardware description language",
      });
      store.upsertNote({
        path: "AI/Transformers.md",
        title: "Transformer Architecture",
        tags: ["AI"],
        content: "Transformers use self-attention mechanisms",
      });
    });

    it("finds notes by content keyword", () => {
      const results = store.searchNotes("neural");
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Large Language Models");
    });

    it("finds notes by title keyword", () => {
      const results = store.searchNotes("Verilog");
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Verilog Basics");
    });

    it("returns snippets and scores", () => {
      const results = store.searchNotes("attention");
      expect(results.length).toBe(1);
      expect(results[0].snippet).toBeTruthy();
      expect(results[0].score).toBeDefined();
    });

    it("filters by tag", () => {
      const results = store.searchNotes("language", { tags: ["FPGA"] });
      expect(results.length).toBe(1);
      expect(results[0].title).toBe("Verilog Basics");
    });

    it("filters by pathPrefix", () => {
      const results = store.searchNotes("language", { pathPrefix: "FPGA" });
      expect(results.length).toBe(1);
      expect(results[0].path).toMatch(/^FPGA/);
    });

    it("respects limit", () => {
      const results = store.searchNotes("is", { limit: 1 });
      expect(results.length).toBeLessThanOrEqual(1);
    });
  });

  describe("listNotes / recentNotes", () => {
    beforeEach(() => {
      for (let i = 0; i < 5; i++) {
        store.upsertNote({
          path: `AI/Note${i}.md`,
          title: `Note ${i}`,
          tags: ["AI"],
          content: `Content ${i}`,
        });
      }
    });

    it("lists all notes", () => {
      expect(store.listNotes().length).toBe(5);
    });

    it("filters by pathPrefix", () => {
      store.upsertNote({
        path: "FPGA/Note.md",
        title: "FPGA Note",
        tags: ["FPGA"],
        content: "FPGA content",
      });
      const aiNotes = store.listNotes({ pathPrefix: "AI" });
      expect(aiNotes.length).toBe(5);
      const fpgaNotes = store.listNotes({ pathPrefix: "FPGA" });
      expect(fpgaNotes.length).toBe(1);
    });

    it("filters by tags", () => {
      store.upsertNote({
        path: "FPGA/Note.md",
        title: "FPGA Note",
        tags: ["FPGA"],
        content: "FPGA content",
      });
      const fpgaNotes = store.listNotes({ tags: ["FPGA"] });
      expect(fpgaNotes.length).toBe(1);
    });

    it("recentNotes returns ordered by updated_at desc", () => {
      const recent = store.recentNotes(3);
      expect(recent.length).toBe(3);
    });
  });

  describe("links", () => {
    beforeEach(() => {
      store.upsertNote({
        path: "AI/Source.md",
        title: "Source",
        tags: ["AI"],
        content: "Links to [[Target]]",
      });
      store.upsertNote({
        path: "FPGA/Target.md",
        title: "Target",
        tags: ["FPGA"],
        content: "Target note",
      });
    });

    it("adds and retrieves backlinks", () => {
      store.addLink("AI/Source.md", "Target");
      const backlinks = store.getBacklinks("Target");
      expect(backlinks.length).toBe(1);
      expect(backlinks[0].sourcePath).toBe("AI/Source.md");
      expect(backlinks[0].targetTitle).toBe("Target");
    });

    it("ignores duplicate links", () => {
      store.addLink("AI/Source.md", "Target");
      store.addLink("AI/Source.md", "Target");
      const backlinks = store.getBacklinks("Target");
      expect(backlinks.length).toBe(1);
    });

    it("removes links for a note", () => {
      store.addLink("AI/Source.md", "Target");
      store.removeLinksForNote("AI/Source.md");
      const backlinks = store.getBacklinks("Target");
      expect(backlinks.length).toBe(0);
    });

    it("finds broken links", () => {
      store.addLink("AI/Source.md", "NonExistent");
      const broken = store.getBrokenLinks();
      expect(broken.length).toBe(1);
      expect(broken[0].targetTitle).toBe("NonExistent");
    });

    it("returns empty broken links when all targets exist", () => {
      store.addLink("AI/Source.md", "Target");
      const broken = store.getBrokenLinks();
      expect(broken.length).toBe(0);
    });
  });
});
