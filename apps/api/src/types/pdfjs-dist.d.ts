declare module "pdfjs-dist" {
  export const GlobalWorkerOptions: { workerSrc: string };
  export function getDocument(params: {
    url: string;
    isEvalSupported?: boolean;
    useSystemFonts?: boolean;
  }): { promise: Promise<PDFDocumentProxy> };

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNum: number): Promise<PDFPageProxy>;
    getMetadata(): Promise<{
      info: Record<string, any>;
      metadata: { _metadata?: Record<string, string> };
    }>;
  }

  export interface PDFPageProxy {
    getTextContent(): Promise<TextContent>;
    getOperatorList(): Promise<OperatorList>;
    objs: {
      get(name: string): Promise<{
        data?: Uint8ClampedArray;
        width?: number;
        height?: number;
      } | null>;
    };
  }

  export interface TextContent {
    items: Array<{
      str: string;
      transform: number[];
      width?: number;
      height?: number;
    }>;
  }

  export interface OperatorList {
    fnArray: number[];
    argsArray: any[][];
  }
}
