import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { runLegalAnswer } from "../lib/legal-answer-workflow/workflow";
import { issuedResearchTurn, type IssueUpdate } from "../lib/legal-answer-workflow/issue-writing";
import type { WritingDraft } from "../lib/legal-answer-workflow/writing-stream";
import { z } from "zod";
import { ProviderResearchSession } from "../lib/legal-answer-workflow/provider-research-session";
import { createEvidenceCompactor } from "../lib/legal-answer-workflow/model-identities";

for (const finish of ["answer", "delayed-answer", "unfinished", "silent-replacement"] as const) {
  test(`research can continue after streamed prose and reconcile later contradictory law: ${finish}`, async () => {
    const drafts: WritingDraft[] = [];
    let phase = 0, published = false, reconciliationTurns = 0;
    const original = { title: "Permit", explanation: "Public events require a permit.", requirementIds: ["r"], sourceIds: ["rule"], actions: [] };
    const revised = { ...original, explanation: "Public events require a permit; private gatherings are exempt.", sourceIds: ["rule", "exception"] };
    const documents = { rule: Buffer.from(original.explanation), exception: Buffer.from("Private gatherings are exempt from the public event permit requirement.") };
    const run = runLegalAnswer({ question: "What permits apply?", language: "en", format: "detailed", mode: "fast",
      actor: { tenantId: "tenant", userId: "user" }, history: [{ role: "user", content: "Preserve the entire previous question." }],
      privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000, onWriting: draft => drafts.push(structuredClone(draft)) }, {
      model: { issueWriting: true, complete: async operation => {
        if (operation.stage === "interpret") return { conversationReply: null, interpretation: { complexity: "difficult", needsClarification: false,
          requirements: [{ id: "r", question: "Permits and exceptions" }], queries: ["rule"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] } };
        const input = z.object({ evidence: z.array(z.object({ identity: z.string(), text: z.string() })),
          unreadCandidates: z.array(z.object({ id: z.string() })), history: z.array(z.object({ content: z.string() })),
          publishedIssues: z.array(z.object({ version: z.string() })) }).parse(operation.input);
        assert.equal(input.history[0].content, "Preserve the entire previous question.");
        const research = (actions: unknown[]) => ({ decision: "research", content: null, gaps: [], actions });
        if (phase === 0) { phase++; return research([{ requirementId: "r", candidateId: input.unreadCandidates[0].id }]); }
        if (phase === 1 || phase === 4) {
          const correcting = phase === 4;
          const update: IssueUpdate = { id: "permit", baseVersion: correcting ? "1" : "0", change: "upsert",
            reason: correcting ? "The later complete rule exempts private gatherings." : "", sourceIds: correcting ? ["rule", "exception"] : ["rule"],
            content: correcting ? revised : original };
          if (correcting) {
            assert.equal(input.evidence.length, 2);
            assert.ok(input.evidence.some(item => item.text === documents.rule.toString()));
            assert.equal(input.publishedIssues[0].version, "1");
          }
          operation.onWriting?.({ issueUpdate: update, blocks: [{ key: "issue/permit/explanation", text: correcting ? "Public events require a permit;" : "Public events require" }] });
          phase++;
          return { [issuedResearchTurn]: true, issueUpdates: [update] };
        }
        if (phase === 2) {
          assert.ok(drafts.some(draft => draft.blocks.some(block => block.text === original.explanation)));
          const compact = createEvidenceCompactor()(operation);
          const sourceId = z.object({ evidence: z.array(z.object({ identity: z.string() })) }).parse(compact.operation.input).evidence[0].identity;
          const native = new ProviderResearchSession().prepare(compact.operation, "{}");
          const reviewed = await native.accept([{ type: "function_call", name: "reconcile_issues", call_id: "dependency",
            arguments: JSON.stringify({ reviews: [{ issueId: "permit", version: "1", disposition: "research_required",
              passages: [{ sourceId, quote: original.explanation, attachmentPage: null, ruleAndQualifications: "The general permit rule." }],
              claims: [{ field: "explanation", actionIndex: null, publicClaim: original.explanation, passageIndices: [0],
                qualifications: [{ qualification: "The possible exception", treatment: "missing", publicWording: null,
                  reason: "The exception needs further research." }] }],
              comparison: "The possible exception remains unresolved.", omissionsOrConflicts: ["Exception scope needs complete law."],
              researchQueries: [{ requirementId: "r", query: "exception" }] }] }) }]);
          phase++; return compact.restore(reviewed);
        }
        if (phase === 3) { phase++; return research([{ requirementId: "r", candidateId: input.unreadCandidates[0].id }]); }
        if (finish === "delayed-answer" && reconciliationTurns++ < 6) return { [issuedResearchTurn]: true, issueUpdates: [], coverageUpdates: [] };
        if (finish === "unfinished") return { decision: "insufficient_evidence", content: null, actions: [], gaps: [{ requirementId: "r", description: "A dependency remains unresolved." }] };
        return { decision: "answer", gaps: [], actions: [], content: { summary: revised.explanation, summarySourceIds: ["rule", "exception"],
          issues: [finish === "silent-replacement" ? original : revised], assumptions: [], conditionalBranches: [], risks: [], deadlines: [],
          requiredDocuments: [], referenceNotes: [], clarificationQuestions: [], urgency: "normal" } };
      } },
      corpus: { search: async query => ({ candidates: [query], sparseAvailable: true, denseAvailable: true }),
        resolve: async identity => {
          const key = identity === "rule" ? "rule" : "exception", bytes = documents[key];
          return { identity: key, snapshot: "revision", objectKey: key, sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
            sourceUrl: `https://lex.uz/docs/${key === "rule" ? "123" : "124"}`, privacyClass: "public_official_source", quarantined: false,
            canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" };
        }, get: async key => documents[key === "rule" ? "rule" : "exception"] },
      publication: { publish: async ({ outcome }) => { published = true; return { answerId: "saved", outcome }; } },
    });
    if (finish === "silent-replacement") {
      await assert.rejects(() => run, /ISSUE_FINAL_RECONCILIATION/); assert.equal(published, false); return;
    }
    const result = await run;
    assert.ok(drafts.some(draft => draft.revision === 1 && draft.notices![0].includes("later complete rule")));
    if (finish === "answer" || finish === "delayed-answer") assert.equal(result.outcome.kind, "answer");
    if (result.outcome.kind === "answer") {
      assert.deepEqual(result.outcome.content.issues, [revised]);
      assert.match(result.outcome.content.referenceNotes[0].note, /later complete rule/);
    } else {
      assert.equal(result.outcome.kind, "insufficient_evidence");
      assert.deepEqual(drafts.at(-1)!.blocks, []);
      assert.match(drafts.at(-1)!.notices!.at(-1)!, /withdrawn/);
    }
  });
}
