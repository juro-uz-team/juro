import { z } from "zod";

import {
  assertSearchReleaseGovernanceReady,
  evaluatePersistedObservationWindow,
} from "./target-governance";
import {
  acceptsPrivateServiceRequest,
  privateServiceJson,
} from "./private-service-boundary";
import {
  canonicalChunkIdSchema,
  corpusSnapshotIdSchema,
  legalEnvironmentSchema,
  legalIdentifierSchema,
  legalLanguageSchema,
  provisionRenditionIdSchema,
  searchReleaseIdSchema,
  sha256Schema,
  utcInstantSchema,
} from "./target-domain-schemas";

export const RELEASE_LIFECYCLE_RESOLVE_PATH = "/internal/legal-corpus/target/releases/resolve";

const SERVICE_BINDING_MARKER = "release-lifecycle-v1";
const capabilitySchema = z.enum(["current", "as_of", "comparison"]);

export class ReleaseLifecycleError extends Error {
  constructor(readonly code:
    | "CORPUS_SNAPSHOT_REJECTED"
    | "SEARCH_RELEASE_REJECTED"
    | "ACTIVATION_REJECTED"
    | "RELEASE_SOURCE_UNAVAILABILITY") {
    super(code);
    this.name = "ReleaseLifecycleError";
  }
}

export function compatibleReleaseCorpora(
  current: { corpusSnapshotId: string },
  history: { corpusSnapshotId: string },
): boolean {
  return current.corpusSnapshotId === history.corpusSnapshotId;
}

