import { deflateSync } from "node:zlib";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import type {
  PDFProcessorResult,
  ExtractedTable,
  ExtractedImage,
  EnhancedPdfMetadata,
} from "./types";

/**
 * pdfjs-dist based PDF extraction with per-page text, table detection,
 * image extraction, and enhanced metadata.
 *
 * Loaded lazily to avoid startup cost when not needed.
 */
let pdfjsLib: any = null;

async function getPdfjs() {
  if (!pdfjsLib) {
    pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
    // In Node.js, pdfjs-dist requires an explicit worker path
    const pdfjsPkgPath = require.resolve("pdfjs-dist/package.json");
    const pdfjsDir = dirname(pdfjsPkgPath);
    const workerPath = resolve(pdfjsDir, "legacy/build/pdf.worker.mjs");
    pdfjsLib.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href;
  }
  return pdfjsLib;
}

// --- Page range parsing ---

function parsePageRange(spec: string, maxPages: number): number[] {
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (!isNaN(start) && !isNaN(end)) {
        for (let i = Math.max(1, start); i <= Math.min(maxPages, end); i++) {
          pages.add(i);
        }
      }
    } else {
      const num = parseInt(trimmed, 10);
      if (!isNaN(num) && num >= 1 && num <= maxPages) {
        pages.add(num);
      }
    }
  }
  return [...pages].sort((a, b) => a - b);
}

// --- Text extraction (per page, sorted by Y-coordinate) ---

interface TextItem {
  str: string;
  transform: number[]; // [scaleX, shearX, shearY, scaleY, x, y]
}

async function extractPageText(
  page: any,
): Promise<string> {
  const content = await page.getTextContent();
  const items = content.items as TextItem[];

  if (items.length === 0) return "";

  // Group by Y-coordinate (transform[5]), sort descending (top of page first)
  const lines: Map<number, TextItem[]> = new Map();
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    // Find existing line within 2px tolerance
    let matchedY: number | null = null;
    for (const existingY of lines.keys()) {
      if (Math.abs(existingY - y) <= 2) {
        matchedY = existingY;
        break;
      }
    }
    const key = matchedY !== null ? matchedY : y;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key)!.push(item);
  }

  // Sort lines by Y descending, items within line by X ascending
  const sortedLines = [...lines.entries()]
    .sort(([a], [b]) => b - a)
    .map(([_, items]) =>
      items
        .sort((a, b) => a.transform[4] - b.transform[4])
        .map(i => i.str)
        .join(" ")
    );

  return sortedLines.join("\n");
}

// --- Table detection (spatial clustering) ---

function detectTables(
  items: TextItem[],
  pageNum: number,
): ExtractedTable[] {
  if (items.length < 6) return []; // Need at least a header + a few rows

  // Group items into rows by Y-coordinate
  const rowMap = new Map<number, TextItem[]>();
  for (const item of items) {
    const y = Math.round(item.transform[5]);
    let matchedY: number | null = null;
    for (const existingY of rowMap.keys()) {
      if (Math.abs(existingY - y) <= 3) {
        matchedY = existingY;
        break;
      }
    }
    const key = matchedY !== null ? matchedY : y;
    if (!rowMap.has(key)) rowMap.set(key, []);
    rowMap.get(key)!.push(item);
  }

  const rows = [...rowMap.entries()]
    .sort(([a], [b]) => b - a) // top to bottom
    .map(([_, items]) => items.sort((a, b) => a.transform[4] - b.transform[4]));

  if (rows.length < 2) return [];

  // Detect column boundaries by analyzing X-positions across rows
  const allX = rows.flatMap(row => row.map(i => i.transform[4]));
  const xSorted = [...new Set(allX.map(x => Math.round(x)))].sort((a, b) => a - b);

  // Cluster X positions into column boundaries (gap > 30px = new column)
  const colBoundaries: number[] = [xSorted[0]];
  for (let i = 1; i < xSorted.length; i++) {
    if (xSorted[i] - xSorted[i - 1] > 30) {
      colBoundaries.push(xSorted[i]);
    }
  }

  if (colBoundaries.length < 2) return []; // Need at least 2 columns

  // Assign each item to a column
  function getColIndex(x: number): number {
    let col = 0;
    for (let i = 0; i < colBoundaries.length; i++) {
      if (x >= colBoundaries[i] - 10) col = i;
    }
    return col;
  }

  // Build table grid
  const grid: string[][] = rows.map(row => {
    const cols = new Array(colBoundaries.length).fill("");
    for (const item of row) {
      const ci = getColIndex(item.transform[4]);
      cols[ci] = cols[ci] ? cols[ci] + " " + item.str : item.str;
    }
    return cols.map(c => c.trim());
  });

  // Filter out rows that are mostly empty (less than half the columns have content)
  const filledRows = grid.filter(
    row => row.filter(c => c.length > 0).length >= Math.ceil(colBoundaries.length / 2),
  );

  if (filledRows.length < 2) return [];

  // Confidence: based on how well-aligned the data is
  const totalCells = filledRows.length * colBoundaries.length;
  const filledCells = filledRows.reduce(
    (sum, row) => sum + row.filter(c => c.length > 0).length,
    0,
  );
  const confidence = Math.round((filledCells / totalCells) * 100) / 100;

  return [
    {
      page: pageNum,
      tableIndex: 0,
      rows: filledRows,
      rowCount: filledRows.length,
      colCount: colBoundaries.length,
      confidence,
    },
  ];
}

