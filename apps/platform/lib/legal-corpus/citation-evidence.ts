import { z } from "zod";
import { completeArticleText, completeDocumentText } from "../legal/article-context";
import { normalizedLegalSourceSnapshotSchema } from "../legal/source-parser";
import { legalEnvironmentSchema, legalLanguageSchema, lexDocumentUrlSchema, sha256Schema } from "./target-domain-schemas";
import { acceptsPrivateServiceRequest, declaredRequestBodyWithinLimit, privateServiceJson } from "./private-service-boundary";
import type { LegalEvidenceBucket } from "./target-evidence";
import {readBoundedLegalSourceBytes} from "../legal/source-fetch";
import {normalizeArticleNumber, detectArticleNumbers} from "../legal/legal-language";

export const CITATION_EVIDENCE_PATH = "/internal/legal-corpus/citations/evidence";
const MARKER = "citation-evidence-v1";
export const citationEvidenceLocatorSchema = z.object({
  version: z.literal(1), capability: z.enum(["current", "history"]),
  kind: z.enum(["provision", "normalized-article", "normalized-document"]),
  r2Key: z.string().min(1).max(700), byteCount: z.number().int().positive().max(8_000_000),
  sha256: sha256Schema, officialUrl: lexDocumentUrlSchema,
  languageTag: legalLanguageSchema, articleNumber: z.string().min(1).max(160).nullable(),
}).strict();
export const citationEvidenceReceiptSchema = citationEvidenceLocatorSchema.extend({textSha256: sha256Schema});
export type CitationEvidenceReceipt = z.infer<typeof citationEvidenceReceiptSchema>;

export function assertCitationEvidenceIdentity(receipt: CitationEvidenceReceipt, expected: {
  officialUrl: string; languageTag: string; articleNumber: string | null; sha256: string; textSha256?: string;
}): void {
  const article = (value: string | null) => value === null ? null
    : normalizeArticleNumber(value) || detectArticleNumbers(value)[0] || undefined;
  if (receipt.officialUrl !== expected.officialUrl || receipt.languageTag !== expected.languageTag
    || receipt.sha256 !== expected.sha256 || article(receipt.articleNumber) === undefined
    || article(receipt.articleNumber) !== article(expected.articleNumber)
    || (expected.textSha256 !== undefined && receipt.textSha256 !== expected.textSha256)) {
    throw new TypeError("CITATION_EVIDENCE_IDENTITY_MISMATCH");
  }
}

const digest = async (bytes: Uint8Array) => [...new Uint8Array(await crypto.subtle.digest("SHA-256",
  new Uint8Array(bytes).buffer))].map(byte => byte.toString(16).padStart(2, "0")).join("");

/** The ownership-checked receipt pins immutable bytes, not a current pointer.
 * Neither this receipt nor citation storage contains complete source text. */
