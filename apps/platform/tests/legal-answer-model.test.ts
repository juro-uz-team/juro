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
  const payloads: Array<{model:string;input:string;reasoning:{effort:string;mode:string};text:{format:{strict:boolean}}}> = [];
  context.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    payloads.push(body);
    return Response.json({ id: "response", model: body.model,
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        sourceReview: [{ sourceId: "source", passageIds: ["p0"] }],
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
    assert.equal(body.reasoning.effort,"high");
    assert.equal(body.reasoning.mode,"pro");
    assert.ok(!body.input.includes("fingerprint"));
    assert.ok(!body.input.includes("https://lex.uz"));
    assert.ok(body.input.includes("Official provision"));
    const input=JSON.parse(body.input);
    assert.ok(input.context.evidence[0].passages.length <=160);
    assert.equal(input.context.evidence[0].passages.map((passage:{text:string})=>passage.text).join("\n"),
      sourceText);
  }
});

test("maximum evidence audit fits provider schema limits without losing passages", async context => {
  const previousKey=env.OPENAI_API_KEY;
  env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  const evidence:AnswerQuestion["evidence"]=Array.from({length:24},(_,index)=>({
    source:{id:`source-${index}-`.padEnd(160,"x"),actTitle:"Official text",actIdentifier:null,
      officialUrl:"https://lex.uz/docs/123",revisionDate:null,lastCheckedAt:"2026-09-14",locale:"en",
      publishedAt:null,sourceType:"lex",status:"current",verificationState:"verified",
      verifiedAt:"2026-09-14",contentSha256:"parent"},
    text:Array.from({length:160},()=>"Rule.").join("\n"),textSha256:"text",endpoint:{kind:"current"},origin:"indexed",
  }));
  const question:AnswerQuestion={question:"What applies?",locale:"en",mode:"fast",answerMode:"detailed",
    temporalScope:{kind:"current"},unresolved:[],evidence};
  let propertyCount=0; let schemaStrings=0; let nesting=0;
  context.mock.method(globalThis,"fetch",async (_url:string|URL|Request,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    const schema=body.text.format.schema;
    function inspect(value:unknown) {
      if(!value||typeof value!=="object")return;
      for(const [key,nested] of Object.entries(value)) {
        if((key==="properties"||key==="$defs")&&nested&&typeof nested==="object") {
          const names=Object.keys(nested);
          if(key==="properties")propertyCount+=names.length;
          schemaStrings+=names.reduce((sum,name)=>sum+name.length,0);
        }
        if(key==="enum"&&Array.isArray(nested))schemaStrings+=nested.reduce((sum,item)=>sum+String(item).length,0);
        if(key==="const")schemaStrings+=String(nested).length;
        inspect(nested);
      }
    }
    inspect(schema);
    function depth(value:Record<string,unknown>):number {
      if(typeof value.$ref==="string") {
        const resolved=value.$ref.slice(2).split("/").reduce((item,key)=>item[key],schema);
        return depth(resolved);
      }
      const children=[...Object.values(value.properties??{}),...(value.items?[value.items]:[])];
      return (value.type==="object"||value.type==="array"?1:0)
        +Math.max(0,...children.map(item=>depth(item as Record<string,unknown>)));
    }
    nesting=depth(schema);
    const sourceAudit=Object.fromEntries(evidence.map(item=>[item.source.id,Object.fromEntries(
      Array.from({length:160},(_,index)=>[`p${index}`,{material:false,missingContent:[]}]),
    )]));
    return Response.json({id:"response",model:body.model,output:[{content:[{type:"output_text",text:JSON.stringify({
      sourceAudit,verification:{retention:[],coverage:[],claims:[],complete:true,gaps:[],questions:[]},
    })}]}],usage:{input_tokens:10,output_tokens:10}});
  });
  let auditedPassages=0;
  const model=createLegalAnswerModel({requestId:"maximum-audit",onVerificationProduced:value=>{
    auditedPassages=value.sourceAudit.reduce((sum,source)=>sum+source.passages.length,0);
  }});
  const draft=legalDraftSchema.parse({mainPoint:{text:"No conclusion",sourceIds:[]},findings:[],actions:[],risks:[],questions:[],unresolved:[]});
  await model.verify({question,draft,claims:[],previous:null});
  assert.equal(auditedPassages,24*160);
  assert.ok(propertyCount<=5000,`Provider schema contains ${propertyCount} object properties`);
  assert.ok(schemaStrings<=120000,`Provider schema contains ${schemaStrings} name/value characters`);
  assert.ok(nesting<=10,`Provider schema contains ${nesting} nesting levels`);
  context.diagnostic(`Maximum audit: ${propertyCount} properties, ${schemaStrings} name/value characters, ${nesting} nesting levels`);
});

