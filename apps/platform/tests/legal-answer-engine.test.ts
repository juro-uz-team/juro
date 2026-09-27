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

test("partial answers identify incomplete reviewed issues and source coverage without publishing audit prose", async () => {
  const outcome = await answerFromEvidence(question, {
    write: async () => draft,
    verify: async () => ({...approval, complete:false,
      coverage:[{...approval.coverage[0],gaps:["INTERNAL: additional qualification missing"]}],
      sourceGaps:[{sourceId:"official-fixture",passages:[{id:"p0",missingContent:["INTERNAL: source rule missing"]}]}],
    }),
  }, {correction:"never"});
  assert.equal(outcome.kind,"partial");
  assert.ok(outcome.result.coverageGaps?.includes('Coverage remains incomplete for this issue: “Filing period”.'));
  assert.ok(outcome.result.coverageGaps?.includes('The answer does not fully cover the relevant rules in this official source: “Synthetic fixture”.'));
  assert.ok(!JSON.stringify(outcome.result).includes("INTERNAL:"));
  assert.deepEqual(outcome.result.confirmedFindings,draft.findings);
  assert.deepEqual(outcome.result.actionPlan,draft.actions);
});

test("coverage limitations never repeat rejected issue titles or invent a source label", async () => {
  const candidate = {...draft,findings:[...draft.findings,
    {title:"UNSUPPORTED entitlement",explanation:"An unsupported rule.",sourceIds:["official-fixture"]}]};
  const outcome = await answerFromEvidence(question, {
    write:async()=>candidate,
    verify:async()=>({...approval,complete:false,
      claims:[...approval.claims,{id:"finding:1",supported:false,reason:"Rejected assertion"}],
      coverage:[...approval.coverage,{issue:"INTERNAL issue",findingIds:["finding:1"],actionIds:[],gaps:["INTERNAL gap"]}],
      sourceGaps:[{sourceId:"unknown-source",passages:[{id:"p0",missingContent:["INTERNAL source gap"]}]}],
    }),
  },{correction:"never"});
  assert.equal(outcome.kind,"partial");
  assert.ok(!JSON.stringify(outcome.result).includes("UNSUPPORTED"));
  assert.ok(!JSON.stringify(outcome.result).includes("INTERNAL"));
  assert.ok(!JSON.stringify(outcome.result).includes("unknown-source"));
  assert.ok(outcome.result.coverageGaps?.length);
});

test("missing practical coverage is identified in the answer language even without free-text audit gaps", async () => {
  for (const [locale,expected] of [
    ["en",'Coverage remains incomplete for this issue: “Filing period”.'],
    ["ru",'Этот вопрос освещен не полностью: «Filing period».'],
    ["uz",'Bu masala to‘liq yoritilmagan: «Filing period».'],
  ] as const) {
    const outcome = await answerFromEvidence({...question,locale},{
      write:async()=>draft,
      verify:async()=>({...approval,coverage:[{...approval.coverage[0],actionIds:[]}]}),
    },{correction:"never"});
    assert.equal(outcome.kind,"partial");
    assert.ok(outcome.result.coverageGaps?.includes(expected),locale);
  }
});

test("citations preserve the source language independently of the answer language", async () => {
  for (const [locale, language] of [["ru", "ru"], ["uz", "uz-Latn"], ["uzc", "uz-Cyrl"], ["en", "en"], ["uz-Cyrl", "uz-Cyrl"], ["unknown", undefined]]) {
    const evidence = question.evidence.map(item => ({...item, source: {...item.source, locale: locale!}}));
    const outcome = await answerFromEvidence({...question, evidence}, {write: async () => draft, verify: async () => approval});
    assert.equal(outcome.kind, "complete");
    assert.equal(outcome.result.sources[0]?.language, language, locale);
  }
});

