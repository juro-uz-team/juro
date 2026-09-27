import { z } from "zod";

import type { CustomRuntimeLegalIdentity } from "./custom-bm25-runtime";

import type { TemporalEndpoint } from "./legal-candidate-index";
import {
  acceptsPrivateServiceRequest,
  declaredRequestBodyWithinLimit,
  privateServiceJson,
} from "./private-service-boundary";
import {
  captureIdSchema,
  legalEnvironmentSchema,
  legalInstrumentIdSchema,
  legalLanguageSchema,
  legalScriptSchema,
  lexDocumentUrlSchema,
  officialExpressionIdSchema,
  provisionConceptIdSchema,
  provisionRenditionIdSchema,
  searchReleaseIdSchema,
  sha256Schema,
  textRevisionIdSchema,
  utcInstantSchema,
} from "./target-domain-schemas";

export const OFFICIAL_EVIDENCE_RESOLVE_PATH = "/internal/legal-corpus/target/evidence/resolve";

const SERVICE_BINDING_MARKER = "official-evidence-v1";
const textualAuthoritySchema = z.enum(["controlling", "official_translation", "unknown"]);
const temporalEndpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current") }).strict(),
  z.object({ kind: z.literal("timestamp"), instant: utcInstantSchema }).strict(),
]);
const authorityEvidenceSchema = z.object({
  kind: z.enum(["publisher_certification", "adoption_record", "official_publication"]),
  sourceUrl: lexDocumentUrlSchema,
  recordedAt: utcInstantSchema,
}).strict();
const rawEvidenceSchema = z.union([
  z.string().min(1).max(16_000_000),
  z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 16_000_000),
]);
const normalizedEvidenceSchema = z.union([
  z.string().min(1).max(8_000_000),
  z.instanceof(Uint8Array).refine((value) => value.byteLength > 0 && value.byteLength <= 8_000_000),
]);
const editorialValiditySchema = z.object({
  validFrom: utcInstantSchema,
  validTo: utcInstantSchema.nullable(),
  recordedAt: utcInstantSchema,
}).strict().superRefine((value, context) => {
  if (value.validTo !== null && Date.parse(value.validFrom) >= Date.parse(value.validTo)) {
    context.addIssue({ code: "custom", message: "Editorial validity must be a non-empty interval" });
  }
});
const applicabilitySchema = z.object({
  id: z.string().min(1).max(200),
  validFrom: utcInstantSchema,
  validTo: utcInstantSchema.nullable(),
  evidenceUrl: lexDocumentUrlSchema,
  evidenceKind: z.enum(["commencement_clause", "amendment_act", "repeal_act", "official_timeline"]),
  recordedAt: utcInstantSchema,
}).strict().superRefine((value, context) => {
  if (value.validTo !== null && Date.parse(value.validFrom) >= Date.parse(value.validTo)) {
    context.addIssue({ code: "custom", message: "Applicability must be a non-empty interval" });
  }
});
const currentPointerSchema = z.object({
  evidenceUrl: lexDocumentUrlSchema,
  verifiedAt: utcInstantSchema,
  recordedAt: utcInstantSchema,
}).strict();
const temporalGapSchema = z.object({
  id: z.string().min(1).max(200),
  kind: z.enum(["unknown", "ambiguous", "disputed"]),
  validFrom: utcInstantSchema.nullable().optional(),
  validTo: utcInstantSchema.nullable().optional(),
  evidenceUrl: lexDocumentUrlSchema,
  reason: z.string().trim().min(10).max(2_000),
  recordedAt: utcInstantSchema,
}).strict().superRefine((value, context) => {
  if (value.validFrom && value.validTo
    && Date.parse(value.validFrom) >= Date.parse(value.validTo)) {
    context.addIssue({ code: "custom", message: "Temporal gap must be a non-empty interval" });
  }
});

const importObjectSchema = z.object({
  legalInstrumentId: legalInstrumentIdSchema,
  publisherInstrumentToken: z.string().trim().min(1).max(200),
  officialExpressionId: officialExpressionIdSchema,
  textRevisionId: textRevisionIdSchema,
  provisionConceptId: provisionConceptIdSchema,
  publisherProvisionToken: z.string().trim().min(1).max(200),
  provisionRenditionId: provisionRenditionIdSchema,
  captureId: captureIdSchema,
  publisherRevisionToken: z.string().min(1).max(160),
  languageTag: legalLanguageSchema,
  script: legalScriptSchema,
  textualAuthority: textualAuthoritySchema,
  origin: z.enum(["certified_original", "adopted_original", "official_publisher", "unknown"]),
  publicationStatus: z.enum(["official", "withdrawn", "unknown"]),
  controllingOnConflict: z.boolean(),
  derivedFromExpressionId: officialExpressionIdSchema.nullable(),
  authorityEvidence: authorityEvidenceSchema.nullable(),
  canonicalInstrumentTitle: z.string().trim().min(1).max(2_000).optional(),
  actTitle: z.string().trim().min(1).max(2_000),
  documentType: z.string().trim().min(1).max(160),
  articleNumber: z.string().trim().min(1).max(160),
  // Lex.uz annex tables sometimes place an entire official cell in the title field.
  // Preserve that source value exactly; truncation would make the imported evidence lossy.
  articleTitle: z.string().trim().min(1).max(16_000).nullable().optional(),
  provisionSequence: z.number().int().nonnegative(),
  provisionText: z.string().min(1).max(500_000),
  renditionStatus: z.enum(["active", "historical", "repealed", "unknown"]).default("active"),
  rawCapture: rawEvidenceSchema,
  normalizedRevision: normalizedEvidenceSchema,
  sourceRawSha256: sha256Schema.optional(),
  sourceNormalizedSha256: sha256Schema.optional(),
  sourceProvisionSha256: sha256Schema.optional(),
  sourceUrl: lexDocumentUrlSchema,
  canonicalInstrumentUrl: lexDocumentUrlSchema.optional(),
  capturedAt: utcInstantSchema,
  migrationRunId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(160).optional(),
  cutoffAt: utcInstantSchema.optional(),
  editorialValidity: editorialValiditySchema.optional(),
  applicability: applicabilitySchema.optional(),
  currentPointer: currentPointerSchema.optional(),
  temporalGap: temporalGapSchema.optional(),
}).strict();

function validateImport(
  value: z.infer<typeof importObjectSchema>,
  context: z.RefinementCtx,
): void {
  if (
    value.textualAuthority === "controlling"
    && (!value.controllingOnConflict || !value.authorityEvidence)
  ) {
    context.addIssue({ code: "custom", message: "Controlling authority evidence required" });
  }
  if (value.textualAuthority !== "controlling" && value.controllingOnConflict) {
    context.addIssue({ code: "custom", message: "Only controlling text controls conflicts" });
  }
  if (
    value.textualAuthority === "official_translation"
    && (value.languageTag === "ru" || value.languageTag === "en")
    && !value.derivedFromExpressionId
  ) {
    context.addIssue({ code: "custom", message: "Translation derivation required" });
  }
  if (value.applicability && value.temporalGap) {
    context.addIssue({
      code: "custom",
      path: ["temporalGap"],
      message: "Applicability evidence and an unresolved temporal gap are mutually exclusive",
    });
  }
}

const importSchema = importObjectSchema.superRefine(validateImport);
const currentMigrationImportSchema = importObjectSchema.extend({
  renditionStatus: z.enum(["active", "historical", "repealed", "unknown"]),
  sourceRawSha256: sha256Schema,
  sourceNormalizedSha256: sha256Schema,
  sourceProvisionSha256: sha256Schema,
  canonicalInstrumentTitle: z.string().trim().min(1).max(2_000),
  canonicalInstrumentUrl: lexDocumentUrlSchema,
  migrationRunId: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(160),
  cutoffAt: utcInstantSchema,
  currentPointer: currentPointerSchema,
}).superRefine((value, context) => {
  validateImport(value, context);
  if ((value.applicability ? 1 : 0) + (value.temporalGap ? 1 : 0) !== 1) {
    context.addIssue({
      code: "custom",
      message: "Exactly one applicability fact or gap is required for a current migration",
    });
  }
  const observedAt = [
    value.capturedAt,
    value.authorityEvidence?.recordedAt,
    value.editorialValidity?.recordedAt,
    value.applicability?.recordedAt,
    value.temporalGap?.recordedAt,
    value.currentPointer.verifiedAt,
    value.currentPointer.recordedAt,
  ].filter((instant): instant is string => instant !== undefined);
  if (observedAt.some((instant) => Date.parse(instant) > Date.parse(value.cutoffAt))) {
    context.addIssue({
      code: "custom",
      path: ["cutoffAt"],
      message: "Current migration evidence must be observed at or before its immutable cutoff",
    });
  }
});

const provisionObjectSchema = z.object({
  schemaVersion: z.literal(1),
  legalInstrumentId: legalInstrumentIdSchema,
  publisherInstrumentToken: importObjectSchema.shape.publisherInstrumentToken,
  officialExpressionId: officialExpressionIdSchema,
  textRevisionId: textRevisionIdSchema,
  provisionConceptId: provisionConceptIdSchema,
  publisherProvisionToken: importObjectSchema.shape.publisherProvisionToken,
  provisionRenditionId: provisionRenditionIdSchema,
  languageTag: importObjectSchema.shape.languageTag,
  script: legalScriptSchema,
  textualAuthority: textualAuthoritySchema,
  actTitle: importObjectSchema.shape.actTitle,
  documentType: importObjectSchema.shape.documentType,
  articleNumber: importObjectSchema.shape.articleNumber,
  articleTitle: importObjectSchema.shape.articleTitle,
  provisionSequence: importObjectSchema.shape.provisionSequence,
  provisionText: importObjectSchema.shape.provisionText,
  renditionStatus: importObjectSchema.shape.renditionStatus,
  sourceUrl: lexDocumentUrlSchema,
  capturedAt: importObjectSchema.shape.capturedAt,
  sourceNormalizedSha256: sha256Schema,
}).strict();

