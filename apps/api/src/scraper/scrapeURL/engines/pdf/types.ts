export type PDFProcessorResult = {
  html: string;
  markdown?: string;
  tables?: ExtractedTable[];
  images?: ExtractedImage[];
  enhancedMetadata?: EnhancedPdfMetadata;
};

export type PdfMetadata = { numPages: number; title?: string };

export const MILLISECONDS_PER_PAGE = 150;

// --- Enhanced types for pdfjs engine ---

export interface ExtractedTable {
  page: number;
  tableIndex: number;
  rows: string[][];
  rowCount: number;
  colCount: number;
  confidence: number;
}

export interface ExtractedImage {
  page: number;
  index: number;
  width: number;
  height: number;
  format: string;
  data: string; // base64
}

export interface EnhancedPdfMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modDate?: string;
  pageCount: number;
  pdfVersion?: string;
}
