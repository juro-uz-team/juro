import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import type { LegalRequest, WorkflowPorts } from "../lib/legal-answer-workflow/contracts";
import { runCompleteReadFixture as runLegalAnswer } from "./helpers/complete-read-agent";

const request = (): LegalRequest => ({ question: "Explain the artificial permit requirement.",
  language: "en", format: "detailed", mode: "deep", submittedAt: Date.now(), deadlineMs: 30_000,
  actor: { tenantId: "tenant", userId: "user" }, history: [], privateDocuments: [] });
const interpretation = { needsClarification: false, complexity: "difficult", requirements: [{ id: "permit", question: "When is a permit required?" }],
  queries: ["permit"], scopes: [{ kind: "current" }], facts: [], clarificationQuestions: [] };
const gap = { requirementId: "permit", description: "The governing permit rule is missing." };
const bytes = Buffer.from("Artificial rule: a permit is required for a public event.");
const content = { summary: "A public event needs a permit.", summarySourceIds: ["rule"],
  issues: [{ title: "Permit", explanation: bytes.toString(), sourceIds: ["rule"], requirementIds: ["permit"], actions: [] }],
  conditionalBranches: [], assumptions: [], risks: [], deadlines: [], requiredDocuments: [],
  referenceNotes: [], clarificationQuestions: [], urgency: "normal" };

test("unavailable corpus reads permit bounded research then explicit insufficient evidence", async () => {
  let assessments = 0, reads = 0;
  const queries: string[] = [];
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      assert.equal(stage, "write", "Missing law must never reach the writer");
      assert.match(JSON.stringify(input), /OFFICIAL_PROVISION_NOT_FOUND/);
      return researchTurn([gap], ++assessments === 1
        ? [{ requirementId: "permit", query: "alternative permit authority" }] : []);
    } },
    corpus: {
      search: async query => { queries.push(query); return { candidates: [query], sparseAvailable: true, denseAvailable: true }; },
      resolve: async () => { reads++; throw new Error("OFFICIAL_PROVISION_NOT_FOUND"); },
      get: async () => { throw new Error("Missing provisions must not supply evidence bytes"); },
    }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(assessments, 2, "The agent receives failed-read results and then ends research explicitly");
  assert.equal(reads, 2);
  assert.deepEqual(queries, ["permit", "alternative permit authority"]);
});

