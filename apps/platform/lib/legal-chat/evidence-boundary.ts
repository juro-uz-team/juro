import { assertCitationEvidenceIdentity, citationEvidenceReceiptSchema } from "../legal-corpus/citation-evidence";
import { MAX_LEGAL_EVIDENCE_CHARACTERS, MAX_LEGAL_EVIDENCE_SOURCES } from "../legal/legal-evidence-budget";
import type { AnswerQuestion, LegalTime } from "./answer-engine";

export function timeIdentity(time: LegalTime): string {
  if (time.kind === "current") return "current";
  return new Date(time.instant).toISOString();
}

export async function assertAnswerEvidence(input: AnswerQuestion): Promise<void> {
  const endpoints = input.temporalScope.kind === "comparison"
    ? [input.temporalScope.left, input.temporalScope.right] : [input.temporalScope];
  const allowedTimes = new Set(endpoints.map(timeIdentity));
  const identities = new Set<string>();
  if (input.evidence.length > MAX_LEGAL_EVIDENCE_SOURCES
    || input.evidence.reduce((size, evidence) => size + evidence.text.length, 0) > MAX_LEGAL_EVIDENCE_CHARACTERS) {
    throw new Error("EVIDENCE_CONTEXT_EXCEEDED");
  }
  for (const evidence of input.evidence) {
    const source = evidence.source;
    const url = new URL(source.officialUrl);
    if (!source.id || identities.has(source.id) || source.sourceType !== "lex"
      || !["OFFICIAL_LEGISLATION", "OFFICIAL_GOVERNMENT_GUIDANCE"].includes(source.sourceClass ?? "")
      || !["verified", "direct_validated"].includes(source.verificationState)
      || !["current", "historical"].includes(source.status)
      || url.protocol !== "https:" || !["lex.uz", "www.lex.uz"].includes(url.hostname)
      || url.username || url.password || url.port || !/^\/(?:ru\/|uz\/|uzc\/|en\/)?docs\/-?\d+\/?$/u.test(url.pathname)
      || !/^[a-f0-9]{64}$/.test(source.contentSha256) || !evidence.text.trim()
      || !allowedTimes.has(timeIdentity(evidence.endpoint))
      || (evidence.endpoint.kind === "current") !== (source.status === "current")) {
      throw new Error("EVIDENCE_IDENTITY_INVALID");
    }
    identities.add(source.id);
    const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(evidence.text)))]
      .map(byte => byte.toString(16).padStart(2, "0")).join("");
    if (hash !== evidence.textSha256) throw new Error("EVIDENCE_TEXT_HASH_MISMATCH");
    if (source.citationEvidenceReceipt) {
      const receipt = citationEvidenceReceiptSchema.parse(source.citationEvidenceReceipt);
      assertCitationEvidenceIdentity(receipt, { officialUrl: source.officialUrl,
        languageTag: ({ ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en" } as Record<string, string>)[source.locale] ?? source.locale,
        articleNumber: source.article ?? null, sha256: source.contentSha256, textSha256: evidence.textSha256,
      });
      if ((receipt.capability === "current") !== (evidence.endpoint.kind === "current")) throw new Error("EVIDENCE_TEMPORAL_MISMATCH");
    }
  }
}
