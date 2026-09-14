import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { answerFromEvidence, type AnswerQuestion } from "../lib/legal-chat/answer-engine";

const provision = "Synthetic fixture: an applicant must file the notice within ten days after delivery.";
const question: AnswerQuestion = {
  question: "When should I file the notice?", locale: "en", mode: "fast", answerMode: "detailed",
  temporalScope: { kind: "current" }, unresolved: [], evidence: [{
    source: {
      id: "official-fixture", actTitle: "Synthetic fixture", actIdentifier: null,
      officialUrl: "https://lex.uz/docs/999999", revisionDate: "2026-09-14", lastCheckedAt: "2026-09-14",
      locale: "en", publishedAt: null, sourceType: "lex", status: "current", verificationState: "verified",
      verifiedAt: "2026-09-14", contentSha256: "a".repeat(64), article: "1", sourceClass: "OFFICIAL_LEGISLATION",
    }, text: provision, textSha256: createHash("sha256").update(provision).digest("hex"),
    endpoint: { kind: "current" }, origin: "indexed",
  }],
};
const draft = {
  mainPoint: { text: "File within ten days after delivery.", sourceIds: ["official-fixture"] },
  findings: [{ title: "Filing period", explanation: "The period is ten days after delivery.", sourceIds: ["official-fixture"] }],
  actions: [{ title: "File the notice", description: "Record the delivery date and file within ten days after it.", sourceIds: ["official-fixture"] }],
  risks: [], questions: [], unresolved: [],
};
const approval = {
  retention: [],
  coverage: [{issue: "Filing deadline", findingIds: ["finding:0"], actionIds: ["action:0"], gaps: []}],
  claims: ["mainPoint", "finding:0", "action:0"].map(id => ({ id, supported: true, reason: "The complete fixture supports this claim." })),
  complete: true, gaps: [], questions: [],
};

test("no official evidence yields a non-answer without invoking a writer or inventing law", async () => {
  const result = await answerFromEvidence({
    question: "Which deadline applies?", locale: "en", mode: "fast", answerMode: "detailed",
    temporalScope: { kind: "current" }, evidence: [], unresolved: ["The governing provision is missing."],
  }, {
    write: async () => { throw new Error("No evidence must not be sent for legal writing"); },
    verify: async () => { throw new Error("There is no draft to verify"); },
  });
  assert.equal(result.kind, "insufficient_evidence");
  assert.equal(result.result.responseKind, "clarification_required");
  assert.deepEqual(result.result.confirmedFindings, []);
  assert.deepEqual(result.result.deadlines, []);
  assert.deepEqual(result.result.coverageGaps, ["The governing provision is missing."]);
});

test("a verifier's completeness flag cannot replace issue-level legal and practical coverage", async () => {
  for (const coverage of [[], [{issue:"Filing deadline",findingIds:["finding:0"],actionIds:[],gaps:[]}],
    [{issue:"Filing deadline",findingIds:["finding:0"],actionIds:["action:invented"],gaps:[]}]]) {
    const outcome = await answerFromEvidence(question, {write:async()=>draft, verify:async()=>({...approval,coverage})});
    assert.equal(outcome.kind, "partial");
    assert.ok(outcome.result.coverageGaps!.length > 0);
  }
});

test("a whole answer is published only after independent verification and uses server-owned citations", async () => {
  const outcome = await answerFromEvidence(question, { write: async () => draft, verify: async () => approval });
  assert.equal(outcome.kind, "complete");
  assert.equal(outcome.result.summary, draft.mainPoint.text);
  assert.equal(outcome.result.confirmedFindings[0]?.explanation, draft.findings[0]?.explanation);
  assert.equal(outcome.result.actionPlan[0]?.description, draft.actions[0]?.description);
  assert.equal(outcome.result.sources[0]?.originalUrl, "https://lex.uz/docs/999999");
});

test("an approving verifier cannot authorize an invented citation identity", async () => {
  const forged = { ...draft, mainPoint: { ...draft.mainPoint, sourceIds: ["invented"] },
    findings: draft.findings.map(item => ({ ...item, sourceIds: ["invented"] })),
    actions: draft.actions.map(item => ({ ...item, sourceIds: ["invented"] })),
  };
  const outcome = await answerFromEvidence(question, { write: async () => forged, verify: async () => approval });
  assert.equal(outcome.kind, "insufficient_evidence");
  assert.deepEqual(outcome.result.confirmedFindings, []);
  assert.deepEqual(outcome.result.actionPlan, []);
  assert.deepEqual(outcome.result.sources, []);
});

test("corrupted, private or temporally mismatched evidence cannot enter legal generation", async () => {
  const first = question.evidence[0]!;
  for (const evidence of [
    { ...first, text: `${first.text} Injected material.` },
    { ...first, source: { ...first.source, sourceClass: "USER_TRUSTED_PRIVATE" as const } },
    { ...first, endpoint: { kind: "timestamp" as const, instant: "2020-01-01T00:00:00.000Z" } },
  ]) {
    const outcome = await answerFromEvidence({ ...question, evidence: [evidence] }, {
      write: async () => assert.fail("Invalid evidence must not reach a writer"), verify: async () => approval,
    });
    assert.equal(outcome.kind, "unavailable");
    assert.deepEqual(outcome.result.confirmedFindings, []);
  }
});

