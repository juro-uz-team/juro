import { z } from "zod";
import { createHash } from "node:crypto";
import { withinSignal } from "./lifetime";
import { parsePinnedCandidateRelease } from "../legal-corpus/legal-candidate-index";
import { preparedCandidateConfigurationSchema } from "../legal-corpus/prepared-candidate-configuration";
import { preparedSearchRequestHash } from "../legal-corpus/prepared-candidate-index";
import { createPreparedSearchService } from "../legal-corpus/prepared-search-service";
import type { createPreparedNumericTransport } from "../legal-corpus/prepared-numeric-transport";
import type { EvidenceScope } from "./evidence";
import type { CandidateRanking } from "./contracts";
import { maximumCandidateDescriptionBatch } from "./contracts";

const object = z.record(z.string(), z.unknown());
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
const source = z.object({ inventory: object, prepared: object.nullable(),
  current_capture: z.enum(["unique", "conflict", "unavailable"]).optional() }).strict();
const catalog = z.object({
  package_sha256: digest, membership_sha256: digest, work_index_sha256: digest, vector_completion_sha256: digest,
  sources: z.record(z.string(), source), units: z.record(z.string(), object),
  records: z.array(z.object({ vector_ordinal: z.number().int().nonnegative(), membership_ordinal: z.number().int().nonnegative(),
    work: z.string().min(1), unit: z.string().min(1), status: z.literal("discovery_only") }).passthrough()).max(128),
}).passthrough();
const sourcePacket = z.object({ package_sha256: digest, work_index_sha256: digest,
  sources: z.record(z.string(), source) }).strict();
type NumericTransport = Pick<ReturnType<typeof createPreparedNumericTransport>, "execute" | "readExact" | "readSources">
  & Partial<Pick<ReturnType<typeof createPreparedNumericTransport>, "readAsset">>;
const assetLimit = 16 * 1024 * 1024;
const renderedPdf = z.object({ source_sha256: digest, renderer_image: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  sha256: digest, byte_count: z.number().int().positive().max(assetLimit),
  data_base64: z.string().min(4).max(4 * Math.ceil(assetLimit / 3)) }).strict();
const assetPacket = z.object({ package_sha256: digest, work_index_sha256: digest,
  asset: z.object({ work: digest, source_url: z.url(), sha256: digest,
    byte_count: z.number().int().positive().max(assetLimit),
    data_base64: z.string().min(4).max(4 * Math.ceil(assetLimit / 3)), rendered_pdf: renderedPdf.optional() }).strict() }).strict();
export type OriginalAsset = { work: string; sourceUrl: string; sha256: string; bytes: Uint8Array;
  renderedPdf?: { sourceSha256: string; rendererImage: string; sha256: string; bytes: Uint8Array } };

