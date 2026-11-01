import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { provisionLocatorSchema, readOfficialProvision, type EvidenceScope, type ProvisionObjects } from "./evidence";
import { articleNumberFromHeading } from "./normalized-document";
import type { StoredProvisionReader, StoredProvisionReceipt } from "./stored-corpus";
import { withinSignal } from "./lifetime";

export type StoredObservationQuery = ({ work: string; position: string } | { url: string }) & { scope: EvidenceScope };
export type StoredObservationRow = { key: string; bytes: Uint8Array };
const observationSchema = z.object({ version: z.literal(1), locator: provisionLocatorSchema,
  source: z.object({ work: z.string().optional(), position: z.string().nullable().optional() }).passthrough().optional(),
  textSha256: z.string().regex(/^[a-f0-9]{64}$/u) });
const metadataSchema = z.object({ documentTitle: z.string(), source: z.object({ locale: z.enum(["en", "ru", "uz", "uzc"]) }),
  blocks: z.array(z.object({ text: z.string(), semanticRole: z.string().optional() })) });
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");

/** Read existing immutable acquisition receipts and their complete stored objects; no source preparation. */
export function createStoredObservationReader(input: { objects: ProvisionObjects;
  find(query: StoredObservationQuery, signal: AbortSignal): Promise<StoredObservationRow[]>;
}): StoredProvisionReader {
  async function read(query: StoredObservationQuery, signal: AbortSignal): Promise<StoredProvisionReceipt | null> {
    const rows = await withinSignal(signal, () => input.find(query, signal));
    if (rows.length > 16) throw new Error("STORED_OBSERVATION_LIMIT");
    const observations = rows.map(row => {
      if (row.bytes.length > 1024 * 1024 || row.key !== `legal-evidence/observations/${digest(row.bytes)}.json`) {
        throw new Error("EVIDENCE_INTEGRITY");
      }
      const observation = observationSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(row.bytes)));
      if ("work" in query ? observation.source?.work !== query.work || observation.source.position !== query.position
        : observation.locator.sourceUrl !== query.url) throw new Error("STORED_OBSERVATION_MAPPING");
      return observation;
    }).filter(({ locator }) => query.scope.kind === "current"
      ? locator.temporalState === "current_supported" && locator.currentPointerVerified
      : locator.applicableAt === query.scope.at);
    observations.sort((a, b) => (b.locator.editionObservation?.observedAt ?? "").localeCompare(a.locator.editionObservation?.observedAt ?? ""));
    const selected = observations[0];
    if (!selected) return null;
    if (!selected.locator.editionObservation) throw new Error("CITATION_OBSERVATION_MISSING");
    for (const other of observations.slice(1)) {
      if (other.locator.editionObservation?.observedAt === selected.locator.editionObservation.observedAt
        && (!isDeepStrictEqual(other.locator, selected.locator) || other.textSha256 !== selected.textSha256)) {
        throw new Error("STORED_OBSERVATION_AMBIGUOUS");
      }
    }
    const locator = selected.locator;
    if (locator.encoding !== "normalized-document" && locator.encoding !== "normalized-article") {
      throw new Error("STORED_OBSERVATION_ENCODING");
    }
    const bytes = await withinSignal(signal, () => input.objects.get(locator.objectKey, signal));
    if (!bytes || bytes.length !== locator.byteCount || digest(bytes) !== locator.sha256) throw new Error("EVIDENCE_INTEGRITY");
    const evidence = await readOfficialProvision(locator, { get: async () => bytes }, query.scope, signal);
    if (digest(evidence.text) !== selected.textSha256) throw new Error("EVIDENCE_INTEGRITY");
    const metadata = metadataSchema.parse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    const articleTitle = locator.encoding === "normalized-article"
      ? metadata.blocks.find(block => articleNumberFromHeading(block.text) === locator.articleNumber)?.text ?? null : null;
    return { locator, title: metadata.documentTitle, articleTitle,
      language: { en: "en", ru: "ru", uz: "uz-Latn", uzc: "uz-Cyrl" }[metadata.source.locale],
      textSha256: selected.textSha256,
      selected: { kind: locator.encoding, articleNumber: locator.articleNumber ?? null } };
  }
  return {
    async lookup(request, signal) {
      const receipt = await read({ work: request.work, position: request.position, scope: request.scope }, signal);
      if (receipt && receipt.language !== request.language) throw new Error("CORPUS_SOURCE_IDENTITY");
      return receipt;
    },
    async reference(request, signal) {
      if (!request.parent.operativeReferences?.some(item => item.url === request.url)) throw new Error("REFERENCE_NOT_AUTHENTICATED");
      if (request.scope.kind === "current" ? request.parent.temporalState !== "current_supported"
        : request.parent.applicableAt !== request.scope.at) throw new Error("REFERENCE_SCOPE_MISMATCH");
      return read({ url: request.url, scope: request.scope }, signal);
    },
  };
}
