import assert from "node:assert/strict";
import test from "node:test";
import { env } from "cloudflare:workers";
import { createLegalAnswerModel } from "../lib/legal-chat/answer-model";
import type { AnswerQuestion } from "../lib/legal-chat/answer-engine";
import { legalDraftSchema, legalVerificationSchema } from "../lib/legal-chat/answer-contract";

test("legal model transport pins each mode and keeps source locators out of provider context", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const sourceText=["Official provision", "", "A qualifying condition follows.",
    ...Array.from({length:161},(_,index)=>`Line ${index}.`)].join("\n");
  const payloads: Array<{model:string;input:string;reasoning:{effort:string};text:{format:{strict:boolean}}}> = [];
  context.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    payloads.push(body);
    return Response.json({ id: "response", model: body.model,
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        sourceReview: [{ sourceId: "source", passageIds: ["p0"], materialRules:["Official provision"] }],
        answer: {
        mainPoint: { text: "Supported result", sourceIds: ["source"] },
        issues: [{finding:{title:"Application",explanation:"A written application is required.",sourceIds:["source"]},
          actions:[{title:"Apply",description:"Submit the written application.",sourceIds:["source"]}]}],
        risks: [], questions: [], unresolved: [],
        },
      }) }] }], usage: { input_tokens: 12, output_tokens: 9 } });
  });
  const observations: unknown[] = [];
  const model = createLegalAnswerModel({ requestId: "request", onAttemptFinished: value => { observations.push(value); } });
  for (const mode of ["fast", "deep"] as const) {
    const question: AnswerQuestion = { question: "Question", locale: "en", mode, answerMode: "detailed",
      temporalScope: { kind: "current" }, unresolved: [], evidence: [{ source: {
        id: "source", actTitle: "Title", actIdentifier: null, officialUrl: "https://lex.uz/docs/123",
        revisionDate: null, lastCheckedAt: "2026-09-14", locale: "en", publishedAt: null,
        sourceType: "lex", status: "current", verificationState: "verified", verifiedAt: "2026-09-14",
        contentSha256: "server-only-parent-fingerprint",
      }, text: sourceText, textSha256: "server-only-text-fingerprint", endpoint: {kind: "current"}, origin: "indexed" }] };
    const draft = legalDraftSchema.parse(await model.write({ question, correction: null }));
    assert.equal(draft.mainPoint.text, "Supported result");
    assert.equal(draft.findings[0]?.explanation,"A written application is required.");
    assert.equal(draft.actions[0]?.description,"Submit the written application.");
    assert.ok(!("sourceReview" in draft));
  }
  assert.deepEqual(payloads.map(body => body.model), ["gpt-5.6-luna", "gpt-5.6-terra"]);
  assert.equal(observations.length, 2);
  for (const body of payloads) {
    assert.equal(body.text.format.strict, true);
    assert.equal(body.reasoning.effort,"max");
    assert.ok(!body.input.includes("fingerprint"));
    assert.ok(!body.input.includes("https://lex.uz"));
    assert.ok(body.input.includes("Official provision"));
    const input=JSON.parse(body.input);
    assert.ok(input.context.evidence[0].passages.length <=160);
    assert.equal(input.context.evidence[0].passages.map((passage:{text:string})=>passage.text).join("\n"),
      sourceText);
  }
});

test("a fabricated source passage is rejected before a draft can reach verification", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      sourceReview: [{sourceId:"source", passageIds:["p999"],materialRules:["A mandatory twenty percent penalty applies."]}],
      answer: {mainPoint:{text:"Pay the penalty",sourceIds:["source"]}, issues:[],risks:[],questions:[],unresolved:[]},
    }) }] }], usage: {input_tokens:10,output_tokens:10},
  }));
  const question: AnswerQuestion = {
    question:"What should I do?", locale:"en", mode:"fast", answerMode:"detailed", temporalScope:{kind:"current"}, unresolved:[],
    evidence:[{source:{id:"source",actTitle:"Official text",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
      revisionDate:null,lastCheckedAt:"2026-09-14",locale:"en",publishedAt:null,sourceType:"lex",status:"current",
      verificationState:"verified",verifiedAt:"2026-09-14",contentSha256:"parent"},
      text:"The person may request review.",textSha256:"text",endpoint:{kind:"current"},origin:"indexed"}],
  };
  await assert.rejects(createLegalAnswerModel({requestId:"forged-passage"}).write({question,correction:null}), /Invalid source passage/);
});

test("verification cannot discard a material omission found in its source audit", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id:"response",model:"gpt-5.6-luna",output:[{content:[{type:"output_text",text:JSON.stringify({
      sourceAudit:[{sourceId:"source",passages:[{id:"p0",material:true,missingContent:
        ["The required written application is missing.",...Array.from({length:10},(_,index)=>`Missing condition ${index}.`)]}]}],
      verification:{retention:[],coverage:[],claims:[],complete:true,gaps:Array.from({length:30},(_,index)=>`Cross-provision omission ${index}.`),questions:[]},
    })}]}],usage:{input_tokens:10,output_tokens:10},
  }));
  const question: AnswerQuestion = {
    question:"How do I request review?",locale:"en",mode:"fast",answerMode:"detailed",temporalScope:{kind:"current"},unresolved:[],
    evidence:[{source:{id:"source",actTitle:"Official text",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
      revisionDate:null,lastCheckedAt:"2026-09-14",locale:"en",publishedAt:null,sourceType:"lex",status:"current",
      verificationState:"verified",verifiedAt:"2026-09-14",contentSha256:"parent"},
      text:"Review requires a written application.",textSha256:"text",endpoint:{kind:"current"},origin:"indexed"}],
  };
  const draft=legalDraftSchema.parse({mainPoint:{text:"Request review",sourceIds:["source"]},findings:[],actions:[],risks:[],questions:[],unresolved:[]});
  const checked=legalVerificationSchema.parse(await createLegalAnswerModel({requestId:"audit-gap"}).verify({question,draft,claims:[],previous:null}));
  assert.equal(checked.complete,false);
  assert.equal(checked.gaps.length,30);
  assert.equal(checked.sourceGaps[0]?.passages[0]?.missingContent.length,11);
  assert.ok(checked.sourceGaps[0]?.passages[0]?.missingContent.some(gap=>gap.includes("written application")));
});