/** Request-scoped adapter over retained index primitives. No discovery field is promoted to legal evidence. */
export function createPreparedDiscovery(input: { release: unknown; transport: NumericTransport;
  embed(query: string, signal: AbortSignal): Promise<readonly number[]> }) {
  const release = parsePinnedCandidateRelease(input.release);
  const configuration = preparedCandidateConfigurationSchema.parse(release.configuration);
  const service = createPreparedSearchService({ release, embed: input.embed, execute: input.transport.execute });
  const identities = new Map<string, [number, number]>();
  const discoveredWorks = new Set<string>();
  type Candidate = z.infer<typeof catalog>["records"][number] & { source: z.infer<typeof source>; unitMetadata: Record<string, unknown> };
  const retained = new Map<string, Candidate>();
  const assets = new Map<string, Promise<OriginalAsset>>();
  let assetBytes = 0;
  async function readCandidates(requested: string[], signal: AbortSignal): Promise<Map<string, Candidate>> {
    signal.throwIfAborted();
    if (requested.length > maximumCandidateDescriptionBatch || new Set(requested).size !== requested.length) throw new Error("CANDIDATE_BATCH_INVALID");
    const missing = requested.filter(identity => !retained.has(identity));
    if (!missing.length) return new Map();
    const expected = new Map(missing.map(identity => {
      const coordinates = identities.get(identity);
      if (!coordinates) throw new Error("CANDIDATE_NOT_DISCOVERED");
      return [JSON.stringify(coordinates), { identity, coordinates }];
    }));
    let raw: unknown;
    try {
      raw = await input.transport.readExact({ artifacts: configuration.artifacts,
        references: [...expected.values()].map(item => item.coordinates) }, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof Error) || error.message !== "PREPARED_CATALOG_PAGE_REQUIRED" || missing.length <= 1) throw error;
      const middle = Math.ceil(missing.length / 2);
      const first = await readCandidates(missing.slice(0, middle), signal);
      const second = await readCandidates(missing.slice(middle), signal);
      return new Map([...first, ...second]);
    }
    const packet = catalog.parse(raw);
    signal.throwIfAborted();
    if (packet.package_sha256 !== configuration.artifacts.packageSha256
      || packet.membership_sha256 !== configuration.artifacts.membershipSha256
      || packet.work_index_sha256 !== configuration.artifacts.workIndexSha256
      || packet.vector_completion_sha256 !== configuration.artifacts.vectorCompletionSha256
      || packet.records.length !== expected.size) throw new Error("CATALOG_IDENTITY_MISMATCH");
    const admitted = new Map<string, Candidate>();
    for (const record of packet.records) {
      const identity = expected.get(JSON.stringify([record.vector_ordinal, record.membership_ordinal]))?.identity;
      const retainedSource = packet.sources[record.work], unit = packet.units[record.unit];
      if (!identity || admitted.has(identity) || !retainedSource || retainedSource.inventory.id !== record.work
        || retainedSource.prepared?.work !== record.work || !record.unit.startsWith(`${record.work}:`) || !unit) {
        throw new Error("CATALOG_MEMBERSHIP_MISMATCH");
      }
      admitted.set(identity, { ...record, source: retainedSource, unitMetadata: unit });
    }
    return admitted;
  }
  async function prepareCandidates(requested: string[], signal: AbortSignal) {
    const admitted = await readCandidates(requested, signal);
    signal.throwIfAborted();
    for (const [identity, candidate] of admitted) { retained.set(identity, candidate); discoveredWorks.add(candidate.work); }
  }
  return {
    prepareCandidates,
    async search(query: string, scope: EvidenceScope, signal: AbortSignal) {
      if ((scope.kind === "current") !== (release.capability === "current")) throw new Error("CORPUS_SCOPE_MISMATCH");
      const endpoint = scope.kind === "current" ? { kind: "current" as const }
        : { kind: "timestamp" as const, instant: `${scope.at}T00:00:00.000Z` };
      const request = { version: "prepared-search-v1" as const, releaseId: release.id,
        environment: release.environment, configuration, endpoint, query, limit: 50 as const };
      const response = await service.search({ ...request, requestSha256: preparedSearchRequestHash(request) }, signal);
      const ranking: Record<string, CandidateRanking> = {};
      const candidates = response.hits.map(hit => {
        const identity = `${release.id}:${hit.vectorOrdinal}:${hit.membershipOrdinal}`;
        identities.set(identity, [hit.vectorOrdinal, hit.membershipOrdinal]);
        ranking[identity] = { vectorRank: hit.vectorRank, vectorScore: hit.vectorScore,
          keywordRank: hit.keywordRank, keywordScore: hit.keywordScore, fusionScore: hit.fusionScore };
        return identity;
      });
      return { candidates, ranking, sparseAvailable: true, denseAvailable: true };
    },
    async readCandidate(identity: string, signal: AbortSignal) {
      await prepareCandidates([identity], signal);
      signal.throwIfAborted();
      return structuredClone(retained.get(identity)!);
    },
    async readAsset(work: string, signal: AbortSignal): Promise<OriginalAsset> {
      signal.throwIfAborted();
      if (!discoveredWorks.has(work)) throw new Error("SOURCE_NOT_DISCOVERED");
      const inventory = [...retained.values()].find(candidate => candidate.work === work)!.source.inventory;
      const declared = z.number().int().positive().max(assetLimit).safeParse(inventory.bytes);
      if (!declared.success || inventory.state !== "done" || !["asset", "member"].includes(String(inventory.kind))) {
        throw new Error("SOURCE_ASSET_INELIGIBLE");
      }
      let pending = assets.get(work);
      if (!pending) {
        if (!input.transport.readAsset) throw new Error("SOURCE_ASSET_TRANSPORT_UNAVAILABLE");
        if (assets.size >= 8 || assetBytes + declared.data > 32 * 1024 * 1024) throw new Error("SOURCE_ASSET_CONTEXT_LIMIT");
        assetBytes += declared.data;
        let reservedBytes = declared.data;
        const readAsset = input.transport.readAsset;
        pending = withinSignal(signal, async () => {
          const parsed = assetPacket.safeParse(await readAsset({ artifacts: configuration.artifacts, work }, signal));
          if (!parsed.success) throw new Error("SOURCE_ASSET_IDENTITY");
          const packet = parsed.data, asset = packet.asset;
          const url = new URL(asset.source_url);
          if (packet.package_sha256 !== configuration.artifacts.packageSha256
            || packet.work_index_sha256 !== configuration.artifacts.workIndexSha256
            || asset.work !== work || asset.source_url !== inventory.url || asset.sha256 !== inventory.raw_hash
            || asset.byte_count !== declared.data || url.protocol !== "https:"
            || !["lex.uz", "www.lex.uz"].includes(url.hostname) || url.username || url.password || url.port) {
            throw new Error("SOURCE_ASSET_IDENTITY");
          }
          const bytes = Buffer.from(asset.data_base64, "base64");
          if (bytes.byteLength !== asset.byte_count || bytes.toString("base64") !== asset.data_base64
            || createHash("sha256").update(bytes).digest("hex") !== asset.sha256) throw new Error("SOURCE_ASSET_IDENTITY");
          let renderedPdf: OriginalAsset["renderedPdf"];
          if (asset.rendered_pdf) {
            const rendered = asset.rendered_pdf;
            if (rendered.source_sha256 !== asset.sha256) throw new Error("SOURCE_ASSET_IDENTITY");
            if (assetBytes + rendered.byte_count > 32 * 1024 * 1024) throw new Error("SOURCE_ASSET_CONTEXT_LIMIT");
            assetBytes += rendered.byte_count; reservedBytes += rendered.byte_count;
            const output = Buffer.from(rendered.data_base64, "base64");
            if (output.length !== rendered.byte_count || output.toString("base64") !== rendered.data_base64
              || output.subarray(0, 5).toString("ascii") !== "%PDF-"
              || createHash("sha256").update(output).digest("hex") !== rendered.sha256) throw new Error("SOURCE_ASSET_IDENTITY");
            renderedPdf = { sourceSha256: rendered.source_sha256, rendererImage: rendered.renderer_image,
              sha256: rendered.sha256, bytes: new Uint8Array(output) };
          }
          signal.throwIfAborted();
          return { work, sourceUrl: asset.source_url, sha256: asset.sha256, bytes: new Uint8Array(bytes), ...(renderedPdf ? { renderedPdf } : {}) };
        }).catch(error => { assets.delete(work); assetBytes -= reservedBytes; throw error; });
        assets.set(work, pending);
      }
      return structuredClone(await withinSignal(signal, () => pending!));
    },
    async readSources(works: string[], signal: AbortSignal) {
      if (!works.length || works.length > 8 || new Set(works).size !== works.length
        || works.some(work => !discoveredWorks.has(work))) throw new Error("SOURCE_NOT_DISCOVERED");
      const packet = sourcePacket.parse(await input.transport.readSources({ artifacts: configuration.artifacts, works }, signal));
      signal.throwIfAborted();
      if (packet.package_sha256 !== configuration.artifacts.packageSha256
        || packet.work_index_sha256 !== configuration.artifacts.workIndexSha256
        || Object.keys(packet.sources).length !== works.length
        || works.some(work => packet.sources[work]?.inventory.id !== work
          || (packet.sources[work].prepared !== null && packet.sources[work].prepared.work !== work))) {
        throw new Error("SOURCE_CATALOG_MISMATCH");
      }
      return packet.sources;
    },
  };
}
