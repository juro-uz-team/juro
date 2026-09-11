import { z } from "zod";
import {observeCurrentLexDocument} from "../legal/lex-document-status";
import {createSharedLexDocumentObservationReader} from "../legal/shared-source-observation";
import {createPinnedSourceVerifier} from "./pinned-source-observation";

import {
  createProviderCandidateIndex,
  parsePinnedCandidateRelease,
  toPinnedCandidateConfiguration,
  type LegalCandidateProvider,
  type LegalCandidateBatchSearchInput,
  type LegalCandidateSearchInput,
  type CandidatePacket,
  type PinnedCandidateRelease,
  type TemporalEndpoint,
} from "./legal-candidate-index";
import { CUSTOM_SEARCH_PATH, CUSTOM_SEARCH_SERVICE_MARKER, customSearchBatchResponseSchema,
  customSearchResponseSchema }
  from "./custom-search-service";
import { customReleaseGovernanceSchema } from "./custom-release-governance";
import { resolveCustomBm25RuntimeMembershipEntries, type CustomRuntimeLegalIdentity }
  from "./custom-bm25-runtime";
import { resolveCustomTrustedLegalTitles } from "./custom-search-trusted-titles";
import { createCustomMembershipLookupReader } from "./custom-membership-lookup";
import {loadCandidateMembershipProjection, readCandidateMembershipProofs, verifyProjectedCandidateMembership} from "./candidate-membership-projection";
import { assertCompleteCorpusCurrentInterval, resolveCompleteCorpusEvidence, resolveControllingEvidence,
  resolveR2NativeCustomEvidence,
  type LegalEvidenceBucket } from "./target-evidence";
import { resolveProvisionLineage } from "./target-lineage";
import { createNormalizedArticleEvidenceReader } from "./normalized-article-evidence";
import { createRuntimeReferenceDiscovery } from "./runtime-reference-discovery";
import { createReleaseLifecycle, resolveStagingHistoryComparisonEvaluationSet } from "./target-release";
import {
  createTargetLegalAnswerRetriever,
  parseQuestionInterpretationPlan,
  parseRevalidatedCandidates,
  parseSelectionDecision,
  type QuestionInterpretationPlan,
  type RevalidatedCandidate,
  type SelectionDecision,
  type TargetLegalAnswerRetriever,
} from "./target-retrieval";

const environmentSchema = z.enum(["development", "staging", "production"]);

function physicalRuntimeReleaseId(descriptorKey: string, logicalReleaseId: string): string {
  const match = /^search-releases\/([^/]+)\/runtime\/descriptor-[a-f0-9]{64}\.json$/u
    .exec(descriptorKey);
  return match?.[1] ?? logicalReleaseId;
}

export type TargetRetrievalRuntimeEnv = {
  APP_ENV: string;
  WORKER_VERSION?: WorkerVersionMetadata;
  LEGAL_RUNTIME_BUILD_ID?: string;
  CANDIDATE_MEMBERSHIP_PROOFS_ENABLED?: string;
  LEGAL_SOURCE_OBSERVATIONS_ENABLED?: string;
  LEGAL_CORPUS_SHADOW_MODE?: string;
  LEGAL_DB?: D1Database;
  LEGAL_EVIDENCE_BUCKET?: Pick<LegalEvidenceBucket, "get">;
  LEGAL_HISTORY_EVIDENCE_BUCKET?: Pick<LegalEvidenceBucket, "get">;
  LEGAL_CUSTOM_ARTIFACT_BUCKET?: R2Bucket;
  LEGAL_CORPUS_REASONING_SERVICE?: Fetcher;
  LEGAL_CUSTOM_SEARCH_SERVICE?: Fetcher;
  LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE?: Fetcher;
  LEGAL_AI_GATEWAY_ID?: string;
  LEGAL_AI_PROVIDER_PROJECT_ID?: string;
};

type RuntimeDependencies = {
  onReleaseResolved?: (releaseId: string) => void;
  environment: z.infer<typeof environmentSchema>;
  membershipProofsEnabled?: boolean;
  sharedSourceObservationsEnabled?: boolean;
  db: D1Database;
  evidenceBucket: Pick<LegalEvidenceBucket, "get">;
  historyEvidenceBucket?: Pick<LegalEvidenceBucket, "get">;
  customArtifactBucket?: R2Bucket;
  reasoningService: Fetcher;
};

type RuntimeReleaseResolver = {
  resolve(endpoint: TemporalEndpoint): Promise<PinnedCandidateRelease | null>;
  resolveComparison?(
    left: TemporalEndpoint,
    right: TemporalEndpoint,
  ): Promise<{ left: PinnedCandidateRelease; right: PinnedCandidateRelease } | null>;
};


export function selectRuntimeEvidenceBucket<T>(
  capability: "current" | "history",
  evidenceBucket: T,
  historyEvidenceBucket?: T,
): T {
  return capability === "history" && historyEvidenceBucket
    ? historyEvidenceBucket
    : evidenceBucket;
}

