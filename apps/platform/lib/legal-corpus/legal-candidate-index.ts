import { z } from "zod";
import {candidateMembershipProofSchema} from "./candidate-membership-proof";
import { LEGAL_INTERPRETATION_FORMULATION_LIMIT, LEGAL_TOTAL_FORMULATION_LIMIT } from "../legal/question-interpretation-limits";

import {
  candidateConfigurationIdSchema,
  candidateInstanceIdSchema,
  candidateShardIdSchema,
  legalEnvironmentSchema,
  legalIdentifierSchema,
  providerProjectIdSchema,
  searchReleaseIdSchema,
  utcInstantSchema,
} from "./target-domain-schemas";

const endpointSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("current") }).strict(),
  z.object({ kind: z.literal("timestamp"), instant: utcInstantSchema }).strict(),
]);
const formulationSchema = z.object({
  id: legalIdentifierSchema,
  text: z.string().trim().min(1).max(900),
  legalTitleSpans: z.array(z.string().trim().min(3).max(300)).max(12).optional(),
  privateNameSpans: z.array(z.string().trim().min(1).max(300)).max(24),
  readingIds: z.array(legalIdentifierSchema).min(1),
  requirementIds: z.array(legalIdentifierSchema).min(1),
}).strict();
export const interpretationSchema = z.object({
  id: legalIdentifierSchema,
  formulations: z.array(formulationSchema).min(1).max(LEGAL_INTERPRETATION_FORMULATION_LIMIT),
}).strict();
export const CANDIDATE_METADATA_SCHEMA = [
  "language",
  "document_type",
  "valid_from",
  "valid_to",
] as const;
const providerItemMetadataSchema = z.object({
  language: z.enum(["uz-Latn", "uz-Cyrl", "ru", "en"]),
  document_type: z.string().min(1).max(300),
  valid_from: utcInstantSchema,
  valid_to: utcInstantSchema.nullable(),
}).strict();

export const candidateConfigurationSchema = z.object({
  identity: candidateConfigurationIdSchema,
  embeddingModel: z.literal("openai/text-embedding-3-large"),
  dimensions: z.literal(1_536),
  keywordTokenizer: z.enum(["porter", "trigram"]),
  metadataSchema: z.tuple([
    z.literal("language"),
    z.literal("document_type"),
    z.literal("valid_from"),
    z.literal("valid_to"),
  ]),
  gatewayIdentity: legalIdentifierSchema,
  providerProjectIdentity: providerProjectIdSchema,
  gatewayPayloadLogging: z.boolean(),
  gatewayCaching: z.boolean(),
  similarityCaching: z.boolean(),
}).strict();
export const pinnedCandidateConfigurationSchema = candidateConfigurationSchema.extend({
  gatewayPayloadLogging: z.literal(false),
  gatewayCaching: z.literal(false),
  similarityCaching: z.literal(false),
}).strict();
const pinnedReleaseSchema = z.object({
  id: searchReleaseIdSchema,
  environment: legalEnvironmentSchema,
  capability: z.enum(["current", "history"]),
  instances: z.array(z.object({
    id: candidateInstanceIdSchema,
    shardId: candidateShardIdSchema,
  }).strict()).min(1),
  configuration: pinnedCandidateConfigurationSchema,
}).strict().superRefine((value, context) => {
  const instanceIds = value.instances.map((instance) => instance.id);
  const shardIds = value.instances.map((instance) => instance.shardId);
  if (new Set(instanceIds).size !== instanceIds.length) {
    context.addIssue({ code: "custom", message: "Candidate instance identities must be unique" });
  }
  if (new Set(shardIds).size !== shardIds.length) {
    context.addIssue({ code: "custom", message: "Candidate shard identities must be unique" });
  }
});

export type QuestionInterpretation = z.infer<typeof interpretationSchema>;
export type TemporalEndpoint = z.infer<typeof endpointSchema>;
export type CandidateConfiguration = z.infer<typeof candidateConfigurationSchema>;
export type PinnedCandidateConfiguration = z.infer<typeof pinnedCandidateConfigurationSchema>;
export type PinnedCandidateRelease = z.infer<typeof pinnedReleaseSchema>;

export function parsePinnedCandidateRelease(value: unknown): PinnedCandidateRelease {
  return pinnedReleaseSchema.parse(value);
}

