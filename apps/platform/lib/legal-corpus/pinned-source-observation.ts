import {normalizedLegalSourceSnapshotSchema} from "../legal/source-parser";
import {publisherTextFingerprint} from "../legal/lex-document-status";
import {pinnedSourceStatusSchema, type SourceObservation, type PinnedSourceStatus} from "../legal/source-observation";
import type {LegalEvidenceBucket, ResolvedOfficialEvidence} from "./target-evidence";

/** Authenticate the parent before comparing current publisher text. A remapped
 * runtime revision never changes the original sealed snapshot's identity. */
export function createPinnedSourceVerifier(input: {
  bucket: Pick<LegalEvidenceBucket, "get">;
  observe: (officialUrl: string) => Promise<SourceObservation>;
}) {
  const fingerprints = new Map<string, Promise<string>>();
  const lanes: Promise<void>[] = Array.from({length: 4}, () => Promise.resolve());
  let nextLane = 0;
  return async (evidence: ResolvedOfficialEvidence): Promise<PinnedSourceStatus> => {
    const revision = evidence.evidence.sourceRevisionId ?? evidence.textRevisionId;
    const sha256 = evidence.evidence.sourceNormalizedSha256;
    const url = evidence.officialCitation.url;
    const key = JSON.stringify([revision, sha256, url, evidence.languageTag]);
    let fingerprint = fingerprints.get(key);
    if (!fingerprint) {
      const lane = nextLane++ % lanes.length;
      fingerprint = lanes[lane]!.then(async () => {
        const object = await input.bucket.get(`corpus/normalized/${revision}.json`);
        if (!object || object.size > 4_000_000) throw new TypeError("PINNED_SOURCE_REVISION_UNAVAILABLE");
        const bytes = await object.bytes();
        const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes).buffer);
        const actual = [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
        if (bytes.byteLength !== object.size || actual !== sha256) throw new TypeError("PINNED_SOURCE_REVISION_INVALID");
        const snapshot = normalizedLegalSourceSnapshotSchema.parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
        const language = {ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"}[snapshot.source.locale];
        if (snapshot.source.sourceKind !== "lex" || snapshot.source.canonicalUrl !== url || language !== evidence.languageTag) {
          throw new TypeError("PINNED_SOURCE_REVISION_INVALID");
        }
        return publisherTextFingerprint(snapshot);
      });
      lanes[lane] = fingerprint.then(() => undefined, () => undefined);
      fingerprints.set(key, fingerprint);
    }
    const [pinnedTextSha256, observation] = await Promise.all([fingerprint, input.observe(url).catch(() => null)]);
    return pinnedSourceStatusSchema.parse({pinnedTextSha256, observation});
  };
}