test("one focused correction is independently checked and unsupported residue is withheld", async () => {
  let writes = 0;
  let checks = 0;
  const unsupported = { ...draft, actions: [{ ...draft.actions[0]!, description: "File within eleven days." }] };
  const outcome = await answerFromEvidence(question, {
    write: async () => { writes++; return unsupported; },
    verify: async () => { checks++; return { ...approval, complete: false,
      claims: approval.claims.map(item => item.id === "action:0" ? { ...item, supported: false, reason: "Eleven days contradicts the ten-day provision." } : item),
      gaps: ["The filing instruction needs the supported ten-day period."],
    }; },
  });
  assert.equal(writes, 2);
  assert.equal(checks, 2);
  assert.equal(outcome.kind, "partial");
  assert.equal(outcome.result.confirmedFindings.length, 1);
  assert.equal(outcome.result.actionPlan.length, 0);
  assert.ok(!JSON.stringify(outcome.result).includes("eleven"));
});

test("a correction-provider outage retains only the previously verified supported portion", async () => {
  let writes = 0;
  const outcome = await answerFromEvidence(question, {
    write: async () => { if (++writes > 1) throw new Error("Provider unavailable"); return draft; },
    verify: async () => ({ ...approval, complete: false, gaps: ["A material issue remains unresolved."] }),
  });
  assert.equal(outcome.kind, "partial");
  assert.equal(outcome.result.confirmedFindings.length, 1);
  assert.equal(outcome.result.coverageStatus, "partial_coverage");
});

test("cancellation during verification prevents publication of an approved answer", async () => {
  const controller = new AbortController();
  const outcome = await answerFromEvidence({ ...question, signal: controller.signal }, {
    write: async () => draft,
    verify: async () => { controller.abort(); return approval; },
  });
  assert.equal(outcome.kind, "unavailable");
  assert.equal(outcome.errorCode, "AI_CANCELLED");
  assert.deepEqual(outcome.result.confirmedFindings, []);
});

test("official Uzbek Cyrillic evidence can support an answer", async () => {
  const first = question.evidence[0]!;
  const outcome = await answerFromEvidence({ ...question, evidence: [{ ...first, source: {
    ...first.source, officialUrl: "https://lex.uz/uzc/docs/999999", locale: "uzc",
  } }] }, { write: async () => draft, verify: async () => approval });
  assert.equal(outcome.kind, "complete");
});

test("comparison cannot be complete when the answer cites only its current endpoint", async () => {
  const first = question.evidence[0]!;
  const historical = { kind: "timestamp" as const, instant: "2020-01-01T00:00:00.000Z" };
  const outcome = await answerFromEvidence({ ...question,
    temporalScope: { kind: "comparison", left: historical, right: {kind:"current"} },
    evidence: [first, { ...first, endpoint: historical, source: { ...first.source, id:"historical", status:"historical" } }],
  }, { write: async () => draft, verify: async () => approval });
  assert.equal(outcome.kind, "partial");
  assert.ok(outcome.result.coverageGaps!.length > 0);
});

test("an official-source outage is distinct from no evidence and cannot yield a complete answer", async () => {
  const model={write:async()=>draft,verify:async()=>approval};
  const unavailable=await answerFromEvidence({...question,evidence:[],sourceUnavailable:true},model);
  assert.equal(unavailable.kind,"unavailable");
  assert.equal(unavailable.result.failureReason,"official_research_unavailable");
  const partial=await answerFromEvidence({...question,sourceUnavailable:true},model);
  assert.equal(partial.kind,"partial");
  assert.equal(partial.result.confirmedFindings.length,1);
  assert.ok(partial.result.coverageGaps!.length>0);
});

test("rejected legal premises in questions and gap prose cannot escape verification", async () => {
  const unsafe={...draft,questions:["Have you paid the legally required 20% penalty?"],unresolved:["You must pay a 20% penalty."]};
  const outcome=await answerFromEvidence(question,{write:async()=>unsafe,verify:async()=>({...approval,complete:false,
    claims:[...approval.claims,{id:"question:0",supported:false,reason:"Invented legal premise"},{id:"gap:0",supported:false,reason:"Invented penalty"}],
    gaps:["The draft asserts an unsupported 20% penalty."],questions:["Have you paid that 20% penalty?"]})});
  assert.equal(outcome.kind,"partial");
  assert.ok(!JSON.stringify(outcome.result).includes("20%"));
});

test("a correction that loses supported issues preserves the earlier verified partial answer", async () => {
  const initial={...draft,findings:[...draft.findings,{title:"Separate issue",explanation:"The notice must be filed.",sourceIds:["official-fixture"]}]};
  let writes=0,checks=0;
  const outcome=await answerFromEvidence(question,{write:async()=>++writes===1?initial:draft,
    verify:async()=>++checks===1?{...approval,complete:false,gaps:["A question remains"],
      claims:[...approval.claims,{id:"finding:1",supported:true,reason:"The text supports filing"}]}:
      {...approval,complete:false,gaps:["A supported issue was lost"],retention:[]}});
  assert.equal(outcome.kind,"partial");
  assert.equal(outcome.result.confirmedFindings.length,2);
});

test("a supported correction can complete the answer while retaining its verified findings", async () => {
  let writes=0,checks=0;
  const outcome=await answerFromEvidence(question,{write:async()=>++writes===1?{...draft,actions:[]}:draft,
    verify:async()=>++checks===1?{...approval,complete:false,gaps:["The practical action is missing"],claims:approval.claims.slice(0,2)}:
      {...approval,retention:[{priorId:"mainPoint",currentIds:["mainPoint"]},{priorId:"finding:0",currentIds:["finding:0"]}]}});
  assert.equal(outcome.kind,"complete");
  assert.equal(outcome.result.actionPlan.length,1);
});