export function toPinnedCandidateConfiguration(value: unknown): PinnedCandidateConfiguration {
  const record = z.record(z.string(), z.unknown()).parse(value);
  return pinnedCandidateConfigurationSchema.parse({
    identity: record.identity,
    embeddingModel: record.embeddingModel,
    dimensions: record.dimensions,
    keywordTokenizer: record.keywordTokenizer,
    metadataSchema: record.metadataSchema,
    gatewayIdentity: record.gatewayIdentity,
    providerProjectIdentity: record.providerProjectIdentity,
    gatewayPayloadLogging: record.gatewayPayloadLogging,
    gatewayCaching: record.gatewayCaching,
    similarityCaching: record.similarityCaching,
  });
}

export const candidateSchema = z.object({
  itemKey: z.string().min(1).max(700),
  membershipProof: candidateMembershipProofSchema.optional(),
  /** Reference discovery inherits the originating search's provenance; its
   * numeric ranks do not represent a separate vector or keyword match. */
  referenceOrigin: z.object({itemKey: z.string().min(1).max(700),
    article: z.string().regex(/^\d+(?:[.-]\d+)?$/u).max(40)}).strict().optional(),
  instanceId: candidateInstanceIdSchema,
  shardId: candidateShardIdSchema,
  // Initial and bounded repair searches retain all contributing formulations.
  formulationIds: z.array(legalIdentifierSchema).min(1).max(LEGAL_TOTAL_FORMULATION_LIMIT),
  formulationMatches: z.array(z.object({
    formulationId: legalIdentifierSchema,
    rank: z.number().int().positive().max(50),
    fusionScore: z.number().finite(),
  }).strict()).min(1).max(LEGAL_TOTAL_FORMULATION_LIMIT).optional(),
  readingIds: z.array(legalIdentifierSchema).min(1),
  retrievalRequirementIds: z.array(legalIdentifierSchema).min(1),
  vectorRank: z.number().int().positive(),
  vectorScore: z.number().finite(),
  keywordRank: z.number().int().positive(),
  keywordScore: z.number().finite(),
  fusionScore: z.number().finite(),
  providerMetadata: providerItemMetadataSchema.optional(),
}).strict();
const packetErrorSchema = z.object({
  code: z.enum([
    "CANDIDATE_CONFIGURATION_DRIFT",
    "CANDIDATE_MISSING_INSTANCE",
    "CANDIDATE_PARTIAL_RESPONSE",
    "CANDIDATE_UNKNOWN_INSTANCE",
    "CANDIDATE_WRONG_RELEASE",
    "CANDIDATE_INTERPRETATION_INVALID",
    "CANDIDATE_PROVIDER_UNAVAILABLE",
    "PRIVACY_TRANSFORM_REJECTED",
  ]),
  instanceId: candidateInstanceIdSchema.optional(),
}).strict();
const packetSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  releaseId: searchReleaseIdSchema,
  endpoint: endpointSchema,
  requiredInstanceIds: z.array(candidateInstanceIdSchema).min(1),
  candidates: z.array(candidateSchema).max(LEGAL_INTERPRETATION_FORMULATION_LIMIT * 50),
  partialErrors: z.array(packetErrorSchema),
}).strict();

export type CandidatePacket = z.infer<typeof packetSchema>;
export function parseCandidatePacket(value: unknown): CandidatePacket {
  return packetSchema.parse(value);
}
export interface LegalCandidateIndex {
  retrieve(
    interpretation: QuestionInterpretation,
    endpoint: TemporalEndpoint,
    searchRelease: PinnedCandidateRelease,
    context?: { currentAt: string },
  ): Promise<CandidatePacket>;
}

type NormalizedCandidateInput = Omit<z.input<typeof candidateSchema>,
  "formulationIds" | "formulationMatches" | "readingIds" | "retrievalRequirementIds">;

function unavailable(
  release: PinnedCandidateRelease,
  endpoint: TemporalEndpoint,
  errors: z.input<typeof packetErrorSchema>[],
): CandidatePacket {
  return packetSchema.parse({
    availability: "unavailable",
    releaseId: release.id,
    endpoint,
    requiredInstanceIds: release.instances.map((instance) => instance.id),
    candidates: [],
    partialErrors: errors,
  });
}

