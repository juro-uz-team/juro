import PizZip from "pizzip";
import { accountingPages } from "../billing/usage";

import {
  detectDocumentLanguage,
  extractDocument,
} from "../document-comparison/extract";
import {
  ComparisonProcessingError,
  type AnalysisPackageContext,
  type AnalysisPackageMemberRole,
  type AnalysisPackageRelationship,
  type AnalysisPackageRelationshipKind,
  type ExtractedDocument,
  type ExtractedSection,
} from "../document-comparison/types";
import { verifyArchiveBytes } from "./archive-inspector";
import { validateTextUploadBytes, validateUploadMagicBytes } from "./upload-pipeline";

const ZIP_MIME_TYPE = "application/zip";
const DOCX_MIME_TYPE = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const MAX_PACKAGE_PAGES = 500;
const MAX_INLINE_MEMBER_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_PACKAGE_BYTES = 50 * 1024 * 1024;
const MAX_RELATIONSHIP_EVIDENCE = 4;
const MAX_PACKAGE_RELATIONSHIPS = 120;

const memberMimeTypes = new Map([
  ["pdf", "application/pdf"],
  ["docx", DOCX_MIME_TYPE],
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["txt", "text/plain"],
  ["html", "text/html"],
  ["htm", "text/html"],
  ["json", "application/json"],
]);

export class PackageExtractionError extends Error {
  readonly code = "PACKAGE_CAPACITY_REQUIRED";

  constructor(message: string) {
    super(message);
    this.name = "PackageExtractionError";
  }
}

export type AnalysisPackageMember = {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
};