function ownedBytes(value: string): Uint8Array<ArrayBuffer> {
  const encoded = new TextEncoder().encode(value);
  const owned = new Uint8Array(encoded.byteLength);
  owned.set(encoded);
  return owned;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", ownedBytes(value).buffer);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

const snapshotInputSchema = z.object({
  id: corpusSnapshotIdSchema,
  environment: legalEnvironmentSchema,
  provisionRenditionIds: z.array(provisionRenditionIdSchema).min(1),
  createdAt: utcInstantSchema,
}).strict();

const releaseItemSchema = z.object({
  provisionRenditionId: provisionRenditionIdSchema,
  canonicalChunkId: canonicalChunkIdSchema,
  itemKey: z.string().min(1).max(700),
  r2Key: z.string().min(1).max(700),
  byteCount: z.number().int().positive(),
  sha256: sha256Schema,
  language: legalLanguageSchema,
  documentType: z.string().trim().min(1).max(160),
  validFrom: utcInstantSchema,
  validTo: utcInstantSchema.nullable(),
}).strict();
const releaseInputSchema = z.object({
  id: searchReleaseIdSchema,
  environment: legalEnvironmentSchema,
  capability: z.enum(["current", "history"]),
  corpusSnapshotId: corpusSnapshotIdSchema,
  items: z.array(releaseItemSchema).min(1),
  retrievalPolicyVersion: legalIdentifierSchema,
  configurationIdentity: legalIdentifierSchema,
  createdAt: utcInstantSchema,
}).strict().superRefine((value, context) => {
  const prefix = `search-releases/${value.id}/${value.capability}/`;
  for (const [index, item] of value.items.entries()) {
    if (item.itemKey !== item.r2Key || !item.itemKey.startsWith(prefix)) {
      context.addIssue({
        code: "custom",
        path: ["items", index, "itemKey"],
        message: "Release item must name its exact deterministic R2 search object",
      });
    }
  }
});
const mutationInputSchema = z.object({
  environment: legalEnvironmentSchema,
  actor: z.string().trim().min(1).max(160),
  reason: z.string().trim().min(10).max(500),
  createdAt: utcInstantSchema,
}).strict();

const snapshotSchema = z.object({
  id: corpusSnapshotIdSchema,
  environment: legalEnvironmentSchema,
  corpusHash: sha256Schema,
  memberCount: z.number().int().positive(),
  status: z.literal("frozen"),
  frozenAt: utcInstantSchema,
}).strict();
const searchReleaseSchema = z.object({
  id: searchReleaseIdSchema,
  environment: legalEnvironmentSchema,
  capability: z.enum(["current", "history"]),
  corpusSnapshotId: corpusSnapshotIdSchema,
  status: z.literal("sealed"),
  itemCount: z.number().int().positive(),
  retrievalPolicyVersion: legalIdentifierSchema,
  configurationIdentity: legalIdentifierSchema,
  reconciliationRunId: legalIdentifierSchema,
  sealedAt: utcInstantSchema,
}).strict();
const draftReleaseSchema = searchReleaseSchema.extend({
  reconciliationRunId: z.null(),
  status: z.literal("draft"),
  sealedAt: z.null(),
});
const activationSetSchema = z.object({
  id: legalIdentifierSchema,
  environment: legalEnvironmentSchema,
  currentReleaseId: searchReleaseIdSchema.nullable(),
  asOfReleaseId: searchReleaseIdSchema.nullable(),
  comparisonCurrentReleaseId: searchReleaseIdSchema.nullable(),
  comparisonHistoryReleaseId: searchReleaseIdSchema.nullable(),
  previousActivationSetId: legalIdentifierSchema.nullable(),
  createdAt: utcInstantSchema,
}).strict();

const stagingEvaluationSetInputSchema = z.object({
  activationSetId: legalIdentifierSchema,
  historyReconciliationRunId: legalIdentifierSchema,
  historyReportSha256: sha256Schema,
}).strict();

const stagingEvaluationReleaseSchema = z.object({
  id: searchReleaseIdSchema,
  environment: z.literal("staging"),
  capability: z.enum(["current", "history"]),
  corpusSnapshotId: corpusSnapshotIdSchema,
  status: z.enum(["draft", "sealed"]),
  itemCount: z.number().int().positive(),
  retrievalPolicyVersion: legalIdentifierSchema,
  configurationIdentity: legalIdentifierSchema,
}).strict();

export type StagingHistoryComparisonEvaluationSet = {
  id: string;
  current: z.infer<typeof stagingEvaluationReleaseSchema>;
  history: z.infer<typeof stagingEvaluationReleaseSchema>;
  historyReconciliationRunId: string;
  historyReportSha256: string;
};

/**
 * Resolves one immutable, off-side pair for pre-governance staging evaluation.
 * This verifies but never changes the active pointer, and cannot admit a draft
 * release outside the exact set and reconciliation supplied by the caller.
 */
export async function resolveStagingHistoryComparisonEvaluationSet(
  db: D1Database,
  untrustedInput: z.input<typeof stagingEvaluationSetInputSchema>,
): Promise<StagingHistoryComparisonEvaluationSet> {
  const input = stagingEvaluationSetInputSchema.parse(untrustedInput);
  const selected = await db.prepare(`SELECT candidate.id,candidate.environment,
      candidate.current_release_id AS currentReleaseId,
      candidate.as_of_release_id AS asOfReleaseId,
      candidate.comparison_current_release_id AS comparisonCurrentReleaseId,
      candidate.comparison_history_release_id AS comparisonHistoryReleaseId,
      candidate.previous_activation_set_id AS previousActivationSetId,
      active.activation_set_id AS activeActivationSetId
    FROM legal_activation_sets candidate
    LEFT JOIN legal_active_activation_sets active ON active.environment=candidate.environment
    WHERE candidate.id=? AND candidate.environment='staging'`).bind(input.activationSetId).first<{
      id: string; environment: string; currentReleaseId: string | null; asOfReleaseId: string | null;
      comparisonCurrentReleaseId: string | null; comparisonHistoryReleaseId: string | null;
      previousActivationSetId: string | null; activeActivationSetId: string | null;
    }>();
  if (!selected || !selected.currentReleaseId || !selected.asOfReleaseId
    || selected.currentReleaseId !== selected.comparisonCurrentReleaseId
    || selected.asOfReleaseId !== selected.comparisonHistoryReleaseId
    || !selected.activeActivationSetId
    || selected.id === selected.activeActivationSetId
    || selected.previousActivationSetId !== selected.activeActivationSetId) {
    throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
  }
  const releases = await db.prepare(`SELECT release.id,release.environment,release.capability,
      release.corpus_snapshot_id AS corpusSnapshotId,release.status,
      release.item_count AS itemCount,release.retrieval_policy_version AS retrievalPolicyVersion,
      release.configuration_identity AS configurationIdentity,snapshot.status AS snapshotStatus,
      component.chunk_count AS chunkCount,component.configuration_sha256 AS configurationSha256,
      runtime.mapping_count AS mappingCount
    FROM legal_search_releases release
    JOIN legal_corpus_snapshots snapshot ON snapshot.id=release.corpus_snapshot_id
    JOIN legal_custom_search_release_components component ON component.search_release_id=release.id
    JOIN (SELECT search_release_id,mapping_count FROM legal_custom_search_r2_runtime_roots
      UNION ALL
      SELECT legacy.search_release_id,legacy.mapping_count
      FROM legal_custom_search_runtime_components legacy
      WHERE NOT EXISTS (SELECT 1 FROM legal_custom_search_r2_runtime_roots current
        WHERE current.search_release_id=legacy.search_release_id)) runtime
      ON runtime.search_release_id=release.id
    WHERE release.id IN (?,?) ORDER BY release.id`).bind(
    selected.currentReleaseId,
    selected.asOfReleaseId,
  ).all<Record<string, unknown>>();
  const currentRow = releases.results.find((row) => row.id === selected.currentReleaseId);
  const historyRow = releases.results.find((row) => row.id === selected.asOfReleaseId);
  const exactRelease = (row: Record<string, unknown> | undefined, capability: "current" | "history") => {
    if (!row || row.snapshotStatus !== "frozen"
      || Number(row.itemCount) !== Number(row.chunkCount)
      || Number(row.itemCount) !== Number(row.mappingCount)) {
      throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
    }
    const release = stagingEvaluationReleaseSchema.parse({
      id: row.id, environment: row.environment, capability: row.capability,
      corpusSnapshotId: row.corpusSnapshotId, status: row.status, itemCount: Number(row.itemCount),
      retrievalPolicyVersion: row.retrievalPolicyVersion,
      configurationIdentity: row.configurationIdentity,
    });
    if (release.capability !== capability) throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
    return { release, configurationSha256: String(row.configurationSha256) };
  };
  const current = exactRelease(currentRow, "current");
  const history = exactRelease(historyRow, "history");
  if (current.release.status !== "sealed" || history.release.status !== "draft"
    || current.release.corpusSnapshotId !== history.release.corpusSnapshotId
    || current.release.retrievalPolicyVersion !== history.release.retrievalPolicyVersion
    || current.release.configurationIdentity !== history.release.configurationIdentity
    || current.configurationSha256 !== history.configurationSha256) {
    throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
  }
  const currentGovernance = await db.prepare(`SELECT id FROM legal_search_release_governance
    WHERE search_release_id=? AND environment='staging' AND capability='current'
      AND status='passed' AND failures_json='[]' LIMIT 1`).bind(current.release.id).first();
  const reconciliation = await db.prepare(`SELECT environment,release_id AS releaseId,capability,
      status,report_sha256 AS reportSha256,report_json AS reportJson
    FROM legal_migration_reconciliation_reports WHERE run_id=?`).bind(
    input.historyReconciliationRunId,
  ).first<{ environment: string; releaseId: string; capability: string; status: string;
    reportSha256: string; reportJson: string }>();
  let report: Record<string, unknown> | null = null;
  try {
    report = reconciliation ? JSON.parse(reconciliation.reportJson) as Record<string, unknown> : null;
  } catch {
    report = null;
  }
  if (!currentGovernance || !reconciliation || reconciliation.environment !== "staging"
    || reconciliation.releaseId !== history.release.id || reconciliation.capability !== "history"
    || reconciliation.status !== "clean" || reconciliation.reportSha256 !== input.historyReportSha256
    || await sha256(`${JSON.stringify(report, null, 2)}\n`) !== input.historyReportSha256
    || report?.releaseId !== history.release.id
    || report?.corpusSnapshotId !== history.release.corpusSnapshotId
    || Number(report?.chunkCount) !== history.release.itemCount
    || report?.materializationComplete !== true || report?.sparseReductionComplete !== true
    || report?.vectorizeFullListReconciled !== true
    || report?.regularApiOnly !== true || report?.batchApiUsed !== false) {
    throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
  }
  return { id: selected.id, current: current.release, history: history.release,
    historyReconciliationRunId: input.historyReconciliationRunId,
    historyReportSha256: input.historyReportSha256 };
}

type SnapshotMember = {
  provisionRenditionId: string;
  locatorId: string;
  r2Key: string;
  byteCount: number;
  sha256: string;
};

async function snapshotMembers(
  db: D1Database,
  ids: readonly string[],
): Promise<SnapshotMember[]> {
  const unique = [...new Set(ids)].sort();
  if (unique.length !== ids.length) throw new ReleaseLifecycleError("CORPUS_SNAPSHOT_REJECTED");
  const placeholders = unique.map(() => "?").join(",");
  const rows = await db.prepare(`SELECT rendition.id AS provisionRenditionId,
      locator.id AS locatorId,locator.r2_key AS r2Key,locator.byte_count AS byteCount,
      locator.sha256 AS sha256
    FROM legal_provision_renditions rendition
    JOIN legal_evidence_locators locator ON locator.id=rendition.locator_id
    WHERE rendition.id IN (${placeholders})
      AND EXISTS (
        SELECT 1 FROM legal_official_eligibility eligibility
        WHERE eligibility.subject_type='provision_rendition'
          AND eligibility.subject_id=rendition.id
          AND eligibility.capability IN ('current','as_of')
          AND eligibility.status='eligible'
      )
    ORDER BY rendition.id`).bind(...unique).all<SnapshotMember>();
  if (rows.results.length !== unique.length) {
    throw new ReleaseLifecycleError("CORPUS_SNAPSHOT_REJECTED");
  }
  return rows.results;
}

function newId(prefix: string, environment: string, createdAt: string): string {
  return `${prefix}:${environment}:${createdAt.replace(/[^0-9]/gu, "")}:${crypto.randomUUID()}`;
}

async function currentActivationId(db: D1Database, environment: string): Promise<string | null> {
  const row = await db.prepare(`SELECT activation_set_id AS id
    FROM legal_active_activation_sets WHERE environment=?`).bind(environment).first<{ id: string }>();
  return row?.id ?? null;
}

function validatedProjectionItems(
  inputItems: z.infer<typeof releaseItemSchema>[],
  snapshotItems: Array<Pick<z.infer<typeof releaseItemSchema>, "provisionRenditionId">>,
): z.infer<typeof releaseItemSchema>[] {
  const items = [...inputItems].sort((left, right) =>
    left.canonicalChunkId.localeCompare(right.canonicalChunkId)
    || left.itemKey.localeCompare(right.itemKey));
  const snapshotByRendition = new Map(snapshotItems.map((item) => [item.provisionRenditionId, item]));
  const renditionIds = new Set(items.map((item) => item.provisionRenditionId));
  const expectedRenditionIds = new Set(snapshotItems.map((item) => item.provisionRenditionId));
  const uniqueChunks = new Set(items.map((item) => item.canonicalChunkId));
  const uniqueItemKeys = new Set(items.map((item) => item.itemKey));
  if (renditionIds.size !== expectedRenditionIds.size
    || [...renditionIds].some((id) => !expectedRenditionIds.has(id))
    || uniqueChunks.size !== items.length || uniqueItemKeys.size !== items.length) {
    throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
  }
  for (const item of items) if (!snapshotByRendition.has(item.provisionRenditionId)) {
    throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
  }
  return items;
}

const reconciledReleaseItemSchema = z.object({
  chunkId: canonicalChunkIdSchema,
  provisionRenditionId: provisionRenditionIdSchema,
  itemKey: z.string().min(1).max(700),
  r2Key: z.string().min(1).max(700),
  byteCount: z.number().int().positive(),
  sha256: sha256Schema,
}).passthrough();
const reconciliationReportSchema = z.object({
  status: z.literal("clean"),
  environment: legalEnvironmentSchema,
  releaseId: searchReleaseIdSchema,
  capability: z.enum(["current", "history"]),
  expected: z.object({
    releaseItems: z.array(reconciledReleaseItemSchema).min(1),
  }).passthrough(),
}).passthrough();

async function assertExactReconciledReleaseInventory(
  db: D1Database,
  input: z.infer<typeof releaseInputSchema>,
  items: z.infer<typeof releaseItemSchema>[],
  reconciliationRunId: string,
): Promise<void> {
  const row = await db.prepare(`SELECT report_json AS reportJson
    FROM legal_migration_reconciliation_reports
    WHERE run_id=? AND release_id=? AND environment=? AND capability=? AND status='clean'`).bind(
    reconciliationRunId,
    input.id,
    input.environment,
    input.capability,
  ).first<{ reportJson: string }>();
  const report = reconciliationReportSchema.parse(JSON.parse(row?.reportJson ?? "null") as unknown);
  const expected = report.expected.releaseItems.map((item) => ({
    canonicalChunkId: item.chunkId,
    provisionRenditionId: item.provisionRenditionId,
    itemKey: item.itemKey,
    r2Key: item.r2Key,
    byteCount: item.byteCount,
    sha256: item.sha256,
  })).sort((left, right) => left.canonicalChunkId.localeCompare(right.canonicalChunkId));
  const actual = items.map((item) => ({
    canonicalChunkId: item.canonicalChunkId,
    provisionRenditionId: item.provisionRenditionId,
    itemKey: item.itemKey,
    r2Key: item.r2Key,
    byteCount: item.byteCount,
    sha256: item.sha256,
  })).sort((left, right) => left.canonicalChunkId.localeCompare(right.canonicalChunkId));
  if (report.releaseId !== input.id || report.environment !== input.environment
    || report.capability !== input.capability || JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
  }
}

async function snapshotProjectionItems(
  db: D1Database,
  corpusSnapshotId: string,
  capability: "current" | "history",
) {
  const eligibilityCapability = capability === "current" ? "current" : "as_of";
  return db.prepare(`SELECT member.provision_rendition_id AS provisionRenditionId,
      locator.r2_key AS r2Key,locator.byte_count AS byteCount,locator.sha256 AS sha256
    FROM legal_corpus_snapshot_members member
    JOIN legal_evidence_locators locator ON locator.id=member.locator_id
    JOIN legal_official_eligibility eligibility
      ON eligibility.subject_type='provision_rendition'
      AND eligibility.subject_id=member.provision_rendition_id
      AND eligibility.capability=? AND eligibility.status='eligible'
    WHERE member.corpus_snapshot_id=? ORDER BY member.provision_rendition_id`)
    .bind(eligibilityCapability, corpusSnapshotId)
    .all<Pick<z.infer<typeof releaseItemSchema>,
      "provisionRenditionId" | "r2Key" | "byteCount" | "sha256">>();
}

async function assertObservationWindows(
  db: D1Database,
  releaseIds: readonly string[],
  environment: "development" | "staging" | "production",
  asOf: string,
): Promise<void> {
  if (environment === "development") return;
  const phase = environment === "staging" ? "staging_soak" : "production_canary";
  const windows = await Promise.all(releaseIds.map(async (releaseId) => {
    const governance = await assertSearchReleaseGovernanceReady(db, releaseId, asOf);
    if (governance.boundedVerification) {
      const failure = await db.prepare(`SELECT id FROM legal_release_observations
        WHERE release_id=? AND environment=? AND observed_at>=? AND observed_at<=?
          AND (green=0 OR gate_breach_count>0) LIMIT 1`)
        .bind(releaseId, environment, governance.observedThrough, asOf).first();
      return { eligible: failure === null };
    }
    return evaluatePersistedObservationWindow({ db }, { releaseId, environment, phase, asOf });
  }));
  if (windows.some((window) => !window.eligible)) {
    throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
  }
}

export function createReleaseLifecycle(dependencies: { db: D1Database }) {
  const { db } = dependencies;
  return {
    async sealCustomSearchRelease(untrustedInput: {
      releaseId: string; environment: string; createdAt: string;
    }) {
      const input = z.object({ releaseId: searchReleaseIdSchema,
        environment: legalEnvironmentSchema, createdAt: utcInstantSchema }).strict().parse(untrustedInput);
      const governance = await assertSearchReleaseGovernanceReady(db, input.releaseId, input.createdAt);
      if (!governance.boundedVerification) throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
      const row = await db.prepare(`SELECT release.status,release.sealed_reconciliation_run_id AS reconciliationRunId
        FROM legal_search_releases release
        JOIN legal_corpus_snapshots snapshot ON snapshot.id=release.corpus_snapshot_id
        JOIN legal_custom_search_release_components component ON component.search_release_id=release.id
        WHERE release.id=? AND release.environment=? AND snapshot.environment=release.environment
          AND snapshot.status='frozen' AND release.item_count=component.chunk_count`)
        .bind(input.releaseId, input.environment).first<{ status: string; reconciliationRunId: string | null }>();
      if (!row || !["draft", "sealed"].includes(row.status)
        || (row.status === "sealed" && row.reconciliationRunId !== governance.reconciliationRunId)) {
        throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
      }
      if (row.status === "draft") await db.prepare(`UPDATE legal_search_releases
        SET status='sealed',sealed_at=?,sealed_reconciliation_run_id=? WHERE id=? AND status='draft'`)
        .bind(input.createdAt, governance.reconciliationRunId, input.releaseId).run();
      return { releaseId: input.releaseId, reconciliationRunId: governance.reconciliationRunId };
    },

    async freezeCorpusSnapshot(untrustedInput: z.input<typeof snapshotInputSchema>) {
      const input = snapshotInputSchema.parse(untrustedInput);
      const members = await snapshotMembers(db, input.provisionRenditionIds);
      const corpusHash = await sha256(members
        .map((member) => `${member.provisionRenditionId}:${member.sha256}`)
        .join("\n"));
      const existing = await db.prepare(`SELECT id,environment,corpus_hash AS corpusHash,
          member_count AS memberCount,status,frozen_at AS frozenAt
        FROM legal_corpus_snapshots WHERE id=?`).bind(input.id).first();
      if (existing) {
        const parsed = snapshotSchema.parse(existing);
        if (
          parsed.environment !== input.environment
          || parsed.corpusHash !== corpusHash
          || parsed.memberCount !== members.length
        ) throw new ReleaseLifecycleError("CORPUS_SNAPSHOT_REJECTED");
        return parsed;
      }
      await db.batch([
        db.prepare(`INSERT INTO legal_corpus_snapshots
          (id,environment,corpus_hash,member_count,status,frozen_at,created_at)
          VALUES (?,?,?,?,'frozen',?,?)`).bind(
          input.id, input.environment, corpusHash, members.length, input.createdAt, input.createdAt,
        ),
        ...members.map((member) => db.prepare(`INSERT INTO legal_corpus_snapshot_members
          (corpus_snapshot_id,provision_rendition_id,locator_id,sha256)
          VALUES (?,?,?,?)`).bind(
          input.id, member.provisionRenditionId, member.locatorId, member.sha256,
        )),
      ]);
      return snapshotSchema.parse({
        id: input.id,
        environment: input.environment,
        corpusHash,
        memberCount: members.length,
        status: "frozen",
        frozenAt: input.createdAt,
      });
    },

    async createSearchReleaseDraft(untrustedInput: z.input<typeof releaseInputSchema>) {
      const input = releaseInputSchema.parse(untrustedInput);
      const snapshot = await db.prepare(`SELECT environment,member_count AS memberCount,status
        FROM legal_corpus_snapshots WHERE id=?`).bind(input.corpusSnapshotId).first<{
        environment: string;
        memberCount: number;
        status: string;
      }>();
      if (
        !snapshot
        || snapshot.environment !== input.environment
        || snapshot.status !== "frozen"
      ) throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
      const expected = await snapshotProjectionItems(db, input.corpusSnapshotId, input.capability);
      const items = validatedProjectionItems(input.items, expected.results);
      await db.batch([
        db.prepare(`INSERT INTO legal_search_releases
          (id,environment,capability,corpus_snapshot_id,status,item_count,
            retrieval_policy_version,configuration_identity,sealed_at,created_at)
          VALUES (?,?,?,?,'draft',?,?,?,NULL,?)`).bind(
          input.id, input.environment, input.capability, input.corpusSnapshotId,
          items.length, input.retrievalPolicyVersion, input.configurationIdentity, input.createdAt,
        ),
        ...items.map((item) => db.prepare(`INSERT INTO legal_search_release_items
          (search_release_id,provision_rendition_id,canonical_chunk_id,item_key,r2_key,byte_count,sha256,
            language,document_type,valid_from,valid_to)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(
          input.id, item.provisionRenditionId, item.canonicalChunkId,
          item.itemKey, item.r2Key, item.byteCount, item.sha256,
          item.language, item.documentType, item.validFrom, item.validTo,
        )),
      ]);
      return draftReleaseSchema.parse({
        id: input.id,
        environment: input.environment,
        capability: input.capability,
        corpusSnapshotId: input.corpusSnapshotId,
        status: "draft",
        itemCount: items.length,
        retrievalPolicyVersion: input.retrievalPolicyVersion,
        configurationIdentity: input.configurationIdentity,
        reconciliationRunId: null,
        sealedAt: null,
      });
    },

    async sealSearchRelease(untrustedInput: z.input<typeof releaseInputSchema>) {
      const input = releaseInputSchema.parse(untrustedInput);
      let governance: Awaited<ReturnType<typeof assertSearchReleaseGovernanceReady>>;
      try {
        governance = await assertSearchReleaseGovernanceReady(db, input.id, input.createdAt);
        await assertExactReconciledReleaseInventory(db, input, input.items, governance.reconciliationRunId);
      } catch {
        throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
      }
      const snapshot = await db.prepare(`SELECT environment,member_count AS memberCount,status
        FROM legal_corpus_snapshots WHERE id=?`).bind(input.corpusSnapshotId).first<{
        environment: string;
        memberCount: number;
        status: string;
      }>();
      if (
        !snapshot
        || snapshot.environment !== input.environment
        || snapshot.status !== "frozen"
      ) throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
      const expected = await snapshotProjectionItems(db, input.corpusSnapshotId, input.capability);
      const items = validatedProjectionItems(input.items, expected.results);
      const existing = await db.prepare(`SELECT id,environment,capability,
          corpus_snapshot_id AS corpusSnapshotId,status,item_count AS itemCount,
          retrieval_policy_version AS retrievalPolicyVersion,
          configuration_identity AS configurationIdentity,
          sealed_reconciliation_run_id AS reconciliationRunId,sealed_at AS sealedAt
        FROM legal_search_releases WHERE id=?`).bind(input.id).first();
      if (existing) {
        const persisted = z.union([searchReleaseSchema, draftReleaseSchema]).parse(existing);
        if (
          persisted.environment !== input.environment
          || persisted.capability !== input.capability
          || persisted.corpusSnapshotId !== input.corpusSnapshotId
          || persisted.itemCount !== items.length
          || persisted.retrievalPolicyVersion !== input.retrievalPolicyVersion
          || persisted.configurationIdentity !== input.configurationIdentity
          || (persisted.status === "sealed"
            && persisted.reconciliationRunId !== governance.reconciliationRunId)
        ) throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
        const persistedItems = await db.prepare(`SELECT provision_rendition_id AS provisionRenditionId,
            canonical_chunk_id AS canonicalChunkId,item_key AS itemKey,r2_key AS r2Key,
            byte_count AS byteCount,sha256,language,
            document_type AS documentType,valid_from AS validFrom,valid_to AS validTo
          FROM legal_search_release_items WHERE search_release_id=?
          ORDER BY canonical_chunk_id,item_key`).bind(input.id).all<z.infer<typeof releaseItemSchema>>();
        if (JSON.stringify(persistedItems.results) !== JSON.stringify(items)) {
          throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
        }
        if (persisted.status === "sealed") return persisted;
        await db.prepare(`UPDATE legal_search_releases
          SET status='sealed',sealed_at=?,sealed_reconciliation_run_id=?
          WHERE id=? AND status='draft'`).bind(
          input.createdAt, governance.reconciliationRunId, input.id,
        ).run();
        return searchReleaseSchema.parse({
          ...persisted,
          status: "sealed",
          reconciliationRunId: governance.reconciliationRunId,
          sealedAt: input.createdAt,
        });
      }
      throw new ReleaseLifecycleError("SEARCH_RELEASE_REJECTED");
    },

    async activateCurrent(untrustedInput: z.input<typeof mutationInputSchema> & {
      currentReleaseId: string;
    }) {
      const input = mutationInputSchema.extend({ currentReleaseId: searchReleaseIdSchema })
        .parse(untrustedInput);
      const release = await db.prepare(`SELECT release.id,release.environment,release.capability,
          release.status,release.retrieval_policy_version AS retrievalPolicyVersion,
          release.configuration_identity AS configurationIdentity,snapshot.status AS snapshotStatus
          ,release.sealed_reconciliation_run_id AS reconciliationRunId
        FROM legal_search_releases release
        JOIN legal_corpus_snapshots snapshot ON snapshot.id=release.corpus_snapshot_id
        WHERE release.id=?`).bind(input.currentReleaseId).first<{
        id: string;
        environment: string;
        capability: string;
        status: string;
        retrievalPolicyVersion: string;
        configurationIdentity: string;
        reconciliationRunId: string | null;
        snapshotStatus: string;
      }>();
      if (
        !release
        || release.environment !== input.environment
        || release.capability !== "current"
        || release.status !== "sealed"
        || release.snapshotStatus !== "frozen"
      ) throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
      try {
        const governance = await assertSearchReleaseGovernanceReady(db, release.id, input.createdAt);
        if (governance.reconciliationRunId !== release.reconciliationRunId) {
          throw new Error("SEARCH_RELEASE_RECONCILIATION_DRIFT");
        }
      } catch {
        throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
      }
      await assertObservationWindows(db, [input.currentReleaseId], input.environment, input.createdAt);
      const prior = await currentActivationId(db, input.environment);
      const id = newId("activation", input.environment, input.createdAt);
      const eventId = newId("activation-event", input.environment, input.createdAt);
      await db.batch([
        db.prepare(`INSERT INTO legal_activation_sets
          (id,environment,current_release_id,as_of_release_id,comparison_current_release_id,
            comparison_history_release_id,previous_activation_set_id,created_at)
          VALUES (?,?,?,NULL,NULL,NULL,?,?)`).bind(
          id, input.environment, input.currentReleaseId, prior, input.createdAt,
        ),
        db.prepare(`INSERT INTO legal_active_activation_sets
          (environment,activation_set_id,updated_at) VALUES (?,?,?)
          ON CONFLICT(environment) DO UPDATE SET
            activation_set_id=excluded.activation_set_id,updated_at=excluded.updated_at`).bind(
          input.environment, id, input.createdAt,
        ),
        db.prepare(`INSERT INTO legal_activation_events
          (id,environment,activation_set_id,prior_activation_set_id,action,actor,reason,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).bind(
          eventId, input.environment, id, prior, "activate", input.actor, input.reason, input.createdAt,
        ),
      ]);
      return activationSetSchema.parse({
        id,
        environment: input.environment,
        currentReleaseId: input.currentReleaseId,
        asOfReleaseId: null,
        comparisonCurrentReleaseId: null,
        comparisonHistoryReleaseId: null,
        previousActivationSetId: prior,
        createdAt: input.createdAt,
      });
    },

    async activateHistoryComparison(untrustedInput: z.input<typeof mutationInputSchema> & {
      currentReleaseId: string;
      historyReleaseId: string;
    }) {
      const input = mutationInputSchema.extend({
        currentReleaseId: searchReleaseIdSchema,
        historyReleaseId: searchReleaseIdSchema,
      }).parse(untrustedInput);
      const releases = await db.prepare(`SELECT release.id,release.environment,release.capability,
          release.status,release.corpus_snapshot_id AS corpusSnapshotId,
          release.item_count AS itemCount,
          release.retrieval_policy_version AS retrievalPolicyVersion,
          release.configuration_identity AS configurationIdentity,
          release.sealed_reconciliation_run_id AS reconciliationRunId,
          snapshot.status AS snapshotStatus
        FROM legal_search_releases release
        JOIN legal_corpus_snapshots snapshot ON snapshot.id=release.corpus_snapshot_id
        WHERE release.id IN (?,?) ORDER BY release.id`).bind(
        input.currentReleaseId,
        input.historyReleaseId,
      ).all<{
        id: string;
        environment: string;
        capability: string;
        status: string;
        corpusSnapshotId: string;
        itemCount: number;
        retrievalPolicyVersion: string;
        configurationIdentity: string;
        reconciliationRunId: string | null;
        snapshotStatus: string;
      }>();
      const current = releases.results.find((release) => release.id === input.currentReleaseId);
      const history = releases.results.find((release) => release.id === input.historyReleaseId);
      const compatibleCorpus = Boolean(current && history
        && compatibleReleaseCorpora(current, history));
      if (!current || !history
        || current.environment !== input.environment || history.environment !== input.environment
        || current.capability !== "current" || history.capability !== "history"
        || current.status !== "sealed" || history.status !== "sealed"
        || current.snapshotStatus !== "frozen" || history.snapshotStatus !== "frozen"
        || !compatibleCorpus
        || current.retrievalPolicyVersion !== history.retrievalPolicyVersion
        || current.configurationIdentity !== history.configurationIdentity
        || Number(current.itemCount) <= 0 || Number(history.itemCount) <= 0) {
        throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
      }
      try {
        const [currentGovernance, historyGovernance] = await Promise.all([
          assertSearchReleaseGovernanceReady(db, current.id, input.createdAt),
          assertSearchReleaseGovernanceReady(db, history.id, input.createdAt),
        ]);
        if (currentGovernance.reconciliationRunId !== current.reconciliationRunId
          || historyGovernance.reconciliationRunId !== history.reconciliationRunId) {
          throw new Error("SEARCH_RELEASE_RECONCILIATION_DRIFT");
        }
      } catch {
        throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
      }
      await assertObservationWindows(
        db,
        [current.id, history.id],
        input.environment,
        input.createdAt,
      );
      const prior = await currentActivationId(db, input.environment);
      const idValue = newId("activation", input.environment, input.createdAt);
      const eventId = newId("activation-event", input.environment, input.createdAt);
      await db.batch([
        db.prepare(`INSERT INTO legal_activation_sets
          (id,environment,current_release_id,as_of_release_id,comparison_current_release_id,
            comparison_history_release_id,previous_activation_set_id,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).bind(
          idValue,
          input.environment,
          current.id,
          history.id,
          current.id,
          history.id,
          prior,
          input.createdAt,
        ),
        db.prepare(`INSERT INTO legal_active_activation_sets
          (environment,activation_set_id,updated_at) VALUES (?,?,?)
          ON CONFLICT(environment) DO UPDATE SET
            activation_set_id=excluded.activation_set_id,updated_at=excluded.updated_at`).bind(
          input.environment,
          idValue,
          input.createdAt,
        ),
        db.prepare(`INSERT INTO legal_activation_events
          (id,environment,activation_set_id,prior_activation_set_id,action,actor,reason,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).bind(
          eventId,
          input.environment,
          idValue,
          prior,
          "activate",
          input.actor,
          input.reason,
          input.createdAt,
        ),
      ]);
      return activationSetSchema.parse({
        id: idValue,
        environment: input.environment,
        currentReleaseId: current.id,
        asOfReleaseId: history.id,
        comparisonCurrentReleaseId: current.id,
        comparisonHistoryReleaseId: history.id,
        previousActivationSetId: prior,
        createdAt: input.createdAt,
      });
    },

    async rollback(untrustedInput: z.input<typeof mutationInputSchema>) {
      const input = mutationInputSchema.parse(untrustedInput);
      const activeId = await currentActivationId(db, input.environment);
      if (!activeId) throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
      const active = await db.prepare(`SELECT previous_activation_set_id AS previousActivationSetId
        FROM legal_activation_sets WHERE id=? AND environment=?`).bind(
        activeId,
        input.environment,
      ).first<{ previousActivationSetId: string | null }>();
      if (!active) throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
      const previous = active.previousActivationSetId === null
        ? null
        : await db.prepare(`SELECT current_release_id AS currentReleaseId,
            as_of_release_id AS asOfReleaseId,
            comparison_current_release_id AS comparisonCurrentReleaseId,
            comparison_history_release_id AS comparisonHistoryReleaseId
          FROM legal_activation_sets WHERE id=? AND environment=?`).bind(
          active.previousActivationSetId,
          input.environment,
        ).first<{
          currentReleaseId: string | null;
          asOfReleaseId: string | null;
          comparisonCurrentReleaseId: string | null;
          comparisonHistoryReleaseId: string | null;
        }>();
      if (active.previousActivationSetId !== null && !previous) {
        throw new ReleaseLifecycleError("ACTIVATION_REJECTED");
      }
      const restored = previous ?? {
        currentReleaseId: null,
        asOfReleaseId: null,
        comparisonCurrentReleaseId: null,
        comparisonHistoryReleaseId: null,
      };
      const id = newId("activation", input.environment, input.createdAt);
      const eventId = newId("activation-event", input.environment, input.createdAt);
      await db.batch([
        db.prepare(`INSERT INTO legal_activation_sets
          (id,environment,current_release_id,as_of_release_id,comparison_current_release_id,
            comparison_history_release_id,previous_activation_set_id,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).bind(
          id,
          input.environment,
          restored.currentReleaseId,
          restored.asOfReleaseId,
          restored.comparisonCurrentReleaseId,
          restored.comparisonHistoryReleaseId,
          activeId,
          input.createdAt,
        ),
        db.prepare(`UPDATE legal_active_activation_sets SET activation_set_id=?,updated_at=?
          WHERE environment=?`).bind(id, input.createdAt, input.environment),
        db.prepare(`INSERT INTO legal_activation_events
          (id,environment,activation_set_id,prior_activation_set_id,action,actor,reason,created_at)
          VALUES (?,?,?,?,?,?,?,?)`).bind(
          eventId, input.environment, id, activeId, "rollback", input.actor, input.reason, input.createdAt,
        ),
      ]);
      return activationSetSchema.parse({
        id,
        environment: input.environment,
        ...restored,
        previousActivationSetId: activeId,
        createdAt: input.createdAt,
      });
    },

    resolveActiveCapability(capability: z.infer<typeof capabilitySchema>, environment: z.infer<typeof legalEnvironmentSchema>) {
      return resolveActiveCapability(db, environment, capability);
    },
    resolveActiveComparison(environment: z.infer<typeof legalEnvironmentSchema>) {
      return resolveActiveComparison(db, environment);
    },
  };
}

const capabilityResolutionSchema = z.discriminatedUnion("availability", [
  z.object({
    capability: capabilitySchema,
    availability: z.literal("available"),
    searchRelease: searchReleaseSchema,
  }).strict(),
  z.object({
    capability: capabilitySchema,
    availability: z.literal("unsupported"),
    nextTier: z.literal("live_official_search"),
  }).strict(),
]);

const comparisonResolutionSchema = z.discriminatedUnion("availability", [
  z.object({ availability: z.literal("available"), current: searchReleaseSchema,
    history: searchReleaseSchema }).strict(),
  z.object({ availability: z.literal("unsupported"),
    nextTier: z.literal("live_official_search") }).strict(),
]);

async function resolveActiveComparison(
  db: D1Database,
  environment: z.infer<typeof legalEnvironmentSchema>,
): Promise<z.infer<typeof comparisonResolutionSchema>> {
  const row = await db.prepare(`SELECT
      current.id AS currentId,current.environment AS currentEnvironment,
      current.capability AS currentCapability,current.corpus_snapshot_id AS currentCorpusSnapshotId,
      current.status AS currentStatus,current.item_count AS currentItemCount,
      current.retrieval_policy_version AS currentRetrievalPolicyVersion,
      current.configuration_identity AS currentConfigurationIdentity,
      current.sealed_reconciliation_run_id AS currentReconciliationRunId,
      current.sealed_at AS currentSealedAt,
      history.id AS historyId,history.environment AS historyEnvironment,
      history.capability AS historyCapability,history.corpus_snapshot_id AS historyCorpusSnapshotId,
      history.status AS historyStatus,history.item_count AS historyItemCount,
      history.retrieval_policy_version AS historyRetrievalPolicyVersion,
      history.configuration_identity AS historyConfigurationIdentity,
      history.sealed_reconciliation_run_id AS historyReconciliationRunId,
      history.sealed_at AS historySealedAt
    FROM legal_active_activation_sets active
    JOIN legal_activation_sets selected ON selected.id=active.activation_set_id
      AND selected.environment=active.environment
    JOIN legal_search_releases current ON current.id=selected.comparison_current_release_id
      AND current.environment=active.environment AND current.status='sealed'
      AND current.capability='current'
    JOIN legal_search_releases history ON history.id=selected.comparison_history_release_id
      AND history.environment=active.environment AND history.status='sealed'
      AND history.capability='history'
    WHERE active.environment=?`).bind(environment).first<Record<string, unknown>>();
  if (!row) return { availability: "unsupported", nextTier: "live_official_search" };
  try {
    const release = (prefix: "current" | "history") => searchReleaseSchema.parse({
      id: row[`${prefix}Id`], environment: row[`${prefix}Environment`],
      capability: row[`${prefix}Capability`], corpusSnapshotId: row[`${prefix}CorpusSnapshotId`],
      status: row[`${prefix}Status`], itemCount: row[`${prefix}ItemCount`],
      retrievalPolicyVersion: row[`${prefix}RetrievalPolicyVersion`],
      configurationIdentity: row[`${prefix}ConfigurationIdentity`],
      reconciliationRunId: row[`${prefix}ReconciliationRunId`], sealedAt: row[`${prefix}SealedAt`],
    });
    const current = release("current");
    const history = release("history");
    if (current.capability !== "current" || history.capability !== "history") {
      throw new TypeError("COMPARISON_RELEASE_CAPABILITY_MISMATCH");
    }
    return comparisonResolutionSchema.parse({ availability: "available", current, history });
  } catch {
    throw new ReleaseLifecycleError("RELEASE_SOURCE_UNAVAILABILITY");
  }
}

async function resolveActiveCapability(
  db: D1Database,
  environment: z.infer<typeof legalEnvironmentSchema>,
  capability: z.infer<typeof capabilitySchema>,
): Promise<z.infer<typeof capabilityResolutionSchema>> {
  const column = capability === "current"
    ? "current_release_id"
    : capability === "as_of"
      ? "as_of_release_id"
      : "comparison_history_release_id";
  const selected = await db.prepare(`SELECT active.activation_set_id AS activationSetId,
      selected.${column} AS releaseId
    FROM legal_active_activation_sets active
    JOIN legal_activation_sets selected ON selected.id=active.activation_set_id
    WHERE active.environment=? AND selected.environment=?`).bind(environment, environment).first<{
    activationSetId: string;
    releaseId: string | null;
  }>();
  if (!selected?.releaseId) {
    return { capability, availability: "unsupported", nextTier: "live_official_search" };
  }
  const release = await db.prepare(`SELECT id,environment,capability,
      corpus_snapshot_id AS corpusSnapshotId,status,item_count AS itemCount,
      retrieval_policy_version AS retrievalPolicyVersion,
      configuration_identity AS configurationIdentity,
      sealed_reconciliation_run_id AS reconciliationRunId,sealed_at AS sealedAt
    FROM legal_search_releases WHERE id=? AND environment=? AND status='sealed'`)
    .bind(selected.releaseId, environment).first();
  try {
    return capabilityResolutionSchema.parse({
      capability,
      availability: "available",
      searchRelease: release,
    });
  } catch {
    throw new ReleaseLifecycleError("RELEASE_SOURCE_UNAVAILABILITY");
  }
}

export type ReleaseLifecycleEnv = Pick<Env, "APP_ENV"> & {
  LEGAL_DB?: D1Database;
};

export async function handleReleaseLifecycleRequest(
  request: Request,
  env: ReleaseLifecycleEnv,
): Promise<Response> {
  const environment = legalEnvironmentSchema.safeParse(env.APP_ENV);
  if (
    !environment.success
    || !acceptsPrivateServiceRequest(request, {
      environment: environment.data,
      marker: SERVICE_BINDING_MARKER,
      method: "POST",
      path: RELEASE_LIFECYCLE_RESOLVE_PATH,
      requireJson: true,
    })
  ) return privateServiceJson({ code: "RELEASE_LIFECYCLE_PRIVATE_ROUTE_REJECTED" }, 404);
  if (!env.LEGAL_DB) return privateServiceJson({ code: "RELEASE_SOURCE_UNAVAILABILITY" }, 503);
  try {
    const body = z.object({ capability: capabilitySchema }).strict().parse(await request.json());
    return privateServiceJson({
      result: await resolveActiveCapability(env.LEGAL_DB, environment.data, body.capability),
    });
  } catch {
    return privateServiceJson({ code: "RELEASE_SOURCE_UNAVAILABILITY" }, 503);
  }
}

export function createReleaseLifecycleClient(input: {
  service: Fetcher;
  environment: z.infer<typeof legalEnvironmentSchema>;
}) {
  return {
    async resolve(capability: z.infer<typeof capabilitySchema>) {
      const response = await input.service.fetch(
        `http://legal-corpus.internal${RELEASE_LIFECYCLE_RESOLVE_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-service-binding": SERVICE_BINDING_MARKER,
            "x-juro-legal-environment": input.environment,
          },
          body: JSON.stringify({ capability }),
        },
      );
      if (!response.ok) throw new ReleaseLifecycleError("RELEASE_SOURCE_UNAVAILABILITY");
      try {
        return z.object({ result: capabilityResolutionSchema }).strict()
          .parse(await response.json()).result;
      } catch {
        throw new ReleaseLifecycleError("RELEASE_SOURCE_UNAVAILABILITY");
      }
    },
  };
}
