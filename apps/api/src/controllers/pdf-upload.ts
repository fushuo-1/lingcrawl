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

function extractFields(fields: Record<string, unknown>): PdfUploadBody {
  return {
    pages: typeof fields.pages === "string" ? fields.pages : undefined,
    includeTables: typeof fields.includeTables === "string" || typeof fields.includeTables === "boolean" ? fields.includeTables : undefined,
    includeImages: typeof fields.includeImages === "string" || typeof fields.includeImages === "boolean" ? fields.includeImages : undefined,
    mode: (typeof fields.mode === "string" ? fields.mode : undefined) as "fast" | "auto" | "ocr" | undefined,
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
  const file = await request.file();
  if (!file) {
    return reply.code(400).send({
      success: false,
      error: "No file uploaded",
    });
  }

  // Extract form fields from the multipart request
  // @fastify/multipart file() returns { file, fields, ... }
  // fields contains non-file form fields
  const formFields = (file as any).fields || {};

  // Validate PDF file type by MIME type or magic bytes
  if (file.mimetype && file.mimetype !== "application/pdf") {
    // Check magic bytes as fallback
    const chunks: Buffer[] = [];
    for await (const chunk of file.file) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    if (buffer.length < 4 || buffer.toString("ascii", 0, 4) !== "%PDF") {
      return reply.code(400).send({
        success: false,
        error: "Uploaded file is not a valid PDF",
      });
    }
    // Continue processing with this buffer
    return await processPdfBuffer(buffer, extractFields(formFields), logger, controllerStartTime, reply);
  }

  // Read file into buffer
  const chunks: Buffer[] = [];
  for await (const chunk of file.file) {
    chunks.push(chunk);
  }
  const buffer = Buffer.concat(chunks);

  return await processPdfBuffer(buffer, extractFields(formFields), logger, controllerStartTime, reply);
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