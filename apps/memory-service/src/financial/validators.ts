/**
 * Financial memory field validators — issue #99.
 *
 * 按 entity_type 校验必填字段。
 */
import type { CreateFinancialMemoryInput } from "./types.js";
import { FinancialValidationError } from "./errors.js";

const REQUIRED_FIELDS: Record<
  string,
  Array<keyof CreateFinancialMemoryInput>
> = {
  opinion: ["ticker", "direction", "timeHorizon", "confidence"],
  strategy: ["name", "assetClass"],
  position: ["ticker", "positionStatus", "quantity"],
  lesson: ["title", "lessonCategory"],
};

export function validateRequiredFields(
  input: CreateFinancialMemoryInput,
): void {
  const fields = REQUIRED_FIELDS[input.entityType];
  if (!fields) {
    throw new FinancialValidationError(
      `Unknown entity_type: ${input.entityType}`,
    );
  }

  const missing: string[] = [];
  for (const key of fields) {
    const value = input[key];
    if (value === undefined || value === null || value === "") {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new FinancialValidationError(
      `Missing required fields for ${input.entityType}: ${missing.join(", ")}`,
    );
  }
}
