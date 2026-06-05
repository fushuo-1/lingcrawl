function normalizeSchemaForOpenAI(schema: any): any {
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const visited = new WeakSet();

  function normalizeObject(obj: any): any {
    if (typeof obj !== "object" || obj === null) return obj;
    if (Array.isArray(obj)) {
      return obj.map(item => normalizeObject(item));
    }

    if (visited.has(obj)) return obj;
    visited.add(obj);

    const normalized = { ...obj };

    // Handle $ref recursion - preserve as-is for OpenAI compatibility
    if (normalized.hasOwnProperty("$ref")) {
      return normalized;
    }

    if (normalized.hasOwnProperty("$defs")) {
      const { $defs, ...rest } = normalized;
      const processedRest = {};

      for (const [key, value] of Object.entries(rest)) {
        if (
          typeof value === "object" &&
          value !== null &&
          !value.hasOwnProperty("$ref")
        ) {
          processedRest[key] = normalizeObject(value);
        } else {
          processedRest[key] = value;
        }
      }

      const normalizedDefs = Object.fromEntries(
        Object.entries($defs ?? {}).map(([key, value]) => [
          key,
          normalizeObject(value),
        ]),
      );

      return { ...processedRest, $defs: normalizedDefs };
    }

    if (
      normalized.type === "object" &&
      normalized.hasOwnProperty("properties") &&
      normalized.hasOwnProperty("additionalProperties")
    ) {
      delete normalized.additionalProperties;
    }

    if (
      normalized.type === "object" &&
      normalized.hasOwnProperty("required") &&
      normalized.hasOwnProperty("properties")
    ) {
      if (
        Array.isArray(normalized.required) &&
        typeof normalized.properties === "object" &&
        normalized.properties !== null
      ) {
        const validRequired = normalized.required.filter((field: string) =>
          normalized.properties.hasOwnProperty(field),
        );
        if (validRequired.length > 0) {
          normalized.required = validRequired;
        } else {
          delete normalized.required;
        }
      } else {
        delete normalized.required;
      }
    }

    for (const [key, value] of Object.entries(normalized)) {
      if (
        typeof value === "object" &&
        value !== null &&
        !value.hasOwnProperty("$ref")
      ) {
        normalized[key] = normalizeObject(value);
      }
    }

    return normalized;
  }

  return normalizeObject(schema);
}

function validateSchemaForOpenAI(schema: any): boolean {
  if (!schema || typeof schema !== "object") {
    return true;
  }

  const visited = new WeakSet();

  function hasInvalidStructure(obj: any): boolean {
    if (typeof obj !== "object" || obj === null) return false;

    if (visited.has(obj)) return false;
    visited.add(obj);

    if (obj.hasOwnProperty("$ref")) {
      return false;
    }

    if (
      obj.type === "object" &&
      !obj.hasOwnProperty("properties") &&
      !obj.hasOwnProperty("patternProperties") &&
      obj.additionalProperties === true
    ) {
      return true;
    }

    for (const value of Object.values(obj)) {
      if (
        typeof value === "object" &&
        value !== null &&
        !value.hasOwnProperty("$ref")
      ) {
        if (hasInvalidStructure(value)) return true;
      }
    }
    return false;
  }

  return !hasInvalidStructure(schema);
}

export const OPENAI_SCHEMA_ERROR_MESSAGE =
  "Schema contains invalid structure for OpenAI: object type with no 'properties' defined but 'additionalProperties: true' (schema-less dictionary not supported by OpenAI). Please define specific properties for your object. Note: Recursive schemas using '$ref' are supported.";

export { normalizeSchemaForOpenAI, validateSchemaForOpenAI };