// R2-native mappings carry the canonical legal identity. Evidence hydration only
// reads the stable, hash-bound fields needed to verify and present the original
// provision object, so legacy object identifiers do not become runtime joins.
const r2NativeProvisionEvidenceSchema = z.object({
  provisionRenditionId: provisionRenditionIdSchema,
  textRevisionId: textRevisionIdSchema.optional(),
  languageTag: importObjectSchema.shape.languageTag,
  script: legalScriptSchema,
  actTitle: importObjectSchema.shape.actTitle,
  articleNumber: importObjectSchema.shape.articleNumber,
  provisionText: importObjectSchema.shape.provisionText,
  sourceUrl: lexDocumentUrlSchema,
  sourceNormalizedSha256: sha256Schema,
}).passthrough();

const resolvedEvidenceSchema = z.object({
  legalInstrumentId: legalInstrumentIdSchema,
  officialExpressionId: officialExpressionIdSchema,
  textRevisionId: textRevisionIdSchema,
  provisionConceptId: provisionConceptIdSchema,
  provisionRenditionId: provisionRenditionIdSchema,
  languageTag: importObjectSchema.shape.languageTag,
  script: legalScriptSchema,
  textualAuthority: textualAuthoritySchema,
  provisionText: importObjectSchema.shape.provisionText,
  officialCitation: z.object({
    label: z.string().min(1).max(2_300),
    url: lexDocumentUrlSchema,
  }).strict(),
  evidence: z.object({
    provisionRenditionId: provisionRenditionIdSchema,
    r2Key: z.string().min(1).max(700),
    byteCount: z.number().int().positive(),
    sha256: sha256Schema,
    sourceNormalizedSha256: sha256Schema,
    schemaVersion: z.literal(1),
    sourceRevisionId: textRevisionIdSchema.optional(),
    normalizedScope: z.literal("section").optional(),
  }).strict(),
}).strict();

export type ResolvedOfficialEvidence = z.infer<typeof resolvedEvidenceSchema>;
export function parseResolvedOfficialEvidence(value: unknown): ResolvedOfficialEvidence {
  return resolvedEvidenceSchema.parse(value);
}
export type LegalEvidenceObject = {
  key: string;
  size: number;
  customMetadata?: Record<string, string>;
  bytes(): Promise<Uint8Array>;
};
type LegalEvidenceHead = Omit<LegalEvidenceObject, "bytes">;
export type LegalEvidenceBucket = {
  head(key: string): Promise<LegalEvidenceHead | null>;
  get(key: string): Promise<LegalEvidenceObject | null>;
  put(
    key: string,
    value: Uint8Array,
    options: {
      onlyIf: { etagDoesNotMatch: "*" };
      httpMetadata: { contentType: string };
      customMetadata: Record<string, string>;
      sha256: ArrayBuffer;
    },
  ): Promise<LegalEvidenceHead | null>;
};

export type OfficialEvidenceEnv = Pick<Env, "APP_ENV">
  & {
    LEGAL_DB?: D1Database;
    LEGAL_EVIDENCE_BUCKET?: Pick<LegalEvidenceBucket, "get">;
  };

