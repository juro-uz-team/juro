import { z } from "zod";
import type { EvidenceScope, ProvisionLocator, ProvisionObjects } from "./evidence";
import { researchToolErrorSchema } from "./research-tool-bindings";
import { coverageRecordSchema } from "./research-workspace";

export const researchConcurrencySchema = z.number().int().min(1).max(8).default(3);
/** Optional research headroom; deadline, progress and spending guards may stop earlier. */
export const maximumResearchRounds = 6;
/** Entry and final composition, acquisition decisions, writing/review for up to
 * sixteen Issues and seven corrections, plus bounded tool-argument repair.
 * Public writing and reconciliation do not consume the acquisition allowance.
 * The absolute deadline and reserved spending envelope remain independent limits. */
export const maximumGenerationCalls = 2 + maximumResearchRounds + 2 * (16 + 7) + 4;
/** Compact discovery metadata; complete legal reads retain their separate limits. */
export const maximumCandidateDescriptionBatch = 48;

const id = z.string().min(1).max(240);
const statement = z.string().min(1).max(4000);
const complexity = z.enum(["simple", "difficult", "very_difficult"]);
const listResultsAction = z.object({ requirementId: id, resultSetId: z.string().min(1).max(32), page: z.number().int().min(0) }).strict();
export const interpretationSchema = z.object({
  complexity,
  needsClarification: z.boolean(),
  requirements: z.array(z.object({ id, question: statement }).strict()).min(1).max(40)
    .describe("The smallest set of material legal questions necessary to answer the actual request. Use concise phrases without repeating the complete user question. Keep a rule's necessary conditions and safeguards together; separate only distinct rules whose support cannot substitute for each other. Do not add optional background or adjacent financial consequences unless needed for the requested decision. Questions remain provisional as research clarifies relevance."),
  queries: z.array(z.string().min(1).max(2000)).min(1).max(8),
  // Distinct kind literals keep these branches disjoint; ordinary union emits provider-supported anyOf.
  scopes: z.array(z.union([
    z.object({ kind: z.literal("current") }).strict(),
    z.object({ kind: z.literal("historical"), at: z.iso.date() }).strict(),
  ])).min(1).max(2),
  facts: z.array(statement).max(40),
  clarificationQuestions: z.array(statement).max(8),
}).strict().refine(value => !value.needsClarification || value.clarificationQuestions.length > 0,
  "A clarification outcome requires a focused question.");
export const assessmentSchema = z.object({
  support: z.array(z.object({ requirementId: id, sourceIds: z.array(id).min(1).max(24) }).strict()).max(40)
    .describe("Requirements whose material legal rules and qualifications are established by these complete sources, including rules answerable conditionally when case facts are unknown."),
  selectedIds: z.array(id).max(24),
  gaps: z.array(z.object({ requirementId: id, description: statement }).strict()).max(40)
    .describe("Only missing material legal evidence that prevents a supported answer to the requested decision. Unknown case facts or private contract terms are not legal-evidence gaps. Empty when all material law is supported."),
  recovery: z.array(z.union([
    z.object({ requirementId: id, selectSourceIds: z.array(id)
      .describe("Replace active evidence with these retained handles. Multiple selections in one batch form one combined replacement set; an empty list alone clears it.") }).strict(),
    z.object({ requirementId: id, candidateId: z.string().min(1).max(16), contains: z.string().min(1).max(240) }).strict(),
    z.object({ requirementId: id, query: z.string().min(1).max(2000) }).strict(),
    z.object({ requirementId: id, candidateId: z.string().min(1).max(16) }).strict(),
    z.object({ requirementId: id, candidateId: z.string().min(1).max(16), wholeSection: z.literal(true) }).strict(),
    z.object({ requirementId: id, candidateId: z.string().min(1).max(16), wholeDocument: z.literal(true) }).strict(),
    z.object({ requirementId: id, candidateId: z.string().min(1).max(16), sectionPosition: z.string().min(1).max(240) }).strict(),
    // The provider's string-format subset excludes uri. Keep URL validation at the local boundary.
    z.object({ requirementId: id, sourceId: id,
      url: z.string().max(2048).refine(value => z.url().safeParse(value).success, "Invalid URL") }).strict(),
    listResultsAction,
  ])).describe("Targeted retrieval actions for missing material law. Request an exact unread candidate ID, a new query, or an exact supplied operative reference where further official evidence could resolve a gap; never search for unknown private facts."),
}).strict();
export type Interpretation = z.infer<typeof interpretationSchema>;
/** The first agent turn can answer conversation without opening the legal corpus. */
export const entrySchema = z.object({
  conversationReply: statement.nullable(),
  interpretation: interpretationSchema.nullable(),
}).strict().refine(value => (value.conversationReply !== null) !== (value.interpretation !== null),
  "Choose either a conversational reply or legal research.");
