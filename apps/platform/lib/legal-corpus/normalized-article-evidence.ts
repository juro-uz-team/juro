import { completeArticleText } from "../legal/article-context";
import { normalizedLegalSourceSnapshotSchema } from "../legal/source-parser";
import type { LegalEvidenceBucket, ResolvedOfficialEvidence } from "./target-evidence";

/** Request-local recovery from the exact accepted parent snapshot. No lookup
 * result or live page can replace the parent hash anchored by the rendition. */
export function createNormalizedArticleEvidenceReader(bucket: Pick<LegalEvidenceBucket, "get">) {
  type Parent = {
    snapshot: ReturnType<typeof normalizedLegalSourceSnapshotSchema.parse>;
    r2Key: string; byteCount: number; sha256: string;
  };
  const snapshots = new Map<string, Parent>();
  const pendingSnapshots = new Map<string, Promise<Parent | null>>();
  const lanes: Promise<void>[] = [Promise.resolve(), Promise.resolve()];
  let nextLane = 0;
  let cachedBytes = 0;
  return async (original: ResolvedOfficialEvidence, article: string,
    sourceRevisionId: string = original.textRevisionId): Promise<ResolvedOfficialEvidence | null> => {
    const r2Key = `corpus/normalized/${sourceRevisionId}.json`;
    const sha256 = original.evidence.sourceNormalizedSha256;
    const key = `${r2Key}:${sha256}`;
    const cached = snapshots.get(key);
    if (cached) {snapshots.delete(key); snapshots.set(key, cached);}
    let pending = cached ? Promise.resolve(cached) : pendingSnapshots.get(key);
    if (!pending) {
      const lane = nextLane++ % lanes.length;
      pending = lanes[lane]!.then(async () => {
        const startedAt = Date.now();
        try {
          const object = await bucket.get(r2Key);
          if (!object || object.size > 4_000_000) return null;
          const bytes = await object.bytes();
          if (bytes.byteLength !== object.size) return null;
          const actual = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
          if ([...new Uint8Array(actual)].map(byte => byte.toString(16).padStart(2, "0")).join("") !== sha256) return null;
          const snapshot = normalizedLegalSourceSnapshotSchema.parse(JSON.parse(
            new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
          console.info(JSON.stringify({event: "legal.normalized_article_snapshot_verified",
            byteCount: bytes.byteLength, elapsedMs: Date.now() - startedAt}));
          return {snapshot, r2Key, byteCount: bytes.byteLength, sha256};
        } catch { return null; }
      }).then(parent => {
        if (parent) {
          // Capacity bounds retained public snapshots, never which later
          // citation is eligible. Only two new parent reads run concurrently.
          while (snapshots.size >= 3 || cachedBytes + parent.byteCount > 8_000_000) {
            const oldest = snapshots.entries().next().value;
            if (!oldest) break;
            snapshots.delete(oldest[0]); cachedBytes -= oldest[1].byteCount;
          }
          snapshots.set(key, parent); cachedBytes += parent.byteCount;
        }
        return parent;
      }).finally(() => {pendingSnapshots.delete(key);});
      lanes[lane] = pending.then(() => undefined, () => undefined);
      pendingSnapshots.set(key, pending);
    }
    const parent = await pending;
    if (!parent || parent.snapshot.source.sourceKind !== "lex"
      || parent.snapshot.source.canonicalUrl !== original.officialCitation.url
      || ({ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"} as const)[parent.snapshot.source.locale] !== original.languageTag) return null;
    const context = completeArticleText(parent.snapshot.blocks, article);
    const originalText = original.provisionText.replace(/\s+/gu, " ").trim();
    if (!context || !context.text.startsWith(originalText)) return null;
    console.info(JSON.stringify({event: "legal.article_context_resolved",
      originalCharacters: original.provisionText.length, contextCharacters: context.text.length}));
    return {...original, provisionText: context.text, evidence: {...original.evidence,
      r2Key: parent.r2Key, byteCount: parent.byteCount, sha256: parent.sha256}};
  };
}