export class LegalEvidenceError extends Error {
  constructor(readonly code:
    | "IMMUTABLE_EVIDENCE_CONFLICT"
    | "LEGAL_EVIDENCE_IDENTITY_CONFLICT"
    | "SOURCE_UNAVAILABILITY") {
    super(code);
    this.name = "LegalEvidenceError";
  }
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function evidenceBytes(value: string | Uint8Array): Uint8Array {
  return typeof value === "string" ? utf8(value) : value;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function sha256(bytes: Uint8Array): Promise<{ digest: ArrayBuffer; hex: string }> {
  const owned = new Uint8Array(bytes.byteLength);
  owned.set(bytes);
  const digest = await crypto.subtle.digest("SHA-256", owned.buffer);
  return { digest, hex: hex(digest) };
}

function deterministicJson(value: unknown): Uint8Array {
  return utf8(`${JSON.stringify(value)}\n`);
}

type Locator = {
  id: string;
  objectKind: "raw_capture" | "normalized_revision" | "provision_rendition";
  r2Key: string;
  mediaType: string;
  byteCount: number;
  sha256: string;
  sourceNormalizedSha256: string | null;
  ordinal: number;
  schemaVersion: 1;
  createdAt: string;
};

async function readAndVerifyObject(
  bucket: Pick<LegalEvidenceBucket, "get">,
  locator: Pick<Locator, "r2Key" | "byteCount" | "sha256">,
  metadataPolicy: "schema-v1" | "sealed-production-evidence" = "schema-v1",
): Promise<Uint8Array> {
  const object = await bucket.get(locator.r2Key);
  if (!object || object.size !== locator.byteCount) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  const bytes = await object.bytes();
  const actual = await sha256(bytes);
  // S3 captures lowercase metadata header names. Accept their spelling without
  // altering persisted metadata or accepting ambiguous declarations.
  const metadata = new Map<string, string>();
  for (const [key, value] of Object.entries(object.customMetadata ?? {})) {
    const canonical = key.toLowerCase();
    if (metadata.has(canonical) && metadata.get(canonical) !== value) {
      throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
    }
    metadata.set(canonical, value);
  }
  const metadataAccepted = metadata.get("schemaversion") === "1"
    || (metadataPolicy === "sealed-production-evidence"
      && metadata.get("kind") === "provision_rendition"
      && (metadata.get("source") === "evidence"
        || (metadata.get("schemaversion") === "complete-corpus-evidence-v1"
          && metadata.get("bytecount") === String(locator.byteCount))));
  if (
    bytes.byteLength !== locator.byteCount
    || actual.hex !== locator.sha256
    || metadata.get("sha256") !== locator.sha256
    || !metadataAccepted
  ) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  return bytes;
}

async function immutablePut(input: {
  bucket: LegalEvidenceBucket;
  id: string;
  objectKind: Locator["objectKind"];
  key: string;
  mediaType: string;
  bytes: Uint8Array;
  sourceNormalizedSha256?: string;
  expectedSha256?: string;
  optimisticCreate?: boolean;
  ordinal: number;
  createdAt: string;
}): Promise<Locator> {
  const hashed = await sha256(input.bytes);
  if (input.expectedSha256 && input.expectedSha256 !== hashed.hex) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  const locator: Locator = {
    id: input.id,
    objectKind: input.objectKind,
    r2Key: input.key,
    mediaType: input.mediaType,
    byteCount: input.bytes.byteLength,
    sha256: hashed.hex,
    sourceNormalizedSha256: input.sourceNormalizedSha256 ?? null,
    ordinal: input.ordinal,
    schemaVersion: 1,
    createdAt: input.createdAt,
  };
  const putOptions = {
      onlyIf: { etagDoesNotMatch: "*" },
      httpMetadata: { contentType: input.mediaType },
      customMetadata: {
        sha256: hashed.hex,
        schemaVersion: "1",
        objectKind: input.objectKind,
      },
      sha256: hashed.digest,
  } as const;
  if (input.optimisticCreate) {
    let created: LegalEvidenceHead | null;
    try {
      created = await input.bucket.put(input.key, input.bytes, putOptions);
    } catch (putError) {
      try {
        await readAndVerifyObject(input.bucket, locator);
        return locator;
      } catch {
        throw putError;
      }
    }
    if (created) {
      if (created.size !== locator.byteCount
        || created.customMetadata?.sha256 !== locator.sha256
        || created.customMetadata?.schemaVersion !== "1") {
        throw new LegalEvidenceError("IMMUTABLE_EVIDENCE_CONFLICT");
      }
      return locator;
    }
  } else {
    const existing = await input.bucket.head(input.key);
    if (!existing) await input.bucket.put(input.key, input.bytes, putOptions);
  }
  try {
    const verified = await readAndVerifyObject(input.bucket, locator);
    if (verified.byteLength !== input.bytes.byteLength) {
      throw new LegalEvidenceError("IMMUTABLE_EVIDENCE_CONFLICT");
    }
  } catch (error) {
    if (error instanceof LegalEvidenceError) {
      throw new LegalEvidenceError("IMMUTABLE_EVIDENCE_CONFLICT");
    }
    throw error;
  }
  return locator;
}

async function assertNaturalIdentityAvailability(
  db: D1Database,
  input: z.infer<typeof importSchema>,
): Promise<void> {
  const instrument = await db.prepare(`SELECT id,publisher_instrument_token AS token,
      canonical_title AS canonicalTitle,document_type AS documentType,
      canonical_url AS canonicalUrl,created_at AS createdAt
    FROM legal_instruments WHERE id=? OR publisher_instrument_token=?`).bind(
    input.legalInstrumentId,
    input.publisherInstrumentToken,
  ).first<{
    id: string;
    token: string;
    canonicalTitle: string;
    documentType: string;
    canonicalUrl: string;
    createdAt: string;
  }>();
  const expression = await db.prepare(`SELECT id,legal_instrument_id AS legalInstrumentId,
      language_tag AS languageTag,source_url AS sourceUrl,created_at AS createdAt,
      script,textual_authority AS textualAuthority,origin,
      publication_status AS publicationStatus,controlling_on_conflict AS controllingOnConflict,
      derived_from_expression_id AS derivedFromExpressionId,
      authority_evidence_json AS authorityEvidenceJson
    FROM legal_official_expressions
    WHERE id=? OR (legal_instrument_id=? AND language_tag=? AND script=? AND textual_authority=?)`).bind(
    input.officialExpressionId,
    input.legalInstrumentId,
    input.languageTag,
    input.script,
    input.textualAuthority,
  ).first<{
    id: string;
    legalInstrumentId: string;
    languageTag: string;
    sourceUrl: string;
    createdAt: string;
    script: string;
    textualAuthority: string;
    origin: string;
    publicationStatus: string;
    controllingOnConflict: number;
    derivedFromExpressionId: string | null;
    authorityEvidenceJson: string | null;
  }>();
  const revision = await db.prepare(`SELECT id,official_expression_id AS officialExpressionId,
      publisher_revision_token AS publisherRevisionToken,raw_locator_id AS rawLocatorId,
      normalized_locator_id AS normalizedLocatorId,captured_at AS capturedAt,
      created_at AS createdAt,script,textual_authority AS textualAuthority,
      authority_evidence_json AS authorityEvidenceJson
    FROM legal_text_revisions
    WHERE id=? OR (official_expression_id=? AND publisher_revision_token=?)`).bind(
    input.textRevisionId,
    input.officialExpressionId,
    input.publisherRevisionToken,
  ).first<{
    id: string;
    officialExpressionId: string;
    publisherRevisionToken: string;
    rawLocatorId: string;
    normalizedLocatorId: string;
    capturedAt: string;
    createdAt: string;
    script: string;
    textualAuthority: string;
    authorityEvidenceJson: string | null;
  }>();
  const concept = await db.prepare(`SELECT id,legal_instrument_id AS legalInstrumentId,
      publisher_concept_token AS token,created_at AS createdAt FROM legal_provision_concepts
    WHERE id=? OR (legal_instrument_id=? AND publisher_concept_token=?)`).bind(
    input.provisionConceptId,
    input.legalInstrumentId,
    input.publisherProvisionToken,
  ).first<{ id: string; legalInstrumentId: string; token: string; createdAt: string }>();
  const rendition = await db.prepare(`SELECT id,provision_concept_id AS provisionConceptId,
      text_revision_id AS textRevisionId,locator_id AS locatorId,article_number AS articleNumber,
      article_title AS articleTitle,sequence AS provisionSequence,source_url AS sourceUrl,
      status AS renditionStatus,created_at AS createdAt FROM legal_provision_renditions
    WHERE id=? OR (provision_concept_id=? AND text_revision_id=?)`).bind(
    input.provisionRenditionId,
    input.provisionConceptId,
    input.textRevisionId,
  ).first<{
    id: string;
    provisionConceptId: string;
    textRevisionId: string;
    locatorId: string;
    articleNumber: string;
    articleTitle: string | null;
    provisionSequence: number;
    sourceUrl: string;
    renditionStatus: string;
    createdAt: string;
  }>();
  const authorityEvidenceJson = input.authorityEvidence
    ? JSON.stringify(input.authorityEvidence) : null;
  const sharedCreatedAt = input.cutoffAt ?? input.capturedAt;
  if ((instrument && (instrument.id !== input.legalInstrumentId
      || instrument.token !== input.publisherInstrumentToken
      || instrument.canonicalTitle !== (input.canonicalInstrumentTitle ?? input.actTitle)
      || instrument.documentType !== input.documentType
      || instrument.canonicalUrl !== (input.canonicalInstrumentUrl ?? input.sourceUrl)
      || (input.cutoffAt !== undefined && instrument.createdAt !== sharedCreatedAt)))
    || (expression && (expression.id !== input.officialExpressionId
      || expression.legalInstrumentId !== input.legalInstrumentId
      || expression.languageTag !== input.languageTag
      || expression.sourceUrl !== input.sourceUrl
      || (input.cutoffAt !== undefined && expression.createdAt !== sharedCreatedAt)
      || expression.script !== input.script
      || expression.textualAuthority !== input.textualAuthority
      || expression.origin !== input.origin
      || expression.publicationStatus !== input.publicationStatus
      || expression.controllingOnConflict !== (input.controllingOnConflict ? 1 : 0)
      || expression.derivedFromExpressionId !== input.derivedFromExpressionId
      || expression.authorityEvidenceJson !== authorityEvidenceJson))
    || (revision && (revision.id !== input.textRevisionId
      || revision.officialExpressionId !== input.officialExpressionId
      || revision.publisherRevisionToken !== input.publisherRevisionToken
      || revision.rawLocatorId !== `raw:${input.captureId}`
      || revision.normalizedLocatorId !== `normalized:${input.textRevisionId}`
      || revision.capturedAt !== input.capturedAt
      || revision.createdAt !== input.capturedAt
      || revision.script !== input.script
      || revision.textualAuthority !== input.textualAuthority
      || revision.authorityEvidenceJson !== authorityEvidenceJson))
    || (concept && (concept.id !== input.provisionConceptId
      || concept.legalInstrumentId !== input.legalInstrumentId
      || concept.token !== input.publisherProvisionToken
      || (input.cutoffAt !== undefined && concept.createdAt !== sharedCreatedAt)))
    || (rendition && (rendition.id !== input.provisionRenditionId
      || rendition.provisionConceptId !== input.provisionConceptId
      || rendition.textRevisionId !== input.textRevisionId
      || rendition.locatorId !== `provision:${input.provisionRenditionId}`
      || rendition.articleNumber !== input.articleNumber
      || rendition.articleTitle !== (input.articleTitle ?? null)
      || rendition.provisionSequence !== input.provisionSequence
      || rendition.sourceUrl !== input.sourceUrl
      || rendition.renditionStatus !== input.renditionStatus
      || rendition.createdAt !== input.capturedAt))) {
    throw new LegalEvidenceError("LEGAL_EVIDENCE_IDENTITY_CONFLICT");
  }
}

function locatorInsert(db: D1Database, locator: Locator): D1PreparedStatement {
  return db.prepare(`INSERT OR IGNORE INTO legal_evidence_locators
    (id,object_kind,r2_key,media_type,byte_count,sha256,source_normalized_sha256,
      ordinal,schema_version,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
    locator.id,
    locator.objectKind,
    locator.r2Key,
    locator.mediaType,
    locator.byteCount,
    locator.sha256,
    locator.sourceNormalizedSha256,
    locator.ordinal,
    locator.schemaVersion,
    locator.createdAt,
  );
}

async function assertPersistedLocators(db: D1Database, expected: Locator[]): Promise<void> {
  const persisted = await db.prepare(`SELECT id,object_kind AS objectKind,r2_key AS r2Key,
      media_type AS mediaType,byte_count AS byteCount,sha256,
      source_normalized_sha256 AS sourceNormalizedSha256,ordinal,
      schema_version AS schemaVersion,created_at AS createdAt
    FROM legal_evidence_locators WHERE id IN (?,?,?)`).bind(
    ...expected.map((locator) => locator.id),
  ).all<Locator>();
  const byId = new Map(persisted.results.map((locator) => [locator.id, locator]));
  const mismatch = expected.some((locator) => {
    const actual = byId.get(locator.id);
    return !actual || Object.entries(locator).some(([key, value]) =>
      actual[key as keyof Locator] !== value);
  });
  if (mismatch || persisted.results.length !== expected.length) {
    throw new LegalEvidenceError("LEGAL_EVIDENCE_IDENTITY_CONFLICT");
  }
}

function expectedEligibility(
  input: z.infer<typeof importSchema>,
  capability: "current" | "as_of",
): { status: "eligible" | "ineligible" | "gap"; reasons: string[]; evaluatedAt: string } | null {
  const provenanceReasons = [
    ...(input.textualAuthority === "unknown" ? ["TEXTUAL_AUTHORITY_UNKNOWN"] : []),
    ...(input.publicationStatus !== "official"
      ? [`PUBLICATION_STATUS_${input.publicationStatus.toUpperCase()}`] : []),
    ...(input.origin === "unknown" ? ["ORIGIN_UNKNOWN"] : []),
    ...(input.textualAuthority !== "unknown" && !input.authorityEvidence
      ? ["AUTHORITY_EVIDENCE_MISSING"] : []),
  ];
  if (capability === "current") {
    if (!input.currentPointer && provenanceReasons.length === 0) return null;
    const reasons = [
      ...provenanceReasons,
      ...(input.renditionStatus !== "active"
        ? [`RENDITION_STATUS_${input.renditionStatus.toUpperCase()}`] : []),
    ];
    return {
      status: reasons.length > 0 ? "ineligible" : "eligible",
      reasons,
      evaluatedAt: input.currentPointer?.recordedAt ?? input.capturedAt,
    };
  }
  if (!input.applicability && !input.temporalGap) return null;
  const reasons = [
    ...provenanceReasons,
    ...(input.renditionStatus === "unknown" ? ["RENDITION_STATUS_UNKNOWN"] : []),
    ...(input.temporalGap ? [`TEMPORAL_${input.temporalGap.kind.toUpperCase()}`] : []),
  ];
  return {
    status: provenanceReasons.length > 0 || input.renditionStatus === "unknown"
      ? "ineligible"
      : input.temporalGap ? "gap" : "eligible",
    reasons,
    evaluatedAt: input.applicability?.recordedAt ?? input.temporalGap!.recordedAt,
  };
}

async function importProvisionRenditionInternal(
  dependencies: { db: D1Database; bucket: LegalEvidenceBucket },
  untrustedInput: z.input<typeof importSchema>,
  identityPreflight: boolean,
  optimisticCreate = false,
) {
  const input = importSchema.parse(untrustedInput);
  const normalizedBytes = evidenceBytes(input.normalizedRevision);
  const rawBytes = evidenceBytes(input.rawCapture);
  const provisionTextBytes = utf8(input.provisionText);
  if (input.sourceRawSha256 && (await sha256(rawBytes)).hex !== input.sourceRawSha256) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  if (input.sourceNormalizedSha256
    && (await sha256(normalizedBytes)).hex !== input.sourceNormalizedSha256) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  if (input.sourceProvisionSha256
    && (await sha256(provisionTextBytes)).hex !== input.sourceProvisionSha256) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  if (identityPreflight) await assertNaturalIdentityAvailability(dependencies.db, input);
  const rawLocator = await immutablePut({
    bucket: dependencies.bucket,
    id: `raw:${input.captureId}`,
    objectKind: "raw_capture",
    key: `corpus/raw/lex/${input.captureId}/source.html`,
    mediaType: "text/html; charset=utf-8",
    bytes: rawBytes,
    expectedSha256: input.sourceRawSha256,
    ordinal: 0,
    createdAt: input.capturedAt,
    optimisticCreate,
  });
  const normalizedLocator = await immutablePut({
    bucket: dependencies.bucket,
    id: `normalized:${input.textRevisionId}`,
    objectKind: "normalized_revision",
    key: `corpus/normalized/${input.textRevisionId}.json`,
    mediaType: "application/json; charset=utf-8",
    bytes: normalizedBytes,
    expectedSha256: input.sourceNormalizedSha256,
    ordinal: 0,
    createdAt: input.capturedAt,
    optimisticCreate,
  });
  const provisionBytes = deterministicJson({
    schemaVersion: 1,
    legalInstrumentId: input.legalInstrumentId,
    publisherInstrumentToken: input.publisherInstrumentToken,
    officialExpressionId: input.officialExpressionId,
    textRevisionId: input.textRevisionId,
    provisionConceptId: input.provisionConceptId,
    publisherProvisionToken: input.publisherProvisionToken,
    provisionRenditionId: input.provisionRenditionId,
    languageTag: input.languageTag,
    script: input.script,
    textualAuthority: input.textualAuthority,
    actTitle: input.actTitle,
    documentType: input.documentType,
    articleNumber: input.articleNumber,
    articleTitle: input.articleTitle ?? null,
    provisionSequence: input.provisionSequence,
    provisionText: input.provisionText,
    renditionStatus: input.renditionStatus,
    sourceUrl: input.sourceUrl,
    capturedAt: input.capturedAt,
    sourceNormalizedSha256: normalizedLocator.sha256,
  });
  const provisionLocator = await immutablePut({
    bucket: dependencies.bucket,
    id: `provision:${input.provisionRenditionId}`,
    objectKind: "provision_rendition",
    key: `corpus/provisions/${input.textRevisionId}/${input.provisionRenditionId}.json`,
    mediaType: "application/json; charset=utf-8",
    bytes: provisionBytes,
    sourceNormalizedSha256: normalizedLocator.sha256,
    ordinal: input.provisionSequence,
    createdAt: input.capturedAt,
    optimisticCreate,
  });
  const currentEligibility = expectedEligibility(input, "current");
  const asOfEligibility = expectedEligibility(input, "as_of");
  const sharedCreatedAt = input.cutoffAt ?? input.capturedAt;

  await dependencies.db.batch([
    locatorInsert(dependencies.db, rawLocator),
    locatorInsert(dependencies.db, normalizedLocator),
    locatorInsert(dependencies.db, provisionLocator),
    dependencies.db.prepare(`INSERT OR IGNORE INTO legal_instruments
      (id,publisher_instrument_token,canonical_title,document_type,canonical_url,created_at)
      VALUES (?,?,?,?,?,?)`).bind(
      input.legalInstrumentId, input.publisherInstrumentToken,
      input.canonicalInstrumentTitle ?? input.actTitle,
      input.documentType, input.canonicalInstrumentUrl ?? input.sourceUrl, sharedCreatedAt,
    ),
    dependencies.db.prepare(`INSERT OR IGNORE INTO legal_official_expressions
      (id,legal_instrument_id,language_tag,source_url,created_at,script,textual_authority,
        origin,publication_status,controlling_on_conflict,derived_from_expression_id,
        authority_evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).bind(
      input.officialExpressionId, input.legalInstrumentId, input.languageTag,
      input.sourceUrl, sharedCreatedAt, input.script, input.textualAuthority,
      input.origin, input.publicationStatus, input.controllingOnConflict ? 1 : 0,
      input.derivedFromExpressionId, input.authorityEvidence
        ? JSON.stringify(input.authorityEvidence) : null,
    ),
    dependencies.db.prepare(`INSERT OR IGNORE INTO legal_text_revisions
      (id,official_expression_id,publisher_revision_token,raw_locator_id,
        normalized_locator_id,captured_at,created_at,script,textual_authority,
        authority_evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
      input.textRevisionId, input.officialExpressionId, input.publisherRevisionToken,
      rawLocator.id, normalizedLocator.id, input.capturedAt, input.capturedAt,
      input.script, input.textualAuthority,
      input.authorityEvidence ? JSON.stringify(input.authorityEvidence) : null,
    ),
    dependencies.db.prepare(`INSERT OR IGNORE INTO legal_provision_concepts
      (id,legal_instrument_id,publisher_concept_token,created_at) VALUES (?,?,?,?)`).bind(
      input.provisionConceptId, input.legalInstrumentId,
      input.publisherProvisionToken, sharedCreatedAt,
    ),
    dependencies.db.prepare(`INSERT OR IGNORE INTO legal_provision_renditions
      (id,provision_concept_id,text_revision_id,locator_id,article_number,article_title,
        sequence,source_url,status,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).bind(
      input.provisionRenditionId, input.provisionConceptId, input.textRevisionId,
      provisionLocator.id, input.articleNumber, input.articleTitle ?? null,
      input.provisionSequence, input.sourceUrl, input.renditionStatus, input.capturedAt,
    ),
    ...(input.editorialValidity ? [
      dependencies.db.prepare(`INSERT OR IGNORE INTO legal_text_revision_validity
        (text_revision_id,valid_from,valid_to,recorded_at) VALUES (?,?,?,?)`).bind(
        input.textRevisionId,
        input.editorialValidity.validFrom,
        input.editorialValidity.validTo,
        input.editorialValidity.recordedAt,
      ),
    ] : []),
    ...(input.applicability ? [
      dependencies.db.prepare(`INSERT INTO legal_applicability_periods
        (id,provision_rendition_id,valid_from,valid_to,evidence_url,evidence_kind,status,recorded_at)
        SELECT ?,?,?,?,?,?,?,?
        WHERE NOT EXISTS (SELECT 1 FROM legal_applicability_periods
          WHERE provision_rendition_id=?)`).bind(
        input.applicability.id,
        input.provisionRenditionId,
        input.applicability.validFrom,
        input.applicability.validTo,
        input.applicability.evidenceUrl,
        input.applicability.evidenceKind,
        "verified",
        input.applicability.recordedAt,
        input.provisionRenditionId,
      ),
    ] : []),
    ...(input.temporalGap ? [
      dependencies.db.prepare(`INSERT OR IGNORE INTO legal_temporal_coverage_gaps
        (id,provision_rendition_id,gap_kind,valid_from,valid_to,evidence_url,reason,status,recorded_at)
        VALUES (?,?,?,?,?,?,?,?,?)`).bind(
        input.temporalGap.id,
        input.provisionRenditionId,
        input.temporalGap.kind,
        input.temporalGap.validFrom ?? null,
        input.temporalGap.validTo ?? null,
        input.temporalGap.evidenceUrl,
        input.temporalGap.reason,
        "open",
        input.temporalGap.recordedAt,
      ),
    ] : []),
    ...(input.currentPointer ? [
      dependencies.db.prepare(`INSERT OR IGNORE INTO legal_current_provision_pointers
        (provision_rendition_id,evidence_url,verified_at,recorded_at) VALUES (?,?,?,?)`).bind(
        input.provisionRenditionId,
        input.currentPointer.evidenceUrl,
        input.currentPointer.verifiedAt,
        input.currentPointer.recordedAt,
      ),
    ] : []),
    ...(asOfEligibility ? [
      dependencies.db.prepare(`INSERT OR IGNORE INTO legal_official_eligibility
        (id,subject_type,subject_id,capability,status,reason_codes_json,evaluated_at)
        VALUES (?,?,?,?,?,?,?)`).bind(
        `eligibility:${input.provisionRenditionId}:as_of`, "provision_rendition",
        input.provisionRenditionId, "as_of", asOfEligibility.status,
        JSON.stringify(asOfEligibility.reasons), asOfEligibility.evaluatedAt,
      ),
    ] : []),
    ...(currentEligibility ? [
      dependencies.db.prepare(`INSERT OR IGNORE INTO legal_official_eligibility
        (id,subject_type,subject_id,capability,status,reason_codes_json,evaluated_at)
        VALUES (?,?,?,?,?,?,?)`).bind(
        `eligibility:${input.provisionRenditionId}:current`, "provision_rendition",
        input.provisionRenditionId, "current", currentEligibility.status,
        JSON.stringify(currentEligibility.reasons), currentEligibility.evaluatedAt,
      ),
    ] : []),
  ]);
  await assertNaturalIdentityAvailability(dependencies.db, input);
  await assertPersistedLocators(dependencies.db, [rawLocator, normalizedLocator, provisionLocator]);

  const persisted = await dependencies.db.prepare(`SELECT locator.r2_key AS r2Key,
      locator.byte_count AS byteCount,locator.sha256 AS sha256,
      locator.source_normalized_sha256 AS sourceNormalizedSha256,
      rendition.provision_concept_id AS provisionConceptId,
      rendition.text_revision_id AS textRevisionId,
      concept.legal_instrument_id AS legalInstrumentId,
      concept.publisher_concept_token AS publisherProvisionToken,
      revision.official_expression_id AS officialExpressionId,
      revision.publisher_revision_token AS publisherRevisionToken,
      instrument.publisher_instrument_token AS publisherInstrumentToken,
      rendition.article_number AS articleNumber,rendition.article_title AS articleTitle,
      rendition.sequence AS provisionSequence,rendition.source_url AS sourceUrl,
      rendition.status AS renditionStatus,
      validity.valid_from AS editorialValidFrom,validity.valid_to AS editorialValidTo,
      validity.recorded_at AS editorialRecordedAt,
      applicability.id AS applicabilityId,applicability.valid_from AS applicabilityValidFrom,
      applicability.valid_to AS applicabilityValidTo,
      applicability.evidence_url AS applicabilityEvidenceUrl,
      applicability.evidence_kind AS applicabilityEvidenceKind,
      applicability.recorded_at AS applicabilityRecordedAt,
      gap.id AS temporalGapId,gap.gap_kind AS temporalGapKind,
      gap.valid_from AS temporalGapValidFrom,
      gap.valid_to AS temporalGapValidTo,gap.evidence_url AS temporalGapEvidenceUrl,
      gap.reason AS temporalGapReason,gap.recorded_at AS temporalGapRecordedAt,
      pointer.evidence_url AS currentPointerEvidenceUrl,
      pointer.verified_at AS currentPointerVerifiedAt,
      pointer.recorded_at AS currentPointerRecordedAt,
      current_eligibility.status AS currentEligibilityStatus,
      current_eligibility.reason_codes_json AS currentEligibilityReasons,
      current_eligibility.evaluated_at AS currentEligibilityEvaluatedAt,
      as_of_eligibility.status AS asOfEligibilityStatus,
      as_of_eligibility.reason_codes_json AS asOfEligibilityReasons,
      as_of_eligibility.evaluated_at AS asOfEligibilityEvaluatedAt
    FROM legal_provision_renditions rendition
    JOIN legal_evidence_locators locator ON locator.id=rendition.locator_id
    JOIN legal_provision_concepts concept ON concept.id=rendition.provision_concept_id
    JOIN legal_text_revisions revision ON revision.id=rendition.text_revision_id
    JOIN legal_instruments instrument ON instrument.id=concept.legal_instrument_id
    LEFT JOIN legal_text_revision_validity validity ON validity.text_revision_id=revision.id
    LEFT JOIN legal_applicability_periods applicability
      ON applicability.provision_rendition_id=rendition.id
    LEFT JOIN legal_temporal_coverage_gaps gap
      ON gap.provision_rendition_id=rendition.id AND gap.status='open'
    LEFT JOIN legal_current_provision_pointers pointer
      ON pointer.provision_rendition_id=rendition.id
    LEFT JOIN legal_official_eligibility current_eligibility
      ON current_eligibility.subject_type='provision_rendition'
      AND current_eligibility.subject_id=rendition.id
      AND current_eligibility.capability='current'
    LEFT JOIN legal_official_eligibility as_of_eligibility
      ON as_of_eligibility.subject_type='provision_rendition'
      AND as_of_eligibility.subject_id=rendition.id
      AND as_of_eligibility.capability='as_of'
    WHERE rendition.id=?`).bind(input.provisionRenditionId).first<{
      r2Key: string;
      byteCount: number;
      sha256: string;
      sourceNormalizedSha256: string;
      provisionConceptId: string;
      textRevisionId: string;
      legalInstrumentId: string;
      publisherProvisionToken: string;
      officialExpressionId: string;
      publisherRevisionToken: string;
      publisherInstrumentToken: string;
      articleNumber: string;
      articleTitle: string | null;
      provisionSequence: number;
      sourceUrl: string;
      renditionStatus: string;
      editorialValidFrom: string | null;
      editorialValidTo: string | null;
      editorialRecordedAt: string | null;
      applicabilityId: string | null;
      applicabilityValidFrom: string | null;
      applicabilityValidTo: string | null;
      applicabilityEvidenceUrl: string | null;
      applicabilityEvidenceKind: string | null;
      applicabilityRecordedAt: string | null;
      temporalGapId: string | null;
      temporalGapKind: string | null;
      temporalGapValidFrom: string | null;
      temporalGapValidTo: string | null;
      temporalGapEvidenceUrl: string | null;
      temporalGapReason: string | null;
      temporalGapRecordedAt: string | null;
      currentPointerEvidenceUrl: string | null;
      currentPointerVerifiedAt: string | null;
      currentPointerRecordedAt: string | null;
      currentEligibilityStatus: string | null;
      currentEligibilityReasons: string | null;
      currentEligibilityEvaluatedAt: string | null;
      asOfEligibilityStatus: string | null;
      asOfEligibilityReasons: string | null;
      asOfEligibilityEvaluatedAt: string | null;
    }>();
  if (
    !persisted
    || persisted.r2Key !== provisionLocator.r2Key
    || persisted.byteCount !== provisionLocator.byteCount
    || persisted.sha256 !== provisionLocator.sha256
    || persisted.sourceNormalizedSha256 !== provisionLocator.sourceNormalizedSha256
    || persisted.provisionConceptId !== input.provisionConceptId
    || persisted.textRevisionId !== input.textRevisionId
    || persisted.legalInstrumentId !== input.legalInstrumentId
    || persisted.publisherProvisionToken !== input.publisherProvisionToken
    || persisted.officialExpressionId !== input.officialExpressionId
    || persisted.publisherRevisionToken !== input.publisherRevisionToken
    || persisted.publisherInstrumentToken !== input.publisherInstrumentToken
    || persisted.articleNumber !== input.articleNumber
    || persisted.articleTitle !== (input.articleTitle ?? null)
    || persisted.provisionSequence !== input.provisionSequence
    || persisted.sourceUrl !== input.sourceUrl
    || persisted.renditionStatus !== input.renditionStatus
    || (input.editorialValidity && (
      persisted.editorialValidFrom !== input.editorialValidity.validFrom
      || persisted.editorialValidTo !== input.editorialValidity.validTo
      || persisted.editorialRecordedAt !== input.editorialValidity.recordedAt
    ))
    || (input.applicability && (
      persisted.applicabilityId !== input.applicability.id
      || persisted.applicabilityValidFrom !== input.applicability.validFrom
      || persisted.applicabilityValidTo !== input.applicability.validTo
      || persisted.applicabilityEvidenceUrl !== input.applicability.evidenceUrl
      || persisted.applicabilityEvidenceKind !== input.applicability.evidenceKind
      || persisted.applicabilityRecordedAt !== input.applicability.recordedAt
    ))
    || (input.temporalGap && (
      persisted.temporalGapId !== input.temporalGap.id
      || persisted.temporalGapKind !== input.temporalGap.kind
      || persisted.temporalGapValidFrom !== (input.temporalGap.validFrom ?? null)
      || persisted.temporalGapValidTo !== (input.temporalGap.validTo ?? null)
      || persisted.temporalGapEvidenceUrl !== input.temporalGap.evidenceUrl
      || persisted.temporalGapReason !== input.temporalGap.reason
      || persisted.temporalGapRecordedAt !== input.temporalGap.recordedAt
    ))
    || (input.currentPointer && (
      persisted.currentPointerEvidenceUrl !== input.currentPointer.evidenceUrl
      || persisted.currentPointerVerifiedAt !== input.currentPointer.verifiedAt
      || persisted.currentPointerRecordedAt !== input.currentPointer.recordedAt
    ))
    || (currentEligibility && (
      persisted.currentEligibilityStatus !== currentEligibility.status
      || persisted.currentEligibilityReasons !== JSON.stringify(currentEligibility.reasons)
      || persisted.currentEligibilityEvaluatedAt !== currentEligibility.evaluatedAt
    ))
    || (asOfEligibility && (
      persisted.asOfEligibilityStatus !== asOfEligibility.status
      || persisted.asOfEligibilityReasons !== JSON.stringify(asOfEligibility.reasons)
      || persisted.asOfEligibilityEvaluatedAt !== asOfEligibility.evaluatedAt
    ))
  ) throw new LegalEvidenceError("LEGAL_EVIDENCE_IDENTITY_CONFLICT");

  return {
    legalInstrumentId: input.legalInstrumentId,
    officialExpressionId: input.officialExpressionId,
    textRevisionId: input.textRevisionId,
    provisionConceptId: input.provisionConceptId,
    provisionRenditionId: input.provisionRenditionId,
    rawLocator,
    normalizedLocator,
    provisionLocator,
  };
}

export function importProvisionRendition(
  dependencies: { db: D1Database; bucket: LegalEvidenceBucket },
  untrustedInput: z.input<typeof importSchema>,
) {
  return importProvisionRenditionInternal(dependencies, untrustedInput, true);
}

function revisionIdentity(input: z.infer<typeof importSchema>): string {
  return JSON.stringify({
    legalInstrumentId: input.legalInstrumentId,
    publisherInstrumentToken: input.publisherInstrumentToken,
    officialExpressionId: input.officialExpressionId,
    textRevisionId: input.textRevisionId,
    captureId: input.captureId,
    publisherRevisionToken: input.publisherRevisionToken,
    languageTag: input.languageTag,
    script: input.script,
    textualAuthority: input.textualAuthority,
    origin: input.origin,
    publicationStatus: input.publicationStatus,
    controllingOnConflict: input.controllingOnConflict,
    derivedFromExpressionId: input.derivedFromExpressionId,
    authorityEvidence: input.authorityEvidence,
    canonicalInstrumentTitle: input.canonicalInstrumentTitle ?? null,
    actTitle: input.actTitle,
    documentType: input.documentType,
    rawCaptureBytes: evidenceBytes(input.rawCapture).byteLength,
    normalizedRevisionBytes: evidenceBytes(input.normalizedRevision).byteLength,
    sourceRawSha256: input.sourceRawSha256 ?? null,
    sourceNormalizedSha256: input.sourceNormalizedSha256 ?? null,
    sourceUrl: input.sourceUrl,
    canonicalInstrumentUrl: input.canonicalInstrumentUrl ?? null,
    capturedAt: input.capturedAt,
    migrationRunId: input.migrationRunId ?? null,
    cutoffAt: input.cutoffAt ?? null,
    editorialValidity: input.editorialValidity ?? null,
  });
}

async function bindCurrentMigrationCutoff(
  db: D1Database,
  input: z.infer<typeof currentMigrationImportSchema>,
): Promise<void> {
  await db.prepare(`INSERT OR IGNORE INTO legal_migration_cutoffs
    (scope,migration_run_id,cutoff_at,recorded_at) VALUES ('current',?,?,?)`).bind(
    input.migrationRunId,
    input.cutoffAt,
    input.cutoffAt,
  ).run();
  const persisted = await db.prepare(`SELECT migration_run_id AS migrationRunId,
      cutoff_at AS cutoffAt,recorded_at AS recordedAt
    FROM legal_migration_cutoffs WHERE scope='current'`).first<{
      migrationRunId: string;
      cutoffAt: string;
      recordedAt: string;
    }>();
  if (!persisted
    || persisted.migrationRunId !== input.migrationRunId
    || persisted.cutoffAt !== input.cutoffAt
    || persisted.recordedAt !== input.cutoffAt) {
    throw new LegalEvidenceError("LEGAL_EVIDENCE_IDENTITY_CONFLICT");
  }
}

function memoizeSharedRevisionEvidence(bucket: LegalEvidenceBucket): LegalEvidenceBucket {
  const cached = new Map<string, Promise<LegalEvidenceObject | null>>();
  const createChecks = new Map<string, Promise<LegalEvidenceHead | null>>();
  const shared = (key: string) => key.startsWith("corpus/raw/")
    || key.startsWith("corpus/normalized/");
  const getShared = (key: string) => {
    let pending = cached.get(key);
    if (!pending) {
      pending = bucket.get(key).then(async (object) => {
        if (!object) return null;
        const value = await object.bytes();
        const bytes = new Uint8Array(value.byteLength);
        bytes.set(value);
        return {
          key: object.key,
          size: object.size,
          customMetadata: object.customMetadata,
          bytes: async () => {
            const copy = new Uint8Array(bytes.byteLength);
            copy.set(bytes);
            return copy;
          },
        };
      });
      cached.set(key, pending);
    }
    return pending;
  };
  return {
    async head(key) {
      if (!shared(key) || !cached.has(key)) return bucket.head(key);
      const object = await getShared(key);
      return object && {
        key: object.key,
        size: object.size,
        customMetadata: object.customMetadata,
      };
    },
    get(key) {
      return shared(key) ? getShared(key) : bucket.get(key);
    },
    put(key, value, options) {
      if (!shared(key)) return bucket.put(key, value, options);
      let pending = createChecks.get(key);
      if (!pending) {
        cached.delete(key);
        pending = bucket.put(key, value, options);
        createChecks.set(key, pending);
      }
      return pending;
    },
  };
}

export async function importProvisionRevision(
  dependencies: { db: D1Database; bucket: LegalEvidenceBucket },
  untrustedInputs: unknown[],
) {
  const inputs = z.array(currentMigrationImportSchema).min(1).max(48).parse(untrustedInputs);
  const expectedRevision = revisionIdentity(inputs[0]!);
  const firstRaw = evidenceBytes(inputs[0]!.rawCapture);
  const firstNormalized = evidenceBytes(inputs[0]!.normalizedRevision);
  const sameBytes = (left: Uint8Array, right: Uint8Array) => left === right
    || (left.byteLength === right.byteLength && left.every((value, index) => value === right[index]));
  if (inputs.some((input) => revisionIdentity(input) !== expectedRevision
    || !sameBytes(firstRaw, evidenceBytes(input.rawCapture))
    || !sameBytes(firstNormalized, evidenceBytes(input.normalizedRevision)))) {
    throw new LegalEvidenceError("LEGAL_EVIDENCE_IDENTITY_CONFLICT");
  }
  await bindCurrentMigrationCutoff(dependencies.db, inputs[0]!);
  const bucket = memoizeSharedRevisionEvidence(dependencies.bucket);
  const imported = [await importProvisionRenditionInternal(
    { db: dependencies.db, bucket },
    inputs[0]!,
    true,
    true,
  )];
  for (let offset = 1; offset < inputs.length; offset += 4) {
    imported.push(...await Promise.all(inputs.slice(offset, offset + 4).map((input) =>
      importProvisionRenditionInternal({ db: dependencies.db, bucket }, input, false, true))));
  }
  return {
    legalInstrumentId: imported[0]!.legalInstrumentId,
    officialExpressionId: imported[0]!.officialExpressionId,
    textRevisionId: imported[0]!.textRevisionId,
    rawLocator: imported[0]!.rawLocator,
    normalizedLocator: imported[0]!.normalizedLocator,
    provisionCount: imported.length,
    provisionRenditionIds: imported.map((item) => item.provisionRenditionId),
  };
}

type EvidenceRow = {
  legalInstrumentId: string;
  officialExpressionId: string;
  textRevisionId: string;
  provisionConceptId: string;
  provisionRenditionId: string;
  languageTag: string;
  script: string;
  textualAuthority: string;
  actTitle: string;
  articleNumber: string;
  sourceUrl: string;
  provisionKey: string;
  provisionBytes: number;
  provisionSha256: string;
  sourceNormalizedSha256: string;
  normalizedKey: string;
  normalizedBytes: number;
  normalizedSha256: string;
};

type CompleteCorpusEvidenceRow = Pick<EvidenceRow,
  | "legalInstrumentId"
  | "officialExpressionId"
  | "textRevisionId"
  | "provisionConceptId"
  | "provisionRenditionId"
  | "languageTag"
  | "script"
  | "textualAuthority"
  | "sourceUrl"
  | "provisionKey"
  | "provisionBytes"
  | "provisionSha256"
  | "sourceNormalizedSha256"
> & { capability: "current" | "history"; legacyCurrentRenditionId: string;
  provisionMediaType: string; validFrom: string | null; validTo: string | null };

export async function resolveProvisionRendition(
  dependencies: { db: D1Database; bucket: Pick<LegalEvidenceBucket, "get"> },
  provisionRenditionId: string,
  untrustedEndpoint?: TemporalEndpoint,
): Promise<ResolvedOfficialEvidence> {
  const id = provisionRenditionIdSchema.parse(provisionRenditionId);
  const endpoint = untrustedEndpoint === undefined
    ? null
    : temporalEndpointSchema.parse(untrustedEndpoint);
  const temporalJoin = endpoint === null ? "" : endpoint.kind === "current" ? `
    JOIN legal_official_eligibility eligibility
      ON eligibility.subject_type='provision_rendition'
      AND eligibility.subject_id=rendition.id AND eligibility.capability='current'
      AND eligibility.status='eligible'
    JOIN legal_current_provision_pointers current_pointer
      ON current_pointer.provision_rendition_id=rendition.id` : `
    JOIN legal_official_eligibility eligibility
      ON eligibility.subject_type='provision_rendition'
      AND eligibility.subject_id=rendition.id AND eligibility.capability='as_of'
      AND eligibility.status='eligible'
    JOIN legal_applicability_periods applicability
      ON applicability.provision_rendition_id=rendition.id
      AND applicability.status='verified'
      AND applicability.valid_from<=?
      AND (applicability.valid_to IS NULL OR ?<applicability.valid_to)`;
  const temporalGuard = endpoint === null || endpoint.kind === "current" ? "" : `
      AND NOT EXISTS (
        SELECT 1 FROM legal_temporal_coverage_gaps temporal_gap
        WHERE temporal_gap.provision_rendition_id=rendition.id
          AND temporal_gap.status='open'
          AND (temporal_gap.valid_from IS NULL OR temporal_gap.valid_from<=?)
          AND (temporal_gap.valid_to IS NULL OR ?<temporal_gap.valid_to)
      )`;
  const statement = dependencies.db.prepare(`SELECT
      instrument.id AS legalInstrumentId,instrument.canonical_title AS actTitle,
      expression.id AS officialExpressionId,expression.language_tag AS languageTag,
      revision.script AS script,revision.textual_authority AS textualAuthority,
      revision.id AS textRevisionId,concept.id AS provisionConceptId,
      rendition.id AS provisionRenditionId,rendition.article_number AS articleNumber,
      rendition.source_url AS sourceUrl,provision_locator.r2_key AS provisionKey,
      provision_locator.byte_count AS provisionBytes,provision_locator.sha256 AS provisionSha256,
      provision_locator.source_normalized_sha256 AS sourceNormalizedSha256,
      normalized_locator.r2_key AS normalizedKey,normalized_locator.byte_count AS normalizedBytes,
      normalized_locator.sha256 AS normalizedSha256
    FROM legal_provision_renditions rendition
    JOIN legal_provision_concepts concept ON concept.id=rendition.provision_concept_id
    JOIN legal_instruments instrument ON instrument.id=concept.legal_instrument_id
    JOIN legal_text_revisions revision ON revision.id=rendition.text_revision_id
    JOIN legal_official_expressions expression ON expression.id=revision.official_expression_id
    JOIN legal_evidence_locators provision_locator ON provision_locator.id=rendition.locator_id
    JOIN legal_evidence_locators normalized_locator ON normalized_locator.id=revision.normalized_locator_id
    ${temporalJoin}
    WHERE rendition.id=?${temporalGuard}`);
  const row = await (endpoint === null || endpoint.kind === "current"
    ? statement.bind(id)
    : statement.bind(endpoint.instant, endpoint.instant, id, endpoint.instant, endpoint.instant))
    .first<EvidenceRow>();
  if (!row) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  const [provisionBytes] = await Promise.all([
    readAndVerifyObject(dependencies.bucket, {
      r2Key: row.provisionKey,
      byteCount: Number(row.provisionBytes),
      sha256: row.provisionSha256,
    }),
    readAndVerifyObject(dependencies.bucket, {
      r2Key: row.normalizedKey,
      byteCount: Number(row.normalizedBytes),
      sha256: row.normalizedSha256,
    }),
  ]);
  let provision: z.infer<typeof provisionObjectSchema>;
  try {
    provision = provisionObjectSchema.parse(JSON.parse(new TextDecoder().decode(provisionBytes)) as unknown);
  } catch {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  if (
    provision.provisionRenditionId !== row.provisionRenditionId
    || provision.textRevisionId !== row.textRevisionId
    || provision.provisionConceptId !== row.provisionConceptId
    || provision.officialExpressionId !== row.officialExpressionId
    || provision.legalInstrumentId !== row.legalInstrumentId
    || provision.sourceNormalizedSha256 !== row.sourceNormalizedSha256
    || provision.sourceNormalizedSha256 !== row.normalizedSha256
    || provision.sourceUrl !== row.sourceUrl
  ) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");

  return resolvedEvidenceSchema.parse({
    legalInstrumentId: row.legalInstrumentId,
    officialExpressionId: row.officialExpressionId,
    textRevisionId: row.textRevisionId,
    provisionConceptId: row.provisionConceptId,
    provisionRenditionId: row.provisionRenditionId,
    languageTag: row.languageTag,
    script: row.script,
    textualAuthority: row.textualAuthority,
    provisionText: provision.provisionText,
    officialCitation: {
      label: `${row.actTitle} — Article ${row.articleNumber}`,
      url: row.sourceUrl,
    },
    evidence: {
      provisionRenditionId: row.provisionRenditionId,
      r2Key: row.provisionKey,
      byteCount: Number(row.provisionBytes),
      sha256: row.provisionSha256,
      sourceNormalizedSha256: row.sourceNormalizedSha256,
      schemaVersion: 1,
    },
  });
}

const controllingResolutionSchema = z.object({
  controlling: resolvedEvidenceSchema,
  articleContext: resolvedEvidenceSchema.optional(),
  documentContext: resolvedEvidenceSchema.optional(),
  translation: resolvedEvidenceSchema.optional(),
  translationLabel: z.literal("Official Translation").optional(),
  materialCitation: resolvedEvidenceSchema.shape.officialCitation,
}).strict().refine(value => !(value.articleContext && value.documentContext), "Evidence context must have one scope");

export type ControllingEvidenceResolution = z.infer<typeof controllingResolutionSchema>;
export function parseControllingEvidenceResolution(value: unknown): ControllingEvidenceResolution {
  return controllingResolutionSchema.parse(value);
}

export async function resolveControllingEvidence(
  dependencies: { db: D1Database; bucket: Pick<LegalEvidenceBucket, "get"> },
  discoveredProvisionRenditionId: string,
  untrustedEndpoint: TemporalEndpoint = { kind: "current" },
): Promise<ControllingEvidenceResolution> {
  const discoveredId = provisionRenditionIdSchema.parse(discoveredProvisionRenditionId);
  const endpoint = temporalEndpointSchema.parse(untrustedEndpoint);
  const discovered = await dependencies.db.prepare(`SELECT
      rendition.provision_concept_id AS provisionConceptId,
      revision.textual_authority AS textualAuthority
    FROM legal_provision_renditions rendition
    JOIN legal_text_revisions revision ON revision.id=rendition.text_revision_id
    WHERE rendition.id=?`).bind(discoveredId).first<{
      provisionConceptId: string;
      textualAuthority: string;
    }>();
  if (!discovered) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  const temporalJoin = endpoint.kind === "current" ? `
    JOIN legal_official_eligibility eligibility
      ON eligibility.subject_type='provision_rendition'
      AND eligibility.subject_id=rendition.id AND eligibility.capability='current'
      AND eligibility.status='eligible'
    JOIN legal_current_provision_pointers current_pointer
      ON current_pointer.provision_rendition_id=rendition.id` : `
    JOIN legal_official_eligibility eligibility
      ON eligibility.subject_type='provision_rendition'
      AND eligibility.subject_id=rendition.id AND eligibility.capability='as_of'
      AND eligibility.status='eligible'
    JOIN legal_applicability_periods applicability
      ON applicability.provision_rendition_id=rendition.id
      AND applicability.status='verified'
      AND applicability.valid_from<=?
      AND (applicability.valid_to IS NULL OR ?<applicability.valid_to)`;
  const temporalGuard = endpoint.kind === "current" ? "" : `
      AND NOT EXISTS (
        SELECT 1 FROM legal_temporal_coverage_gaps temporal_gap
        WHERE temporal_gap.provision_rendition_id=rendition.id
          AND temporal_gap.status='open'
          AND (temporal_gap.valid_from IS NULL OR temporal_gap.valid_from<=?)
          AND (temporal_gap.valid_to IS NULL OR ?<temporal_gap.valid_to)
      )`;
  const candidateStatement = dependencies.db.prepare(`SELECT rendition.id AS provisionRenditionId
    FROM legal_provision_renditions rendition
    JOIN legal_text_revisions revision ON revision.id=rendition.text_revision_id
    JOIN legal_official_expressions expression ON expression.id=revision.official_expression_id
    ${temporalJoin}
    WHERE rendition.provision_concept_id=?
      AND revision.textual_authority='controlling'
      AND revision.authority_evidence_json IS NOT NULL
      AND expression.controlling_on_conflict=1${temporalGuard}
    ORDER BY revision.captured_at DESC,rendition.id`);
  const candidates = await (endpoint.kind === "current"
    ? candidateStatement.bind(discovered.provisionConceptId)
    : candidateStatement.bind(
      endpoint.instant,
      endpoint.instant,
      discovered.provisionConceptId,
      endpoint.instant,
      endpoint.instant,
    )).all<{
      provisionRenditionId: string;
    }>();
  if (candidates.results.length !== 1) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  const controlling = await resolveProvisionRendition(
    dependencies,
    candidates.results[0]!.provisionRenditionId,
    endpoint,
  );
  const translation = discovered.textualAuthority === "official_translation"
    ? await resolveProvisionRendition(dependencies, discoveredId, endpoint)
    : undefined;
  return controllingResolutionSchema.parse({
    controlling,
    ...(translation ? { translation, translationLabel: "Official Translation" } : {}),
    materialCitation: controlling.officialCitation,
  });
}

/** Resolves current evidence from the accepted complete-corpus projection used by a custom release. */
export function assertCompleteCorpusCurrentInterval(
  record: { validFrom: string | null; validTo: string | null },
  currentAt: string,
): void {
  const at = Date.parse(utcInstantSchema.parse(currentAt));
  const from = record.validFrom === null ? NaN : Date.parse(record.validFrom);
  const to = record.validTo === null ? Infinity : Date.parse(record.validTo);
  if (!Number.isFinite(from) || Number.isNaN(to) || from > at || at >= to) {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
}

export async function resolveCompleteCorpusEvidence(
  dependencies: { db: D1Database; bucket: Pick<LegalEvidenceBucket, "get">;
    environment: z.infer<typeof legalEnvironmentSchema>; releaseId: string; currentAt: string },
  provisionRenditionId: string,
  untrustedEndpoint: TemporalEndpoint,
): Promise<ControllingEvidenceResolution> {
  const id = provisionRenditionIdSchema.parse(provisionRenditionId);
  const releaseId = searchReleaseIdSchema.parse(dependencies.releaseId);
  const endpoint = temporalEndpointSchema.parse(untrustedEndpoint);
  const capability = endpoint.kind === "current" ? "current" : "history";
  const eligibility = endpoint.kind === "current" ? "current_eligible" : "historical_eligible";
  const row = await dependencies.db.prepare(`SELECT
      release.capability AS capability,
      record.instrument_id AS legalInstrumentId,
      record.official_expression_id AS officialExpressionId,
      record.text_revision_id AS textRevisionId,
      record.provision_concept_id AS provisionConceptId,
      record.provision_rendition_id AS provisionRenditionId,
      record.legacy_current_rendition_id AS legacyCurrentRenditionId,
      record.language AS languageTag,record.script,
      authority_revision.textual_authority AS textualAuthority,
      record.provision_source_url AS sourceUrl,
      record.provision_object_r2_key AS provisionKey,
      record.provision_object_sha256 AS provisionSha256,
      record.normalized_source_sha256 AS sourceNormalizedSha256,
      record.valid_from AS validFrom,record.valid_to AS validTo,
      object.byte_count AS provisionBytes,object.media_type AS provisionMediaType
    FROM legal_search_releases release
    JOIN legal_custom_search_runtime_components runtime
      ON runtime.search_release_id=release.id
    JOIN legal_complete_corpus_records record
      ON record.run_id=runtime.complete_corpus_run_id
    JOIN legal_provision_renditions authority_rendition
      ON authority_rendition.id=record.provision_rendition_id
      AND authority_rendition.provision_concept_id=record.provision_concept_id
      AND authority_rendition.text_revision_id=record.text_revision_id
    JOIN legal_text_revisions authority_revision
      ON authority_revision.id=authority_rendition.text_revision_id
      AND authority_revision.official_expression_id=record.official_expression_id
      AND authority_revision.textual_authority='controlling'
      AND authority_revision.authority_evidence_json IS NOT NULL
    JOIN legal_official_expressions authority_expression
      ON authority_expression.id=authority_revision.official_expression_id
      AND authority_expression.textual_authority='controlling'
      AND authority_expression.controlling_on_conflict=1
    JOIN legal_complete_corpus_objects object
      ON object.run_id=record.run_id AND object.object_kind='provision_rendition'
      AND object.r2_key=record.provision_object_r2_key
      AND object.sha256=record.provision_object_sha256
    WHERE release.environment=? AND release.id=? AND release.status='sealed'
      AND record.provision_rendition_id=?
      AND record.${eligibility}=1 AND record.quarantined=0
    LIMIT 2`).bind(dependencies.environment, releaseId, id).all<CompleteCorpusEvidenceRow>();
  if (row.results.length !== 1) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  const record = row.results[0]!;
  if (record.capability !== capability) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  if (record.textualAuthority !== "controlling") {
    throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  }
  assertCompleteCorpusCurrentInterval(record,
    endpoint.kind === "timestamp" ? endpoint.instant : dependencies.currentAt);
  const provisionBytes = await readAndVerifyObject(dependencies.bucket, {
    r2Key: record.provisionKey,
    byteCount: Number(record.provisionBytes),
    sha256: record.provisionSha256,
  });
  let provisionText: string;
  let citationLabel = "Official provision";
  if (record.provisionMediaType === "text/plain;charset=utf-8") {
    try { provisionText = new TextDecoder("utf-8", { fatal: true }).decode(provisionBytes); }
    catch { throw new LegalEvidenceError("SOURCE_UNAVAILABILITY"); }
    if (provisionText.length === 0) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  } else if (record.provisionMediaType === "application/json;charset=utf-8") {
    let provision: z.infer<typeof provisionObjectSchema>;
    try {
      provision = provisionObjectSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true })
        .decode(provisionBytes)) as unknown);
    } catch {
      throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
    }
    if (provision.provisionRenditionId !== record.legacyCurrentRenditionId
      || provision.languageTag !== record.languageTag || provision.script !== record.script
      || provision.sourceNormalizedSha256 !== record.sourceNormalizedSha256
      || provision.sourceUrl !== record.sourceUrl) {
      throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
    }
    provisionText = provision.provisionText;
    citationLabel = `${provision.actTitle} — Article ${provision.articleNumber}`;
  } else throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  const evidence = resolvedEvidenceSchema.parse({
    legalInstrumentId: record.legalInstrumentId,
    officialExpressionId: record.officialExpressionId,
    textRevisionId: record.textRevisionId,
    provisionConceptId: record.provisionConceptId,
    provisionRenditionId: record.provisionRenditionId,
    languageTag: record.languageTag,
    script: record.script,
    textualAuthority: record.textualAuthority,
    provisionText,
    officialCitation: { label: citationLabel, url: record.sourceUrl },
    evidence: { provisionRenditionId: record.provisionRenditionId,
      r2Key: record.provisionKey, byteCount: Number(record.provisionBytes),
      sha256: record.provisionSha256, sourceNormalizedSha256: record.sourceNormalizedSha256,
      schemaVersion: 1 },
  });
  return controllingResolutionSchema.parse({ controlling: evidence,
    materialCitation: evidence.officialCitation });
}

