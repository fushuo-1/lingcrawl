import type { Parsers, PDFMode } from "../schemas/common";

export function shouldParsePDF(parsers?: Parsers): boolean {
  if (!parsers) return true;
  return parsers.some(parser => {
    if (parser === "pdf") return true;
    if (typeof parser === "object" && parser !== null && "type" in parser) {
      return (parser as any).type === "pdf";
    }
    return false;
  });
}

export function getPDFMaxPages(parsers?: Parsers): number | undefined {
  if (!parsers) return undefined;
  const pdfParser = parsers.find(parser => {
    if (typeof parser === "object" && parser !== null && "type" in parser) {
      return (parser as any).type === "pdf";
    }
    return false;
  });
  if (pdfParser && typeof pdfParser === "object" && "maxPages" in pdfParser) {
    return (pdfParser as any).maxPages;
  }
  return undefined;
}

export function getPDFMode(parsers?: Parsers): PDFMode {
  if (!parsers) return "auto";
  for (const parser of parsers) {
    if (parser === "pdf") return "auto";
    if (typeof parser === "object" && parser.type === "pdf") {
      return parser.mode ?? "auto";
    }
  }
  return "auto";
}

export function getPDFPages(parsers?: Parsers): string | undefined {
  if (!parsers) return undefined;
  for (const parser of parsers) {
    if (typeof parser === "object" && parser !== null && "pages" in parser) {
      return (parser as any).pages;
    }
  }
  return undefined;
}

export function getPDFIncludeTables(parsers?: Parsers): boolean {
  if (!parsers) return false;
  for (const parser of parsers) {
    if (typeof parser === "object" && parser !== null && "includeTables" in parser) {
      return (parser as any).includeTables === true;
    }
  }
  return false;
}

export function getPDFIncludeImages(parsers?: Parsers): boolean {
  if (!parsers) return false;
  for (const parser of parsers) {
    if (typeof parser === "object" && parser !== null && "includeImages" in parser) {
      return (parser as any).includeImages === true;
    }
  }
  return false;
}

export function needsPdfjsEngine(parsers?: Parsers): boolean {
  return !!(getPDFPages(parsers) || getPDFIncludeTables(parsers) || getPDFIncludeImages(parsers));
}
