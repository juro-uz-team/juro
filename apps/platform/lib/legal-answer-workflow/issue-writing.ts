import { z } from "zod";
import { writtenAnswerSchema, type WrittenAnswer } from "./contracts";
import type { WritingBlock, WritingDraft } from "./writing-stream";

export const issueWritingHeaderSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]{0,47}$/),
  baseVersion: z.string().regex(/^(?:0|[1-9]\d{0,2})$/),
  change: z.enum(["upsert", "retract"]),
  reason: z.string().max(1200),
  sourceIds: z.array(z.string().min(1).max(160)).min(1).max(12),
}).strict();
export const issueUpdateSchema = issueWritingHeaderSchema.extend({
  content: writtenAnswerSchema.shape.issues.element.nullable(),
}).superRefine((value, context) => {
  if ((value.change === "retract") !== (value.content === null)
    || (value.baseVersion !== "0" && !value.reason.trim()) || (value.change === "retract" && value.baseVersion === "0"))
    context.addIssue({ code: "custom", message: "Issue revision and content disagree." });
});
export type IssueUpdate = z.infer<typeof issueUpdateSchema>;
export type IssueWritingUpdate = z.infer<typeof issueWritingHeaderSchema>;
export const issuedResearchTurn = Symbol("issuedResearchTurn");
export const publishedIssueSchema = z.object({ id: issueWritingHeaderSchema.shape.id,
  version: issueWritingHeaderSchema.shape.baseVersion, content: writtenAnswerSchema.shape.issues.element.nullable() }).strict();
const header = ({ id, baseVersion, change, reason, sourceIds }: IssueWritingUpdate) => issueWritingHeaderSchema.parse({ id, baseVersion, change, reason, sourceIds });
type Issue = WrittenAnswer["issues"][number];

function blocksFor(id: string, issue: Issue): WritingBlock[] {
  return [{ key: `issue/${id}/title`, text: issue.title }, { key: `issue/${id}/explanation`, text: issue.explanation },
    ...issue.actions.flatMap((action, index) => [{ key: `issue/${id}/actions/${index}/title`, text: action.title },
      { key: `issue/${id}/actions/${index}/description`, text: action.description }])];
}

/** Streamed issues stay mutable until saving; revisions are explicit and survive finalization. */
export class IssueWriting {
  private readonly issued = new Map<string, { version: number; content: Issue | null }>();
  private readonly pending = new Map<string, { update: IssueWritingUpdate; blocks: WritingBlock[] }>();
  private readonly order: string[] = [];
  private readonly changes: WrittenAnswer["referenceNotes"] = [];
  private readonly notices: string[] = [];
  private revision = 0;
  private closed = false;
  constructor(private readonly language: "en" | "ru" | "uz") {}

