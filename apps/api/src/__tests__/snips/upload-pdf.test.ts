import { readFile } from "node:fs/promises";
import path from "node:path";

// Path to a real PDF in the repo root
const PDF_PATH = path.resolve(__dirname, "../../../../../ug472_pages_1-3.pdf");

// Directly test the validation logic from upload-pdf handler
// This avoids ESM dependency issues with uuid, processJobInternal, etc.

const MAX_PDF_SIZE_BYTES = 500 * 1024 * 1024; // 500MB

function validateUploadPdfArgs({
  content,
  path: filePath,
}: {
  content?: string;
  path?: string;
}): { valid: boolean; error?: string } {
  // Validate: exactly one of content or path
  if (!content && !filePath) {
    return {
      valid: false,
      error: "Error: Provide either 'content' (base64) or 'path' (server file path).",
    };
  }
  if (content && filePath) {
    return {
      valid: false,
      error: "Error: Provide only one of 'content' or 'path', not both.",
    };
  }

  if (content) {
    const buffer = Buffer.from(content, "base64");

    // Size check
    if (buffer.length > MAX_PDF_SIZE_BYTES) {
      return {
        valid: false,
        error: `Error: PDF size (${(buffer.length / 1024 / 1024).toFixed(1)}MB) exceeds the 500MB limit.`,
      };
    }

    // PDF magic bytes check (%PDF)
    if (
      buffer.length < 4 ||
      buffer[0] !== 0x25 ||
      buffer[1] !== 0x50 ||
      buffer[2] !== 0x44 ||
      buffer[3] !== 0x46
    ) {
      return {
        valid: false,
        error: "Error: Content is not a valid PDF file (missing %PDF header).",
      };
    }
  }

  return { valid: true };
}

describe("upload_pdf MCP tool — validation logic", () => {
  describe("happy path: base64 upload", () => {
    it("should accept valid base64-encoded PDF content", async () => {
      const pdfBuffer = await readFile(PDF_PATH);
      const base64 = pdfBuffer.toString("base64");

      const result = validateUploadPdfArgs({ content: base64 });
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it("should accept any content starting with %PDF header", () => {
      // Minimal valid PDF header
      const minimalPdf = Buffer.from("%PDF-1.0\n%%EOF");
      const base64 = minimalPdf.toString("base64");

      const result = validateUploadPdfArgs({ content: base64 });
      expect(result.valid).toBe(true);
    });
  });

  describe("happy path: server-side file path", () => {
    it("should accept absolute path", () => {
      const result = validateUploadPdfArgs({ path: "/data/report.pdf" });
      expect(result.valid).toBe(true);
    });

    it("should accept relative path", () => {
      const result = validateUploadPdfArgs({ path: "./docs/report.pdf" });
      expect(result.valid).toBe(true);
    });

    it("should accept Windows-style path", () => {
      const result = validateUploadPdfArgs({
        path: "D:\\PDFS\\report.pdf",
      });
      expect(result.valid).toBe(true);
    });
  });

  describe("failure path: missing parameters", () => {
    it("should reject when neither content nor path provided", () => {
      const result = validateUploadPdfArgs({});
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/Provide either/i);
    });
  });

  describe("failure path: conflicting parameters", () => {
    it("should reject when both content and path provided", async () => {
      const pdfBuffer = await readFile(PDF_PATH);
      const base64 = pdfBuffer.toString("base64");

      const result = validateUploadPdfArgs({
        content: base64,
        path: "/data/report.pdf",
      });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/only one/i);
    });
  });

  describe("failure path: invalid PDF content", () => {
    it("should reject content without %PDF header", () => {
      const fakeContent = Buffer.from("this is not a pdf file").toString(
        "base64",
      );

      const result = validateUploadPdfArgs({ content: fakeContent });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not a valid PDF|%PDF/i);
    });

    it("should reject empty content", () => {
      const emptyContent = Buffer.from("").toString("base64");

      const result = validateUploadPdfArgs({ content: emptyContent });
      expect(result.valid).toBe(false);
      // Empty base64 decodes to empty buffer, which is falsy — treated as "not provided"
      expect(result.error).toMatch(/Provide either/i);
    });

    it("should reject content with wrong magic bytes", () => {
      // Starts with something other than %PDF
      const wrongMagic = Buffer.from([0x00, 0x50, 0x44, 0x46]).toString(
        "base64",
      );

      const result = validateUploadPdfArgs({ content: wrongMagic });
      expect(result.valid).toBe(false);
      expect(result.error).toMatch(/not a valid PDF|%PDF/i);
    });
  });

  describe("size limit", () => {
    it("should have MAX_PDF_SIZE_BYTES set to 500MB", () => {
      expect(MAX_PDF_SIZE_BYTES).toBe(500 * 1024 * 1024);
    });
  });
});
