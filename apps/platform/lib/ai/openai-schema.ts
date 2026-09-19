/**
 * OpenAI Structured Outputs accepts a subset of JSON Schema. Zod's draft-7
 * export includes the draft marker and validation annotations that are not
 * part of the provider contract for every supported model. Keep the complete
 * structural grammar here; the caller still validates the returned value with
 * the original Zod parser, so application-level bounds are not weakened.
 * Numeric bounds remain visible as descriptions so the provider can honor
 * limits that cannot be expressed in the common structural subset.
 */
export function openAiCompatibleJsonSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const unsupportedAnnotations = new Set([
    "$schema",
    "format",
    "minLength",
    "maxLength",
    "minItems",
    "maxItems",
    "minimum",
    "maximum",
    "multipleOf",
    "pattern",
    "default",
  ]);
  const describedBounds = new Set([
    "minLength", "maxLength", "minItems", "maxItems", "minimum", "maximum", "multipleOf",
  ]);
  const visit = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(visit);
    if (!value || typeof value !== "object") return value;
    const entries: Array<[string, unknown]> = [];
    const bounds: string[] = [];
    const inheritedDescriptions: string[] = [];
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (unsupportedAnnotations.has(key)) {
        if (describedBounds.has(key) && typeof nested === "number" && Number.isFinite(nested)) {
          bounds.push(`${key}=${nested}`);
        }
        continue;
      }
      const providerKey = key === "oneOf" ? "anyOf" : key;
      const visited = visit(nested);
      if (providerKey === "allOf" && Array.isArray(visited)
        && visited.every((entry) => entry && typeof entry === "object"
          && Object.keys(entry as Record<string, unknown>).every(name => name === "description"))) {
        for (const entry of visited) {
          if (typeof entry.description === "string") inheritedDescriptions.push(entry.description);
        }
        continue;
      }
      entries.push([providerKey, visited]);
    }
    const result = Object.fromEntries(entries);
    if (bounds.length || inheritedDescriptions.length) result.description = [
      typeof result.description === "string" ? result.description : "",
      ...inheritedDescriptions,
      bounds.length ? `Application validation bounds: ${bounds.join(", ")}.` : "",
    ].filter(Boolean).join(" ");
    return result;
  };
  return visit(schema) as Record<string, unknown>;
}