function tablesToMarkdown(tables: ExtractedTable[]): string {
  return tables
    .map(table => {
      const header = `| ${table.rows[0].join(" | ")} |`;
      const separator = `| ${table.rows[0].map(() => "---").join(" | ")} |`;
      const body = table.rows
        .slice(1)
        .map(row => `| ${row.join(" | ")} |`)
        .join("\n");
      return `${header}\n${separator}\n${body}`;
    })
    .join("\n\n");
}

// --- Image extraction ---

async function extractPageImages(
  page: any,
  pageNum: number,
): Promise<ExtractedImage[]> {
  const images: ExtractedImage[] = [];

  try {
    const ops = await page.getOperatorList();
    const fnArray = ops.fnArray;
    const argsArray = ops.argsArray;

    let imageIndex = 0;
    for (let i = 0; i < fnArray.length; i++) {
      // OPS.paintImageXObject = 85
      if (fnArray[i] === 85) {
        const imageName = argsArray[i][0];
        try {
          const img = await page.objs.get(imageName);
          if (img && img.data) {
            const width = img.width || 0;
            const height = img.height || 0;
            if (width > 0 && height > 0) {
              // Convert raw pixel data to base64
              const rawData = img.data;
              let format = "rgb";
              let pngBuffer: Buffer;

              if (rawData.length === width * height * 4) {
                format = "rgba";
                pngBuffer = rgbaToPng(rawData, width, height);
              } else if (rawData.length === width * height * 3) {
                format = "rgb";
                pngBuffer = rgbToPng(rawData, width, height);
              } else if (rawData.length === width * height) {
                format = "grayscale";
                pngBuffer = grayscaleToPng(rawData, width, height);
              } else {
                continue; // Unknown format
              }

              images.push({
                page: pageNum,
                index: imageIndex++,
                width,
                height,
                format,
                data: pngBuffer.toString("base64"),
              });
            }
          }
        } catch {
          // Skip unresolvable images
        }
      }
    }
  } catch {
    // If operator list fails, skip image extraction
  }

  return images;
}

