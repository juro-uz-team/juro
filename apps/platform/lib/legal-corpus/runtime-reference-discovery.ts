import {sameInstrumentArticleReferences} from "../legal/referenced-article-context";
import {legalReferenceKey, resolveCustomReferenceKeys, type LegalReferenceQuery} from "./custom-reference-lookup";
import {parseCandidatePacket, type CandidatePacket, type PinnedCandidateRelease, type TemporalEndpoint} from "./legal-candidate-index";
import type {CustomRuntimeLegalIdentity} from "./custom-bm25-runtime";
import type {RevalidatedCandidate, SelectionCandidate} from "./target-retrieval";

const citationArticle = (label: string) => /(?:Article|Статья|Ст\.)\s+(\d+(?:[.-]\d+)?)\s*$/iu.exec(label)?.[1];

/** Resolve explicit references without asking a language model or a search
 * provider to rediscover their article numbers. Returned keys still pass the
 * independent accepted-membership catalog and same-revision checks. */
export function createRuntimeReferenceDiscovery(input: {
  db: D1Database; bucket: Pick<R2Bucket, "get">;
  identities: ReadonlyMap<string, CustomRuntimeLegalIdentity>;
  preparePacket?: (packet: CandidatePacket, release: PinnedCandidateRelease) => Promise<CandidatePacket>;
  revalidate: (packet: CandidatePacket, endpoint: TemporalEndpoint,
    release: PinnedCandidateRelease, currentAt: string) => Promise<RevalidatedCandidate[]>;
}) {
  return async (candidates: readonly SelectionCandidate[], endpoint: TemporalEndpoint,
    release: PinnedCandidateRelease, currentAt: string): Promise<RevalidatedCandidate[]> => {
    const unresolved = new Map<string, {query: LegalReferenceQuery; source: SelectionCandidate;
      identity: CustomRuntimeLegalIdentity; referringConcepts: Set<string>}>();
    for (const source of candidates) {
      const identity = input.identities.get(source.candidate.provisionRenditionId);
      if (!identity) continue;
      for (const article of sameInstrumentArticleReferences(source.provisionText)) {
        const present = candidates.some(candidate => candidate.candidate.textRevisionId === source.candidate.textRevisionId
          && input.identities.get(candidate.candidate.provisionRenditionId)?.languageTag === identity.languageTag
          && citationArticle(candidate.citationLabel) === article && !/:\s*$/u.test(candidate.provisionText));
        if (present) continue;
        const query = {textRevisionId: identity.textRevisionId, languageTag: identity.languageTag, article};
        const key = legalReferenceKey(query);
        const request = unresolved.get(key) ?? {query, source, identity, referringConcepts: new Set<string>()};
        request.referringConcepts.add(source.candidate.provisionConceptId);
        unresolved.set(key, request);
      }
    }
    // Shared operative dependencies should not lose the bounded lookup to
    // whichever incidental citation appeared first in search order. Count
    // distinct provisions, not duplicate chunks or translations of one rule.
    const requests = new Map([...unresolved].sort(([, left], [, right]) =>
      right.referringConcepts.size - left.referringConcepts.size).slice(0, 3));
    if (!requests.size) return [];
    const row = await input.db.prepare(`SELECT root.mapping_inventory_sha256 AS sourceInventorySha256,
      root.mapping_count AS memberCount,root.runtime_descriptor_r2_key AS descriptorKey,
      lookup.lookup_r2_key AS lookupKey,lookup.lookup_sha256 AS lookupSha256,
      lookup.lookup_size_bytes AS lookupSizeBytes
      FROM legal_custom_search_r2_runtime_roots root
      JOIN legal_custom_search_reference_lookups lookup ON lookup.search_release_id=root.search_release_id
        AND lookup.source_inventory_sha256=root.mapping_inventory_sha256 AND lookup.member_count=root.mapping_count
      WHERE root.search_release_id=?`).bind(release.id).first<{sourceInventorySha256: string; memberCount: number;
        descriptorKey: string; lookupKey: string; lookupSha256: string; lookupSizeBytes: number}>();
    if (!row) return [];
    const physicalReleaseId = /^search-releases\/([^/]+)\/runtime\/descriptor-[a-f0-9]{64}\.json$/u.exec(row.descriptorKey)?.[1];
    if (!physicalReleaseId) throw new TypeError("CUSTOM_REFERENCE_RELEASE_INVALID");
    const keys = await resolveCustomReferenceKeys({bucket: input.bucket, releaseId: physicalReleaseId,
      sourceInventorySha256: row.sourceInventorySha256, memberCount: row.memberCount,
      reference: {key: row.lookupKey, sha256: row.lookupSha256, sizeBytes: row.lookupSizeBytes},
      queries: [...requests.values()].map(request => request.query)});
    const origins = new Map<string, (typeof requests extends Map<string, infer Value> ? Value : never)>();
    for (const [reference, members] of keys) {
      // A large split article stays unresolved for bounded semantic repair;
      // do not silently represent it with an arbitrary prefix of its chunks.
      if (members.length > 4) continue;
      for (const member of members) {
        const key = `search-releases/${release.id}/${member}`;
        if (!candidates.some(candidate => candidate.candidate.candidate.itemKey === key)) {
          origins.set(key, requests.get(reference)!);
        }
      }
    }
    if (!origins.size) return [];
    const packet = parseCandidatePacket({availability: "available", releaseId: release.id, endpoint,
      requiredInstanceIds: release.instances.map(instance => instance.id), partialErrors: [],
      candidates: [...origins].map(([itemKey, {source, query}]) => ({...source.candidate.candidate,
        itemKey, referenceOrigin: {itemKey: source.candidate.candidate.itemKey, article: query.article},
        formulationMatches: undefined, vectorScore: 0, keywordScore: 0, fusionScore: 0})),
    });
    const validated = await input.revalidate(input.preparePacket ? await input.preparePacket(packet, release) : packet,
      endpoint, release, currentAt);
    if (validated.length !== origins.size || new Set(validated.map(candidate => candidate.candidate.itemKey)).size !== origins.size) {
      throw new TypeError("CUSTOM_REFERENCE_MEMBERSHIP_INVALID");
    }
    for (const candidate of validated) {
      const origin = origins.get(candidate.candidate.itemKey);
      const identity = input.identities.get(candidate.provisionRenditionId);
      if (!origin || !identity || identity.textRevisionId !== origin.query.textRevisionId
        || candidate.textRevisionId !== identity.textRevisionId
        || identity.legalInstrumentId !== origin.identity.legalInstrumentId
        || identity.languageTag !== origin.query.languageTag) {
        throw new TypeError("CUSTOM_REFERENCE_IDENTITY_MISMATCH");
      }
    }
    console.info(JSON.stringify({event: "legal.reference_candidates_resolved", referenceCount: requests.size,
      candidateCount: validated.length}));
    return validated;
  };
}
