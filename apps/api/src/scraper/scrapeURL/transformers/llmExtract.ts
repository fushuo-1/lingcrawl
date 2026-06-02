// Stub: LLM extract removed in self-hosted mode (requires OpenAI API key)
export async function performLLMExtract(meta: any, document: any) {
  return document;
}

export async function performSummary(meta: any, document: any) {
  return document;
}

export async function performQuery(meta: any, document: any) {
  return document;
}

export async function performCleanContent(meta: any, document: any) {
  return document;
}

export class LLMRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LLMRefusalError";
  }
}
