// Stub: search index sender removed in self-hosted mode
export function sendToSearchIndex(...args: any[]) {
  return args[1]; // return document
}

export function sendDocumentToSearchIndex(meta: any, document: any) {
  return document;
}