async function readR2NativeProvision(
  dependencies: { bucket: Pick<LegalEvidenceBucket, "get">; currentAt: string },
  identity: CustomRuntimeLegalIdentity,
  untrustedEndpoint: TemporalEndpoint,
) {
  const endpoint = temporalEndpointSchema.parse(untrustedEndpoint);
  assertCompleteCorpusCurrentInterval(identity,
    endpoint.kind === "timestamp" ? endpoint.instant : dependencies.currentAt);
  const evidenceBytes = await readAndVerifyObject(dependencies.bucket, {
    r2Key: identity.evidence.r2Key,
    byteCount: identity.evidence.byteCount,
    sha256: identity.evidence.sha256,
  }, "sealed-production-evidence");
  let provisionText: string;
  let officialCitation = identity.citation;
  let articleNumber: string | undefined;
  let sourceRevisionId: string | undefined;
  let metadata: DiscoveryMetadata | null = null;
  if (identity.evidence.mediaType === "text/plain;charset=utf-8") {
    try { provisionText = new TextDecoder("utf-8", { fatal: true }).decode(evidenceBytes); }
    catch { throw new LegalEvidenceError("SOURCE_UNAVAILABILITY"); }
    if (provisionText.length === 0) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
  } else {
    let provision: z.infer<typeof r2NativeProvisionEvidenceSchema>;
    try {
      provision = r2NativeProvisionEvidenceSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true })
        .decode(evidenceBytes)) as unknown);
    } catch {
      throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
    }
    if (provision.provisionRenditionId !== identity.evidenceProvisionRenditionId
      || provision.languageTag !== identity.languageTag || provision.script !== identity.script
      || provision.sourceNormalizedSha256 !== identity.evidence.sourceNormalizedSha256
      || provision.sourceUrl !== identity.citation.url) {
      throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
    }
    provisionText = provision.provisionText;
    articleNumber = provision.articleNumber;
    sourceRevisionId = provision.textRevisionId;
    const heading=importObjectSchema.shape.articleTitle.safeParse(provision.articleTitle);
    if(heading.success)metadata = {actTitle:provision.actTitle,articleTitle:heading.data??null,languageTag:provision.languageTag};
    officialCitation = {
      label: `${provision.actTitle} — Article ${provision.articleNumber}`,
      url: provision.sourceUrl,
    };
  }
  return {provisionText,officialCitation,articleNumber,sourceRevisionId,metadata};
}

