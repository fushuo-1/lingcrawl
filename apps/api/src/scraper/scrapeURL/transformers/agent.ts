import { Document } from "../../../controllers/types";
import { Meta } from "..";

export async function performAgent(
  meta: Meta,
  document: Document,
): Promise<Document> {
  return document;
}
