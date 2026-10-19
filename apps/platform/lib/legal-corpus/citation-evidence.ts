import { z } from "zod";
import { createCompleteArticleIndex, completeDocumentText, completeResolutionIntroductionContext } from "../legal/article-context";
import { normalizedLegalSourceSnapshotSchema } from "../legal/source-parser";
import { legalEnvironmentSchema, legalLanguageSchema, lexDocumentUrlSchema, sha256Schema } from "./target-domain-schemas";
import { acceptsPrivateServiceRequest, declaredRequestBodyWithinLimit, privateServiceJson } from "./private-service-boundary";
import type { LegalEvidenceBucket } from "./target-evidence";
import {readBoundedLegalSourceBytes} from "../legal/source-fetch";
import {normalizeArticleNumber, detectArticleNumbers} from "../legal/legal-language";
import {importedSourceContexts} from "../legal/imported-source-context";
import {completeDocumentSections} from "../legal/document-sections";

export const CITATION_EVIDENCE_PATH = "/internal/legal-corpus/citations/evidence";
const MARKER = "citation-evidence-v1";
export const citationEvidenceLocatorSchema = z.object({
  version: z.union([z.literal(1),z.literal(2)]), capability: z.enum(["current", "history"]),
  store: z.object({namespace:z.string().regex(/^legal-prepared-[a-f0-9]{64}$/u),generationSha256:sha256Schema}).strict().optional(),
  kind: z.enum(["provision", "normalized-article", "normalized-document", "normalized-section"]),
  r2Key: z.string().min(1).max(700), byteCount: z.number().int().positive().max(8_000_000),
  sha256: sha256Schema, officialUrl: lexDocumentUrlSchema,
  languageTag: legalLanguageSchema, articleNumber: z.string().min(1).max(160).nullable(),
}).strict().refine(value=>value.version===2?Boolean(value.store):value.store===undefined,"Evidence store binding must match receipt version");
export const citationEvidenceReceiptSchema = citationEvidenceLocatorSchema.safeExtend({textSha256: sha256Schema});
export type CitationEvidenceReceipt = z.infer<typeof citationEvidenceReceiptSchema>;

export class RetiredCitationEvidenceError extends Error {
  constructor(){super("CITATION_EVIDENCE_RETIRED");this.name="RetiredCitationEvidenceError";}
}

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
  if (value.kind === "normalized-article" || value.kind === "normalized-document" || value.kind === "normalized-section") {
    const snapshot = normalizedLegalSourceSnapshotSchema.parse(JSON.parse(decoded));
    if (snapshot.source.sourceKind !== "lex" || snapshot.source.canonicalUrl !== value.officialUrl
      || ({ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl", en: "en"} as const)[snapshot.source.locale] !== value.languageTag) {
      throw new TypeError("CITATION_EVIDENCE_IDENTITY_MISMATCH");
    }
    if(value.kind === "normalized-section"){
      const matches=[];
      if(value.articleNumber!==null)throw new TypeError("CITATION_SECTION_UNAVAILABLE");
      for(const section of [...completeDocumentSections(snapshot),...importedSourceContexts(snapshot)])if(await digest(new TextEncoder().encode(section.text))===value.textSha256)matches.push(section);
      if(matches.length!==1)throw new TypeError("CITATION_SECTION_UNAVAILABLE");
      text=matches[0]!.text;
    } else if (value.kind === "normalized-document") {
      const document = value.articleNumber === null && (completeDocumentText(snapshot)??completeResolutionIntroductionContext(snapshot));
      if (!document) throw new TypeError("CITATION_DOCUMENT_UNAVAILABLE");
      text = document;
    } else {
      const candidates = value.articleNumber ? createCompleteArticleIndex(snapshot.blocks)(value.articleNumber).candidates : [];
      const matches = [];
      for (const candidate of candidates) {
        if (await digest(new TextEncoder().encode(candidate.text)) === value.textSha256) matches.push(candidate);
      }
      if (matches.length !== 1) throw new TypeError("CITATION_ARTICLE_UNAVAILABLE");
      text = matches[0]!.text;
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
  return {text, fullArticle: value.kind === "normalized-article", truncated: false, evidenceUnavailable:false};
}

export async function handleCitationEvidenceRequest(request: Request, env: {
  APP_ENV?: string; LEGAL_EVIDENCE_BUCKET?: Pick<LegalEvidenceBucket, "get">;
  LEGAL_HISTORY_EVIDENCE_BUCKET?: Pick<LegalEvidenceBucket, "get">;
  isRetiredEvidence?: (receipt:CitationEvidenceReceipt)=>Promise<boolean>;
  resolveEvidenceStore?: (store:NonNullable<CitationEvidenceReceipt["store"]>)=>Promise<Pick<LegalEvidenceBucket,"get">|null>;
}) {
  const environment = legalEnvironmentSchema.safeParse(env.APP_ENV);
  if (!environment.success || !acceptsPrivateServiceRequest(request, {environment: environment.data,
    marker: MARKER, method: "POST", path: CITATION_EVIDENCE_PATH, requireJson: true})
    || !declaredRequestBodyWithinLimit(request, 4096)) return privateServiceJson({code: "CITATION_UNAVAILABLE"}, 404);
  try {
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 4096) throw new TypeError("CITATION_REQUEST_TOO_LARGE");
    const receipt = citationEvidenceReceiptSchema.parse(JSON.parse(body));
    if(await env.isRetiredEvidence?.(receipt))return privateServiceJson({code:"CITATION_EVIDENCE_RETIRED"},410);
    const bucket = receipt.version===2&&receipt.store?await env.resolveEvidenceStore?.(receipt.store)
      :receipt.capability === "history" ? env.LEGAL_HISTORY_EVIDENCE_BUCKET : env.LEGAL_EVIDENCE_BUCKET;
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
  if(response.status===410){
    const bytes=await readBoundedLegalSourceBytes(response,4096,8_000);
    const body=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
    if(body?.code==="CITATION_EVIDENCE_RETIRED")throw new RetiredCitationEvidenceError();
  }
  if (!response.ok) throw new TypeError("CITATION_EVIDENCE_UNAVAILABLE");
  if (response.headers.get("x-juro-citation-evidence-contract") !== "1") throw new TypeError("CITATION_EVIDENCE_CONTRACT_UNAVAILABLE");
  const bytes = await readBoundedLegalSourceBytes(response, 1_000_000, 8_000);
  const result = z.object({text: z.string().max(200_000), fullArticle: z.boolean(), truncated: z.literal(false),evidenceUnavailable:z.literal(false).optional()}).strict()
    .parse(JSON.parse(new TextDecoder("utf-8", {fatal: true}).decode(bytes)));
  if (await digest(new TextEncoder().encode(result.text)) !== receipt.textSha256
    || result.fullArticle !== (receipt.kind === "normalized-article")) throw new TypeError("CITATION_EVIDENCE_TEXT_MISMATCH");
  return result;
}