/** Discovery hints never establish Requirement Support or publication eligibility. */
export type DiscoveryMetadata = {
  actTitle: string;
  articleTitle: string | null;
  languageTag: CustomRuntimeLegalIdentity["languageTag"];
};

export async function readR2NativeDiscoveryMetadata(
  dependencies: {bucket: Pick<LegalEvidenceBucket,"get">;currentAt:string},
  identity: CustomRuntimeLegalIdentity,
  endpoint: TemporalEndpoint,
): Promise<DiscoveryMetadata | null> {
  return (await readR2NativeProvision(dependencies,identity,endpoint)).metadata;
}

/** Resolves immutable evidence through the body-free R2-native runtime mapping. */
export async function resolveR2NativeCustomEvidence(
  dependencies: { bucket: Pick<LegalEvidenceBucket, "get">; currentAt: string;
    readArticleContext?: (original: ResolvedOfficialEvidence, article: string,
      sourceRevisionId: string) => Promise<ResolvedOfficialEvidence | null>;
    readDocumentContext?: (original: ResolvedOfficialEvidence,
      sourceRevisionId: string) => Promise<ResolvedOfficialEvidence | null> },
  identity: CustomRuntimeLegalIdentity,
  untrustedEndpoint: TemporalEndpoint,
): Promise<ControllingEvidenceResolution> {
  const {provisionText,officialCitation,articleNumber,sourceRevisionId} =
    await readR2NativeProvision(dependencies,identity,untrustedEndpoint);
  const evidence = resolvedEvidenceSchema.parse({
    legalInstrumentId: identity.legalInstrumentId,
    officialExpressionId: identity.officialExpressionId,
    textRevisionId: identity.textRevisionId,
    provisionConceptId: identity.provisionConceptId,
    provisionRenditionId: identity.provisionRenditionId,
    languageTag: identity.languageTag,
    script: identity.script,
    textualAuthority: identity.textualAuthority,
    provisionText,
    officialCitation,
    evidence: {
      provisionRenditionId: identity.provisionRenditionId,
      r2Key: identity.evidence.r2Key,
      byteCount: identity.evidence.byteCount,
      sha256: identity.evidence.sha256,
      sourceNormalizedSha256: identity.evidence.sourceNormalizedSha256,
      schemaVersion: 1,
      ...(sourceRevisionId ? {sourceRevisionId} : {}),
    },
  });
  // Runtime identities may be remapped across releases. The parent locator
  // belongs to the original revision authenticated inside the sealed bytes.
  const articleContext = articleNumber && sourceRevisionId && dependencies.readArticleContext
    ? await dependencies.readArticleContext(evidence, articleNumber, sourceRevisionId) : null;
  const documentContext = !articleContext && sourceRevisionId && dependencies.readDocumentContext
    ? await dependencies.readDocumentContext(evidence, sourceRevisionId) : null;
  return controllingResolutionSchema.parse({ controlling: evidence,
    ...(articleContext ? { articleContext } : {}),
    ...(documentContext ? { documentContext } : {}),
    materialCitation: documentContext?.officialCitation ?? evidence.officialCitation });
}