export const navigationEntrySchema = entrySchema.safeExtend({
  candidateIds: z.array(z.string().min(1).max(16)).max(4),
}).refine(value => value.candidateIds.length === 0
  || (value.interpretation !== null && !value.interpretation.needsClarification),
"Conversation and clarification must not select legal reads.");
/** Interpretation and initial complete-read choices belong to the same research agent turn. */
export const initialResearchSchema = z.object({
  interpretation: interpretationSchema,
  candidateIds: z.array(z.string().min(1).max(16)),
}).strict();
export type Assessment = z.infer<typeof assessmentSchema>;
export type OfficialProvision = ProvisionLocator & { text: string };

const citations = z.array(id).min(1).max(24);
/** Uzbek Latin prose, including legal punctuation, numbers and mathematical symbols.
 * This constrains script only; it cannot identify foreign words written in Latin.
 * Source text and structured citation identifiers do not use this pattern. */
const uzbekLatinProse = /^[\u0000-\u036f\u1e00-\u1eff\u2000-\u22ff]*$/u;
export function writtenAnswerForLanguage(language?: unknown, sourceIds?: readonly string[]) {
  const boundCitations = sourceIds?.length ? z.array(z.enum(sourceIds)).min(1).max(24) : citations;
  const statement = language === "uz" ? z.string().min(1).max(4000).regex(uzbekLatinProse) : z.string().min(1).max(4000);
  const title = language === "uz" ? id.regex(uzbekLatinProse) : id;
  return z.object({
  issues: z.array(z.object({
    title, explanation: statement.describe("State the complete source-supported rule and its application, retaining material conditions, exceptions and exclusions. Distinguish rules for different actors, claims or procedures; a general rule must not conceal an applicable special rule. Put the actor and governing-regime conditions in each affected statement, supported by its own citations; a later conditional branch cannot repair an earlier overbroad entitlement. Source silence does not establish permission, prohibition or absence of legal effect."),
    requirementIds: z.array(id).min(1).max(40), sourceIds: boundCitations,
    actions: z.array(z.object({ title,
      description: statement.describe("A practical step supported by these citations. Any stated legal consequence, contractual exception, obligation or deadline must itself be established by the cited complete law; do not add a familiar rule from memory. Preserve the actor and governing-regime qualifications in the step itself, not only in a separate branch. Cite the rule actually establishing that qualified step."),
      sourceIds: boundCitations }).strict()).max(16),
  }).strict()).min(1).max(16)
    .describe("Explain every supported material research question, including directly connected effects and continuing rights, with its conditions and safeguards. Combine overlapping requirements in one issue when appropriate. Drop a provisional requirement only when the actual question and law make it irrelevant; do not silently omit a relevant supported requirement. Research missing material law before returning an answer."),
  conditionalBranches: z.array(z.object({ condition: statement, outcome: statement, sourceIds: boundCitations }).strict()).max(12)
    .describe("Material alternative routes relevant to the requested decision, with their separate factual triggers and qualifications. Preserve routes available to multiple participants as well as actor-specific routes; explaining one participant's grounds does not exhaust the governing law's other relevant alternatives. Exclude unrelated hypothetical disputes. A branch must not contradict an earlier unqualified statement."),
  assumptions: z.array(z.object({ statement, impact: statement }).strict()).max(12),
  risks: z.array(z.object({ level: z.enum(["low", "medium", "high", "critical"]),
    title, explanation: statement, sourceIds: boundCitations }).strict()).max(12),
  deadlines: z.array(z.object({ title, dueDate: z.string().max(64).nullable(),
    sourceDate: z.string().max(64).nullable(), calculationMethod: statement,
    confidence: z.enum(["preliminary", "confirmed"]), sourceIds: boundCitations }).strict()).max(12)
    .describe("Distinct source-supported deadlines with their own actors, claim or procedural stage, triggering event and material exceptions. Do not apply one route's deadline to another or repeat an issue's qualified deadline without its qualifications."),
  requiredDocuments: z.array(z.object({ name: title, reason: statement, required: z.boolean() }).strict()).max(16),
  referenceNotes: z.array(z.object({ title, note: statement, sourceIds: boundCitations }).strict()).max(12),
  clarificationQuestions: z.array(statement).max(8),
  urgency: z.enum(["normal", "high", "critical"]),
  // Structured generation follows field order: derive the overview from the
  // completed qualified explanations, rather than commit to it before them.
  summary: statement,
  summarySourceIds: boundCitations,
}).strict();
}
export const writtenAnswerSchema = writtenAnswerForLanguage();
export type WrittenAnswer = z.infer<typeof writtenAnswerSchema>;