test("recovery reads overlap within one query and share a three-read bound across queries", async () => {
  for (const queries of [["exception"], ["exception", "procedure", "remedy"]]) {
    let active = 0, peak = 0, completed = 0, assessments = 0;
    await runLegalAnswer(request(), {
      model: { complete: async ({ stage }) => {
        if (stage === "interpret") return interpretation;
        assert.equal(stage, "write");
        return researchTurn([gap], ++assessments === 1
          ? queries.map(query => ({ requirementId: "permit", query })) : []);
      } },
      corpus: {
        search: async query => ({ candidates: query === "permit" ? [] : Array.from({ length: 5 }, (_, i) => `${query}-${i}`),
          sparseAvailable: true, denseAvailable: true }),
        resolve: async identity => {
          active++; peak = Math.max(peak, active);
          return { identity, snapshot: "revision", objectKey: identity,
            sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
            sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
            canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" };
        }, get: async () => { await new Promise(resolve => setTimeout(resolve, 20)); active--; completed++; return bytes; },
      }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
    });
    assert.equal(peak, 3);
    assert.equal(completed, queries.length * 5);
    assert.equal(active, 0);
    assert.equal(assessments, 2);
  }
});

test("search completion alone does not read evidence before the agent selects it", async () => {
  let readCompleted = false, readBeforeSlowSearch = false;
  let releaseSearch!: () => void;
  const firstRead = new Promise<void>(resolve => { releaseSearch = resolve; });
  await runLegalAnswer(request(), {
    model: { complete: async ({ stage }) => stage === "interpret"
      ? { ...interpretation, queries: ["prompt", "slow"] }
      : researchTurn([gap], []) },
    corpus: {
      search: async query => {
        if (query === "slow") {
          await Promise.race([firstRead, new Promise(resolve => setTimeout(resolve, 200))]);
          readBeforeSlowSearch = readCompleted;
        }
        return { candidates: query === "prompt" ? ["rule"] : [], sparseAvailable: true, denseAvailable: true };
      },
      resolve: async identity => ({ identity, snapshot: "revision", objectKey: "object",
        sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
        sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" }),
      get: async () => { readCompleted = true; releaseSearch(); return bytes; },
    }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(readBeforeSlowSearch, false);
  assert.equal(readCompleted, true);
});

test("cancellation stops queued recovery reads from opening further sources", async () => {
  const controller = new AbortController();
  let assessments = 0, started = 0;
  await assert.rejects(() => runLegalAnswer({ ...request(), signal: controller.signal }, {
    model: { complete: async ({ stage }) => {
      if (stage === "interpret") return interpretation;
      assessments++;
      return researchTurn([gap], [{ requirementId: "permit", query: "exception" }]);
    } },
    corpus: {
      search: async query => ({ candidates: query === "permit" ? [] : Array.from({ length: 8 }, (_, i) => `rule-${i}`),
        sparseAvailable: true, denseAvailable: true }),
      resolve: async (_identity, _scope, signal) => {
        started++;
        return new Promise<null>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          if (started === 3) controller.abort(new Error("ARTIFICIAL_READ_CANCELLED"));
        });
      }, get: async () => { throw new Error("Cancelled sources must not be read"); },
    }, publication: { publish: async () => { throw new Error("Cancelled requests must not publish"); } },
  }), /ARTIFICIAL_READ_CANCELLED/);
  assert.equal(started, 3);
  assert.equal(assessments, 1);
});

test("material operative-reference recovery reads the linked rule before writing and rejects invented links", async () => {
  for (const forged of [false, true]) {
    let references = 0, searches = 0, assessments = 0;
    const target = "https://lex.uz/docs/456#11";
    const linkedBytes = Buffer.from("Artificial exception: private gatherings do not need a permit.");
    const locator = (identity: string, objectKey: string, value: Buffer) => ({ identity, snapshot: "revision", objectKey,
      sha256: createHash("sha256").update(value).digest("hex"), byteCount: value.length,
      sourceUrl: identity === "rule" ? "https://lex.uz/docs/123" : target,
      privacyClass: "public_official_source" as const, quarantined: false, canonicalizationConflict: false,
      currentPointerVerified: true, temporalState: "current_supported" as const });
    const pending = runLegalAnswer(request(), {
      model: { complete: async ({ stage, input }) => {
        if (stage === "interpret") return interpretation;
        if (++assessments === 1) return researchTurn([gap], [{ requirementId: "permit", sourceId: "rule", url: forged ? "https://lex.uz/docs/789" : target }]);
        if (forged && assessments === 2) {
          assert.equal(references, 0);
          assert.match(JSON.stringify(input), /RECOVERY_REFERENCE_INVALID/);
          return researchTurn([gap], [{ requirementId: "permit", sourceId: "rule", url: target }]);
        }
        assert.equal(references, 1);
        return { decision: "answer", gaps: [], actions: [], content: { ...content, summary: "A public event needs a permit; private gatherings are exempt.",
          summarySourceIds: ["rule", "exception"], issues: content.issues.map(issue => ({ ...issue,
            explanation: `${bytes.toString()} ${linkedBytes.toString()}`, sourceIds: ["rule", "exception"] })) } };
      } },
      corpus: {
        search: async () => { searches++; return { candidates: ["candidate"], sparseAvailable: true, denseAvailable: true }; },
        resolve: async () => ({ ...locator("rule", "base", bytes), operativeReferences: [{ url: target, text: "Exceptions" }] }),
        resolveReference: async (sourceId, url, scope) => {
          references++; assert.equal(sourceId, "rule"); assert.equal(url, target); assert.deepEqual(scope, { kind: "current" });
          return locator("exception", "linked", linkedBytes);
        }, get: async key => key === "base" ? bytes : linkedBytes,
      }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
    });
    assert.equal((await pending).outcome.kind, "answer");
    assert.equal(references, 1); assert.equal(assessments, forged ? 3 : 2);
    assert.equal(searches, 1);
  }
});

test("explicit fixture selection retains all complete reads across initial and follow-up searches", async () => {
  const resolved: string[] = [];
  let assessments = 0;
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return { ...interpretation, queries: ["one", "two", "three", "four"] };
      assert.equal(stage, "write");
      assessments++;
      const packet = input as { researchLimits: { omittedCandidates: number }[] };
      assert.deepEqual(packet.researchLimits, []);
      if (assessments === 1) {
        assert.equal(resolved.length, 200);
        return researchTurn([gap], [{ requirementId: "permit", query: "recovery" }]);
      }
      return researchTurn([gap], []);
    } },
    corpus: {
      search: async query => ({ candidates: Array.from({ length: 50 }, (_, i) => `${query}-${i}`), sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => {
        resolved.push(identity);
        return { identity, snapshot: "revision", objectKey: "object",
          sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
          sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
          canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" };
      }, get: async () => bytes,
    }, publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "insufficient_evidence");
  assert.equal(resolved.length, 250);
  assert.equal(resolved.filter(id => id.startsWith("recovery-")).length, 50);
});

test("an unreadable candidate remains an explicit research gap while other candidates are read", async () => {
  const resolved: string[] = [];
  let assessed = false;
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage, input }) => {
      if (stage === "interpret") return interpretation;
      assert.equal(stage, "write");
      assessed = true;
      const packet = input as { researchFailures: unknown[]; evidence: { identity: string }[] };
      assert.deepEqual(packet.researchFailures, [{ candidate: "broken", scope: { kind: "current" }, code: "OFFICIAL_READ_UNAVAILABLE" }]);
      assert.deepEqual(packet.evidence.map(item => item.identity), ["rule"]);
      return researchTurn([gap], []);
    } },
    corpus: {
      search: async () => ({ candidates: ["broken", "readable"], sparseAvailable: true, denseAvailable: true }),
      resolve: async identity => {
        resolved.push(identity);
        if (identity === "broken") throw new Error("private transport diagnostics must not reach the model");
        return { identity: "rule", snapshot: "revision", objectKey: "object",
          sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
          sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
          canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" };
      }, get: async () => bytes,
    },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(assessed, true);
  assert.deepEqual(resolved, ["broken", "readable"]);
  assert.equal(result.outcome.kind, "insufficient_evidence");
});

test("targeted recovery obtains missing material law before writing", async () => {
  const searches: string[] = [];
  let assessments = 0;
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage }) => {
      if (stage === "interpret") return interpretation;
      return ++assessments === 1
        ? researchTurn([gap], [{ requirementId: "permit", query: "public event authorization" }])
        : { decision: "answer", content, gaps: [], actions: [] };
    } },
    corpus: {
      search: async (query) => { searches.push(query); return {
        candidates: query === "permit" ? [] : ["candidate"], sparseAvailable: true, denseAvailable: true,
      }; },
      resolve: async () => ({ identity: "rule", snapshot: "revision", objectKey: "object",
        sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
        sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source", quarantined: false,
        canonicalizationConflict: false, currentPointerVerified: true, temporalState: "current_supported" }),
      get: async () => bytes,
    },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.deepEqual(searches, ["permit", "public event authorization"]);
});