test("same-section qualifications survive together and are withheld together when support is lost", async () => {
  const qualified = {...draft, findings: [...draft.findings,
    {title:"General rule", explanation:"The filing period applies subject to the following exception.",sourceIds:["official-fixture"]},
    {title:"Exception", explanation:"The exception limits the preceding rule.",sourceIds:["official-fixture"]}],
  };
  for (const failure of ["none", "rejected", "citation", "unknown", "cross-section", "self"] as const) {
    const candidate = failure === "citation" ? {...qualified, findings:qualified.findings.map((item,index)=>index===2?{...item,sourceIds:["invented"]}:item)} : qualified;
    const dependency = failure === "unknown" ? "finding:9" : failure === "cross-section" ? "action:0" : failure === "self" ? "finding:1" : "finding:2";
    const outcome = await answerFromEvidence(question, {
      write:async({correction})=>{if(correction)throw new Error("Correction unavailable");return candidate;},
      verify:async()=>({...approval,claims:[...approval.claims,
        {id:"finding:1",supported:true,reason:"Qualified general rule.",dependsOn:[dependency]},
        {id:"finding:2",supported:failure!=="rejected",reason:"Qualification reviewed.",dependsOn:[]}]}),
    });
    assert.equal(outcome.kind, failure === "none" ? "complete" : "partial", failure);
    assert.equal(outcome.result.confirmedFindings.some(item=>item.title==="General rule"),failure==="none",failure);
    assert.equal(outcome.result.confirmedFindings[0]?.title,"Filing period");
  }
});

test("losing a qualification removes transitive conclusions, including after correction reassessment", async () => {
  const initial = {...draft, findings:[...draft.findings,
    ...["Dependent conclusion", "Intermediate qualification", "Essential exception"].map(title=>({
      title,explanation:title,sourceIds:["official-fixture"],
    }))]};
  for (const reassessment of [false,true]) {
    let checks=0;
    const outcome=await answerFromEvidence(question,{
      write:async({correction})=>{
        if(correction && !reassessment)throw new Error("Correction unavailable");
        return correction ? draft : initial;
      },
      verify:async()=>++checks===1 ? {...approval,complete:false,gaps:["Review remaining material issue."],
        claims:[...approval.claims,
          {id:"finding:1",supported:true,reason:"Depends on qualification.",dependsOn:["finding:2"]},
          {id:"finding:2",supported:true,reason:"Depends on exception.",dependsOn:["finding:3"]},
          {id:"finding:3",supported:reassessment,reason:"Exception reviewed.",dependsOn:[]}],
      } : {...approval,retention:[{priorId:"finding:3",priorSupported:false,currentIds:[]}]},
    });
    assert.equal(outcome.kind,reassessment?"complete":"partial");
    assert.deepEqual(outcome.result.confirmedFindings.map(item=>item.title),["Filing period"]);
    assert.equal(outcome.errorCode,reassessment?undefined:"ANSWER_CORRECTION_UNAVAILABLE");
  }
});

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

test("a rejected conclusion cannot return through prior approval after a useful repair", async () => {
  let writes = 0, checks = 0;
  const corrected = {...draft, mainPoint:{...draft.mainPoint,text:"An unsupported replacement conclusion."},
    findings:[...draft.findings,{title:"Repaired explanation",explanation:"The applicant files the notice.",sourceIds:["official-fixture"]}]};
  const outcome = await answerFromEvidence(question, {
    write:async()=>++writes===1?draft:corrected,
    verify:async()=>++checks===1?{...approval,complete:false,gaps:["Explain the actor."]}:
      {...approval,complete:false,claims:[...approval.claims.map(claim=>claim.id==="mainPoint"?{...claim,supported:false}:claim),
        {id:"finding:1",supported:true,reason:"The source identifies the applicant."}],
        retention:[{priorId:"mainPoint",priorSupported:true,currentIds:[]}]},
  });
  assert.equal(writes,2);
  assert.equal(checks,2);
  assert.equal(outcome.kind,"partial");
  assert.notEqual(outcome.result.summary,draft.mainPoint.text);
  assert.doesNotMatch(outcome.result.summary,/unsupported replacement/);
  assert.equal(outcome.result.confirmedFindings.length,2);
});

