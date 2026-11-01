import { createHash } from "node:crypto";
import { z } from "zod";
import { publishedIssueSchema, issuedResearchTurn } from "./issue-writing";

const nonblank = z.string().min(1).regex(/\S/u);
const claimSchema = z.object({
  field: z.enum(["explanation", "action_description"]),
  actionIndex: z.number().int().nonnegative().nullable().describe("Zero-based action index; null for the issue explanation."),
  publicClaim: nonblank.describe("Exact contiguous words in the current public field, not a paraphrase."),
  passageIndices: z.array(z.number().int().nonnegative()).describe("Zero-based indices into this review's passages. Empty only when support is missing and the review is not confirmed; never invent support."),
  qualifications: z.array(z.object({
    qualification: nonblank.describe("Material actor, trigger, scope, condition or exception in the controlling passage."),
    treatment: z.enum(["preserved", "not_applicable", "missing"]),
    publicWording: nonblank.nullable().describe("Exact contiguous words in this public field preserving the qualification; do not abbreviate with ellipses or stitch separate spans. Null when absent or inapplicable."),
    reason: nonblank.describe("Explain applicability to the actual question and whether the public wording preserves the rule."),
  }).strict()).describe("Material qualifications identified in acquired support. Empty only for an unsupported claim in a non-confirmed review."),
}).strict();
const reviewItemSchema = z.object({
  issueId: publishedIssueSchema.shape.id, version: publishedIssueSchema.shape.version,
  passages: z.array(z.object({ sourceId: nonblank, quote: nonblank, attachmentPage: z.number().int().positive().nullable(),
    ruleAndQualifications: nonblank }).strict()).min(1),
  comparison: nonblank,
  claims: z.array(claimSchema).min(1).describe("Compare each material public rule and action directly with the controlling passages. Cover the explanation and every action description. Identify missing qualifications rather than comparing two paraphrases."),
  omissionsOrConflicts: z.array(nonblank).describe("Only unresolved material omissions or conflicts in the current public version. Put resolved findings and explanations of excluded irrelevant topics in comparison. Must be empty when confirmed."),
  disposition: z.enum(["confirmed", "revision_required", "research_required"]),
  researchQueries: z.array(z.object({ requirementId: nonblank, query: nonblank.max(2000) }).strict()).min(1).max(4).optional(),
}).strict();
const reviewSchema = z.object({ reviews: z.array(reviewItemSchema).min(1).max(16) }).strict();
const toolSchema = z.object({ reviews: z.array(z.union([
  reviewItemSchema.omit({ researchQueries: true }).extend({ disposition: z.literal("confirmed"), omissionsOrConflicts: reviewItemSchema.shape.omissionsOrConflicts.max(0) }),
  reviewItemSchema.omit({ researchQueries: true }).extend({ disposition: z.literal("revision_required"), omissionsOrConflicts: reviewItemSchema.shape.omissionsOrConflicts.min(1) }),
  reviewItemSchema.extend({ disposition: z.literal("research_required"), omissionsOrConflicts: reviewItemSchema.shape.omissionsOrConflicts.min(1),
    researchQueries: reviewItemSchema.shape.researchQueries.unwrap() }),
])).min(1).max(16) }).strict();
const object = z.record(z.string(), z.unknown());
const quoteText = (text: string) => text.replace(/\s+/gu, " ").trim();
export class IssueReviewQuoteError extends Error {
  constructor(readonly reviewIndex: number, readonly passageIndex: number,
    readonly matchingSourceIds: string[] = []) { super("ISSUE_REVIEW_QUOTE_INVALID"); }
}
export class IssueReviewSpanError extends Error {
  constructor(readonly reviewIndex: number, readonly claimIndex: number, readonly qualificationIndex: number | null) {
    super(qualificationIndex === null ? "ISSUE_REVIEW_PUBLIC_SPAN_INVALID" : "ISSUE_REVIEW_QUALIFICATION_SPAN_INVALID");
  }
}

/** Exact quotations establish review provenance, not automatic legal entailment. */
export class IssueReconciliation {
  private readonly receipts = new Map<string, string>();
  private readonly revisionsRequired = new Map<string, number>();
  private readonly dependencies = new Map<string, { evidenceFingerprint: string; sources: Map<string, string>; queries: string[] }>();

