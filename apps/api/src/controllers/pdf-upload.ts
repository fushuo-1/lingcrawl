import type { FastifyRequest, FastifyReply } from "fastify";
import { logger as _logger } from "../lib/logger";
import { scrapeRequestSchema } from "./types";
import { v7 as uuidv7 } from "uuid";
import { buildSyncScrapeJob } from "../services/job-factory";
import { processJobInternal } from "../services/worker/scrape-worker";
import { writeFile, unlink, mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const UPLOAD_DIR = "/tmp/pdf-upload";
const MAX_PDF_SIZE_BYTES = 100 * 1024 * 1024; // 100MB

// Simple counting semaphore for concurrent upload control
const MAX_CONCURRENT_UPLOADS = 3;
let activeUploads = 0;
const uploadQueue: Array<() => void> = [];

async function acquireUploadSlot(): Promise<void> {
  if (activeUploads < MAX_CONCURRENT_UPLOADS) {
    activeUploads++;
    return;
  }
  return new Promise<void>((resolve) => {
    uploadQueue.push(() => {
      activeUploads++;
      resolve();
    });
  });
}

function releaseUploadSlot(): void {
  activeUploads--;
  const next = uploadQueue.shift();
  if (next) next();
}

interface PdfUploadResponse {
  success: boolean;
  markdown?: string;
  metadata?: Record<string, unknown>;
  error?: string;
  pageCount?: number;
}

interface PdfUploadBody {
  pages?: string;
  includeTables?: string | boolean;
  includeImages?: string | boolean;
  mode?: "fast" | "auto" | "ocr";
}

/** Extract a string value from a @fastify/multipart field (may be array or string) */
function getFieldValue(fields: Record<string, unknown>, key: string): string | undefined {
  const raw = fields[key];
  if (Array.isArray(raw)) {
    const item = raw[0] as Record<string, unknown> | undefined;
    return typeof item?.value === "string" ? item.value : undefined;
  }
  return typeof raw === "string" ? raw : undefined;
}

function extractFields(fields: Record<string, unknown>): PdfUploadBody {
  return {
    pages: getFieldValue(fields, "pages"),
    includeTables: getFieldValue(fields, "includeTables") === "true" ? true : undefined,
    includeImages: getFieldValue(fields, "includeImages") === "true" ? true : undefined,
    mode: getFieldValue(fields, "mode") as "fast" | "auto" | "ocr" | undefined,
  };
}

export async function pdfUploadHandler(
  request: FastifyRequest<{ Body: PdfUploadBody }>,
  reply: FastifyReply,
): Promise<PdfUploadResponse> {
  const controllerStartTime = Date.now();
  const jobId = uuidv7();

  const logger = _logger.child({
    method: "pdfUploadHandler",
    jobId,
    scrapeId: jobId,
  });

  logger.debug("PDF Upload " + jobId + " starting");

  // Parse multipart form data using @fastify/multipart
  // Use request.parts() to iterate ALL parts (file + non-file fields)
  const parts = request.parts();
  let fileBuffer: Buffer | null = null;
  let fileMimetype = "";
  const formFields: Record<string, string> = {};

  for await (const part of parts) {
    if (part.file) {
      // This is a file field
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      fileBuffer = Buffer.concat(chunks);
      fileMimetype = part.mimetype;
    } else {
      // This is a non-file field (mode, pages, etc.)
      const chunks: Buffer[] = [];
      for await (const chunk of part.file) {
        chunks.push(chunk);
      }
      formFields[part.fieldname] = Buffer.concat(chunks).toString("utf-8");
    }
  }

  if (!fileBuffer) {
    return reply.code(400).send({
      success: false,
      error: "No file uploaded",
    });
  }

  const options: PdfUploadBody = {
    pages: formFields.pages || undefined,
    includeTables: formFields.includeTables === "true" ? true : undefined,
    includeImages: formFields.includeImages === "true" ? true : undefined,
    mode: (formFields.mode as "fast" | "auto" | "ocr") || undefined,
  };

  // Validate PDF file type by MIME type or magic bytes
  if (fileMimetype && fileMimetype !== "application/pdf") {
    // Check magic bytes as fallback
    if (fileBuffer.length < 4 || fileBuffer.toString("ascii", 0, 4) !== "%PDF") {
      return reply.code(400).send({
        success: false,
        error: "Uploaded file is not a valid PDF",
      });
    }
    // Continue processing with this buffer
    return await processPdfBuffer(fileBuffer, options, logger, controllerStartTime, reply);
  }

  return await processPdfBuffer(fileBuffer, options, logger, controllerStartTime, reply);
}

async function processPdfBuffer(
  buffer: Buffer,
  options: PdfUploadBody,
  logger: ReturnType<typeof _logger.child>,
  startTime: number,
  reply: FastifyReply,
): Promise<PdfUploadResponse> {
  // Validate size
  if (buffer.length > MAX_PDF_SIZE_BYTES) {
    return reply.code(413).send({
      success: false,
      error: `PDF size (${(buffer.length / 1024 / 1024).toFixed(1)}MB) exceeds the 100MB limit`,
    });
  }

  // Validate PDF magic bytes
  if (buffer.length < 4 || buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    return reply.code(400).send({
      success: false,
      error: "Uploaded content is not a valid PDF file (missing %PDF header)",
    });
  }

  let tmpPath: string | undefined;

  try {
    // Acquire semaphore
    await acquireUploadSlot();

    // Write to tmpfs
    await mkdir(UPLOAD_DIR, { recursive: true });
    tmpPath = `${UPLOAD_DIR}/${randomUUID()}.pdf`;
    await writeFile(tmpPath, buffer);

    const fileUrl = `file://${tmpPath}`;

    // Parse options from form fields
    const pages = options.pages;
    const includeTables = options.includeTables === "true" || options.includeTables === true;
    const includeImages = options.includeImages === "true" || options.includeImages === true;
    const mode = options.mode || "auto";

    // Build and process scrape job
    const parsed = scrapeRequestSchema.parse({
      url: fileUrl,
      formats: [{ type: "markdown" }],
      parsers: [
        {
          type: "pdf",
          ...(pages && { pages }),
          includeTables,
          includeImages,
          mode,
        },
      ],
    });

    const job = buildSyncScrapeJob({
      url: parsed.url,
      scrapeOptions: { ...parsed },
      origin: "api",
      unnormalizedSourceURL: fileUrl,
    });

    const result = await processJobInternal(job as any);
    if (!result) {
      return reply.code(200).send({
        success: false,
        error: "PDF extraction returned no result",
      });
    }

    const elapsed = Date.now() - startTime;
    logger.info("PDF Upload completed", {
      success: true,
      time_taken: elapsed,
    });

    return reply.code(200).send({
      success: true,
      markdown: result.markdown,
      metadata: result.metadata,
      pageCount: (result.metadata as Record<string, unknown>)?.pageCount,
    });
  } catch (e: any) {
    const msg = e.message || String(e);
    if (msg.includes("ENOENT") || msg.includes("no such file")) {
      return reply.code(404).send({
        success: false,
        error: "File not found after upload",
      });
    }
    if (msg.includes("OCR") || msg.includes("ocr") || msg.includes("scanned")) {
      return reply.code(200).send({
        success: false,
        error: "Scanned PDF detected. Try setting mode to 'ocr'",
      });
    }
    logger.error("PDF Upload error", { error: msg });
    return reply.code(500).send({
      success: false,
      error: msg,
    });
  } finally {
    // Clean up tmpfs file and release semaphore
    if (tmpPath) {
      await unlink(tmpPath).catch(() => {});
    }
    releaseUploadSlot();
  }
}