function normalizeCandidates(input: Array<NormalizedCandidateInput & {
  formulation: QuestionInterpretation["formulations"][number];
  formulationRank: number;
}>): CandidatePacket["candidates"] {
  const byKey = new Map<string, z.infer<typeof candidateSchema>>();
  for (const raw of input) {
    const candidate = candidateSchema.parse({
      itemKey: raw.itemKey,
      instanceId: raw.instanceId,
      shardId: raw.shardId,
      formulationIds: [raw.formulation.id],
      formulationMatches: [{
        formulationId: raw.formulation.id,
        rank: raw.formulationRank,
        fusionScore: raw.fusionScore,
      }],
      readingIds: [...new Set(raw.formulation.readingIds)].sort(),
      retrievalRequirementIds: [...new Set(raw.formulation.requirementIds)].sort(),
      vectorRank: raw.vectorRank,
      vectorScore: raw.vectorScore,
      keywordRank: raw.keywordRank,
      keywordScore: raw.keywordScore,
      // Outer reciprocal-rank fusion treats each independently searched
      // formulation as one retrieval list. Provider fusion remains available
      // on the per-formulation match for deterministic tie-breaking.
      fusionScore: 1 / (60 + raw.formulationRank),
      ...(raw.providerMetadata ? { providerMetadata: raw.providerMetadata } : {}),
      ...(raw.membershipProof ? {membershipProof: raw.membershipProof} : {}),
    });
    const existing = byKey.get(candidate.itemKey);
    if (!existing) {
      byKey.set(candidate.itemKey, candidate);
    } else {
      if (JSON.stringify(existing.membershipProof) !== JSON.stringify(candidate.membershipProof)) {
        throw new TypeError("CANDIDATE_MEMBERSHIP_PROOF_CONFLICT");
      }
      const existingProviderScore = existing.formulationMatches
        ? Math.max(...existing.formulationMatches.map((match) => match.fusionScore))
        : existing.fusionScore;
      const preferred = raw.fusionScore > existingProviderScore ? candidate : existing;
      const matches = new Map((existing.formulationMatches ?? []).map((match) => [
        match.formulationId,
        match,
      ]));
      for (const match of candidate.formulationMatches ?? []) {
        const previous = matches.get(match.formulationId);
        if (!previous || match.rank < previous.rank
          || (match.rank === previous.rank && match.fusionScore > previous.fusionScore)) {
          matches.set(match.formulationId, match);
        }
      }
      const formulationMatches = [...matches.values()].sort((left, right) =>
        left.formulationId.localeCompare(right.formulationId));
      byKey.set(candidate.itemKey, {
        ...preferred,
        formulationIds: [...new Set([...existing.formulationIds, ...candidate.formulationIds])].sort(),
        formulationMatches,
        readingIds: [...new Set([...existing.readingIds, ...candidate.readingIds])].sort(),
        retrievalRequirementIds: [...new Set([
          ...existing.retrievalRequirementIds,
          ...candidate.retrievalRequirementIds,
        ])].sort(),
        fusionScore: formulationMatches.reduce((score, match) => score + 1 / (60 + match.rank), 0),
      });
    }
  }
  return [...byKey.values()].sort((left, right) =>
    right.fusionScore - left.fusionScore || left.itemKey.localeCompare(right.itemKey));
}

export function createCallbackCandidateIndex(
  retrieve: (
    formulation: QuestionInterpretation["formulations"][number],
    endpoint: TemporalEndpoint,
    release: PinnedCandidateRelease,
  ) => Promise<NormalizedCandidateInput[]>,
): LegalCandidateIndex {
  return {
    async retrieve(rawInterpretation, rawEndpoint, rawRelease) {
      const interpretation = interpretationSchema.parse(rawInterpretation);
      const endpoint = endpointSchema.parse(rawEndpoint);
      const release = pinnedReleaseSchema.parse(rawRelease);
      try {
        const results = await Promise.all(interpretation.formulations.map(async (formulation) =>
          (await retrieve(formulation, endpoint, release)).map((candidate, index) => ({
            ...candidate,
            formulation,
            formulationRank: index + 1,
          }))));
        return packetSchema.parse({
          availability: "available",
          releaseId: release.id,
          endpoint,
          requiredInstanceIds: release.instances.map((instance) => instance.id),
          candidates: normalizeCandidates(results.flat()),
          partialErrors: [],
        });
      } catch {
        return unavailable(release, endpoint, [{ code: "CANDIDATE_PROVIDER_UNAVAILABLE" }]);
      }
    },
  };
}