test("equivalent recovery searches stop honestly without asserting corpus absence", async () => {
  const searches: string[] = [];
  const ports: WorkflowPorts = {
    model: { complete: async ({ stage }) => stage === "interpret" ? interpretation : researchTurn([gap], [{ requirementId: "permit", query: "  PERMIT  " }]) },
    corpus: { search: async query => { searches.push(query); return {
      candidates: [], sparseAvailable: true, denseAvailable: true,
    }; }, resolve: async () => null, get: async () => null },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  };
  const result = await runLegalAnswer(request(), ports);
  assert.equal(result.outcome.kind, "insufficient_evidence");
  if (result.outcome.kind === "insufficient_evidence") {
    assert.equal(result.outcome.researchIncomplete, true);
    assert.deepEqual(result.outcome.gaps.map(item => item.requirementId), [gap.requirementId]);
    assert.match(result.outcome.gaps[0].description, /research could not finish/);
  }
  assert.deepEqual(searches, ["permit"]);
});

test("independent searches overlap within a bounded concurrency limit", async () => {
  let active = 0;
  let peak = 0;
  const queries = ["permit", "notice", "authority", "exception", "procedure", "remedy"];
  await runLegalAnswer(request(), {
    model: { complete: async ({ stage }) => stage === "interpret" ? { ...interpretation, queries } : researchTurn([gap], []) },
    corpus: {
      search: async () => {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 20));
        active--;
        return { candidates: [], sparseAvailable: true, denseAvailable: true };
      }, resolve: async () => null, get: async () => null,
    },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.ok(peak > 1 && peak <= 3, `Expected bounded overlapping searches, observed ${peak}`);
});

test("overlapping searches share candidate resolution and verified object reads", async () => {
  let resolutions = 0;
  let reads = 0;
  const result = await runLegalAnswer(request(), {
    model: { complete: async ({ stage }) => stage === "interpret"
      ? { ...interpretation, queries: ["permit", "authorization", "public event"] }
      : { decision: "answer", content, gaps: [], actions: [] } },
    corpus: {
      search: async () => ({ candidates: ["candidate", "candidate"], sparseAvailable: true, denseAvailable: true }),
      resolve: async () => {
        resolutions++;
        await new Promise(resolve => setTimeout(resolve, 10));
        return { identity: "rule", snapshot: "revision", objectKey: "object",
          sha256: createHash("sha256").update(bytes).digest("hex"), byteCount: bytes.length,
          sourceUrl: "https://lex.uz/docs/123", privacyClass: "public_official_source",
          quarantined: false, canonicalizationConflict: false,
          currentPointerVerified: true, temporalState: "current_supported" };
      },
      get: async () => { reads++; return bytes; },
    },
    publication: { publish: async ({ outcome }) => ({ answerId: "saved", outcome }) },
  });
  assert.equal(result.outcome.kind, "answer");
  assert.equal(resolutions, 1);
  assert.equal(reads, 1);
});

function researchTurn(gaps: { requirementId: string; description: string }[], actions: unknown[]) {
  return { decision: actions.length ? "research" : "insufficient_evidence", content: null, gaps, actions };
}