test("an action cannot survive rejection of its bound qualified rule", async () => {
  const grouped = {...draft,ruleBindings:[{findingId:"finding:0",actionIds:["action:0"]}],
    findings:[...draft.findings,{title:"Independent information",explanation:"The source describes a notice.",sourceIds:["official-fixture"]}]};
  const outcome = await answerFromEvidence(question, {
    write:async()=>grouped,
    verify:async()=>({...approval,complete:false,claims:[...approval.claims.map(claim=>claim.id==="finding:0"?{...claim,supported:false}:claim),
      {id:"finding:1",supported:true,reason:"Independent explanation."}]}),
  });
  assert.equal(outcome.kind,"partial");
  assert.deepEqual(outcome.result.actionPlan,[]);
  assert.equal(outcome.result.confirmedFindings[0]?.title,"Independent information");
});

test("a purely explanatory issue does not require inventing an action", async () => {
  const outcome = await answerFromEvidence(question, {
    write:async()=>({...draft,actions:[]}),
    verify:async()=>({...approval,claims:approval.claims.slice(0,2),coverage:[{
      issue:"Explanation",findingIds:["finding:0"],actionIds:[],actionRequired:false,gaps:[],
    }]}),
  });
  assert.equal(outcome.kind,"complete");
  assert.deepEqual(outcome.result.actionPlan,[]);
});

test("source-audit omissions reach correction without publishing their unverified legal premises", async () => {
  let corrections=0;
  const sourceGaps=[{sourceId:"official-fixture",passages:[{id:"p0",missingContent:["An invented twenty percent penalty is missing."]}]}];
  const outcome=await answerFromEvidence(question,{
    write:async({correction})=>{
      if(correction){corrections++;assert.deepEqual(correction.verification.sourceGaps,sourceGaps);}
      return draft;
    },
    verify:async()=>({...approval,sourceGaps}),
  });
  assert.equal(corrections,1);
  assert.equal(outcome.kind,"partial");
  assert.ok(outcome.result.coverageGaps!.length>0);
  assert.ok(!JSON.stringify(outcome.result).includes("twenty percent"));
});

test("an approving verifier cannot authorize invented or missing citations", async () => {
  for (const sourceIds of [["invented"], []]) {
    const forged = { ...draft, mainPoint: { ...draft.mainPoint, sourceIds },
      findings: draft.findings.map(item => ({ ...item, sourceIds })),
      actions: draft.actions.map(item => ({ ...item, sourceIds })),
    };
    const outcome = await answerFromEvidence(question, { write: async () => forged, verify: async () => approval });
    assert.equal(outcome.kind, "insufficient_evidence");
    assert.deepEqual(outcome.result.confirmedFindings, []);
    assert.deepEqual(outcome.result.actionPlan, []);
    assert.deepEqual(outcome.result.sources, []);
    assert.notEqual(outcome.result.summary, draft.mainPoint.text);
  }
});

test("complete evidence up to the context limit reaches generation unchanged and larger inputs are refused", async () => {
  for (const size of [48_000, 64_000, 64_001]) {
    const text = provision.padEnd(size, " ");
    const evidence = { ...question.evidence[0]!, text, textSha256: createHash("sha256").update(text).digest("hex") };
    let writes = 0;
    const outcome = await answerFromEvidence({ ...question, evidence: [evidence] }, {
      write: async ({ question: received }) => {
        writes++;
        assert.equal(received.evidence[0]?.text, text);
        return draft;
      },
      verify: async () => approval,
    });
    assert.equal(outcome.kind, size <= 64_000 ? "complete" : "unavailable");
    assert.equal(writes, size <= 64_000 ? 1 : 0);
  }
});