/** Compatibility name for callers that only select current complete-corpus releases. */
export const resolveCompleteCorpusCurrentEvidence = resolveCompleteCorpusEvidence;

export async function handleOfficialEvidenceRequest(
  request: Request,
  env: OfficialEvidenceEnv,
): Promise<Response> {
  const environment = legalEnvironmentSchema.safeParse(env.APP_ENV);
  if (!environment.success || !acceptsPrivateServiceRequest(request, {
    environment: environment.data,
    marker: SERVICE_BINDING_MARKER,
    method: "POST",
    path: OFFICIAL_EVIDENCE_RESOLVE_PATH,
    requireJson: true,
  })) {
    return privateServiceJson({ code: "OFFICIAL_EVIDENCE_PRIVATE_ROUTE_REJECTED" }, 404);
  }
  if (!env.LEGAL_DB || !env.LEGAL_EVIDENCE_BUCKET) {
    return privateServiceJson({ code: "SOURCE_UNAVAILABILITY" }, 503);
  }
  try {
    if (!declaredRequestBodyWithinLimit(request, 4_096)) {
      throw new TypeError("OFFICIAL_EVIDENCE_REQUEST_TOO_LARGE");
    }
    const body = z.object({
      provisionRenditionId: provisionRenditionIdSchema,
      mode: z.enum(["rendition", "controlling"]).default("rendition"),
      endpoint: temporalEndpointSchema.optional(),
    }).strict()
      .parse(await request.json());
    const dependencies = { db: env.LEGAL_DB, bucket: env.LEGAL_EVIDENCE_BUCKET };
    return privateServiceJson({ result: body.mode === "controlling"
      ? await resolveControllingEvidence(
        dependencies,
        body.provisionRenditionId,
        body.endpoint ?? { kind: "current" },
      )
      : await resolveProvisionRendition(dependencies, body.provisionRenditionId, body.endpoint) });
  } catch {
    return privateServiceJson({ code: "SOURCE_UNAVAILABILITY" }, 503);
  }
}

