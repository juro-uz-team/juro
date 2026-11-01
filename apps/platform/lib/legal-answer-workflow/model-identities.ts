import { z } from "zod";
import { assessmentSchema, researchResponseSchema, researchTurnSchema, writtenAnswerSchema, type Assessment, type ModelOperation, type WrittenAnswer } from "./contracts";
import { recoveredResearchTurn } from "./research-tool-bindings";
import { coverageRecordSchema } from "./research-workspace";
import { issuedResearchTurn, issueUpdateSchema, publishedIssueSchema, type IssueUpdate } from "./issue-writing";

type MapIdentity = (identity: string) => string;
function mapIssue(value: NonNullable<IssueUpdate["content"]>, map: MapIdentity) {
  return { ...value, sourceIds: value.sourceIds.map(map), actions: value.actions.map(action => ({ ...action, sourceIds: action.sourceIds.map(map) })) };
}
function mapAssessment(value: Assessment, map: MapIdentity): Assessment {
  return { ...value, selectedIds: value.selectedIds.map(map),
    support: value.support.map(item => ({ ...item, sourceIds: item.sourceIds.map(map) })),
    recovery: value.recovery.map(item => "sourceId" in item ? { ...item, sourceId: map(item.sourceId) } : item) };
}
function mapAnswer(value: WrittenAnswer, map: MapIdentity): WrittenAnswer {
  const citations = <T extends { sourceIds: string[] }>(item: T): T => ({ ...item, sourceIds: item.sourceIds.map(map) });
  return { ...value, summarySourceIds: value.summarySourceIds.map(map),
    issues: value.issues.map(item => ({ ...citations(item), actions: item.actions.map(citations) })),
    conditionalBranches: value.conditionalBranches.map(citations), risks: value.risks.map(citations),
    deadlines: value.deadlines.map(citations), referenceNotes: value.referenceNotes.map(citations) };
}

/** One immutable handle namespace for the lifetime of a request's research conversation. */
export function createEvidenceCompactor() {
  const handles = new Map<string, string>();
  return (operation: ModelOperation) => compactEvidenceOperation(operation, handles);
}