test("invalid identities, nonofficial content and mismatched evidence cannot enter legal generation", async () => {
  const first = question.evidence[0]!;
  const invalidEvidence: AnswerQuestion["evidence"][] = [
    [first, {...first}],
    [{ ...first, text: `${first.text} Injected material.` }],
    [{ ...first, source: { ...first.source, sourceClass: "USER_TRUSTED_PRIVATE" } }],
    [{ ...first, source: { ...first.source, sourceClass: "SECONDARY_REFERENCE" } }],
    [{ ...first, endpoint: { kind: "timestamp", instant: "2020-01-01T00:00:00.000Z" } }],
  ];
  for (const evidence of invalidEvidence) {
    let writes = 0;
    let checks = 0;
    const outcome = await answerFromEvidence({ ...question, evidence }, {
      write: async () => {writes++; return draft;},
      verify: async () => {checks++; return approval;},
    });
    assert.equal(outcome.kind, "unavailable");
    assert.equal(writes, 0);
    assert.equal(checks, 0);
    assert.deepEqual(outcome.result.confirmedFindings, []);
    assert.deepEqual(outcome.result.actionPlan, []);
    assert.deepEqual(outcome.result.sources, []);
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

test("a correction reports lost issues without restoring an earlier whole answer", async () => {
  const initial={...draft,findings:[...draft.findings,{title:"Separate issue",explanation:"The notice must be filed.",sourceIds:["official-fixture"]}]};
  let writes=0,checks=0;
  const outcome=await answerFromEvidence(question,{write:async()=>++writes===1?initial:draft,
    verify:async()=>++checks===1?{...approval,complete:false,gaps:["A question remains"],
      claims:[...approval.claims,{id:"finding:1",supported:true,reason:"The text supports filing"}]}:
      {...approval,complete:false,gaps:["A supported issue was lost"],retention:[]}});
  assert.equal(outcome.kind,"partial");
  assert.equal(outcome.result.confirmedFindings.length,1);
});

test("a supported correction can complete the answer while retaining its verified findings", async () => {
  let writes=0,checks=0;
  const outcome=await answerFromEvidence(question,{write:async()=>++writes===1?{...draft,actions:[]}:draft,
    verify:async()=>++checks===1?{...approval,complete:false,gaps:["The practical action is missing"],claims:approval.claims.slice(0,2)}:
      {...approval,retention:[{priorId:"mainPoint",priorSupported:true,currentIds:["mainPoint"]},{priorId:"finding:0",priorSupported:true,currentIds:["finding:0"]}]}});
  assert.equal(outcome.kind,"complete");
  assert.equal(outcome.result.actionPlan.length,1);
});

test("a later rejection of an original claim prevents restoring it after correction loses another issue", async () => {
  const initial = { ...draft, actions: [{ ...draft.actions[0]!, description: "File within eleven days after delivery." }] };
  let writes = 0;
  let checks = 0;
  const outcome = await answerFromEvidence(question, {
    write: async () => ++writes === 1 ? initial : { ...draft, findings: [] },
    verify: async () => ++checks === 1
      ? { ...approval, complete: false, gaps: ["Another material issue needs correction."] }
      : { ...approval, complete: false, gaps: ["The corrected draft lost the legal explanation."],
          claims: approval.claims.filter(claim => claim.id !== "finding:0"),
          retention: [
            { priorId: "mainPoint", priorSupported: true, currentIds: ["mainPoint"] },
            { priorId: "finding:0", priorSupported: true, currentIds: [] },
            { priorId: "action:0", priorSupported: false, currentIds: [] },
          ],
        },
  });
  assert.equal(outcome.kind, "insufficient_evidence");
  assert.equal(outcome.result.confirmedFindings.length, 0);
  assert.deepEqual(outcome.result.actionPlan, []);
  assert.doesNotMatch(JSON.stringify(outcome.result), /eleven/);
});

test("a supported correction can replace a claim the later verifier discovers was wrongly approved", async () => {
  let writes = 0;
  let checks = 0;
  const outcome = await answerFromEvidence(question, {
    write: async () => ++writes === 1
      ? { ...draft, actions: [{ ...draft.actions[0]!, description: "File within eleven days after delivery." }] }
      : draft,
    verify: async () => ++checks === 1
      ? { ...approval, complete: false, gaps: ["Check the practical deadline."] }
      : { ...approval, retention: [
          { priorId: "mainPoint", priorSupported: true, currentIds: ["mainPoint"] },
          { priorId: "finding:0", priorSupported: true, currentIds: ["finding:0"] },
          { priorId: "action:0", priorSupported: false, currentIds: [] },
        ] },
  });
  assert.equal(outcome.kind, "complete");
  assert.equal(outcome.result.actionPlan[0]?.description, draft.actions[0]!.description);
  assert.doesNotMatch(JSON.stringify(outcome.result), /eleven/);
});
