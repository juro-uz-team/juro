import { z } from "zod";
import type { OfficialProvision } from "./contracts";
import { EvidenceInventory } from "./inventory";
import { researchEvidence } from "./research-context";
import type { ReadCandidate } from "./candidate-selection";

export const coverageRecordSchema = z.object({
  id: z.string().min(1).max(240), issue: z.string().min(1).max(2000), relevance: z.string().min(1).max(2000).regex(/\S/u),
  status: z.enum(["open", "supported", "dropped", "superseded"]),
  sourceIds: z.array(z.string().min(1).max(240)).max(24),
  dependency: z.string().max(2000), nextAction: z.string().max(2000),
}).strict();
export type CoverageRecord = z.infer<typeof coverageRecordSchema>;
export type ResearchOutcome = { action: unknown; kind: "complete_read" | "navigation" | "empty" | "duplicate"
  | "unavailable" | "invalid" | "cancelled" | "not_executed" | "selected"; code?: string };

/** Private request state; issue claims are provisional and never legal evidence. */
export class ResearchWorkspace {
  readonly inventory = new EvidenceInventory<OfficialProvision>();
  private readonly issues = new Map<string, CoverageRecord>();
  private readonly results = new Map<string, ResearchOutcome>();
  private readonly ranges = new Map<string, { key: string; sourceScope: string; language: string }>();
  static sourceScope(candidate: ReadCandidate) {
    return JSON.stringify([candidate.sourceUrl, candidate.readRange?.language ?? candidate.language,
      candidate.selectedEditions, candidate.requestedEdition, candidate.scope]);
  }
  registerRange(identity: string, key: string, candidate: ReadCandidate) {
    if (candidate.readRange) this.ranges.set(identity, { key, sourceScope: ResearchWorkspace.sourceScope(candidate), language: candidate.readRange.language });
  }
  active() { return this.inventory.all(); }
  retain(provision: OfficialProvision) {
    this.inventory.retain(provision);
  }
  select(ids: string[]): never { this.inventory.select(ids); throw new Error("EVIDENCE_REMOVAL_DISABLED"); }
  revise(records: CoverageRecord[]) {
    const parsed = z.array(coverageRecordSchema).max(40).parse(records);
    for (const record of parsed) this.inventory.select(record.sourceIds);
    if (new Set([...this.issues.keys(), ...parsed.map(item => item.id)]).size > 40) throw new Error("COVERAGE_RECORD_LIMIT");
    for (const record of parsed) this.issues.set(record.id, structuredClone(record));
  }
  coverage() { return structuredClone([...this.issues.values()]); }
  record(result: ResearchOutcome) { this.results.set(JSON.stringify([result.action, result.kind, result.code]), structuredClone(result)); }
  outcomes() { return structuredClone([...this.results.values()]); }
  catalog(candidates: readonly ReadCandidate[] = []) {
    return this.inventory.all().map(provision => ({ identity: provision.identity, sourceUrl: provision.sourceUrl,
      sourceTitle: provision.sourceTitle, articleNumber: provision.articleNumber, applicableAt: provision.applicableAt,
      editionObservation: provision.editionObservation, sourceNotes: provision.sourceNotes ?? [],
      rangeKind: provision.sourceStructure?.rangeKind ?? "unknown", anchor: provision.sourceStructure?.anchor ?? null,
      language: provision.sourceStructure?.anchor.language ?? null,
      serializedBytes: Buffer.byteLength(JSON.stringify(researchEvidence([provision])[0])),
      completeRangeKey: this.ranges.get(provision.identity)?.key ?? null,
      narrowerCompleteReads: candidates.filter(candidate => {
        const parent = this.ranges.get(provision.identity);
        return parent && candidate.readRange?.kind === "provision" && candidate.readRange.language === parent.language
          && ResearchWorkspace.sourceScope(candidate) === parent.sourceScope
          && candidate.readRange.sections?.some(section => section.key === parent.key);
      }).map(candidate => ({ candidateId: candidate.id, completeRangeKey: candidate.readRange!.key,
        scope: candidate.scope, language: candidate.readRange!.language })),
      hasSourceFile: Boolean(provision.sourceFile), active: this.active().some(item => item.identity === provision.identity) }));
  }
}