  private checkVersion(update: IssueWritingUpdate) {
    if (Number(update.baseVersion) !== (this.issued.get(update.id)?.version ?? 0)) throw new Error("ISSUE_VERSION_INVALID");
    if (update.baseVersion !== "0" && !update.reason.trim()) throw new Error("ISSUE_REVISION_REASON_MISSING");
  }
  private notice(update: IssueWritingUpdate) {
    return `${this.noticeTitle()}: ${update.reason}`;
  }
  private noticeTitle() { return { en: "Updated explanation", ru: "Уточнение ответа", uz: "Javobga aniqlik" }[this.language]; }
  project(supplied: IssueWritingUpdate, blocks: WritingBlock[], sources: ReadonlySet<string>): WritingDraft {
    if (this.closed) throw new Error("ISSUE_WRITING_CLOSED");
    const update = header(supplied);
    this.checkVersion(update);
    if (update.sourceIds.some(id => !sources.has(id)) || (update.change === "retract" && update.baseVersion === "0"))
      throw new Error("ISSUE_SUPPORT_INVALID");
    if (new Set(blocks.map(block => block.key)).size !== blocks.length || blocks.some(block => !new RegExp(`^issue/${update.id}/(?:title|explanation|actions/\\d+/(?:title|description))$`).test(block.key)
      || block.text.length > 4000) || (update.change === "retract" && blocks.length)) throw new Error("ISSUE_BLOCK_INVALID");
    const prior = this.pending.get(update.id);
    if (prior && JSON.stringify(prior.update) !== JSON.stringify(update)) throw new Error("ISSUE_REVISION_CHANGED");
    const active = this.activeIds();
    if (update.change === "retract") active.delete(update.id); else active.add(update.id);
    if (active.size > 16) throw new Error("ISSUE_CAPACITY");
    if (!prior) {
      if (update.baseVersion !== "0") {
        if (this.notices.length >= 7) throw new Error("ISSUE_REVISION_LIMIT");
        this.revision++; this.notices.push(this.notice(update));
        this.changes.push({ title: this.noticeTitle(), note: update.reason, sourceIds: [...update.sourceIds] });
      }
      if (!this.order.includes(update.id)) this.order.push(update.id);
    } else if (prior.blocks.some(block => !blocks.find(next => next.key === block.key)?.text.startsWith(block.text))) {
      throw new Error("ISSUE_STREAM_REPLACEMENT");
    }
    this.pending.set(update.id, { update, blocks: structuredClone(blocks) });
    return this.snapshot();
  }
  commit(updates: IssueUpdate[], sources: ReadonlySet<string>, requirements: ReadonlySet<string>) {
    if (this.closed) throw new Error("ISSUE_WRITING_CLOSED");
    const parsed = z.array(issueUpdateSchema).max(4).parse(updates);
    if (new Set(parsed.map(update => update.id)).size !== parsed.length) throw new Error("ISSUE_UPDATE_DUPLICATE");
    if (this.notices.length + parsed.filter(update => update.baseVersion !== "0" && !this.pending.has(update.id)).length > 7)
      throw new Error("ISSUE_REVISION_LIMIT");
    const active = this.activeIds();
    for (const update of parsed) {
      this.checkVersion(update);
      const issue = update.content;
      if (issue) active.add(update.id); else active.delete(update.id);
      if (active.size > 16) throw new Error("ISSUE_CAPACITY");
      if (update.sourceIds.some(id => !sources.has(id)) || (issue && (
        [...issue.sourceIds, ...issue.actions.flatMap(action => action.sourceIds)].some(id => !update.sourceIds.includes(id))
        || issue.requirementIds.some(id => !requirements.has(id))))) throw new Error("ISSUE_SUPPORT_INVALID");
      const blocks = issue ? blocksFor(update.id, issue) : [];
      const pending = this.pending.get(update.id);
      if (pending && JSON.stringify(pending.update) !== JSON.stringify(header(update))) throw new Error("ISSUE_REVISION_CHANGED");
      if (pending?.blocks.some(block => !blocks.find(final => final.key === block.key)?.text.startsWith(block.text)))
        throw new Error("ISSUE_STREAM_FINAL_MISMATCH");
    }
    const drafts: WritingDraft[] = [];
    for (const update of parsed) {
      const issue = update.content;
      if (!this.pending.has(update.id)) drafts.push(this.project(update, issue ? blocksFor(update.id, issue) : [], sources));
      this.issued.set(update.id, { version: Number(update.baseVersion) + 1, content: issue ? structuredClone(issue) : null });
      this.pending.delete(update.id);
      drafts.push(this.snapshot());
    }
    return drafts;
  }
  published() { return this.order.flatMap(id => {
    const value = this.issued.get(id);
    return value ? [{ id, version: String(value.version), content: structuredClone(value.content) }] : [];
  }); }
  snapshot(extra: WritingDraft = { blocks: [] }): WritingDraft {
    const blocks = this.order.flatMap(id => {
      const pending = this.pending.get(id);
      if (pending) return pending.blocks;
      const issue = this.issued.get(id)?.content;
      return issue ? blocksFor(id, issue) : [];
    });
    return { blocks: [...structuredClone(blocks), ...extra.blocks],
      ...(this.revision ? { revision: this.revision, notices: [...this.notices] } : {}) };
  }
  finalize(content: WrittenAnswer): WrittenAnswer {
    if (this.pending.size) throw new Error("ISSUE_WRITING_UNFINISHED");
    const issues = this.published().flatMap(item => item.content ? [item.content] : []);
    if (this.issued.size && JSON.stringify(content.issues) !== JSON.stringify(issues)) throw new Error("ISSUE_FINAL_RECONCILIATION");
    if (content.referenceNotes.length + this.changes.length > 8) throw new Error("ISSUE_NOTE_CAPACITY");
    return writtenAnswerSchema.parse({ ...content, referenceNotes: [...content.referenceNotes, ...this.changes] });
  }
  correctionCount() { return this.changes.length; }
  correctionNotes() { return structuredClone(this.changes); }
  private activeIds() {
    const active = new Set(this.published().filter(item => item.content).map(item => item.id));
    for (const [id, pending] of this.pending) {
      if (pending.update.change === "retract") active.delete(id); else active.add(id);
    }
    return active;
  }
  withdrawIncomplete(): WritingDraft | null {
    if (this.closed) throw new Error("ISSUE_WRITING_CLOSED");
    this.closed = true;
    if (!this.snapshot().blocks.length) return null;
    const reason = {
      en: "Research could not finish. The earlier explanations have been withdrawn because a complete, reconciled answer could not be verified.",
      ru: "Исследование не удалось завершить. Предыдущие объяснения отозваны: полный и согласованный ответ не удалось проверить.",
      uz: "Izlanishni yakunlab bo‘lmadi. To‘liq va o‘zaro muvofiq javobni tekshirib bo‘lmagani uchun avvalgi tushuntirishlar qaytarib olindi.",
    }[this.language];
    this.revision++; this.notices.push(reason);
    this.changes.push({ title: this.noticeTitle(), note: reason, sourceIds: [] });
    return { revision: this.revision, notices: [...this.notices], blocks: [] };
  }
}