  prepare(input: Record<string, unknown>, enabled: boolean) {
    const published = z.array(publishedIssueSchema).parse(input.publishedIssues ?? []).filter(issue => issue.content);
    const active = enabled && published.length > 0;
    const evidence = z.array(z.object({ identity: z.string(), text: z.string().optional(),
      sourceFile: z.object({ attached: z.literal(true) }).optional() }).passthrough()).parse(input.evidence ?? []);
    const sources = new Map(evidence.map(source => [source.identity, source]));
    // Any change in acquired law or published prose invalidates earlier reviews.
    const fingerprint = createHash("sha256").update(JSON.stringify([published, evidence])).digest("hex");
    const pending = published.filter(issue => this.receipts.get(issue.id) !== fingerprint);
    const evidenceFingerprint = createHash("sha256").update(JSON.stringify(evidence)).digest("hex");
    const sourceFingerprints = new Map(evidence.map(source => [source.identity,
      createHash("sha256").update(JSON.stringify([source.text ?? null, source.sourceFile ?? null])).digest("hex")]));
    const dependencies = this.dependencies;
    const required = enabled && (pending.length > 0 || dependencies.size > 0);
    const receipts = this.receipts;
    const revisionsRequired = this.revisionsRequired;
    const freshReviewIds = enabled ? pending.filter(issue => Number(issue.version) > (revisionsRequired.get(issue.id) ?? -1)
      && !issue.content!.requirementIds.some(id => {
        const dependency = dependencies.get(id);
        return dependency && ![...sourceFingerprints].some(([sourceId, value]) => dependency.sources.get(sourceId) !== value);
      })).map(issue => issue.id) : [];
    return {
      enabled: active, required, freshReviewIds,
      writerInstruction: required ? `\nPublic issues require a private source review before final composition. Correct issues marked revision_required using write_issues; a private assurance cannot change public prose. Resolve research_required dependencies with acquired law and a revised public issue. The next eligible issue revision will be reviewed separately. Pending issue IDs: ${JSON.stringify(pending.map(issue => issue.id))}. Unresolved research dependencies: ${JSON.stringify([...dependencies].map(([requirementId, value]) => ({ requirementId, queries: value.queries })))}.` : "",
      tool: { type: "function", name: "reconcile_issues", strict: true,
        parameters: z.toJSONSchema(toolSchema.extend({ reviews: toolSchema.shape.reviews.max(Math.max(1, published.length)) })),
        description: "Privately compare current published issues against complete acquired law. Quote exact contiguous controlling passages, including material conditions and exceptions. Use separate passage entries for excerpts separated by notes or other text; do not stitch quotations or insert ellipses. issueReviewError reports rejected review arguments; correct those arguments without assuming the review was accepted. matchingSourceIds, when present, lists acquired sources that contain the exact rejected quotation; verify applicability before correcting its source binding. Use attachmentPage:null for retained text; for an attached source PDF give its one-based page. PDF quotations remain model-read evidence, not mechanically verified text. Return one disposition per issue ID at its current published version. Identify omissions or contradictions explicitly. This tool does not modify public prose; use write_issues for necessary corrections, then review the revised versions." },
      instruction: active ? `\nBefore finalizing, use reconcile_issues for each current published issue. Assess the actual question, not only the scope the draft chose to discuss. Read governing passages in the complete law, not only the narrower sources cited in the draft. Distinguish everyday descriptions from the legal triggers for the advice. When a material trigger or required step depends on procedural, evidentiary or implementing rules, research those dependencies before confirming. Silence in one statute does not establish that no such requirements exist. Keep this inquiry relevant to the actual question. Compare statutory rights and their scope, amendments, conditions, exceptions and procedural guidance with every material public claim and action. Include exact quotations from each cited source and any other acquired source that changes the rule. Quote enough surrounding text to preserve material qualifications. Distinguish an established contradiction from a missing legal basis. If a material claim or practical step lacks acquired legal support, choose research_required with targeted researchQueries linked to that issue's requirementIds; those queries execute as the next research turn. Request at most four queries across the entire review batch. Do not merely delete an unsupported but relevant claim and confirm the narrower answer. Use revision_required when the acquired law already establishes the correction. Do not invent dependencies for irrelevant optional topics. State the unresolved material matter in omissionsOrConflicts. Correct the public issue with write_issues; a private review cannot repair public prose. Confirm only after the published wording includes the relevant qualifications. New law or changed prose requires fresh review. Eligible review issue IDs: ${JSON.stringify(freshReviewIds)}. Unresolved research dependencies by requirement: ${JSON.stringify([...dependencies].map(([requirementId, value]) => ({ requirementId, queries: value.queries })))}.` : "",
      configureFinal(schema: Record<string, unknown>) {
        if (!required) return;
        const properties = object.parse(schema.properties), turn = object.parse(properties.turn);
        turn.anyOf = z.array(object).parse(turn.anyOf).filter(branch =>
          object.parse(object.parse(branch.properties).decision).const !== "answer");
        schema.properties = { ...properties, turn };
      },
      assertFinal(value: unknown) {
        if (required && object.parse(object.parse(value).turn).decision === "answer") throw new Error("ISSUE_REVIEW_REQUIRED");
      },
      accept(value: unknown) {
        if (!active) throw new Error("ISSUE_REVIEW_UNAVAILABLE");
        const { reviews } = reviewSchema.parse(value), seen = new Set<string>();
        const actions = reviews.flatMap(review => review.researchQueries ?? []);
        if (actions.length > 4) throw new Error("ISSUE_RESEARCH_BATCH_INVALID");
        for (const [reviewIndex, review] of reviews.entries()) {
          const issue = published.find(issue => issue.id === review.issueId && issue.version === review.version);
          if (!issue) throw new Error("ISSUE_REVIEW_VERSION_INVALID");
          if (seen.has(review.issueId)) throw new Error("ISSUE_REVIEW_DUPLICATE");
          if (review.disposition === "research_required") {
            if (input.canResearch === false) throw new Error("ISSUE_RESEARCH_CLOSED");
            if (!review.omissionsOrConflicts.length || !review.researchQueries?.length
              || review.researchQueries.some(action => !issue.content!.requirementIds.includes(action.requirementId)))
              throw new Error("ISSUE_RESEARCH_ARGUMENT_INVALID");
          } else if (review.researchQueries !== undefined) throw new Error("ISSUE_RESEARCH_ARGUMENT_INVALID");
          if (review.disposition === "confirmed" && issue.content!.requirementIds.some(id =>
            dependencies.get(id)?.evidenceFingerprint === evidenceFingerprint)) throw new Error("ISSUE_RESEARCH_REQUIRED");
          if (review.disposition === "confirmed" && issue.content!.requirementIds.some(id => {
            const dependency = dependencies.get(id);
            return dependency && !review.passages.some(passage => sourceFingerprints.has(passage.sourceId)
              && sourceFingerprints.get(passage.sourceId) !== dependency.sources.get(passage.sourceId));
          })) throw new Error("ISSUE_RESEARCH_SUPPORT_MISSING");
          if (review.disposition === "confirmed" && Number(review.version) <= (revisionsRequired.get(review.issueId) ?? -1))
            throw new Error("ISSUE_PUBLIC_REVISION_REQUIRED");
          seen.add(review.issueId);
          for (const [passageIndex, passage] of review.passages.entries()) {
            const source = sources.get(passage.sourceId);
            // Layout whitespace may change in a quotation; words, punctuation,
            // order and intervening publisher notes must still match.
            const valid = passage.attachmentPage === null
              ? source?.text !== undefined && quoteText(source.text).includes(quoteText(passage.quote))
              : source?.sourceFile?.attached;
            if (!valid) throw new IssueReviewQuoteError(reviewIndex, passageIndex, passage.attachmentPage === null
              ? evidence.filter(item => item.text !== undefined && quoteText(item.text).includes(quoteText(passage.quote))).map(item => item.identity) : []);
          }
          const cited = [...issue.content!.sourceIds, ...issue.content!.actions.flatMap(action => action.sourceIds)];
          if (cited.some(id => !review.passages.some(passage => passage.sourceId === id))) throw new Error("ISSUE_REVIEW_SUPPORT_MISSING");
          const covered = new Set<string>();
          for (const [claimIndex, claim] of review.claims.entries()) {
            const field = claim.field === "explanation" && claim.actionIndex === null ? issue.content!.explanation
              : claim.field === "action_description" && claim.actionIndex !== null
                ? issue.content!.actions[claim.actionIndex]?.description : undefined;
            if (!field || !field.includes(claim.publicClaim)) throw new IssueReviewSpanError(reviewIndex, claimIndex, null);
            if (review.disposition === "confirmed" && (!claim.passageIndices.length || !claim.qualifications.length))
              throw new Error("ISSUE_REVIEW_CLAIM_SUPPORT_MISSING");
            if (claim.passageIndices.some(index => index >= review.passages.length)) throw new Error("ISSUE_REVIEW_PASSAGE_INVALID");
            covered.add(claim.field === "explanation" ? "explanation" : `action/${claim.actionIndex}`);
            for (const [qualificationIndex, qualification] of claim.qualifications.entries()) {
              if (qualification.treatment === "preserved"
                ? !qualification.publicWording || !field.includes(qualification.publicWording)
                : qualification.publicWording !== null) throw new IssueReviewSpanError(reviewIndex, claimIndex, qualificationIndex);
              if (review.disposition === "confirmed" && qualification.treatment === "missing") throw new Error("ISSUE_REVIEW_CONFLICT");
            }
          }
          if (!covered.has("explanation") || issue.content!.actions.some((_, index) => !covered.has(`action/${index}`)))
            throw new Error("ISSUE_REVIEW_CLAIM_COVERAGE_MISSING");
          if (review.disposition === "confirmed" && review.omissionsOrConflicts.length) throw new Error("ISSUE_REVIEW_CONFLICT");
        }
        for (const review of reviews) {
          if (review.disposition === "confirmed") {
            receipts.set(review.issueId, fingerprint);
            const issue = published.find(issue => issue.id === review.issueId)!;
            for (const id of issue.content!.requirementIds) dependencies.delete(id);
          }
          else { receipts.delete(review.issueId); revisionsRequired.set(review.issueId, Number(review.version)); }
        }
        // Commit dependencies last so a confirmation in the same batch cannot
        // erase another issue's unresolved research for a shared requirement.
        for (const action of actions) {
          const prior = dependencies.get(action.requirementId);
          dependencies.set(action.requirementId, { evidenceFingerprint, sources: sourceFingerprints,
            queries: [...new Set([...(prior?.queries ?? []), action.query])] });
        }
        if (actions.length) return { turn: { decision: "research", content: null, gaps: [], actions, coverageUpdates: [] } };
        return { [issuedResearchTurn]: true, issueUpdates: [], coverageUpdates: [] };
      },
    };
  }

  clear() { this.receipts.clear(); this.revisionsRequired.clear(); this.dependencies.clear(); }
}