const rolePatterns: ReadonlyArray<{
  role: Exclude<AnalysisPackageMemberRole, "primary" | "unknown">;
  pattern: RegExp;
}> = [
  { role: "amendment", pattern: /(?:amendment|addendum|доп(?:олнительное)?\s+соглаш|qo['‘’]?shimcha\s+kelish)/iu },
  { role: "annex", pattern: /(?:annex|appendix|приложен|ilova)/iu },
  { role: "acceptance_act", pattern: /(?:acceptance|completion|акт(?:\s+при[её]м|\s+выполн)|dalolatnoma)/iu },
  { role: "correspondence", pattern: /(?:letter|notice|claim|претензи|письм|уведомлен|xat|bildirish)/iu },
  { role: "evidence", pattern: /(?:invoice|receipt|сч[её]т|квитан|чек|hisob|to['‘’]?lov)/iu },
];
const primaryPattern = /(?:contract|agreement|договор|контракт|shartnoma)/iu;

export function buildAnalysisPackageContext(
  documents: readonly ExtractedDocument[],
): AnalysisPackageContext {
  const provisionalRoles = documents.map(classifyPackageMemberRole);
  const explicitPrimaryIndex = provisionalRoles.findIndex((role) => role === "primary");
  const unknownIndex = provisionalRoles.findIndex((role) => role === "unknown");
  const primaryIndex = explicitPrimaryIndex >= 0 ? explicitPrimaryIndex : unknownIndex;
  const members = documents.map((document, index) => ({
    id: packageMemberId(index),
    name: document.fileName,
    mimeType: document.mimeType,
    role: index === primaryIndex ? "primary" as const : provisionalRoles[index]!,
    detectedLanguage: document.detectedLanguage,
    pageCount: document.pageCount,
    sectionCount: document.sections.length,
  }));
  const relationships: AnalysisPackageRelationship[] = [];
  const edgeKeys = new Set<string>();
  const primaryMemberId = primaryIndex >= 0 ? packageMemberId(primaryIndex) : null;

  function addRelationship(
    fromIndex: number,
    toIndex: number,
    kind: AnalysisPackageRelationshipKind,
    confidence: AnalysisPackageRelationship["confidence"],
    evidence: string[],
  ) {
    if (fromIndex === toIndex) return;
    const edge: AnalysisPackageRelationship = {
      fromMemberId: packageMemberId(fromIndex),
      toMemberId: packageMemberId(toIndex),
      kind,
      confidence,
      evidence: [...new Set(evidence)].slice(0, MAX_RELATIONSHIP_EVIDENCE),
    };
    const key = `${edge.fromMemberId}:${edge.toMemberId}:${edge.kind}`;
    if (edgeKeys.has(key)) return;
    edgeKeys.add(key);
    relationships.push(edge);
  }

  if (primaryIndex >= 0) {
    for (const [index, role] of provisionalRoles.entries()) {
      if (index === primaryIndex) continue;
      const inferred = roleRelationship(role);
      if (inferred) addRelationship(index, primaryIndex, inferred.kind, inferred.confidence, ["member_role"]);
    }
  }

  for (const [fromIndex, document] of documents.entries()) {
    const normalizedText = normalizeFileReferenceText(document.text);
    for (const [toIndex, target] of documents.entries()) {
      if (fromIndex === toIndex) continue;
      const targetStem = normalizedFileStem(target.fileName);
      if (targetStem.length >= 4 && normalizedText.includes(targetStem)) {
        addRelationship(fromIndex, toIndex, "references", "high", ["filename_reference"]);
      }
    }
  }

  for (let left = 0; left < documents.length; left += 1) {
    const leftText = normalizeComparableText(documents[left]!.text);
    if (leftText.length < 80) continue;
    for (let right = left + 1; right < documents.length; right += 1) {
      if (leftText === normalizeComparableText(documents[right]!.text)) {
        addRelationship(right, left, "possible_duplicate", "high", ["normalized_text_match"]);
      }
    }
  }

  relationships.sort((left, right) =>
    relationshipPriority(left).localeCompare(relationshipPriority(right))
    || left.fromMemberId.localeCompare(right.fromMemberId)
    || left.toMemberId.localeCompare(right.toMemberId)
    || left.kind.localeCompare(right.kind));
  return {
    schemaVersion: 1,
    primaryMemberId,
    members,
    relationships: relationships.slice(0, MAX_PACKAGE_RELATIONSHIPS),
  };
}

export function isAnalysisPackageContext(value: unknown): value is AnalysisPackageContext {
  if (!value || typeof value !== "object") return false;
  const context = value as Partial<AnalysisPackageContext>;
  if (context.schemaVersion !== 1 || !Array.isArray(context.members) || !Array.isArray(context.relationships)) return false;
  if (context.members.length > 20 || context.relationships.length > MAX_PACKAGE_RELATIONSHIPS) return false;
  const ids = new Set<string>();
  for (const member of context.members) {
    if (!member || typeof member !== "object" || !/^package-member-\d{2}$/.test(member.id)
      || typeof member.name !== "string" || member.name.length < 1 || member.name.length > 240
      || typeof member.mimeType !== "string" || member.mimeType.length > 160
      || !["primary", "annex", "amendment", "acceptance_act", "correspondence", "evidence", "unknown"].includes(member.role)
      || !["ru", "uz", "mixed", "unknown"].includes(member.detectedLanguage)
      || (member.pageCount !== null && (!Number.isInteger(member.pageCount) || member.pageCount < 0 || member.pageCount > MAX_PACKAGE_PAGES))
      || !Number.isInteger(member.sectionCount) || member.sectionCount < 0 || member.sectionCount > 10_000) return false;
    if (ids.has(member.id)) return false;
    ids.add(member.id);
  }
  if (context.primaryMemberId !== null && (typeof context.primaryMemberId !== "string" || !ids.has(context.primaryMemberId))) return false;
  for (const relationship of context.relationships) {
    if (!relationship || typeof relationship !== "object"
      || !ids.has(relationship.fromMemberId) || !ids.has(relationship.toMemberId)
      || relationship.fromMemberId === relationship.toMemberId
      || !["annex_to", "amends", "acceptance_for", "supports", "references", "possible_duplicate"].includes(relationship.kind)
      || !["high", "medium", "low"].includes(relationship.confidence)
      || !Array.isArray(relationship.evidence) || relationship.evidence.length > MAX_RELATIONSHIP_EVIDENCE
      || relationship.evidence.some((item) => typeof item !== "string" || item.length < 1 || item.length > 80)) return false;
  }
  return true;
}

export async function readAnalysisPackageMembers(input: {
  bytes: Uint8Array;
  mimeType: string;
}): Promise<AnalysisPackageMember[]> {
  if (input.mimeType !== ZIP_MIME_TYPE) {
    throw new ComparisonProcessingError("UNSUPPORTED_FILE", "Ожидался ZIP-пакет документов.");
  }
  await verifyArchiveBytes(input.bytes, input.mimeType);
  let zip: PizZip;
  try {
    zip = new PizZip(input.bytes);
  } catch {
    throw new ComparisonProcessingError("CORRUPT_FILE", "ZIP-пакет повреждён или не может быть прочитан.");
  }

  const names = Object.keys(zip.files)
    .filter((name) => !zip.files[name]?.dir)
    .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  const members: AnalysisPackageMember[] = [];
  let totalMemberBytes = 0;
  for (const name of names) {
    const member = zip.file(name);
    const extension = name.split(".").at(-1)?.toLocaleLowerCase() ?? "";
    const mimeType = memberMimeTypes.get(extension);
    if (!member || !mimeType) {
      throw new ComparisonProcessingError("UNSUPPORTED_FILE", "ZIP-пакет содержит неподдерживаемый файл.");
    }
    const bytes = member.asUint8Array();
    totalMemberBytes += bytes.byteLength;
    if (bytes.byteLength > MAX_INLINE_MEMBER_BYTES || totalMemberBytes > MAX_INLINE_PACKAGE_BYTES) {
      throw new PackageExtractionError("ZIP-пакет превышает лимит встроенного безопасного извлечения.");
    }
    if (!validateUploadMagicBytes(mimeType, bytes.subarray(0, 16), bytes.subarray(Math.max(0, bytes.byteLength - 16)))) {
      throw new ComparisonProcessingError("CORRUPT_FILE", "Тип содержимого файла внутри ZIP не соответствует его расширению.");
    }
    if ((mimeType === "text/plain" || mimeType === "text/html" || mimeType === "application/json")
      && !validateTextUploadBytes(mimeType, bytes)) {
      throw new ComparisonProcessingError("CORRUPT_FILE", "Текстовый файл внутри ZIP повреждён или содержит активный HTML-контент.");
    }
    if (mimeType === DOCX_MIME_TYPE) await verifyArchiveBytes(bytes, mimeType);
    members.push({ name, mimeType, bytes });
  }
  return members;
}

export async function extractAnalysisDocument(input: {
  bytes: Uint8Array;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<ExtractedDocument> {
  if (input.mimeType !== ZIP_MIME_TYPE) return extractDocument(input);
  const members = await readAnalysisPackageMembers(input);
  const documents: ExtractedDocument[] = [];
  let totalPages = 0;

  for (const member of members) {
    if (member.mimeType.startsWith("image/")) {
      throw new ComparisonProcessingError(
        "OCR_REQUIRED",
        "ZIP-пакет содержит скан. Его нельзя анализировать до распознавания каждого файла отдельно.",
      );
    }
    const extracted = await extractDocument({
      bytes: member.bytes,
      fileName: member.name,
      mimeType: member.mimeType,
      sizeBytes: member.bytes.byteLength,
    });
    totalPages += extracted.pageCount ?? 0;
    if (totalPages > MAX_PACKAGE_PAGES) {
      throw new ComparisonProcessingError(
        "PAGE_LIMIT_EXCEEDED",
        `ZIP-пакет содержит более ${MAX_PACKAGE_PAGES} распознанных страниц.`,
      );
    }
    documents.push(extracted);
  }

  const text = documents
    .map((document) => `===== ФАЙЛ: ${JSON.stringify(document.fileName)} =====\n\n${document.text}`)
    .join("\n\n");
  const sections: ExtractedSection[] = [];
  for (const [documentIndex, document] of documents.entries()) {
    for (const section of document.sections) {
      sections.push({
        ...section,
        id: `package-${documentIndex + 1}-${section.id}`,
        index: sections.length,
        heading: section.heading ? `${document.fileName} — ${section.heading}` : document.fileName,
      });
    }
  }

  const warnings = documents
    .map((document) => document.warningCode)
    .filter((warning): warning is string => Boolean(warning));
  return {
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    pageCount: totalPages || null,
    detectedLanguage: detectDocumentLanguage(text),
    textQuality: documents.some((document) => document.textQuality === "limited") ? "limited" : "good",
    warningCode: ["PACKAGE_MULTI_DOCUMENT", ...warnings].join(","),
    text,
    sections,
    packageContext: buildAnalysisPackageContext(documents),
    accountingPages: documents.reduce((total, document) => total + accountingPages(document.text), 0),
  };
}

function classifyPackageMemberRole(document: ExtractedDocument): AnalysisPackageMemberRole {
  for (const candidate of rolePatterns) {
    if (candidate.pattern.test(document.fileName)) return candidate.role;
  }
  if (primaryPattern.test(document.fileName)) return "primary";

  const evidence = document.text.slice(0, 500);
  for (const candidate of rolePatterns) {
    if (candidate.pattern.test(evidence)) return candidate.role;
  }
  return primaryPattern.test(evidence) ? "primary" : "unknown";
}

function roleRelationship(role: AnalysisPackageMemberRole): {
  kind: AnalysisPackageRelationshipKind;
  confidence: AnalysisPackageRelationship["confidence"];
} | null {
  if (role === "annex") return { kind: "annex_to", confidence: "high" };
  if (role === "amendment") return { kind: "amends", confidence: "high" };
  if (role === "acceptance_act") return { kind: "acceptance_for", confidence: "medium" };
  if (role === "correspondence") return { kind: "references", confidence: "low" };
  if (role === "evidence") return { kind: "supports", confidence: "medium" };
  return null;
}

function relationshipPriority(relationship: AnalysisPackageRelationship): string {
  const confidence = { high: "0", medium: "1", low: "2" }[relationship.confidence];
  const kind = {
    amends: "0", annex_to: "1", acceptance_for: "2", supports: "3",
    possible_duplicate: "4", references: "5",
  }[relationship.kind];
  return `${confidence}${kind}`;
}

function packageMemberId(index: number): string {
  return `package-member-${String(index + 1).padStart(2, "0")}`;
}

function normalizedFileStem(name: string): string {
  return normalizeFileReferenceText(name.replace(/\.[^.]+$/u, ""));
}

function normalizeRelationshipText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ");
}

function normalizeFileReferenceText(value: string): string {
  return normalizeRelationshipText(value).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function normalizeComparableText(value: string): string {
  return normalizeRelationshipText(value).replace(/[^\p{L}\p{N}]+/gu, "");
}
