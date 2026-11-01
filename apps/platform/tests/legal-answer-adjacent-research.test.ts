import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runCompleteReadFixture as runLegalAnswer } from "./helpers/complete-read-agent";
import type { OfficialProvision } from "../lib/legal-answer-workflow/contracts";

test("initial reads preserve primary evidence without blanket adjacency and reserve targeted recovery capacity", async () => {
  for (const scenario of ["normal", "recovery"] as const) {
    const primaryCount = scenario === "recovery" ? 12 : 3;
    let assessments = 0, recoveryReads = 0;
    const primary = Array.from({ length: primaryCount }, (_, index) => `primary:${index}`);
    const completed = new Set<string>(), adjacentCalls: string[] = [];
    const buffers = new Map<string, Buffer>();
    const locator = (identity: string) => {
      const bytes = Buffer.from(`Complete artificial ${identity}`);
      buffers.set(identity, bytes);
      return { identity, snapshot: "snapshot", objectKey: identity, sha256: createHash("sha256").update(bytes).digest("hex"),
        byteCount: bytes.length, sourceUrl: "https://lex.uz/docs/123#456", privacyClass: "public_official_source" as const,
        quarantined: false, canonicalizationConflict: false, temporalState: "current_supported" as const, currentPointerVerified: true };
    };
    const result = await runLegalAnswer({ question: "Artificial rule and exception?", language: "en", format: "detailed", mode: "fast",
      submittedAt: Date.now(), deadlineMs: 30_000, actor: { tenantId: "a", userId: "b" }, history: [], privateDocuments: [] }, {
      model: { async complete({ stage, input }) {
        if (stage === "interpret") return { needsClarification: false, complexity: "difficult",
          requirements: [{ id: "rule", question: "Rule and exception?" }], queries: ["first", "second"],
          scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
        assert.equal(stage, "write");
        const packet = input as { evidence: OfficialProvision[]; researchFailures: { code: string }[] };
        assert.deepEqual(packet.evidence.filter(item => item.identity.startsWith("primary")).map(item => item.identity).sort(), [...primary].sort());
        assert.equal(adjacentCalls.length, 0);
        assert.equal(new Set(packet.evidence.map(item => item.identity)).size, packet.evidence.length);
        if (scenario === "normal") assert.equal(packet.evidence.length, primaryCount);
        assert.ok(!JSON.stringify(packet).includes("artificial-secret"));
        // Adjacency never proves material support by itself.
        assessments++;
        return { decision: scenario === "recovery" && assessments === 1 ? "research" : "insufficient_evidence",
          content: null, actions: scenario === "recovery" && assessments === 1
          ? ["recover:first", "recover:second", "recover:third"].map(query => ({ requirementId: "rule", query })) : [],
          gaps: [{ requirementId: "rule", description: "Support remains unverified." }] };
      } },
      corpus: { async search(query) { return { candidates: query.startsWith("recover:")
        ? Array.from({ length: 12 }, (_, index) => `${query}:${index}`)
        : primary,
        sparseAvailable: true, denseAvailable: true }; },
        async resolve(identity) { await new Promise(resolve => setTimeout(resolve, 1));
          if (identity.startsWith("recover:")) recoveryReads++; else completed.add(identity);
          return locator(identity); },
        async resolveAdjacent(identity, direction, scope) {
          assert.equal(completed.size, primaryCount);
          assert.ok(primary.includes(identity), "no recursive expansion");
          assert.deepEqual(scope, { kind: "current" });
          adjacentCalls.push(`${identity}:${direction}`);
          if (scenario === "recovery") throw new Error("artificial-secret");
          return locator(direction === "previous" ? primary[0] : `adjacent:${identity}`);
        }, async get(key) { return buffers.get(key) ?? null; } },
      publication: { async publish({ outcome }) { return { answerId: "saved", outcome }; } },
    });
    assert.equal(result.outcome.kind, "insufficient_evidence");
    if (scenario === "recovery") {
      assert.equal(assessments, 2);
      assert.equal(recoveryReads, 36, "the shared 48-read limit reserves room for targeted research");
    }
  }
});