async function sha256Hex(value: string | Uint8Array): Promise<string> {
  const encoded = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const bytes = new Uint8Array(encoded.byteLength);
  bytes.set(encoded);
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function serviceJson(
  service: Fetcher,
  environment: string,
  path: string,
  body: unknown,
): Promise<unknown> {
  const serializedBody = JSON.stringify(body);
  if (path === "/internal/legal-corpus/reasoning/select") {
    console.log(JSON.stringify({
      event: "legal_target_reasoning_requested",
      requestBytes: new TextEncoder().encode(serializedBody).byteLength,
    }));
  }
  const response = await service.fetch(`http://legal-corpus.internal${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-juro-service-binding": "target-retrieval-runtime-v1",
      "x-juro-legal-environment": environment,
    },
    body: serializedBody,
  });
  if (!response.ok) {
    const error = new TypeError("TARGET_RETRIEVAL_DEPENDENCY_UNAVAILABLE");
    error.name = `TargetRetrievalDependency${response.status}`;
    throw error;
  }
  return response.json();
}

const customChunkArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  releaseId: z.string().min(1),
  chunk: z.object({ id: z.string().min(1),
    snapshotProvisionId: z.string().regex(/^audit:[a-f0-9]{64}$/u) }).passthrough(),
  evidence: z.object({ snapshotProvisionId: z.string().regex(/^audit:[a-f0-9]{64}$/u) })
    .passthrough(),
}).passthrough();

async function resolveCustomChunkIdentities(
  bucket: Pick<LegalEvidenceBucket, "get">,
  releaseId: string,
  itemKeys: readonly string[],
) {
  const prefix = `search-releases/${releaseId}/`;
  const output = new Map<string, { canonicalChunkId: string; legalIdentitySha256: string }>();
  for (let offset = 0; offset < itemKeys.length; offset += 6) {
    await Promise.all(itemKeys.slice(offset, offset + 6).map(async (itemKey) => {
      if (!itemKey.startsWith(prefix)) throw new TypeError("TARGET_CUSTOM_CHUNK_IDENTITY_INVALID");
      const canonicalChunkId = z.string().regex(/^retrieval-chunk-v1:[a-f0-9]{64}$/u)
        .parse(itemKey.slice(prefix.length));
      const object = await bucket.get(`search-releases/${releaseId}/chunks/${canonicalChunkId}.json`);
      if (!object || !object.customMetadata?.sha256) {
        throw new TypeError("TARGET_CUSTOM_CHUNK_ARTIFACT_MISSING");
      }
      const bytes = await object.bytes();
      if (bytes.byteLength !== object.size || await sha256Hex(bytes) !== object.customMetadata.sha256) {
        throw new TypeError("TARGET_CUSTOM_CHUNK_ARTIFACT_CORRUPT");
      }
      const artifact = customChunkArtifactSchema.parse(JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      ) as unknown);
      if (artifact.releaseId !== releaseId || artifact.chunk.id !== canonicalChunkId
        || artifact.chunk.snapshotProvisionId !== artifact.evidence.snapshotProvisionId) {
        throw new TypeError("TARGET_CUSTOM_CHUNK_IDENTITY_INVALID");
      }
      output.set(itemKey, { canonicalChunkId,
        legalIdentitySha256: artifact.chunk.snapshotProvisionId.slice("audit:".length) });
    }));
  }
  return output;
}

export function createRuntimeCandidateCatalog(
  db: D1Database,
  bucket?: Pick<LegalEvidenceBucket, "get">,
  r2IdentityByRendition = new Map<string, CustomRuntimeLegalIdentity>(),
  options: {membershipProofsEnabled?: boolean} = {},
) {
  // Current and historical releases have independent publication histories.
  // This rollout flag activates current proofs only; history retains its
  // authenticated inventory lookup until a historical projection is published.
  const usesMembershipProofs = (release: PinnedCandidateRelease) =>
    options.membershipProofsEnabled === true && release.capability === "current";
  // The catalog belongs to one answer request. Reuse only membership facts
  // authenticated against the same pinned inventory; temporal eligibility and
  // candidate provenance are still checked for every packet and endpoint.
  type Membership = NonNullable<Awaited<ReturnType<typeof resolveCustomBm25RuntimeMembershipEntries>>>;
  const membershipByInventory = new Map<string, Membership>();
  const readMembershipLookup = bucket ? createCustomMembershipLookupReader(bucket as R2Bucket) : null;
  const projections = new Map<string, ReturnType<typeof loadCandidateMembershipProjection>>();
  const trustedProjection = async (releaseId: string) => {
    if (!bucket) throw new TypeError("TARGET_MEMBERSHIP_PROOF_UNAVAILABLE");
    let published = projections.get(releaseId);
    if (!published) {
      published = loadCandidateMembershipProjection({db, bucket: bucket as R2Bucket, releaseId});
      projections.set(releaseId, published);
    }
    const projection = await published;
    if (!projection) throw new TypeError("TARGET_MEMBERSHIP_PROOF_UNAVAILABLE");
    return projection;
  };
  return {
    async prepareReferencePacket(packet: CandidatePacket, release: PinnedCandidateRelease): Promise<CandidatePacket> {
      if (!usesMembershipProofs(release)) return packet;
      if (packet.releaseId !== release.id) throw new TypeError("TARGET_CANDIDATE_PACKET_IDENTITY_MISMATCH");
      const projection = await trustedProjection(release.id);
      const prefix = `search-releases/${release.id}/`;
      if (packet.candidates.some(candidate => !candidate.itemKey.startsWith(prefix))) {
        throw new TypeError("TARGET_CANDIDATE_PACKET_IDENTITY_MISMATCH");
      }
      const proofs = await readCandidateMembershipProofs({bucket: bucket as R2Bucket, projection,
        itemKeys: packet.candidates.map(candidate => candidate.itemKey.slice(prefix.length))});
      return {...packet, candidates: packet.candidates.map(candidate => ({...candidate,
        membershipProof: proofs.get(candidate.itemKey.slice(prefix.length))!}))};
    },
    async revalidate(
      packet: CandidatePacket,
      endpoint: TemporalEndpoint,
      release: PinnedCandidateRelease,
      currentAt: string,
    ): Promise<RevalidatedCandidate[]> {
      if (packet.releaseId !== release.id || packet.availability !== "available" || packet.partialErrors.length
        || packet.requiredInstanceIds.length !== release.instances.length
        || new Set(packet.requiredInstanceIds).size !== release.instances.length
        || release.instances.some(instance => !packet.requiredInstanceIds.includes(instance.id))
        || packet.candidates.some(candidate => !release.instances.some(instance =>
          instance.id === candidate.instanceId && instance.shardId === candidate.shardId))) {
        throw new TypeError("TARGET_CANDIDATE_PACKET_IDENTITY_MISMATCH");
      }
      const uniqueKeys = [...new Set(packet.candidates.map((candidate) => candidate.itemKey))];
      const rows: Array<{
        itemKey: string;
        canonicalChunkId: string;
        provisionRenditionId: string;
        textRevisionId: string;
        provisionConceptId: string;
        languageTag: string;
        textualAuthority: string;
        validFrom: string | null;
        validTo: string | null;
      }> = [];
      const custom = packet.candidates.every((candidate) =>
        candidate.itemKey.startsWith(`search-releases/${release.id}/retrieval-chunk-v1:`));
      if (custom && ((release.capability === "current" && endpoint.kind !== "current")
        || (release.capability === "history" && endpoint.kind !== "timestamp"))) {
        throw new TypeError("TARGET_CUSTOM_CANDIDATE_ENDPOINT_INVALID");
      }
      const customEligibility = release.capability === "history"
        ? "historical_eligible" : "current_eligible";
      let compactMembership: Map<string, { ordinal: number;
        legalIdentitySha256: string | null; legalIdentity?: CustomRuntimeLegalIdentity }> | null = null;
      if (usesMembershipProofs(release)) {
        if (!custom || !bucket) throw new TypeError("TARGET_MEMBERSHIP_PROOF_UNAVAILABLE");
        const projection = await trustedProjection(release.id);
        compactMembership = new Map();
        for (let offset = 0; offset < packet.candidates.length; offset += 16) {
          const members = await Promise.all(packet.candidates.slice(offset, offset + 16).map(candidate =>
            verifyProjectedCandidateMembership({projection,
              itemKey: candidate.itemKey.slice(`search-releases/${release.id}/`.length), proof: candidate.membershipProof})));
          for (const member of members) compactMembership.set(member.itemKey, {ordinal: member.ordinal,
            legalIdentitySha256: member.legalIdentity.legalIdentitySha256, legalIdentity: member.legalIdentity});
        }
      } else if (custom && bucket) {
        const component = await db.prepare(`SELECT root.mapping_inventory_sha256 AS mappingInventorySha256,
            root.runtime_descriptor_r2_key AS descriptorKey, lookup.lookup_r2_key AS lookupKey,
            lookup.lookup_sha256 AS lookupSha256, lookup.lookup_size_bytes AS lookupSizeBytes
          FROM legal_custom_search_r2_runtime_roots root
          LEFT JOIN legal_custom_search_membership_lookups lookup
            ON lookup.search_release_id=root.search_release_id
            AND lookup.source_inventory_sha256=root.mapping_inventory_sha256
            AND lookup.member_count=root.mapping_count
          WHERE root.search_release_id=?
          UNION ALL SELECT mapping_inventory_sha256,runtime_descriptor_r2_key,NULL,NULL,NULL
          FROM legal_custom_search_runtime_components
          WHERE search_release_id=? AND NOT EXISTS (
            SELECT 1 FROM legal_custom_search_r2_runtime_roots WHERE search_release_id=?)
          LIMIT 1`).bind(release.id, release.id, release.id)
          .first<{ mappingInventorySha256: string; descriptorKey: string;
            lookupKey?: string | null; lookupSha256?: string | null; lookupSizeBytes?: number | null }>();
        if (!component) throw new TypeError("TARGET_CUSTOM_RUNTIME_COMPONENT_MISSING");
        const prefix = `search-releases/${release.id}/`;
        const inventoryKey = `${release.id}:${component.mappingInventorySha256}`;
        const known = membershipByInventory.get(inventoryKey) ?? new Map();
        const canonicalKeys = uniqueKeys.map(key => key.slice(prefix.length));
        const missingKeys = canonicalKeys.filter(key => !known.has(key));
        const physicalReleaseId = physicalRuntimeReleaseId(component.descriptorKey, release.id);
        compactMembership = missingKeys.length === 0 ? new Map()
          : component.lookupKey && component.lookupSha256 && component.lookupSizeBytes
            ? await readMembershipLookup!({releaseId: physicalReleaseId,
              sourceInventorySha256: component.mappingInventorySha256,
              reference: {key: component.lookupKey, sha256: component.lookupSha256, sizeBytes: component.lookupSizeBytes},
              itemKeys: missingKeys})
            : await resolveCustomBm25RuntimeMembershipEntries(bucket as R2Bucket, release.id,
            component.mappingInventorySha256, missingKeys);
        if (!compactMembership && physicalReleaseId !== release.id) {
          compactMembership = await resolveCustomBm25RuntimeMembershipEntries(bucket as R2Bucket,
            physicalReleaseId, component.mappingInventorySha256,
            missingKeys);
        }
        if (compactMembership) {
          for (const [key, value] of compactMembership) known.set(key, value);
          // Current/history endpoints and one repair are bounded by the caller.
          if (membershipByInventory.size < 4 || membershipByInventory.has(inventoryKey)) {
            membershipByInventory.set(inventoryKey, known);
          }
          compactMembership = new Map(canonicalKeys.flatMap(key => {
            const value = known.get(key);
            return value ? [[key, value] as const] : [];
          }));
        }
        if (compactMembership && compactMembership.size !== uniqueKeys.length) {
          throw new TypeError("TARGET_CANDIDATE_NOT_IN_PINNED_RELEASE");
        }
      }
      const r2NativeIdentities = compactMembership
        && [...compactMembership.values()].every(({ legalIdentity }) => legalIdentity)
        ? new Map(uniqueKeys.map((key) => [key, compactMembership!.get(
          key.slice(`search-releases/${release.id}/`.length),
        )!.legalIdentity!])) : null;
      if (r2NativeIdentities) {
        for (const key of uniqueKeys) {
          const identity = r2NativeIdentities.get(key)!;
          const canonicalChunkId = key.slice(`search-releases/${release.id}/`.length);
          rows.push({ itemKey: key, canonicalChunkId,
            provisionRenditionId: identity.provisionRenditionId,
            textRevisionId: identity.textRevisionId,
            provisionConceptId: identity.provisionConceptId,
            languageTag: identity.languageTag,
            textualAuthority: identity.textualAuthority,
            validFrom: identity.validFrom, validTo: identity.validTo });
          r2IdentityByRendition.set(identity.provisionRenditionId, identity);
        }
      }
      const prefix = `search-releases/${release.id}/`;
      const anchoredIdentities = compactMembership
        && [...compactMembership.values()].every(({ legalIdentitySha256 }) => legalIdentitySha256)
        ? new Map(uniqueKeys.map((key) => {
          const canonicalChunkId = key.slice(prefix.length);
          return [key, { canonicalChunkId,
            legalIdentitySha256: compactMembership!.get(canonicalChunkId)!.legalIdentitySha256! }];
        })) : null;
      const customIdentities = anchoredIdentities ?? (compactMembership && bucket
        ? await resolveCustomChunkIdentities(bucket, release.id, uniqueKeys) : null);
      for (let offset = 0; !r2NativeIdentities && offset < uniqueKeys.length; offset += 80) {
        const keys = uniqueKeys.slice(offset, offset + 80);
        if (keys.length === 0) continue;
        const identities = customIdentities
          ? keys.map((key) => customIdentities.get(key)!.legalIdentitySha256) : keys;
        const placeholders = identities.map(() => "?").join(",");
        const result = await db.prepare(custom && customIdentities ? `SELECT
            record.legal_identity_sha256 AS itemKey,'' AS canonicalChunkId,
            record.provision_rendition_id AS provisionRenditionId,
            record.text_revision_id AS textRevisionId,
            record.provision_concept_id AS provisionConceptId,
            record.language AS languageTag,record.textual_authority AS textualAuthority,
            record.valid_from AS validFrom,record.valid_to AS validTo
          FROM legal_custom_search_runtime_components runtime
          JOIN legal_complete_corpus_records record ON record.run_id=runtime.complete_corpus_run_id
          WHERE runtime.search_release_id=? AND record.legal_identity_sha256 IN (${placeholders})
            AND record.${customEligibility}=1 AND record.quarantined=0` : custom ? `SELECT item.item_key AS itemKey,
            item.retrieval_chunk_id AS canonicalChunkId,
            record.provision_rendition_id AS provisionRenditionId,
            record.text_revision_id AS textRevisionId,
            record.provision_concept_id AS provisionConceptId,
            record.language AS languageTag,record.textual_authority AS textualAuthority,
            record.valid_from AS validFrom,record.valid_to AS validTo
          FROM legal_custom_search_runtime_items item
          JOIN legal_custom_search_runtime_components runtime
            ON runtime.search_release_id=item.search_release_id
          JOIN legal_complete_corpus_records record
            ON record.run_id=runtime.complete_corpus_run_id
            AND record.legal_identity_sha256=item.legal_identity_sha256
          WHERE item.search_release_id=? AND item.item_key IN (${placeholders})
            AND record.${customEligibility}=1 AND record.quarantined=0` : `SELECT item.item_key AS itemKey,
            item.canonical_chunk_id AS canonicalChunkId,
            rendition.id AS provisionRenditionId,rendition.text_revision_id AS textRevisionId,
            rendition.provision_concept_id AS provisionConceptId,
            expression.language_tag AS languageTag,revision.textual_authority AS textualAuthority
          FROM legal_search_release_items item
          JOIN legal_provision_renditions rendition
            ON rendition.id=item.provision_rendition_id
          JOIN legal_text_revisions revision ON revision.id=rendition.text_revision_id
          JOIN legal_official_expressions expression ON expression.id=revision.official_expression_id
          WHERE item.search_release_id=? AND item.item_key IN (${placeholders})`).bind(
          release.id,
          ...identities,
        ).all<typeof rows[number]>();
        if (customIdentities) {
          const byIdentity = new Map(result.results.map((row) => [row.itemKey, row]));
          for (const key of keys) {
            const identity = customIdentities.get(key)!;
            const record = byIdentity.get(identity.legalIdentitySha256);
            if (record) rows.push({ ...record, itemKey: key,
              canonicalChunkId: identity.canonicalChunkId });
          }
        } else rows.push(...result.results);
      }
      const byKey = new Map(rows.map((row) => [row.itemKey, row]));
      return parseRevalidatedCandidates(packet.candidates.map((candidate) => {
        const row = byKey.get(candidate.itemKey);
        if (!row) throw new TypeError("TARGET_CANDIDATE_NOT_IN_PINNED_RELEASE");
        if (custom) assertCompleteCorpusCurrentInterval(row,
          endpoint.kind === "timestamp" ? endpoint.instant : currentAt);
        const languageFamily = row.languageTag.startsWith("uz-") ? "uz"
          : row.languageTag === "ru" ? "ru" : row.languageTag === "en" ? "en" : null;
        if (!languageFamily || !["controlling", "official_translation", "unknown"]
          .includes(row.textualAuthority)) {
          throw new TypeError("TARGET_CANDIDATE_IDENTITY_INVALID");
        }
        return {
          candidate,
          canonicalChunkId: row.canonicalChunkId,
          provisionRenditionId: row.provisionRenditionId,
          textRevisionId: row.textRevisionId,
          provisionConceptId: row.provisionConceptId,
          languageFamily,
          textualAuthority: row.textualAuthority as RevalidatedCandidate["textualAuthority"],
        };
      }));
    },
  };
}

type CustomSearchCapability = "current" | "history";
const customInstanceId = (capability: CustomSearchCapability, environment: string) =>
  `custom-${capability}-${environment}-v1`;
const customShardId = (capability: CustomSearchCapability) => `${capability}-base-v1`;

function customPinnedConfiguration(identityValue: string, gatewayIdentity: string,
  projectIdentity: string) {
  return toPinnedCandidateConfiguration({
    identity: identityValue,
    embeddingModel: "openai/text-embedding-3-large",
    dimensions: 1_536,
    keywordTokenizer: "porter",
    metadataSchema: ["language", "document_type", "valid_from", "valid_to"],
    gatewayIdentity,
    providerProjectIdentity: projectIdentity,
    gatewayPayloadLogging: false,
    gatewayCaching: false,
    similarityCaching: false,
  });
}

function assertCustomSearchRequest(capability: CustomSearchCapability, environment: string,
  input: Pick<LegalCandidateSearchInput, "endpoint" | "instanceIds">) {
  if ((capability === "current" && input.endpoint.kind !== "current")
    || (capability === "history" && input.endpoint.kind !== "timestamp")
    || input.instanceIds.length !== 1
    || input.instanceIds[0] !== customInstanceId(capability, environment)) {
    throw new TypeError("CUSTOM_SEARCH_REQUEST_REJECTED");
  }
}

async function requestCustomSearch(service: Fetcher, environment: string,
  input: LegalCandidateSearchInput) {
  const response = await service.fetch(`http://legal-corpus.internal${CUSTOM_SEARCH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json",
      "x-juro-service-binding": CUSTOM_SEARCH_SERVICE_MARKER,
      "x-juro-legal-environment": environment },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new TypeError("CUSTOM_SEARCH_SERVICE_UNAVAILABLE");
  return customSearchResponseSchema.parse(await response.json());
}

async function requestCustomSearchBatch(service: Fetcher, environment: string,
  input: LegalCandidateBatchSearchInput) {
  const response = await service.fetch(`http://legal-corpus.internal${CUSTOM_SEARCH_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json",
      "x-juro-service-binding": CUSTOM_SEARCH_SERVICE_MARKER,
      "x-juro-legal-environment": environment },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new TypeError("CUSTOM_SEARCH_SERVICE_UNAVAILABLE");
  return customSearchBatchResponseSchema.parse(await response.json());
}

export function createRuntimeCustomSearchProvider(input: {
  db: D1Database;
  service: Fetcher;
  capability: CustomSearchCapability;
  environment: "development" | "staging" | "production";
  gatewayIdentity: string;
  projectIdentity: string;
}): LegalCandidateProvider {
  const pinned = async (releaseId: string | undefined) => {
    if (!releaseId) throw new TypeError("CUSTOM_SEARCH_PINNED_RELEASE_REQUIRED");
    const row = await input.db.prepare(`SELECT release.id,release.configuration_identity AS configurationIdentity
      FROM legal_search_releases release
      WHERE (EXISTS (SELECT 1 FROM legal_custom_search_r2_runtime_roots runtime
          WHERE runtime.search_release_id=release.id)
        OR EXISTS (SELECT 1 FROM legal_custom_search_runtime_components runtime
          WHERE runtime.search_release_id=release.id))
        AND release.environment=? AND release.id=? AND release.capability=?
        AND release.status='sealed'`).bind(input.environment, releaseId, input.capability)
      .first<{ id: string; configurationIdentity: string }>();
    if (!row) throw new TypeError("CUSTOM_SEARCH_ACTIVE_RELEASE_UNAVAILABLE");
    return row;
  };
  return {
    async attest(instanceId, releaseId) {
      if (instanceId !== customInstanceId(input.capability, input.environment)) {
        throw new TypeError("CUSTOM_SEARCH_INSTANCE_REJECTED");
      }
      const release = await pinned(releaseId);
      return customPinnedConfiguration(release.configurationIdentity,
        input.gatewayIdentity, input.projectIdentity);
    },
    async search(searchInput) {
      assertCustomSearchRequest(input.capability, input.environment, searchInput);
      const release = await pinned(searchInput.releaseId);
      return requestCustomSearch(input.service, input.environment,
        { ...searchInput, releaseId: release.id });
    },
    async searchMany(searchInput) {
      assertCustomSearchRequest(input.capability, input.environment, searchInput);
      const release = await pinned(searchInput.releaseId);
      return requestCustomSearchBatch(input.service, input.environment,
        { ...searchInput, releaseId: release.id });
    },
  };
}

function createRuntimeEvaluationCustomSearchProvider(input: {
  releaseId: string;
  configurationIdentity: string;
  service: Fetcher;
  capability: CustomSearchCapability;
  gatewayIdentity: string;
  projectIdentity: string;
}): LegalCandidateProvider {
  const configuration = customPinnedConfiguration(input.configurationIdentity,
    input.gatewayIdentity, input.projectIdentity);
  const assertEvaluationRelease = (releaseId: string | undefined) => {
    if (releaseId !== input.releaseId) {
      throw new TypeError("CUSTOM_SEARCH_EVALUATION_RELEASE_REJECTED");
    }
  };
  return {
    async attest(instanceId, releaseId) {
      if (instanceId !== customInstanceId(input.capability, "staging")) {
        throw new TypeError("CUSTOM_SEARCH_INSTANCE_REJECTED");
      }
      assertEvaluationRelease(releaseId);
      return configuration;
    },
    async search(searchInput) {
      assertCustomSearchRequest(input.capability, "staging", searchInput);
      assertEvaluationRelease(searchInput.releaseId);
      return requestCustomSearch(input.service, "staging", searchInput);
    },
    async searchMany(searchInput) {
      assertCustomSearchRequest(input.capability, "staging", searchInput);
      assertEvaluationRelease(searchInput.releaseId);
      return requestCustomSearchBatch(input.service, "staging", searchInput);
    },
  };
}

export async function resolveRuntimeTrustedLegalTitles(db: D1Database, releaseId: string): Promise<string[]> {
  const custom = await resolveCustomTrustedLegalTitles(db, releaseId);
  if (custom !== null) return custom;
  const result = await db.prepare(`SELECT DISTINCT instrument.canonical_title AS title
    FROM legal_search_release_items item
    JOIN legal_provision_renditions rendition ON rendition.id=item.provision_rendition_id
    JOIN legal_provision_concepts concept ON concept.id=rendition.provision_concept_id
    JOIN legal_instruments instrument ON instrument.id=concept.legal_instrument_id
    WHERE item.search_release_id=? ORDER BY title`)
    .bind(releaseId).all<{ title: string }>();
  return result.results.map((row) => z.string().trim().min(3).max(300).parse(row.title));
}

function createRuntimeCandidateIndex(provider: LegalCandidateProvider) {
  return createProviderCandidateIndex(provider, {
    emitTelemetry(event) {
      console.log(JSON.stringify({ event: "legal_target_candidate", ...event }));
    },
  });
}

function createRuntimeRetriever(
  dependencies: RuntimeDependencies,
  candidateIndex: ReturnType<typeof createRuntimeCandidateIndex>,
  releaseResolver: RuntimeReleaseResolver,
): TargetLegalAnswerRetriever {
  const { environment, db, evidenceBucket, historyEvidenceBucket,
    customArtifactBucket, reasoningService } = dependencies;
  const r2IdentityByRendition = new Map<string, CustomRuntimeLegalIdentity>();
  const currentArticleContext = createNormalizedArticleEvidenceReader(evidenceBucket);
  const historicalArticleContext = historyEvidenceBucket
    ? createNormalizedArticleEvidenceReader(historyEvidenceBucket) : currentArticleContext;
  const candidateCatalog = createRuntimeCandidateCatalog(db, customArtifactBucket ?? evidenceBucket, r2IdentityByRendition,
    {membershipProofsEnabled: dependencies.membershipProofsEnabled});
  return createTargetLegalAnswerRetriever({
    onReleaseResolved: dependencies.onReleaseResolved,
    verifyCurrentSource: createPinnedSourceVerifier({bucket: evidenceBucket,
      observe: dependencies.sharedSourceObservationsEnabled
        ? createSharedLexDocumentObservationReader(db) : observeCurrentLexDocument}),
    environment,
    interpreter: {
      async interpret(input): Promise<QuestionInterpretationPlan> {
        const body = await serviceJson(
          reasoningService,
          environment,
          "/internal/legal-corpus/reasoning/interpret",
          input,
        );
        const response = z.object({ result: z.unknown() }).strict().parse(body);
        return parseQuestionInterpretationPlan(response.result);
      },
    },
    releaseResolver,
    candidateIndex,
    candidateCatalog,
    referenceDiscovery: customArtifactBucket ? createRuntimeReferenceDiscovery({db, bucket: customArtifactBucket,
      identities: r2IdentityByRendition, revalidate: candidateCatalog.revalidate,
      preparePacket: candidateCatalog.prepareReferencePacket}) : undefined,
    evidenceResolver: {
      async resolveControlling(provisionRenditionId, endpoint, context) {
        if (context.release.instances.some((instance) =>
          instance.id === customInstanceId("current", environment)
          || instance.id === customInstanceId("history", environment))) {
          const releaseEvidenceBucket = selectRuntimeEvidenceBucket(
            context.release.capability,
            evidenceBucket,
            historyEvidenceBucket,
          );
          const r2Identity = r2IdentityByRendition.get(provisionRenditionId);
          if (r2Identity) return resolveR2NativeCustomEvidence(
            { bucket: releaseEvidenceBucket, currentAt: context.currentAt,
              readArticleContext: context.release.capability === "history" ? historicalArticleContext : currentArticleContext },
            r2Identity, endpoint,
          );
          return resolveCompleteCorpusEvidence(
            { db, bucket: releaseEvidenceBucket, environment,
              releaseId: context.release.id, currentAt: context.currentAt }, provisionRenditionId, endpoint,
          );
        }
        return resolveControllingEvidence(
          { db, bucket: evidenceBucket }, provisionRenditionId, endpoint,
        );
      },
    },
    provisionSelector: {
      async select(input): Promise<SelectionDecision> {
        const body = await serviceJson(
          reasoningService,
          environment,
          "/internal/legal-corpus/reasoning/select",
          input,
        );
        const response = z.object({ result: z.unknown() }).strict().parse(body);
        return parseSelectionDecision(response.result);
      },
    },
    lineageResolver: {
      resolve: (leftConceptIds, rightConceptIds) => resolveProvisionLineage(
        { db },
        leftConceptIds,
        rightConceptIds,
      ),
    },
  });
}

export function createRuntimeTargetLegalAnswerRetriever(
  env: TargetRetrievalRuntimeEnv,
  observation: {onReleaseResolved?: (releaseId: string) => void} = {},
): TargetLegalAnswerRetriever {
  const environment = environmentSchema.parse(env.APP_ENV);
  if (!env.LEGAL_DB || !env.LEGAL_EVIDENCE_BUCKET
    || !env.LEGAL_CORPUS_REASONING_SERVICE) {
    throw new TypeError("TARGET_RETRIEVAL_RUNTIME_UNAVAILABLE");
  }
  const db = env.LEGAL_DB;
  const evidenceBucket = env.LEGAL_EVIDENCE_BUCKET;
  const reasoningService = env.LEGAL_CORPUS_REASONING_SERVICE;
  const dependencies = { environment, db, evidenceBucket, onReleaseResolved: observation.onReleaseResolved,
    membershipProofsEnabled: env.CANDIDATE_MEMBERSHIP_PROOFS_ENABLED === "true",
    sharedSourceObservationsEnabled: env.LEGAL_SOURCE_OBSERVATIONS_ENABLED === "true",
    historyEvidenceBucket: env.LEGAL_HISTORY_EVIDENCE_BUCKET,
    customArtifactBucket: env.LEGAL_CUSTOM_ARTIFACT_BUCKET, reasoningService };
  const releaseLifecycle = createReleaseLifecycle({ db });
  const customProviders = new Map<CustomSearchCapability, LegalCandidateProvider>();
  if (env.LEGAL_AI_GATEWAY_ID && env.LEGAL_AI_PROVIDER_PROJECT_ID) {
    if (env.LEGAL_CUSTOM_SEARCH_SERVICE) customProviders.set("current",
      createRuntimeCustomSearchProvider({
        db, service: env.LEGAL_CUSTOM_SEARCH_SERVICE, capability: "current", environment,
        gatewayIdentity: env.LEGAL_AI_GATEWAY_ID,
        projectIdentity: env.LEGAL_AI_PROVIDER_PROJECT_ID,
      }));
    if (env.LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE) customProviders.set("history",
      createRuntimeCustomSearchProvider({
        db, service: env.LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE, capability: "history", environment,
        gatewayIdentity: env.LEGAL_AI_GATEWAY_ID,
        projectIdentity: env.LEGAL_AI_PROVIDER_PROJECT_ID,
      }));
  }
  if (customProviders.size === 0) {
    throw new TypeError("TARGET_RETRIEVAL_RUNTIME_UNAVAILABLE");
  }
  const customProviderForInstance = (instanceId: string) =>
    (["current", "history"] as const).map((capability) => ({
      capability, provider: customProviders.get(capability),
    })).find(({ capability, provider }) => provider
      && instanceId === customInstanceId(capability, environment))?.provider;
  const provider: LegalCandidateProvider = {
    attest(instanceId, releaseId) {
      const custom = customProviderForInstance(instanceId);
      return custom
        ? custom.attest(instanceId, releaseId)
        : Promise.reject(new TypeError("TARGET_CANDIDATE_PROVIDER_UNAVAILABLE"));
    },
    search(input) {
      const custom = input.instanceIds.length === 1
        ? customProviderForInstance(input.instanceIds[0]!) : undefined;
      return custom
        ? custom.search(input)
        : Promise.reject(new TypeError("TARGET_CANDIDATE_PROVIDER_UNAVAILABLE"));
    },
    searchMany(input) {
      const custom = input.instanceIds.length === 1
        ? customProviderForInstance(input.instanceIds[0]!) : undefined;
      return custom?.searchMany
        ? custom.searchMany(input)
        : Promise.reject(new TypeError("TARGET_CANDIDATE_PROVIDER_UNAVAILABLE"));
    },
  };
  const candidateIndex = createRuntimeCandidateIndex(provider);
  const resolvePinnedRelease = async (searchRelease: { id: string; capability: string }) => {
        const custom = await db.prepare(`SELECT
            release.configuration_identity AS configurationIdentity,
            release.item_count AS itemCount,component.chunk_count AS chunkCount,
            component.embedding_model AS embeddingModel,
            component.embedding_dimensions AS embeddingDimensions,
            runtime.mapping_count AS mappingCount,
            governance.evidence_json AS evidenceJson
          FROM legal_search_releases release
          JOIN legal_custom_search_release_components component
            ON component.search_release_id=release.id
          JOIN (SELECT search_release_id,mapping_count
            FROM legal_custom_search_r2_runtime_roots
            UNION ALL
            SELECT legacy.search_release_id,legacy.mapping_count
            FROM legal_custom_search_runtime_components legacy
            WHERE NOT EXISTS (SELECT 1 FROM legal_custom_search_r2_runtime_roots current
              WHERE current.search_release_id=legacy.search_release_id)) runtime
            ON runtime.search_release_id=release.id
          JOIN legal_search_release_governance governance
            ON governance.search_release_id=release.id
            AND governance.status='passed' AND governance.failures_json='[]'
          WHERE release.id=? ORDER BY governance.recorded_at DESC LIMIT 1`).bind(
          searchRelease.id,
        ).first<{ configurationIdentity: string; itemCount: number; chunkCount: number;
          embeddingModel: string; embeddingDimensions: number; mappingCount: number;
          evidenceJson: string }>();
        if (custom) {
          const capability = searchRelease.capability as CustomSearchCapability;
          const customProvider = customProviders.get(capability);
          const evidence = customReleaseGovernanceSchema.parse(JSON.parse(custom.evidenceJson) as unknown);
          if (evidence.releaseId !== searchRelease.id
            || custom.itemCount !== custom.chunkCount || custom.mappingCount !== custom.itemCount
            || custom.embeddingModel !== "text-embedding-3-large"
            || Number(custom.embeddingDimensions) !== 1_536
            || !customProvider || !env.LEGAL_AI_GATEWAY_ID || !env.LEGAL_AI_PROVIDER_PROJECT_ID) {
            return null;
          }
          return parsePinnedCandidateRelease({
            id: searchRelease.id,
            environment,
            capability: searchRelease.capability,
            instances: [{ id: customInstanceId(capability, environment),
              shardId: customShardId(capability) }],
            configuration: customPinnedConfiguration(custom.configurationIdentity,
              env.LEGAL_AI_GATEWAY_ID, env.LEGAL_AI_PROVIDER_PROJECT_ID),
          });
        }
        return null;
  };
  return createRuntimeRetriever(dependencies, candidateIndex, {
      async resolve(endpoint) {
        const capability = endpoint.kind === "current" ? "current" : "as_of";
        const resolution = await releaseLifecycle.resolveActiveCapability(capability, environment);
        return resolution.availability === "available"
          ? resolvePinnedRelease(resolution.searchRelease) : null;
      },
      async resolveComparison(left, right) {
        const resolution = await releaseLifecycle.resolveActiveComparison(environment);
        if (resolution.availability !== "available") return null;
        const [current, history] = await Promise.all([
          resolvePinnedRelease(resolution.current), resolvePinnedRelease(resolution.history),
        ]);
        if (!current || !history) return null;
        return {
          left: left.kind === "current" ? current : history,
          right: right.kind === "current" ? current : history,
        };
      },
  });
}

export type TargetActivationSetEvaluationObservation = {
  activationSetId: string;
  historyReconciliationRunId: string;
  historyReportSha256: string;
  resolutions: Array<{
    kind: "endpoint" | "comparison";
    endpoint?: TemporalEndpoint;
    left?: TemporalEndpoint;
    right?: TemporalEndpoint;
    releaseId?: string;
    leftReleaseId?: string;
    rightReleaseId?: string;
  }>;
};

/** Opens one explicit off-side current/history pair for staging-only target evaluation. */
export async function createRuntimeTargetActivationSetEvaluation(input: {
  env: TargetRetrievalRuntimeEnv;
  activationSetId: string;
  historyReconciliationRunId: string;
  historyReportSha256: string;
}): Promise<{
  answer(question: Parameters<TargetLegalAnswerRetriever["answer"]>[0]): Promise<{
    result: Awaited<ReturnType<TargetLegalAnswerRetriever["answer"]>>;
    observation: TargetActivationSetEvaluationObservation;
  }>;
}> {
  const { env } = input;
  if (env.APP_ENV !== "staging" || env.LEGAL_CORPUS_SHADOW_MODE !== "true"
    || !env.LEGAL_DB || !env.LEGAL_EVIDENCE_BUCKET
    || !env.LEGAL_CUSTOM_ARTIFACT_BUCKET
    || !env.LEGAL_CORPUS_REASONING_SERVICE || !env.LEGAL_CUSTOM_SEARCH_SERVICE
    || !env.LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE || !env.LEGAL_AI_GATEWAY_ID
    || !env.LEGAL_AI_PROVIDER_PROJECT_ID) {
    throw new TypeError("TARGET_ACTIVATION_SET_EVALUATION_UNAVAILABLE");
  }
  const selected = await resolveStagingHistoryComparisonEvaluationSet(env.LEGAL_DB, {
    activationSetId: input.activationSetId,
    historyReconciliationRunId: input.historyReconciliationRunId,
    historyReportSha256: input.historyReportSha256,
  });
  const dependencies: RuntimeDependencies = {
    environment: "staging", db: env.LEGAL_DB, evidenceBucket: env.LEGAL_EVIDENCE_BUCKET,
    membershipProofsEnabled: env.CANDIDATE_MEMBERSHIP_PROOFS_ENABLED === "true",
    sharedSourceObservationsEnabled: env.LEGAL_SOURCE_OBSERVATIONS_ENABLED === "true",
    customArtifactBucket: env.LEGAL_CUSTOM_ARTIFACT_BUCKET,
    reasoningService: env.LEGAL_CORPUS_REASONING_SERVICE,
  };
  const providers = new Map<CustomSearchCapability, LegalCandidateProvider>([
    ["current", createRuntimeEvaluationCustomSearchProvider({
      releaseId: selected.current.id, configurationIdentity: selected.current.configurationIdentity,
      service: env.LEGAL_CUSTOM_SEARCH_SERVICE, capability: "current",
      gatewayIdentity: env.LEGAL_AI_GATEWAY_ID, projectIdentity: env.LEGAL_AI_PROVIDER_PROJECT_ID,
    })],
    ["history", createRuntimeEvaluationCustomSearchProvider({
      releaseId: selected.history.id, configurationIdentity: selected.history.configurationIdentity,
      service: env.LEGAL_CUSTOM_HISTORY_SEARCH_SERVICE, capability: "history",
      gatewayIdentity: env.LEGAL_AI_GATEWAY_ID, projectIdentity: env.LEGAL_AI_PROVIDER_PROJECT_ID,
    })],
  ]);
  const providerForInstance = (instanceId: string) =>
    (["current", "history"] as const).find(capability =>
      instanceId === customInstanceId(capability, "staging"));
  const provider: LegalCandidateProvider = {
    attest(instanceId, releaseId) {
      const capability = providerForInstance(instanceId);
      return capability
        ? providers.get(capability)!.attest(instanceId, releaseId)
        : Promise.reject(new TypeError("TARGET_CANDIDATE_PROVIDER_UNAVAILABLE"));
    },
    search(searchInput) {
      const capability = searchInput.instanceIds.length === 1
        ? providerForInstance(searchInput.instanceIds[0]!) : undefined;
      return capability
        ? providers.get(capability)!.search(searchInput)
        : Promise.reject(new TypeError("TARGET_CANDIDATE_PROVIDER_UNAVAILABLE"));
    },
    searchMany(searchInput) {
      const capability = searchInput.instanceIds.length === 1
        ? providerForInstance(searchInput.instanceIds[0]!) : undefined;
      const selected = capability ? providers.get(capability) : undefined;
      return selected?.searchMany
        ? selected.searchMany(searchInput)
        : Promise.reject(new TypeError("TARGET_CANDIDATE_PROVIDER_UNAVAILABLE"));
    },
  };
  const pinned = (release: typeof selected.current) => parsePinnedCandidateRelease({
    id: release.id, environment: "staging", capability: release.capability,
    instances: [{ id: customInstanceId(release.capability, "staging"),
      shardId: customShardId(release.capability) }],
    configuration: customPinnedConfiguration(release.configurationIdentity,
      env.LEGAL_AI_GATEWAY_ID!, env.LEGAL_AI_PROVIDER_PROJECT_ID!),
  });
  const current = pinned(selected.current);
  const history = pinned(selected.history);
  return {
    async answer(question) {
      const observation: TargetActivationSetEvaluationObservation = {
        activationSetId: selected.id,
        historyReconciliationRunId: selected.historyReconciliationRunId,
        historyReportSha256: selected.historyReportSha256,
        resolutions: [],
      };
      const releaseResolver: RuntimeReleaseResolver = {
        async resolve(endpoint) {
          const release = endpoint.kind === "current" ? current : history;
          observation.resolutions.push({ kind: "endpoint", endpoint, releaseId: release.id });
          return release;
        },
        async resolveComparison(left, right) {
          const leftRelease = left.kind === "current" ? current : history;
          const rightRelease = right.kind === "current" ? current : history;
          observation.resolutions.push({ kind: "comparison", left, right,
            leftReleaseId: leftRelease.id, rightReleaseId: rightRelease.id });
          return { left: leftRelease, right: rightRelease };
        },
      };
      const retriever = createRuntimeRetriever(dependencies,
        createRuntimeCandidateIndex(provider), releaseResolver);
      return { result: await retriever.answer(question), observation };
    },
  };
}
