import { z } from "zod";
import { issueWritingHeaderSchema, issueUpdateSchema, publishedIssueSchema, issuedResearchTurn, type IssueUpdate } from "./issue-writing";
import { createIssueWritingProjection } from "./issue-writing-stream";
import { restoreStatementCitations } from "./provider-statement-citations";
import { writtenAnswerForLanguage, type ModelOperation } from "./contracts";
import { coverageRecordSchema } from "./research-workspace";

const object = z.record(z.string(), z.unknown());

/** A separate native tool makes public issue prose distinguishable from research arguments. */
export function prepareIssueWriting(operation: ModelOperation, input: Record<string, unknown>,
  sourceIds: string[], requirementIds: string[], prose: (text: string, ids: readonly string[]) => string) {
  const enabled = operation.stage === "write" && input.issueWriting === true && sourceIds.length > 0;
  const published = z.array(publishedIssueSchema).parse(input.publishedIssues ?? []);
  const active = published.flatMap(item => item.content ? [item.content] : []);
  const coverage = z.array(coverageRecordSchema).parse(input.coverageRecords ?? []);
  const covered = new Set(active.flatMap(issue => issue.requirementIds));
  const unresolved = requirementIds.filter(id => !covered.has(id) && !coverage.some(record => record.id === id && record.status === "dropped"));
  const corrections = z.number().int().min(0).max(7).parse(input.issueCorrections ?? 0);
  const sources = new Set(sourceIds);
  const publicAnswer = writtenAnswerForLanguage(input.language);
  const publicIssue = publicAnswer.shape.issues.element;
  const reason = publicAnswer.shape.summary.max(1200).or(z.literal(""));
  const updatesSchema = z.object({ updates: z.array(issueWritingHeaderSchema.extend({
    content: publicIssue.omit({ sourceIds: true }).nullable(), reason,
  })).max(4), coverageUpdates: z.array(coverageRecordSchema).max(40).optional() }).strict()
    .refine(value => value.updates.length > 0 || Boolean(value.coverageUpdates?.length), "An issue or relevance update is required.");
  const parameters = z.toJSONSchema(updatesSchema);
  parameters.required = ["updates", "coverageUpdates"];
  const bind = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(bind); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    const fields = object.safeParse(node.properties);
    if (fields.success) {
      for (const [field, ids] of [["sourceIds", sourceIds], ["requirementIds", requirementIds]] as const) {
        const array = object.safeParse(fields.data[field]);
        if (array.success) (node.properties as Record<string, unknown>)[field] = { ...array.data, items: {
          type: "string", pattern: `^(?:${ids.map(id => id.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")).join("|")})$`,
        } };
      }
    }
    Object.values(node).forEach(bind);
  };
  bind(parameters);
  const projections = new Map<number, ReturnType<typeof createIssueWritingProjection>>();
  return {
    enabled,
    needsIssueWork: enabled && (!active.length || unresolved.length > 0),
    tool: { type: "function", name: "write_issues", strict: true, parameters,
      description: "Write complete supported issues as public answer prose while other material research continues. Later corrections or retractions require the exact published baseVersion and an explicit explanation in the user's language. Header sourceIds are the issue’s sole citation set and must establish every statement and its material qualifications; content inherits them. Each action declares its own subset of these sources. These are public claims, never private planning or progress." },
    instruction: enabled ? `\nUse write_issues to deliver each sufficiently researched material issue promptly, then research any remaining dependencies. Do not wait to write an established issue merely because another issue remains under research. Include all necessary conditions and exceptions in each public claim; never stream a known unresolved conclusion. Begin with the rule that answers the supplied facts; a route excluded by those facts is not the opening proposition. Use stable issue IDs and publishedIssues versions (0 for a new issue). Later contradictory law requires an explicit correction or retraction with a meaningful reason in the user's language. Never silently replace a published issue. The main summary is derived only when research is complete.${published.length ? " When implementing or judicial guidance describes a narrower practice, also check the governing statute’s current rights, definitions and safeguards. A procedural discretion or exception does not by itself define the full scope of the underlying right. Reconcile later amendments and the relationship between governing and implementing rules where they materially affect the answer." : ""} Before finalizing, reconcile each published rule against all applicable complete law: check omitted qualifications, exceptions, safeguards and later contradictory evidence. Correct or extend the issue explicitly when needed; a summary or separate note must not quietly repair an overbroad earlier issue. Final content omits issues: their latest exact versions are inserted automatically; use write_issues for every additional issue or change before finalizing. Each material requirement must be addressed in a published issue, combining related requirements when useful. If research shows a provisional requirement is irrelevant to the actual question, explicitly revise its coverage record with status dropped and explain why in relevance. Do not drop a relevant requirement merely to finish. coverageUpdates may be empty; use updates: [] only to revise relevance. Requirements not yet explained or explicitly dropped: ${JSON.stringify(unresolved)}. Reserve referenceNotes capacity for issueCorrections. All complete law and earlier conversation remain available.` : "",
    project(name: string, delta: string, index: number) {
      if (!enabled || name !== "write_issues" || !operation.onWriting) return;
      if (!projections.has(index)) projections.set(index, createIssueWritingProjection(draft => {
        reason.parse(draft.issueUpdate!.reason);
        for (const block of draft.blocks) {
          (block.key.endsWith("/title") ? publicIssue.shape.title : publicIssue.shape.explanation).parse(block.text);
        }
        operation.onWriting!(draft);
      }, sources, prose));
      projections.get(index)!(delta);
    },
    accept(value: unknown) {
      if (!enabled) throw new Error("PROVIDER_OUTPUT_INVALID");
      const parsed = updatesSchema.parse(value);
      const updates = parsed.updates.map(update => issueUpdateSchema.parse({ ...update,
        content: update.content ? { ...update.content, sourceIds: update.sourceIds } : null }));
      if (parsed.coverageUpdates?.some(record => record.sourceIds.some(id => !sources.has(id)))) throw new Error("ISSUE_SUPPORT_INVALID");
      const ids = new Set<string>();
      const activeIds = new Set(published.filter(item => item.content).map(item => item.id));
      for (const update of updates) {
        if (ids.has(update.id)) throw new Error("ISSUE_UPDATE_DUPLICATE");
        ids.add(update.id);
        if (update.content) activeIds.add(update.id); else activeIds.delete(update.id);
        if (activeIds.size > 16) throw new Error("ISSUE_CAPACITY");
        if (update.baseVersion !== (published.find(item => item.id === update.id)?.version ?? "0")) throw new Error("ISSUE_VERSION_INVALID");
        if (update.sourceIds.some(id => !sources.has(id)) || (update.content && (
          [...update.content.sourceIds, ...update.content.actions.flatMap(action => action.sourceIds)].some(id => !update.sourceIds.includes(id))
          || update.content.requirementIds.some(id => !requirementIds.includes(id))))) throw new Error("ISSUE_SUPPORT_INVALID");
      }
      if (corrections + updates.filter(update => update.baseVersion !== "0").length > 7) throw new Error("ISSUE_REVISION_LIMIT");
      const normalized: IssueUpdate[] = updates.map(update => ({ ...update, content: update.content ? {
        ...update.content, title: prose(update.content.title, update.content.sourceIds), explanation: prose(update.content.explanation, update.content.sourceIds),
        actions: update.content.actions.map(action => ({ ...action, title: prose(action.title, action.sourceIds), description: prose(action.description, action.sourceIds) })),
      } : null }));
      return { [issuedResearchTurn]: true, issueUpdates: normalized, coverageUpdates: parsed.coverageUpdates ?? [] };
    },
    configureFinal(schema: Record<string, unknown>) {
      if (!enabled) return;
      const fields = object.parse(schema.properties), turn = object.parse(fields.turn);
      turn.anyOf = z.array(object).parse(turn.anyOf).filter(branch => {
        const fields = object.parse(branch.properties);
        if (object.parse(fields.decision).const !== "answer") return true;
        if (!active.length || unresolved.length) return false;
        const content = object.parse(fields.content), properties = object.parse(content.properties);
        if (published.length) {
          delete properties.issues;
          content.required = z.array(z.string()).parse(content.required).filter(key => key !== "issues");
        }
        properties.referenceNotes = { ...object.parse(properties.referenceNotes), maxItems: 8 - corrections };
        content.properties = properties; fields.content = content; branch.properties = fields;
        return true;
      });
      schema.properties = { ...fields, turn };
    },
    restore(value: unknown) {
      if (enabled && (!active.length || unresolved.length) && object.parse(object.parse(value).turn).decision === "answer")
        throw new Error("ISSUE_REQUIREMENT_UNRESOLVED");
      if (!enabled || !published.length) return restoreStatementCitations(value, prose);
      const raw = object.parse(value), turn = object.parse(raw.turn);
      if (turn.content == null) return value;
      const content = object.parse(turn.content);
      if ("issues" in content) throw new Error("ISSUE_FINAL_RECONCILIATION");
      const normalized = object.parse(restoreStatementCitations({ ...raw, turn: { ...turn, content: { ...content, issues: [] } } }, prose));
      const restored = object.parse(normalized.turn);
      return { ...normalized, turn: { ...restored, content: { ...object.parse(restored.content), issues: structuredClone(active) } } };
    },
  };
}
