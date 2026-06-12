import { z } from "zod";
import { strictWithMessage } from "./common";

export const pdfUploadOptionsSchema = z.object({
  pages: z
    .string()
    .optional()
    .describe("Page range to extract (e.g. '1-5', '3,7,12-20')"),
  includeTables: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to detect and extract tables"),
  includeImages: z
    .boolean()
    .optional()
    .default(false)
    .describe("Whether to extract images"),
  mode: z
    .enum(["fast", "auto", "ocr"])
    .optional()
    .default("auto")
    .describe("Parsing mode: 'fast' for text-only, 'auto' for smart detection, 'ocr' for scanned PDFs"),
});

export type PdfUploadOptions = z.infer<typeof pdfUploadOptionsSchema>;