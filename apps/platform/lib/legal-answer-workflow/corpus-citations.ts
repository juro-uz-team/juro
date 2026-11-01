import { isDeepStrictEqual } from "node:util";
import type { OfficialProvision } from "./contracts";
import type { CitationRecord } from "./citation-storage";
import type { ProvisionLocator } from "./evidence";

export type CorpusCitationReceipt = {
  locator: ProvisionLocator; title: string; articleTitle: string | null; sectionTitle?: string | null; language: string; textSha256: string;
  selected: { kind: CitationRecord["receipt"]["kind"]; articleNumber: string | null };
};

/** Citation presentation and reopen receipts are derived from retained evidence, never model-generated URLs. */
export function buildCorpusCitations(evidence: readonly OfficialProvision[], corpus: { receipt(identity: string): CorpusCitationReceipt | null },
  store: { namespace: string; generationSha256: string }): CitationRecord[] {
  if (!/^[a-f0-9]{64}$/u.test(store.generationSha256) || store.namespace !== `legal-prepared-${store.generationSha256}`) {
    throw new Error("CITATION_STORE_IDENTITY");
  }
  if (new Set(evidence.map(item => item.identity)).size !== evidence.length) throw new Error("CITATION_EVIDENCE_DUPLICATE");
  return evidence.map(item => {
    const retained = corpus.receipt(item.identity);
    const locator = { ...item } as Partial<OfficialProvision>;
    delete locator.text;
    if (!retained || !isDeepStrictEqual(locator, retained.locator)) throw new Error("CITATION_EVIDENCE_MISMATCH");
    const verifiedAt = locator.editionObservation?.observedAt;
    if (!verifiedAt) throw new Error("CITATION_OBSERVATION_MISSING");
    if (!["en", "ru", "uz-Latn", "uz-Cyrl"].includes(retained.language)) throw new Error("CITATION_LANGUAGE_INVALID");
    return {
      evidence: structuredClone(item), accessMode: "direct",
      source: { sourceId: item.identity, actTitle: retained.title, actIdentifier: null,
        article: retained.sectionTitle ?? retained.articleTitle, excerpt: null, originalUrl: item.sourceUrl,
        status: "unconfirmed", effectiveDate: null, verifiedAt },
      receipt: { version: 2, capability: item.temporalState === "current_supported" ? "current" : "history",
        kind: retained.selected.kind, r2Key: item.objectKey, byteCount: item.byteCount, sha256: item.sha256,
        officialUrl: item.sourceUrl, languageTag: retained.language as "en" | "ru" | "uz-Latn" | "uz-Cyrl",
        articleNumber: retained.selected.articleNumber, textSha256: retained.textSha256, store: { ...store } },
    };
  });
}