/** One agent turn either delivers its answer or requests bounded corpus work. */
export const researchTurnSchema = z.object({
  decision: z.enum(["answer", "research", "insufficient_evidence"]),
  content: writtenAnswerSchema.nullable(),
  gaps: assessmentSchema.shape.gaps,
  actions: assessmentSchema.shape.recovery,
  coverageUpdates: z.array(coverageRecordSchema).max(40).optional(),
  toolErrors: z.array(researchToolErrorSchema).max(56).optional(),
}).strict().superRefine((value, context) => {
  if (value.decision === "answer" ? !value.content || value.gaps.length > 0 || value.actions.length > 0
    : value.content !== null
      || (value.decision === "research" ? (value.actions.length === 0 && !value.toolErrors?.length) : value.actions.length > 0 || value.gaps.length === 0)) {
    context.addIssue({ code: "custom", message: "Research decision and content disagree." });
  }
});
export type ResearchTurn = z.infer<typeof researchTurnSchema>;

/** Without complete evidence, legal drafting is not an available operation. */
export const unreadResearchTurnSchema = z.object({
  decision: z.enum(["research", "insufficient_evidence"]),
  content: z.null(),
  gaps: assessmentSchema.shape.gaps,
  actions: assessmentSchema.shape.recovery,
}).strict();

// Before the first complete read, no evidence identity exists to reopen or follow.
const [, literalRead, searchQuery, candidateRead, sectionRead, documentRead, positionedRead] = assessmentSchema.shape.recovery.element.options;
export const initialReadTurnSchema = unreadResearchTurnSchema.extend({
  actions: z.array(z.union([literalRead, searchQuery, candidateRead, sectionRead, documentRead, positionedRead, listResultsAction])).max(3),
});

/** Provider-visible alternatives enforce the same decision invariants as the local boundary. */
export function researchResponseSchema(allowAnswer: boolean, hasRead: boolean, language?: unknown, sourceIds?: readonly string[]) {
  // Native tools admit at most four actions (three before reading). A search
  // action expands into four language formulations before canonical restoration.
  const actionLimit = hasRead ? 4 : 3;
  const actions = z.array(hasRead ? assessmentSchema.shape.recovery.element : initialReadTurnSchema.shape.actions.element)
    .max(actionLimit * 4).superRefine((items, context) => {
      const searches = items.filter(item => "query" in item).length;
      if (items.length - searches + Math.ceil(searches / 4) > actionLimit)
        context.addIssue({ code: "custom", message: "Too many research actions." });
    });
  const pending = [
    z.object({ decision: z.literal("research"), content: z.null(), gaps: assessmentSchema.shape.gaps,
      actions: actions.min(1) }).strict(),
    z.object({ decision: z.literal("insufficient_evidence"), content: z.null(),
      gaps: assessmentSchema.shape.gaps.min(1), actions: assessmentSchema.shape.recovery.max(0) }).strict(),
  ] as const;
  const answer = z.object({ decision: z.literal("answer"), content: writtenAnswerForLanguage(language, sourceIds),
    gaps: assessmentSchema.shape.gaps.max(0), actions: assessmentSchema.shape.recovery.max(0) }).strict();
  // Structured Outputs requires an object at the root; alternatives belong beneath it.
  return z.object({ turn: allowAnswer ? z.union([...pending, answer]) : z.union(pending) }).strict();
}