export const createInMemoryCandidateIndex = createCallbackCandidateIndex;

type ProviderCandidateHit = Omit<NormalizedCandidateInput, "instanceId" | "shardId"> & {
  instanceId: string;
  shardId: string;
  candidateText?: string;
};
export type LegalCandidateSearchInput = {
  releaseId?: string;
  currentAt?: string;
  instanceIds: string[];
  query: string;
  endpoint: TemporalEndpoint;
  maxResults: 50;
  vectorThreshold: 0;
};
export type LegalCandidateSearchResponse = {
  hits: ProviderCandidateHit[];
  errors: Array<{ code: string; instanceId?: string }>;
  searchedInstanceIds: string[];
  tokenUsage?: number;
};
export type LegalCandidateBatchSearchInput = Omit<LegalCandidateSearchInput, "query"> & {
  queries: string[];
};
export type LegalCandidateBatchSearchResponse = Omit<LegalCandidateSearchResponse, "hits"> & {
  results: Array<{ queryIndex: number; hits: ProviderCandidateHit[] }>;
};
export type LegalCandidateProvider = {
  attest(instanceId: string, releaseId?: string): Promise<CandidateConfiguration>;
  search(input: LegalCandidateSearchInput): Promise<LegalCandidateSearchResponse>;
  searchMany?(input: LegalCandidateBatchSearchInput): Promise<LegalCandidateBatchSearchResponse>;
};

const providerStatusSchema = z.enum(["ok", "unavailable", "rejected"]);
const safeErrorClassSchema = z.enum([
  "configuration_drift",
  "integrity_failure",
  "privacy_rejected",
  "provider_unavailable",
]).nullable();
const candidateTelemetrySchema = z.object({
  releaseId: searchReleaseIdSchema,
  correlationHash: z.string().length(64).regex(/^[a-f0-9]+$/u),
  formulationCount: z.number().int().nonnegative(),
  instanceCount: z.number().int().nonnegative(),
  candidateCount: z.number().int().nonnegative(),
  tokenUsage: z.number().int().nonnegative(),
  latencyMs: z.number().int().nonnegative(),
  providerStatus: providerStatusSchema,
  safeErrorClass: safeErrorClassSchema,
}).strict();

export type CandidateTelemetryEvent = z.infer<typeof candidateTelemetrySchema>;
type CandidateIndexOptions = {
  /** Compatibility hook retained for callers created before unmodified retrieval formulations. */
  attestPrivateNames?: (input: {
    text: string;
    formulationSha256: string;
    legalTitleSpans: readonly string[];
  }) => Promise<unknown>;
  emitTelemetry?: (event: CandidateTelemetryEvent) => void;
  now?: () => number;
  resolveTrustedLegalTitles?: (release: PinnedCandidateRelease) => Promise<readonly string[]>;
};

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function safeEmit(
  emit: CandidateIndexOptions["emitTelemetry"],
  event: CandidateTelemetryEvent,
): void {
  try {
    emit?.(candidateTelemetrySchema.parse(event));
  } catch {
    // Candidate retrieval never depends on telemetry availability.
  }
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < values.length; offset += size) {
    result.push(values.slice(offset, offset + size));
  }
  return result;
}