/** Only active complete evidence can become citations, even when earlier handles remain known. */
export function compactEvidenceOperation(operation: ModelOperation, handles?: Map<string, string>): { operation: ModelOperation; restore(value: unknown): unknown } {
  if (operation.stage === "interpret" || operation.stage === "select") return { operation, restore: value => value };
  const input = z.record(z.string(), z.unknown()).parse(operation.input);
  if (input.evidence === undefined) return { operation, restore: value => value };
  const evidence = z.array(z.object({ identity: z.string().min(1) }).passthrough()).parse(input.evidence);
  const labels = new Map<string, string>(), identities = new Map<string, string>();
  for (const [index, item] of evidence.entries()) {
    if (labels.has(item.identity)) throw new Error("PROVIDER_SOURCE_IDENTITY");
    if (handles && !handles.has(item.identity)) handles.set(item.identity, `s${handles.size + 1}`);
    const label = handles?.get(item.identity) ?? `s${index + 1}`;
    labels.set(item.identity, label); identities.set(label, item.identity);
  }
  const lookup = (map: Map<string, string>): MapIdentity => identity => {
    const mapped = map.get(identity);
    if (!mapped) throw new Error("PROVIDER_SOURCE_IDENTITY");
    return mapped;
  };
  const label = lookup(labels), canonical = lookup(identities);
  // Assessment may retain alternative support or inactive recovery outside the
  // writer's selected evidence. Preserve that context in a separate namespace;
  // these labels never enter the map accepted for output citations.
  const unselected = new Map<string, string>();
  const contextLabel: MapIdentity = identity => {
    const supplied = labels.get(identity);
    if (supplied) return supplied;
    if (handles) {
      if (!handles.has(identity)) handles.set(identity, `s${handles.size + 1}`);
      return handles.get(identity)!;
    }
    if (!unselected.has(identity)) unselected.set(identity, `u${unselected.size + 1}`);
    return unselected.get(identity)!;
  };
  const available = input.availableEvidence === undefined ? undefined
    : z.array(z.object({ identity: z.string().min(1) }).passthrough()).parse(input.availableEvidence);
  const availableIdentities = new Map<string, string>();
  const availableEvidence = available?.map(item => {
    const identity = contextLabel(item.identity);
    availableIdentities.set(identity, item.identity);
    return { ...item, identity };
  });
  const researchCanonical = lookup(new Map([...identities, ...availableIdentities]));
  const availableReferences = input.availableReferences === undefined ? undefined
    : z.array(z.object({ sourceId: z.string().min(1) }).passthrough()).parse(input.availableReferences)
      .map(item => ({ ...item, sourceId: label(item.sourceId) }));
  const known = new Set([...labels.keys(), ...(available ?? []).map(item => item.identity)]);
  const previous = input.previousResearch == null ? undefined : z.object({
    consideredEvidenceIds: z.array(z.string()), newlyReadEvidenceIds: z.array(z.string()),
  }).passthrough().parse(input.previousResearch);
  const priorLabel: MapIdentity = identity => {
    if (!known.has(identity)) throw new Error("PROVIDER_SOURCE_IDENTITY");
    return contextLabel(identity);
  };
  const previousResearch = previous ? { ...previous,
    consideredEvidenceIds: previous.consideredEvidenceIds.map(priorLabel),
    newlyReadEvidenceIds: previous.newlyReadEvidenceIds.map(priorLabel) } : undefined;
  const coverageRecords = input.coverageRecords === undefined ? undefined : z.array(coverageRecordSchema).parse(input.coverageRecords)
    .map(item => ({ ...item, sourceIds: item.sourceIds.map(priorLabel) }));
  const actionOutcomes = input.actionOutcomes === undefined ? undefined : z.array(z.object({ action: z.record(z.string(), z.unknown()) }).passthrough())
    .parse(input.actionOutcomes).map(item => ({ ...item, action: { ...item.action,
      ...(typeof item.action.sourceId === "string" ? { sourceId: priorLabel(item.action.sourceId) } : {}),
      ...(Array.isArray(item.action.selectSourceIds) ? { selectSourceIds: z.array(z.string()).parse(item.action.selectSourceIds).map(priorLabel) } : {}) } }));
  const response = input.researchAgent ? researchResponseSchema(evidence.length > 0, evidence.length > 0 || Boolean(available?.length), input.language, [...identities.keys()]) : null;
  // Share only citation enums, keeping the research constraints inline and
  // using pure references without sibling constraint overrides.
  const responseSchema = response ? z.toJSONSchema(response, { override: ({ jsonSchema }) => {
    if (identities.size && jsonSchema.enum?.length === identities.size
      && jsonSchema.enum.every(value => typeof value === "string" && identities.has(value))) {
      delete jsonSchema.enum;
      delete jsonSchema.type;
      jsonSchema.$ref = "#/$defs/citationSource";
    }
  } }) : null;
  if (responseSchema && identities.size) {
    responseSchema.$defs = { citationSource: { type: "string", enum: [...identities.keys()] } };
  }
  return {
    operation: { ...operation,
      ...(operation.onWriting ? { onWriting: draft => operation.onWriting!({ ...draft,
        ...(draft.issueUpdate ? { issueUpdate: { ...draft.issueUpdate, sourceIds: draft.issueUpdate.sourceIds.map(canonical) } } : {}) }) } : {}),
      ...(responseSchema ? { schema: responseSchema } : {}),
      input: { ...input, evidence: evidence.map(item => ({ ...item, identity: label(item.identity) })),
        ...(input.publishedIssues !== undefined ? { publishedIssues: z.array(publishedIssueSchema).parse(input.publishedIssues)
          .map(item => ({ ...item, content: item.content ? mapIssue(item.content, label) : null })) } : {}),
        ...(availableEvidence ? { availableEvidence } : {}),
        ...(availableReferences ? { availableReferences } : {}),
        ...(previousResearch ? { previousResearch } : {}),
        ...(coverageRecords ? { coverageRecords } : {}),
        ...(actionOutcomes ? { actionOutcomes } : {}),
        ...(operation.stage === "write" && !input.researchAgent ? { assessment: mapAssessment(assessmentSchema.parse(input.assessment), contextLabel) } : {}) },
      ...(operation.sourceFiles ? { sourceFiles: operation.sourceFiles.map(file => ({ ...file, sourceId: label(file.sourceId) })) } : {}),
    },
    restore: value => {
      if (typeof value === "object" && value !== null && issuedResearchTurn in value) {
        const parsed = z.object({ issueUpdates: z.array(issueUpdateSchema), coverageUpdates: z.array(coverageRecordSchema).optional() }).parse(value);
        const updates = parsed.issueUpdates;
        return { [issuedResearchTurn]: true, issueUpdates: updates.map(update => ({ ...update,
          sourceIds: update.sourceIds.map(canonical), content: update.content ? mapIssue(update.content, canonical) : null })),
        coverageUpdates: (parsed.coverageUpdates ?? []).map(record => ({ ...record, sourceIds: record.sourceIds.map(canonical) })) };
      }
      if (input.researchAgent) {
        const raw = z.object({ turn: z.record(z.string(), z.unknown()) }).parse(value).turn;
        const trusted = typeof value === "object" && value !== null && recoveredResearchTurn in value;
        const { coverageUpdates, toolErrors, ...responseTurn } = raw;
        if (toolErrors !== undefined && !trusted) throw new Error("PROVIDER_OUTPUT_INVALID");
        const turn = researchTurnSchema.parse({ ...(trusted ? responseTurn : response!.parse({ turn: responseTurn }).turn),
          ...(trusted && toolErrors ? { toolErrors } : {}),
          ...(coverageUpdates ? { coverageUpdates } : {}) });
        return { ...turn, content: turn.content ? mapAnswer(turn.content, canonical) : null,
          ...(turn.coverageUpdates ? { coverageUpdates: turn.coverageUpdates.map(item => ({ ...item, sourceIds: item.sourceIds.map(researchCanonical) })) } : {}),
          actions: turn.actions.map(action => "sourceId" in action ? { ...action, sourceId: researchCanonical(action.sourceId) }
            : "selectSourceIds" in action ? { ...action, selectSourceIds: action.selectSourceIds.map(lookup(availableIdentities)) } : action) };
      }
      return operation.stage === "assess"
      ? mapAssessment(assessmentSchema.parse(value), canonical) : mapAnswer(writtenAnswerSchema.parse(value), canonical);
    },
  };
}