export type LegalRequest = {
  question: string;
  language: "en" | "ru" | "uz";
  format: "short" | "detailed";
  mode: "fast" | "deep";
  legalContextDate?: string;
  actor: { tenantId: string; userId: string };
  history: readonly { role: "user" | "assistant"; content: string }[];
  privateDocuments: readonly { id: string; text: string }[];
  caseContext?: import("./case-context").CaseContext;
  submittedAt: number;
  deadlineMs: number;
  /** Completion target only; never changes the overall deadline. */
  onBudgetSelected?(durationMs: number): void;
  onProgress?(stage: "interpreting" | "researching" | "reviewing" | "writing" | "saving"): void;
  onWriting?(draft: import("./writing-stream").WritingDraft): void;
  signal?: AbortSignal;
  onDiagnostic?(event: import("./diagnostics").ResearchDiagnostic): void;
};
export type ModelOperation = {
  onWriting?: LegalRequest["onWriting"];
  /** Continue the same request-local native research conversation. */
  researchSession?: boolean;
  stage: "interpret" | "select" | "assess" | "write";
  instruction: string;
  input: unknown;
  /** Complete verified PDFs, supplied only by the evidence reader for assessment/writing. */
  sourceFiles?: readonly { sourceId: string; sha256: string; bytes: Uint8Array }[];
  schema: Record<string, unknown>;
  signal: AbortSignal;
};
export type LegalOutcome = {
  kind: "conversation";
  text: string;
  checkedEvidence: OfficialProvision[];
  clarificationQuestions: string[];
} | {
  kind: "clarification_required";
  checkedEvidence: OfficialProvision[];
  clarificationQuestions: string[];
} | {
  kind: "insufficient_evidence";
  /** Research stopped without establishing that the trusted corpus lacks the law. */
  researchIncomplete?: boolean;
  revisionNotes?: WrittenAnswer["referenceNotes"];
  gaps: Assessment["gaps"];
  checkedEvidence: OfficialProvision[];
  clarificationQuestions: string[];
} | { kind: "answer"; content: WrittenAnswer; evidence: OfficialProvision[] };
export type PublishedAnswer = { answerId: string; outcome: LegalOutcome };
export type CandidateRanking = { vectorRank: number; vectorScore: number; keywordRank: number; keywordScore: number; fusionScore: number };
export type WorkflowPorts = {
  /** Wait for cancelled provider operations to finish recording their reservations. */
  drain?(): Promise<void>;
  model: { issueWriting?: boolean; complete(operation: ModelOperation): Promise<unknown>;
    capacity?(): { remainingCalls: number; canReserveResearchAndComposition: boolean } };
  corpus: ProvisionObjects & {
    /** Optional ranked complete-provision hydration; zero leaves read selection to the agent. */
    automaticReadLimit?: number;
    automaticReadScope?: "provision" | "section" | "document";
    candidateReadScope?: "provision" | "section" | "document";
    researchConcurrency?: number;
    entryNavigation?: boolean;
    /** Overlap standalone question discovery with interpretation; interpreted scopes remain binding. */
    prefetchInitialSearch?: boolean;
    questionFirstResearch?: boolean;
    /** Literal matches remain separate candidates; repeated headings are never silently resolved. */
    findInSource?(identity: string, contains: string, scope: EvidenceScope, signal: AbortSignal): Promise<string[]>;
    /** Authenticated discovery metadata only; never complete legal evidence. */
    describeCandidates?(identities: string[], scope: EvidenceScope, signal: AbortSignal, includeNavigation?: boolean): Promise<{
      identity: string; sourceUrl: string; text: string; truncated: boolean;
      title?: string; hierarchy?: string[]; descriptionFailure?: string;
      sourceNotes?: string[];
      readRange?: { key: string; kind: "provision" | "section" | "document"; language: string; textByteCount?: number; unitCount?: number;
        sourceNotes?: string[]; sourceSections?: { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[]; sections?: { position: string; title: string; key: string; textByteCount?: number; unitCount?: number }[] };
    }[]>;
    prepareCandidates?(identities: string[], scope: EvidenceScope, signal: AbortSignal): Promise<void>;
    search(query: string, scope: EvidenceScope, signal: AbortSignal): Promise<{
      candidates: string[]; sparseAvailable: boolean; denseAvailable: boolean;
      ranking?: Record<string, CandidateRanking>;
    }>;
    resolve(identity: string, scope: EvidenceScope, signal: AbortSignal, sectionPosition?: string): Promise<ProvisionLocator | null>;
    resolveDocument?(identity: string, scope: EvidenceScope, signal: AbortSignal): Promise<ProvisionLocator | null>;
    resolveReference?(sourceId: string, url: string, scope: EvidenceScope, signal: AbortSignal): Promise<ProvisionLocator | null>;
    resolveIntroductory?(sourceId: string, scope: EvidenceScope, signal: AbortSignal): Promise<ProvisionLocator | null>;
    resolveAdjacent?(sourceId: string, direction: "next" | "previous", scope: EvidenceScope,
      signal: AbortSignal): Promise<ProvisionLocator | null>;
  };
  publication: {
    publish(input: { request: LegalRequest; outcome: LegalOutcome; signal: AbortSignal }): Promise<PublishedAnswer>;
  };
};
