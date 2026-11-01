/** Match a legacy reference only to the exact source identity in the owned saved answer. */
export function savedSourceIdentityMatches(serialized: string | null, sourceId: string, url: string, article: string | null) {
  if (!serialized || Buffer.byteLength(serialized) > 2 * 1024 * 1024) return false;
  let value: unknown;
  try { value = JSON.parse(serialized); } catch { return false; }
  if (!value || typeof value !== "object" || !("sources" in value) || !Array.isArray(value.sources)
    || value.sources.length > 512) return false;
  const selected = value.sources.filter((source: unknown) => source && typeof source === "object"
    && "sourceId" in source && source.sourceId === sourceId);
  if (selected.length !== 1) return false;
  const source: unknown = selected[0];
  return Boolean(source && typeof source === "object" && "originalUrl" in source && source.originalUrl === url
    && "article" in source && (source.article ?? null) === article);
}