export function createProviderCandidateIndex(
  provider: LegalCandidateProvider,
  options: CandidateIndexOptions,
): LegalCandidateIndex {
  return {
    async retrieve(rawInterpretation, rawEndpoint, rawRelease, context) {
      const interpretation = interpretationSchema.parse(rawInterpretation);
      const endpoint = endpointSchema.parse(rawEndpoint);
      const release = pinnedReleaseSchema.parse(rawRelease);
      const startedAt = (options.now ?? Date.now)();
      const requiredInstanceIds = release.instances.map((instance) => instance.id);
      const shardByInstance = new Map(release.instances.map((instance) => [
        instance.id,
        instance.shardId,
      ]));
      const correlationHash = await sha256Hex([
        "juro.legal-candidate-index.v1",
        release.environment,
        release.id,
        interpretation.id,
      ].join("\n"));
      let observedTokenUsage = 0;
      const emitOutcome = (
        providerStatus: CandidateTelemetryEvent["providerStatus"],
        safeErrorClass: CandidateTelemetryEvent["safeErrorClass"],
        candidateCount = 0,
      ): void => safeEmit(options.emitTelemetry, {
        releaseId: release.id,
        correlationHash,
        formulationCount: interpretation.formulations.length,
        instanceCount: requiredInstanceIds.length,
        candidateCount,
        tokenUsage: observedTokenUsage,
        latencyMs: Math.max(0, Math.round((options.now ?? Date.now)() - startedAt)),
        providerStatus,
        safeErrorClass,
      });
      const formulationIds = interpretation.formulations.map((formulation) => formulation.id);
      if (new Set(formulationIds).size !== formulationIds.length) {
        emitOutcome("rejected", "integrity_failure");
        return unavailable(release, endpoint, [{ code: "CANDIDATE_INTERPRETATION_INVALID" }]);
      }
      try {
        const attestations = await Promise.all(requiredInstanceIds.map(async (instanceId) => ({
          instanceId,
          configuration: candidateConfigurationSchema.parse(await provider.attest(instanceId, release.id)),
        })));
        const drift = attestations.find(({ configuration }) =>
          JSON.stringify(configuration) !== JSON.stringify(release.configuration));
        if (drift) {
          emitOutcome("unavailable", "configuration_drift");
          return unavailable(release, endpoint, [{
            code: "CANDIDATE_CONFIGURATION_DRIFT",
            instanceId: drift.instanceId,
          }]);
        }

        const waves = chunks(requiredInstanceIds, 10);
        const currentAt = context?.currentAt ?? new Date(startedAt).toISOString();
        const searches: Array<{
          formulation: QuestionInterpretation["formulations"][number];
          instanceIds: string[];
          response: LegalCandidateSearchResponse;
        }> = [];
        if (provider.searchMany) {
          // The provider transport accepts six queries, independently of how
          // many legal scopes the request contains. Preserve every association.
          const batches = await Promise.all(waves.flatMap(instanceIds =>
            chunks(interpretation.formulations, 6).map(async formulations => ({
            instanceIds,
            formulations,
            response: await provider.searchMany!({
              releaseId: release.id,
              currentAt,
              instanceIds,
              queries: formulations.map((formulation) => formulation.text),
              endpoint,
              maxResults: 50,
              vectorThreshold: 0,
            }).then((response) => {
              observedTokenUsage += response.tokenUsage ?? 0;
              return response;
            }),
          }))));
          for (const batch of batches) {
            if (batch.response.errors.length > 0) {
              emitOutcome("unavailable", "provider_unavailable");
              return unavailable(release, endpoint, batch.response.errors.map((error) => {
                const instanceId = candidateInstanceIdSchema.safeParse(error.instanceId);
                return {
                  code: "CANDIDATE_PARTIAL_RESPONSE" as const,
                  ...(instanceId.success ? { instanceId: instanceId.data } : {}),
                };
              }));
            }
            const indices = batch.response.results.map((result) => result.queryIndex);
            if (indices.length !== batch.formulations.length
              || new Set(indices).size !== indices.length
              || indices.some((index) => !Number.isInteger(index)
                || index < 0 || index >= batch.formulations.length)) {
              emitOutcome("unavailable", "integrity_failure");
              return unavailable(release, endpoint, [{ code: "CANDIDATE_PARTIAL_RESPONSE" }]);
            }
            for (const result of batch.response.results) {
              searches.push({
                formulation: batch.formulations[result.queryIndex]!,
                instanceIds: batch.instanceIds,
                response: {
                  hits: result.hits,
                  errors: [],
                  searchedInstanceIds: batch.response.searchedInstanceIds,
                },
              });
            }
          }
        } else {
          searches.push(...await Promise.all(interpretation.formulations.flatMap((formulation) =>
            waves.map(async (instanceIds) => ({
              formulation,
              instanceIds,
              response: await provider.search({
                releaseId: release.id,
                currentAt,
                instanceIds,
                query: formulation.text,
                endpoint,
                maxResults: 50,
                vectorThreshold: 0,
              }).then((response) => {
                observedTokenUsage += response.tokenUsage ?? 0;
                return response;
              }),
            })))));
        }
        const normalized: Array<NormalizedCandidateInput & {
          formulation: QuestionInterpretation["formulations"][number];
          formulationRank: number;
        }> = [];
        for (const search of searches) {
          if (search.response.errors.length > 0) {
            emitOutcome("unavailable", "provider_unavailable");
            return unavailable(release, endpoint, search.response.errors.map((error) => {
              const instanceId = candidateInstanceIdSchema.safeParse(error.instanceId);
              return {
                code: "CANDIDATE_PARTIAL_RESPONSE" as const,
                ...(instanceId.success ? { instanceId: instanceId.data } : {}),
              };
            }));
          }
          const searched = search.response.searchedInstanceIds;
          if (!Array.isArray(searched) || searched.length !== new Set(searched).size) {
            emitOutcome("unavailable", "integrity_failure");
            return unavailable(release, endpoint, [{ code: "CANDIDATE_PARTIAL_RESPONSE" }]);
          }
          const requested = new Set<string>(search.instanceIds);
          const unknown = searched.find((instanceId) => !requested.has(instanceId));
          if (unknown) {
            const unknownId = candidateInstanceIdSchema.safeParse(unknown);
            emitOutcome("unavailable", "integrity_failure");
            return unavailable(release, endpoint, [{
              code: "CANDIDATE_UNKNOWN_INSTANCE",
              ...(unknownId.success ? { instanceId: unknownId.data } : {}),
            }]);
          }
          const searchedIds = new Set<string>(searched);
          const missing = search.instanceIds.find((instanceId) => !searchedIds.has(instanceId));
          if (missing) {
            emitOutcome("unavailable", "integrity_failure");
            return unavailable(release, endpoint, [{
              code: "CANDIDATE_MISSING_INSTANCE",
              instanceId: missing,
            }]);
          }
          for (const [hitIndex, hit] of search.response.hits.slice(0, 50).entries()) {
            const hitInstanceId = candidateInstanceIdSchema.safeParse(hit.instanceId);
            const shardId = hitInstanceId.success ? shardByInstance.get(hitInstanceId.data) : undefined;
            if (!hitInstanceId.success || !shardId || !requested.has(hit.instanceId)) {
              emitOutcome("unavailable", "integrity_failure");
              return unavailable(release, endpoint, [{
                code: "CANDIDATE_UNKNOWN_INSTANCE",
                ...(hitInstanceId.success ? { instanceId: hitInstanceId.data } : {}),
              }]);
            }
            if (
              hit.shardId !== shardId
              || !hit.itemKey.startsWith(`search-releases/${release.id}/`)
            ) {
              emitOutcome("unavailable", "integrity_failure");
              return unavailable(release, endpoint, [{
                code: "CANDIDATE_WRONG_RELEASE",
                instanceId: hitInstanceId.data,
              }]);
            }
            normalized.push({
              itemKey: hit.itemKey,
              instanceId: hitInstanceId.data,
              shardId,
              vectorRank: hit.vectorRank,
              vectorScore: hit.vectorScore,
              keywordRank: hit.keywordRank,
              keywordScore: hit.keywordScore,
              fusionScore: waves.length > 1
                ? 1 / (60 + hit.vectorRank) + 1 / (60 + hit.keywordRank)
                : hit.fusionScore,
              ...(hit.providerMetadata ? { providerMetadata: hit.providerMetadata } : {}),
              ...(hit.membershipProof ? {membershipProof: hit.membershipProof} : {}),
              formulation: search.formulation,
              formulationRank: hitIndex + 1,
            });
          }
        }
        const packet = packetSchema.parse({
          availability: "available",
          releaseId: release.id,
          endpoint,
          requiredInstanceIds,
          candidates: normalizeCandidates(normalized),
          partialErrors: [],
        });
        emitOutcome("ok", null, packet.candidates.length);
        return packet;
      } catch {
        emitOutcome("unavailable", "provider_unavailable");
        return unavailable(release, endpoint, [{ code: "CANDIDATE_PROVIDER_UNAVAILABLE" }]);
      }
    },
  };
}

export async function runCandidateShadow(input: {
  active: LegalCandidateIndex;
  shadow: LegalCandidateIndex;
  interpretation: QuestionInterpretation;
  endpoint: TemporalEndpoint;
  release: PinnedCandidateRelease;
  observe: (packet: CandidatePacket) => void;
}): Promise<CandidatePacket> {
  const shadow = input.shadow.retrieve(input.interpretation, input.endpoint, input.release)
    .then(input.observe)
    .catch(() => input.observe(unavailable(input.release, input.endpoint, [{
      code: "CANDIDATE_PROVIDER_UNAVAILABLE",
    }])));
  void shadow;
  return input.active.retrieve(input.interpretation, input.endpoint, input.release);
}
