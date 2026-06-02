import { Meta } from "..";
import { Document } from "../../../controllers/types";

// No-op: screenshots are kept as data URLs in self-hosted mode
export function uploadScreenshot(meta: Meta, document: Document): Document {
  return document;
}
