import { sourceFileSchema, type SourceFile } from "./source-file-contract";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { readNormalizedEvidence } from "./normalized-document";

const sourceStructureSchema = z.object({
  navigationOnly: z.literal(true), rangeKind: z.enum(["article", "stored_section", "document"]),
  rangeTitle: z.string().nullable(),
  anchor: z.object({ position: z.string(), ordinal: z.number().int(), language: z.string() }),
  annexContext: z.array(z.object({ relation: z.enum(["preceding", "within"]),
    units: z.array(z.object({ position: z.string(), ordinal: z.number().int(), language: z.string(), text: z.string() })),
  })).optional(),
  headings: z.array(z.object({ position: z.string(), ordinal: z.number().int(), language: z.string(),
    text: z.string(), hierarchy: z.array(z.string()) })),
});
export type SourceStructure = z.infer<typeof sourceStructureSchema>;
const referenceOriginSchema = z.object({
  position: z.string(), ordinal: z.number().int(), text: z.string(), hierarchy: z.array(z.string()),
  precedingHeading: z.object({ position: z.string(), text: z.string() }).optional(),
});
export type ReferenceOrigin = z.infer<typeof referenceOriginSchema>;

export const provisionLocatorSchema = z.object({
  identity: z.string().trim().min(1), snapshot: z.string().trim().min(1),
  objectKey: z.string().trim().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  byteCount: z.number().int().positive(),
  sourceUrl: z.url(), privacyClass: z.literal("public_official_source"),
  sourceTitle: z.string().optional(),
  quarantined: z.literal(false), canonicalizationConflict: z.literal(false),
  temporalState: z.enum(["current_supported", "historical_only"]),
  currentPointerVerified: z.boolean(), applicableAt: z.iso.date().optional(),
  encoding: z.enum(["utf8-provision", "normalized-document", "normalized-article"]).optional(),
  articleNumber: z.string().regex(/^[1-9]\d{0,5}(?:-\d{1,4})?$/u).optional(),
  operativeReferences: z.array(z.object({ url: z.url(), text: z.string(), origins: z.array(referenceOriginSchema).optional() })).max(2000).optional(),
  editionObservation: z.object({ selectedEdition: z.string().nullable(), observedAt: z.iso.datetime() }).optional(),
  sourceNotes: z.array(z.string()).optional(),
  sourceStructure: sourceStructureSchema.optional(),
  sourceFile: sourceFileSchema.optional(),
}).refine(locator => locator.encoding !== "normalized-article" || !!locator.articleNumber);

/** Metadata must come from the authenticated retained membership reader, never a model. */
export type ProvisionLocator = {
  identity: string;
  snapshot: string;
  objectKey: string;
  sha256: string;
  byteCount: number;
  sourceUrl: string;
  /** Exact retained act title; distinct from a provision or chapter heading. */
  sourceTitle?: string;
  privacyClass: "public_official_source" | "private" | "unknown";
  quarantined: boolean;
  canonicalizationConflict: boolean;
  temporalState: "current_supported" | "unknown" | "historical_only" | "disputed";
  currentPointerVerified: boolean;
  /** Requested legal date bound to the verified edition; substantive temporal conditions are assessed separately. */
  applicableAt?: string;
  /** Omitted for historical plain UTF-8 provision objects. */
  encoding?: "utf8-provision" | "normalized-document" | "normalized-article";
  articleNumber?: string;
  operativeReferences?: { url: string; text: string; origins?: ReferenceOrigin[] }[];
  /** Publisher edition observation; commencement and transitional rules still require substantive assessment. */
  editionObservation?: { selectedEdition: string | null; observedAt: string };
  /** Exact retained publisher notices; a current capture is not a finding that the law remains in force. */
  sourceNotes?: string[];
  /** Exact heading occurrences; inherited hierarchy is navigation, not a legal applicability finding. */
  sourceStructure?: SourceStructure;
  /** Complete PDF required alongside textual navigation; bytes stay outside graph and saved-answer state. */
  sourceFile?: SourceFile;
};

export type EvidenceScope = { kind: "current" } | { kind: "historical"; at: string };

export type ProvisionObjects = {
  get(key: string, signal?: AbortSignal): Promise<Uint8Array | null>;
};

const storedReadSchema = z.object(provisionLocatorSchema.shape).pick({ identity: true, snapshot: true, objectKey: true,
  sha256: true, byteCount: true, sourceUrl: true, privacyClass: true, encoding: true, articleNumber: true, sourceFile: true })
  .refine(locator => locator.encoding !== "normalized-article" || !!locator.articleNumber);

export async function readOfficialProvision(
  locator: ProvisionLocator,
  objects: ProvisionObjects,
  scope: EvidenceScope = { kind: "current" },
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  if (!storedReadSchema.safeParse(locator).success) throw new Error("EVIDENCE_INELIGIBLE");
  const url = new URL(locator.sourceUrl);
  const temporalEligible = scope.kind === "current"
    ? locator.temporalState === "current_supported"
    : z.iso.date().safeParse(scope.at).success && locator.applicableAt === scope.at
      && ["current_supported", "historical_only"].includes(locator.temporalState);
  if (locator.privacyClass !== "public_official_source" || !temporalEligible || url.protocol !== "https:"
    || !["lex.uz", "www.lex.uz"].includes(url.hostname) || url.username || url.password
    || url.port) throw new Error("EVIDENCE_INELIGIBLE");
  const bytes = await objects.get(locator.objectKey, signal);
  signal?.throwIfAborted();
  // Corpus authenticity is established by preparation. Reading is not re-certification.
  if (!bytes) throw new Error("OFFICIAL_PROVISION_NOT_FOUND");
  const serialized = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  let text = serialized;
  if (locator.encoding === "normalized-article" || locator.encoding === "normalized-document") {
    const retained = readNormalizedEvidence(serialized, locator.sourceUrl, locator.encoding === "normalized-article"
      ? { kind: locator.encoding, articleNumber: locator.articleNumber! } : { kind: locator.encoding });
    if (!isDeepStrictEqual(retained.sourceFile, locator.sourceFile)) throw new Error("EVIDENCE_SOURCE_FILE_MISMATCH");
    text = retained.text;
  }
  if (!text.trim()) throw new Error("EVIDENCE_EMPTY");
  return { ...locator, text };
}