// Minimal PNG encoder (no external dependency)
function createPngBuffer(
  pixels: Buffer,
  width: number,
  height: number,
  channels: number,
): Buffer {
  // PNG signature
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = channels === 4 ? 6 : channels === 1 ? 0 : 2; // color type
  ihdrData[10] = 0; // compression
  ihdrData[11] = 0; // filter
  ihdrData[12] = 0; // interlace
  const ihdr = makeChunk("IHDR", ihdrData);

  // IDAT chunk - add filter byte (0) before each row
  const rowSize = width * channels;
  const rawSize = height * (1 + rowSize);
  const rawData = Buffer.alloc(rawSize);
  for (let y = 0; y < height; y++) {
    rawData[y * (1 + rowSize)] = 0; // filter: none
    pixels.copy(rawData, y * (1 + rowSize) + 1, y * rowSize, (y + 1) * rowSize);
  }
  const compressed = deflateSync(rawData);
  const idat = makeChunk("IDAT", compressed);

  // IEND chunk
  const iend = makeChunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

function makeChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function rgbToPng(data: Uint8ClampedArray, w: number, h: number): Buffer {
  return createPngBuffer(Buffer.from(data), w, h, 3);
}

function rgbaToPng(data: Uint8ClampedArray, w: number, h: number): Buffer {
  return createPngBuffer(Buffer.from(data), w, h, 4);
}

function grayscaleToPng(data: Uint8ClampedArray, w: number, h: number): Buffer {
  return createPngBuffer(Buffer.from(data), w, h, 1);
}

// --- Metadata extraction ---

async function extractEnhancedMetadata(
  doc: any,
): Promise<EnhancedPdfMetadata> {
  let info: Record<string, any> = {};
  try {
    info = await doc.getMetadata();
  } catch {
    // ignore
  }

  const infoData = info.info || {};
  const metadata = info.metadata?._metadata || {};

  return {
    title: infoData.Title || metadata["dc:title"] || undefined,
    author: infoData.Author || metadata["dc:creator"] || undefined,
    subject: infoData.Subject || metadata["dc:subject"] || undefined,
    keywords: infoData.Keywords || undefined,
    creator: infoData.Creator || undefined,
    producer: infoData.Producer || undefined,
    creationDate: infoData.CreationDate || metadata["xmp:createDate"] || undefined,
    modDate: infoData.ModDate || metadata["xmp:modifyDate"] || undefined,
    pageCount: doc.numPages,
    pdfVersion: infoData.PDFFormatVersion || undefined,
  };
}

// --- Main entry point ---

export async function extractWithPdfjs(
  filePath: string,
  options: {
    pages?: string;
    maxPages?: number;
    includeTables?: boolean;
    includeImages?: boolean;
  },
): Promise<PDFProcessorResult> {
  const pdfjs = await getPdfjs();

  // Load PDF - supports both local files and URLs
  const loadingTask = pdfjs.getDocument({
    url: filePath.startsWith("/") || filePath.match(/^[A-Z]:\\/i)
      ? `file://${filePath}`
      : filePath,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    verbosity: 0,
  });

  const doc = await loadingTask.promise;
  const totalPages = doc.numPages;
  const effectiveMax = options.maxPages
    ? Math.min(totalPages, options.maxPages)
    : totalPages;

  // Determine which pages to extract
  const pageNumbers = options.pages
    ? parsePageRange(options.pages, effectiveMax)
    : Array.from({ length: effectiveMax }, (_, i) => i + 1);

  // Extract metadata
  const enhancedMetadata = await extractEnhancedMetadata(doc);

  // Extract text, tables, images per page
  const pageTexts: string[] = [];
  const allTables: ExtractedTable[] = [];
  const allImages: ExtractedImage[] = [];

  for (const pageNum of pageNumbers) {
    const page = await doc.getPage(pageNum);

    // Text
    const text = await extractPageText(page);
    pageTexts.push(`<!-- Page ${pageNum} -->\n${text}`);

    // Tables
    if (options.includeTables) {
      const content = await page.getTextContent();
      const tables = detectTables(content.items as TextItem[], pageNum);
      allTables.push(...tables);
    }

    // Images
    if (options.includeImages) {
      const images = await extractPageImages(page, pageNum);
      allImages.push(...images);
    }
  }

  // Build markdown output
  let markdown = pageTexts.join("\n\n");

  // Append tables as markdown
  if (allTables.length > 0) {
    markdown += "\n\n## Detected Tables\n\n" + tablesToMarkdown(allTables);
  }

  // Append image info (not base64 data in markdown to keep it readable)
  if (allImages.length > 0) {
    markdown +=
      "\n\n## Extracted Images\n\n" +
      allImages
        .map(
          img =>
            `- Page ${img.page}, Image ${img.index}: ${img.width}x${img.height} (${img.format})`,
        )
        .join("\n");
  }

  return {
    html: markdown,
    markdown,
    tables: allTables.length > 0 ? allTables : undefined,
    images: allImages.length > 0 ? allImages : undefined,
    enhancedMetadata,
  };
}