export async function resolveCitationEvidence(bucket: Pick<LegalEvidenceBucket, "get">, receipt: CitationEvidenceReceipt) {
  const value = citationEvidenceReceiptSchema.parse(receipt);
  const object = await bucket.get(value.r2Key);
  if (!object || object.size !== value.byteCount) throw new TypeError("CITATION_EVIDENCE_UNAVAILABLE");
  const bytes = await object.bytes();
  if (bytes.byteLength !== value.byteCount || await digest(bytes) !== value.sha256) {
    throw new TypeError("CITATION_EVIDENCE_HASH_MISMATCH");
  }
  const decoded = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  let text: string;
  if (value.kind === "normalized-article" || value.kind === "normalized-document") {
    const snapshot = normalizedLegalSourceSnapshotSchema.parse(JSON.parse(decoded));
    if (snapshot.source.sourceKind !== "lex" || snapshot.source.canonicalUrl !== value.officialUrl
      || ({ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"} as const)[snapshot.source.locale] !== value.languageTag) {
      throw new TypeError("CITATION_EVIDENCE_IDENTITY_MISMATCH");
    }
    if (value.kind === "normalized-document") {
      const document = value.articleNumber === null && completeDocumentText(snapshot);
      if (!document) throw new TypeError("CITATION_DOCUMENT_UNAVAILABLE");
      text = document;
    } else {
      const article = value.articleNumber && completeArticleText(snapshot.blocks, value.articleNumber);
      if (!article) throw new TypeError("CITATION_ARTICLE_UNAVAILABLE");
      text = article.text;
    }
  } else {
    if (decoded.trimStart().startsWith("{")) {
      const provision = z.object({sourceUrl: z.string(), languageTag: z.string(), provisionText: z.string()}).parse(JSON.parse(decoded));
      if (provision.sourceUrl !== value.officialUrl || provision.languageTag !== value.languageTag) {
        throw new TypeError("CITATION_EVIDENCE_IDENTITY_MISMATCH");
      }
      text = provision.provisionText;
    } else text = decoded;
  }
  if (text.length > 200_000 || await digest(new TextEncoder().encode(text)) !== value.textSha256) {
    throw new TypeError("CITATION_EVIDENCE_TEXT_MISMATCH");
  }
  return {text, fullArticle: value.kind === "normalized-article", truncated: false};
}

export async function handleCitationEvidenceRequest(request: Request, env: {
  APP_ENV?: string; LEGAL_EVIDENCE_BUCKET?: Pick<LegalEvidenceBucket, "get">;
  LEGAL_HISTORY_EVIDENCE_BUCKET?: Pick<LegalEvidenceBucket, "get">;
}) {
  const environment = legalEnvironmentSchema.safeParse(env.APP_ENV);
  if (!environment.success || !acceptsPrivateServiceRequest(request, {environment: environment.data,
    marker: MARKER, method: "POST", path: CITATION_EVIDENCE_PATH, requireJson: true})
    || !declaredRequestBodyWithinLimit(request, 4096)) return privateServiceJson({code: "CITATION_UNAVAILABLE"}, 404);
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 4096) throw new TypeError("CITATION_REQUEST_TOO_LARGE");
    const receipt = citationEvidenceReceiptSchema.parse(JSON.parse(body));
    const bucket = receipt.capability === "history" ? env.LEGAL_HISTORY_EVIDENCE_BUCKET : env.LEGAL_EVIDENCE_BUCKET;
    if (!bucket) throw new TypeError("CITATION_BUCKET_UNAVAILABLE");
    const response = privateServiceJson(await resolveCitationEvidence(bucket, receipt));
    response.headers.set("x-juro-citation-evidence-contract", "1");
    return response;
  } catch { return privateServiceJson({code: "CITATION_UNAVAILABLE"}, 503); }
}

export async function fetchCitationEvidence(service: { fetch(input: Request | string | URL, init?: RequestInit): Promise<Response> }, environment: string, receipt: CitationEvidenceReceipt) {
  const response = await service.fetch(`http://legal-corpus.internal${CITATION_EVIDENCE_PATH}`, {
    method: "POST", headers: {"content-type": "application/json", "x-juro-service-binding": MARKER,
      "x-juro-legal-environment": environment}, body: JSON.stringify(receipt),
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) throw new TypeError("CITATION_EVIDENCE_UNAVAILABLE");
  if (response.headers.get("x-juro-citation-evidence-contract") !== "1") throw new TypeError("CITATION_EVIDENCE_CONTRACT_UNAVAILABLE");
  const bytes = await readBoundedLegalSourceBytes(response, 1_000_000, 8_000);
  const result = z.object({text: z.string().max(200_000), fullArticle: z.boolean(), truncated: z.literal(false)}).strict()
    .parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
  if (await digest(new TextEncoder().encode(result.text)) !== receipt.textSha256
    || result.fullArticle !== (receipt.kind === "normalized-article")) throw new TypeError("CITATION_EVIDENCE_TEXT_MISMATCH");
  return result;
}
