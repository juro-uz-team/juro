/** Recognize only the temporal shape qualified for compact group search.
 * Nested, namespace and additional metadata predicates retain the generic
 * adapter until their selectivity/recall has been qualified separately. */
export function compactVectorScope(filter: Record<string, unknown> | undefined,
  namespace: string | undefined): {instant?: number} | null {
  if (namespace !== undefined) return null;
  if (!filter || Object.keys(filter).length === 0) return {};
  if (Object.keys(filter).length !== 2 || !Object.hasOwn(filter, "valid_from_epoch")
    || !Object.hasOwn(filter, "valid_to_epoch")) return null;
  const from = filter.valid_from_epoch;
  const to = filter.valid_to_epoch;
  if (!from || typeof from !== "object" || Array.isArray(from)
    || !to || typeof to !== "object" || Array.isArray(to)) return null;
  const lower = Object.entries(from);
  const upper = Object.entries(to);
  if (lower.length !== 1 || upper.length !== 1 || lower[0]![0] !== "$lte" || upper[0]![0] !== "$gt") return null;
  const instant: unknown = lower[0]![1];
  return typeof instant === "number" && Number.isSafeInteger(instant) && upper[0]![1] === instant ? {instant} : null;
}

/** A conservative eligibility check, not a conversion: scoring keeps every
 * original coordinate. Tiny/large valid float32 queries use the generic path. */
export function supportsCompactVector(values: number[] | Float32Array): boolean {
  return values.every(value => Number.isFinite(value) && Math.abs(value) <= 65504)
    && values.some(value => Math.abs(value) >= 2 ** -24);
}
