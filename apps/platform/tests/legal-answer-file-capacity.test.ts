import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runCompleteReadFixture as runLegalAnswer } from "./helpers/complete-read-agent";
import { providerSourceFiles } from "../lib/legal-answer-workflow/provider-files";

for (const [count, fileBytes] of [[5, 32], [16, 32], [17, 32], [3, 16_000_001]])
test(`${count} complete PDF candidates of ${fileBytes} bytes preserve evidence or produce a bounded unavailable outcome`, async () => {
  const hash = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
  const objects = new Map<string, Uint8Array>();
  const candidates = Array.from({ length: count }, (_, i) => `source-${i}`);
  const stages: string[] = [];
  const result = await runLegalAnswer({ question: "Artificial rule", language: "en", format: "short", mode: "fast",
    actor: { tenantId: "t", userId: "u" }, history: [], privateDocuments: [], submittedAt: Date.now(), deadlineMs: 30_000 }, {
    model: { complete: async operation => {
      stages.push(operation.stage);
      if (operation.stage === "interpret") return { needsClarification: false, complexity: "difficult",
        requirements: [{ id: "r", question: "Which artificial rule applies?" }], queries: ["rule", "exception"],
        scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
      const context = operation.input as { evidence: { identity: string }[]; availableEvidence: { identity: string }[];
        researchFailures: { code: string }[] };
      assert.ok(context.evidence.length > 0);
      assert.equal(providerSourceFiles(operation).filter(part => part.type === "input_file").length,
        count);
      assert.deepEqual(operation.sourceFiles?.map(file => file.sourceId).sort(), [...candidates].sort());
      return { decision: "answer", gaps: [], actions: [], content: { summary: "Artificial supported conclusion", summarySourceIds: [candidates[0]],
        issues: [{ title: "Rule", explanation: "Artificial rule explanation", requirementIds: ["r"], sourceIds: [candidates[0]], actions: [] }],
        conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [],
        clarificationQuestions: [], urgency: "normal" } };
    } },
    corpus: { search: async query => ({ candidates: query === "rule" ? candidates.slice(0, Math.ceil(count / 2))
      : candidates.slice(Math.ceil(count / 2)), sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => {
        const text = Buffer.from(`Complete artificial rule ${identity}`), pdf = Buffer.alloc(fileBytes);
        pdf.write(`%PDF-artificial ${identity}`);
        objects.set(identity, text); objects.set(`${identity}.pdf`, pdf);
        return { identity, snapshot: identity, objectKey: identity, sha256: hash(text), byteCount: text.length,
          sourceUrl: `https://lex.uz/files/${identity}.pdf`, privacyClass: "public_official_source", quarantined: false,
          canonicalizationConflict: false, temporalState: "current_supported", currentPointerVerified: true,
          sourceFile: { objectKey: `${identity}.pdf`, sha256: hash(pdf), byteCount: pdf.length } };
      }, get: async key => objects.get(key) ?? null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  if (count <= 16 && count * fileBytes <= 48_000_000) {
    assert.equal(result.outcome.kind, "answer");
    assert.deepEqual(stages, ["interpret", "write"]);
  } else {
    assert.equal(result.outcome.kind, "insufficient_evidence");
    if (result.outcome.kind !== "insufficient_evidence") throw new Error("Expected unavailable outcome");
    assert.equal(result.outcome.checkedEvidence.length, count);
    assert.match(result.outcome.gaps[0].description, /available evidence and delivery limits/);
    assert.deepEqual(stages, ["interpret"]);
  }
});