test("a fabricated source passage is rejected before a draft can reach verification", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      sourceReview: [{sourceId:"source", passageIds:["p999"]}],
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
  let sourceAudit:Record<string,Record<string,{material:boolean;missingContent:string[]}>> = {
    source:{p0:{material:true,missingContent:["The required written application is missing.",
      ...Array.from({length:10},(_,index)=>`Missing condition ${index}.`)]}},
  };
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id:"response",model:"gpt-5.6-luna",output:[{content:[{type:"output_text",text:JSON.stringify({
      sourceAudit,
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
  const invalidAudits:Array<typeof sourceAudit> = [
    {source:{}},{},{source:{p0:{material:false,missingContent:[]},p999:{material:false,missingContent:[]}}},
  ];
  for (const invalidAudit of invalidAudits) {
    sourceAudit=invalidAudit;
    await assert.rejects(createLegalAnswerModel({requestId:"incomplete-audit"}).verify({question,draft,claims:[],previous:null}));
  }
});

test("one whole correction can reuse approved claims without rewriting their conditions", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const question: AnswerQuestion = {
    question: "When can I request review?", locale: "en", mode: "fast", answerMode: "detailed",
    temporalScope: { kind: "current" }, unresolved: [], evidence: [{
      source: { id: "source", actTitle: "Official fixture", actIdentifier: null,
        officialUrl: "https://lex.uz/docs/123", revisionDate: null, lastCheckedAt: "2026-09-19",
        locale: "en", publishedAt: null, sourceType: "lex", status: "current",
        verificationState: "verified", verifiedAt: "2026-09-19", contentSha256: "parent" },
      text: "A person may request review within ten days after written notice.", textSha256: "text",
      endpoint: { kind: "current" }, origin: "indexed",
    }],
  };
  const draft = legalDraftSchema.parse({
    mainPoint: { text: "Request review within ten days after written notice.", sourceIds: ["source"] },
    findings: [{ title: "Review period", explanation: "The ten-day period starts with written notice.", sourceIds: ["source"] }],
    actions: [], risks: [], questions: [], unresolved: [],
  });
  const verification = legalVerificationSchema.parse({ retention: [], coverage: [],
    claims: ["mainPoint", "finding:0"].map(id => ({ id, supported: true, reason: "Supported by the fixture." })),
    complete: false, gaps: ["Practical guidance is missing."], questions: [],
  });
  let findingReuse = "finding:0";
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      sourceReview: [{ sourceId: "source", passageIds: ["p0"] }],
      answer: { mainPoint: { reuse: "mainPoint" },
        issues: [{ finding: { reuse: findingReuse }, actions: [{ title: "Request review",
          description: "Record the written-notice date and request review within ten days after it.", sourceIds: ["source"] }] }],
        risks: [], questions: [], unresolved: [],
      },
    }) }] }], usage: { input_tokens: 10, output_tokens: 10 },
  }));
  const model = createLegalAnswerModel({ requestId: "reuse-supported-claims" });
  const corrected = legalDraftSchema.parse(await model.write({ question, correction: { draft, verification } }));
  assert.deepEqual(corrected.mainPoint, draft.mainPoint);
  assert.deepEqual(corrected.findings, draft.findings);
  assert.match(corrected.actions[0]!.description, /within ten days after it/);
  assert.ok(!("reuse" in corrected.findings[0]!));
  findingReuse = "mainPoint";
  await assert.rejects(model.write({ question, correction: { draft, verification } }));
  findingReuse = "finding:0";
  verification.claims.push({ ...verification.claims.find(claim => claim.id === "finding:0")! });
  await assert.rejects(model.write({ question, correction: { draft, verification } }));
  verification.claims.pop();
  verification.claims.find(claim => claim.id === "finding:0")!.supported = false;
  await assert.rejects(model.write({ question, correction: { draft, verification } }));
  await assert.rejects(model.write({ question, correction: null }));
});