export function createOfficialEvidenceClient(input: {
  service: Fetcher;
  environment: z.infer<typeof legalEnvironmentSchema>;
}) {
  return {
    async resolve(
      provisionRenditionId: string,
      endpoint?: TemporalEndpoint,
    ): Promise<ResolvedOfficialEvidence> {
      const response = await input.service.fetch(
        `http://legal-corpus.internal${OFFICIAL_EVIDENCE_RESOLVE_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-service-binding": SERVICE_BINDING_MARKER,
            "x-juro-legal-environment": input.environment,
          },
          body: JSON.stringify({ provisionRenditionId, ...(endpoint ? { endpoint } : {}) }),
        },
      );
      if (!response.ok) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
      try {
        return z.object({ result: resolvedEvidenceSchema }).strict().parse(await response.json()).result;
      } catch {
        throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
      }
    },
    async resolveControlling(
      provisionRenditionId: string,
      endpoint: TemporalEndpoint = { kind: "current" },
    ): Promise<ControllingEvidenceResolution> {
      const response = await input.service.fetch(
        `http://legal-corpus.internal${OFFICIAL_EVIDENCE_RESOLVE_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-service-binding": SERVICE_BINDING_MARKER,
            "x-juro-legal-environment": input.environment,
          },
          body: JSON.stringify({ provisionRenditionId, mode: "controlling", endpoint }),
        },
      );
      if (!response.ok) throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
      try {
        return z.object({ result: controllingResolutionSchema }).strict()
          .parse(await response.json()).result;
      } catch {
        throw new LegalEvidenceError("SOURCE_UNAVAILABILITY");
      }
    },
  };
}
