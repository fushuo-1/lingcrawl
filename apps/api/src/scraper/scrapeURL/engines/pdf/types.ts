export type PDFProcessorResult = { html: string; markdown?: string };

export type PdfMetadata = { numPages: number; title?: string };

export const MILLISECONDS_PER_PAGE = 150;
