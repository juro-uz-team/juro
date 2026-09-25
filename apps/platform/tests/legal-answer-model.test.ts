import assert from "node:assert/strict";
import test from "node:test";
import {privateDocumentContext} from "./helpers/private-document-context";
import { createHash } from "node:crypto";
import { env } from "./helpers/runtime-env";
import { createLegalAnswerModel } from "../lib/legal-chat/answer-model";
import { answerFromEvidence, type AnswerQuestion } from "../lib/legal-chat/answer-engine";
import { legalDraftClaims, legalDraftSchema, legalVerificationSchema } from "../lib/legal-chat/answer-contract";

function assertStrictProviderObjects(value: unknown): void {
  if (Array.isArray(value)) {value.forEach(assertStrictProviderObjects); return;}
  if (!value || typeof value !== "object") return;
  const node = value as Record<string, unknown>;
  if (node.properties && typeof node.properties === "object") {
    assert.equal(node.additionalProperties, false, "Provider objects reject undeclared fields");
    assert.deepEqual(Array.isArray(node.required) ? [...node.required].sort() : [],
      Object.keys(node.properties).sort(), "Every provider property is required");
  }
  Object.values(node).forEach(assertStrictProviderObjects);
}

test("a stalled answer provider is cancelled by the selected chat mode watchdog",async context=>{
  const previousKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  context.mock.timers.enable({apis:["setTimeout"]});
  for(const [mode,limit] of [["fast",60_000],["deep",120_000]] as const) {
    const started=Promise.withResolvers<void>();
    let providerSignal:AbortSignal|undefined;
    context.mock.method(globalThis,"fetch",async(_url:unknown,init?:RequestInit)=>new Promise<Response>((_resolve,reject)=>{
      providerSignal=init!.signal!;
      init!.signal!.addEventListener("abort",()=>reject(init!.signal!.reason),{once:true});
      started.resolve();
    }));
    const question:AnswerQuestion={question:"What applies?",locale:"en",mode,answerMode:"short",
      temporalScope:{kind:"current"},unresolved:[],evidence:[]};
    const pending=createLegalAnswerModel({requestId:"stalled-answer"}).write({question,correction:null});
    const rejected=assert.rejects(pending,(error:unknown)=>error instanceof Error&&"code" in error&&error.code==="PROVIDER_TIMEOUT");
    await started.promise;
    context.mock.timers.tick(limit-1);
    assert.equal(providerSignal?.aborted,false);
    context.mock.timers.tick(1);
    await rejected;
  }
});

test("legal model transport pins each mode and keeps source locators out of provider context", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const sourceText=["Official provision", "", "A qualifying condition follows.",
    ...Array.from({length:161},(_,index)=>`Line ${index}.`)].join("\n");
  const payloads: Array<{model:string;input:string;reasoning:{effort:string;mode:string};text:{format:{strict:boolean}}}> = [];
  context.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assertStrictProviderObjects(body.text.format.schema);
    payloads.push(body);
    return Response.json({ id: "response", model: body.model,
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
        sourceReview: [{ sourceId: "source", coverage: [{ passageId: "p0", issueIndices: [0], unresolvedIndices: [] }] }],
        answer: {
        mainPoint: { text: "Supported result", sourceIds: ["source"] },
        issues: [{finding:{title:"Application",explanation:"A written application is required.",sourceIds:["source"]},
          actions:[{title:"Apply",instruction:"Submit the application and keep a copy.",sourceIds:["source"]}]}],
        risks: [], questions: [], unresolved: [],
        },
      }) }] }], usage: { input_tokens: 12, output_tokens: 9 } });
  });
  const observations: unknown[] = [];
  const model = createLegalAnswerModel({ requestId: "request", onAttemptFinished: value => { observations.push(value); } });
  for (const mode of ["fast", "deep"] as const) {
    const question: AnswerQuestion = { question: "Question", locale: "en", mode, answerMode: "detailed",
      temporalScope: { kind: "current" }, unresolved: [], documents:[privateDocumentContext()], evidence: [{ source: {
        id: "source", actTitle: "Title", actIdentifier: null, officialUrl: "https://lex.uz/docs/123",
        revisionDate: null, lastCheckedAt: "2026-09-14", locale: "en", publishedAt: null,
        sourceType: "lex", status: "current", verificationState: "verified", verifiedAt: "2026-09-14",
        contentSha256: "server-only-parent-fingerprint",
      }, text: sourceText, textSha256: "server-only-text-fingerprint", endpoint: {kind: "current"}, origin: "indexed" }] };
    const draft = legalDraftSchema.parse(await model.write({ question, correction: null }));
    assert.equal(draft.mainPoint.text, "Supported result");
    assert.equal(draft.findings[0]?.explanation,"A written application is required.");
    assert.equal(draft.actions[0]?.description,"Submit the application and keep a copy.");
    assert.ok(!("sourceReview" in draft));
  }
  assert.deepEqual(payloads.map(body => body.model), ["gpt-6-luna", "gpt-5.6-terra"]);
  assert.deepEqual(payloads.map(body=>body.reasoning),[
    {effort:"none",mode:"standard"},{effort:"max",mode:"pro"},
  ]);
  assert.equal(observations.length, 2);
  for (const body of payloads) {
    assert.equal(body.text.format.strict, true);
    assert.ok(!body.input.includes("fingerprint"));
    assert.ok(!body.input.includes("https://lex.uz"));
    assert.ok(body.input.includes("Official provision"));
    const input=JSON.parse(body.input);
    assert.deepEqual(input.context.privateDocuments,[{id:privateDocumentContext().source.id,
      title:"Uploaded agreement",text:privateDocumentContext().text}]);
    assert.doesNotMatch(body.input,/juro-private:|private-object-checksum/);
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
  let propertyCount=0; let schemaStrings=0; let nesting=0; let explicitPracticalRelevance=false;
  context.mock.method(globalThis,"fetch",async (_url:string|URL|Request,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    assert.deepEqual(body.reasoning,{effort:"medium",mode:"standard"},"The fast draft still receives a separate deliberative verification");
    const schema=body.text.format.schema;
    assertStrictProviderObjects(schema);
    function inspect(value:unknown) {
      if(!value||typeof value!=="object")return;
      if ("$ref" in value) assert.deepEqual(Object.keys(value), ["$ref"], "Provider references cannot have sibling keywords");
      if ("properties" in value && value.properties && typeof value.properties === "object"
        && "actionRequired" in value.properties) {
        assert.ok("required" in value && Array.isArray(value.required) && value.required.includes("actionRequired"));
        explicitPracticalRelevance=true;
      }
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
      Array.from({length:160},(_,index)=>[`p${index}`,{material:false,findingSupport:[],actionSupport:[],missingContent:[]}]),
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
  assert.equal(explicitPracticalRelevance,true);
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
      sourceReview: [{sourceId:"source", coverage:[{passageId:"p999",issueIndices:[0],unresolvedIndices:[]}]}],
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
  let sourceAudit:Record<string,Record<string,{material:boolean;findingSupport:Array<{claimId:string;excerpt:string}>;actionSupport:Array<{claimId:string;excerpt:string}>;missingContent:string[]}>> = {
    source:{p0:{material:true,findingSupport:[],actionSupport:[],missingContent:["The required written application is missing.",
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
  assert.equal(checked.sourceGaps[0]?.passages[0]?.missingContent.length,13);
  assert.ok(checked.sourceGaps[0]?.passages[0]?.missingContent.some(gap=>gap.includes("written application")));
  assert.ok(checked.sourceGaps[0]?.passages[0]?.missingContent.some(gap=>gap.includes("practical guidance")));
  assert.ok(checked.sourceGaps[0]?.passages[0]?.missingContent.some(gap=>gap.includes("legal explanation")));
  const invalidAudits:Array<typeof sourceAudit> = [
    {source:{}},{},{source:{
      p0:{material:false,findingSupport:[],actionSupport:[],missingContent:[]},
      p999:{material:false,findingSupport:[],actionSupport:[],missingContent:[]},
    }},
  ];
  for (const invalidAudit of invalidAudits) {
    sourceAudit=invalidAudit;
    await assert.rejects(createLegalAnswerModel({requestId:"incomplete-audit"}).verify({question,draft,claims:[],previous:null}));
  }
});

test("separate excerpts of one claim are all checked without rejecting a repeated claim reference", async context => {
  const previousKey=env.OPENAI_API_KEY;
  env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  const period="Request review within ten days after written notice.";
  const qualification="A late request may be accepted for a justified reason.";
  const body=`${period} ${qualification}`;
  const question:AnswerQuestion={question:"When can I request review?",locale:"en",mode:"fast",answerMode:"detailed",
    temporalScope:{kind:"current"},unresolved:[],evidence:[{
      source:{id:"source",actTitle:"Synthetic fixture",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
        revisionDate:null,lastCheckedAt:"2026-09-19",locale:"en",publishedAt:null,sourceType:"lex",status:"current",
        verificationState:"verified",verifiedAt:"2026-09-19",contentSha256:"parent"},
      text:body,textSha256:"fixture",endpoint:{kind:"current"},origin:"indexed",
    }]};
  const draft=legalDraftSchema.parse({mainPoint:{text:body,sourceIds:["source"]},
    findings:[{title:"Review",explanation:body,sourceIds:["source"]}],
    actions:[{title:"Request review",description:body,sourceIds:["source"]}],risks:[],questions:[],unresolved:[]});
  const findingSupport=[period,qualification].map(excerpt=>({claimId:"finding:0",excerpt}));
  const actionSupport=[period,qualification].map(excerpt=>({claimId:"action:0",excerpt}));
  let actionSupported=true;let duplicateActionVerdict=false;
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",model:"gpt-5.6-luna",
    output:[{content:[{type:"output_text",text:JSON.stringify({
      sourceAudit:{source:{p0:{material:true,actionRequired:true,findingSupport,actionSupport,missingContent:[]}}},
      verification:{retention:[],coverage:[],claims:[...legalDraftClaims(draft).map(claim=>({
        id:claim.id,supported:claim.id!=="action:0"||actionSupported,reason:"Fixture verdict",
      })),...(duplicateActionVerdict?[{id:"action:0",supported:true,reason:"Duplicate verdict"}]:[])],complete:true,gaps:[],questions:[]},
    })}]}],usage:{input_tokens:10,output_tokens:10}}));
  const model=createLegalAnswerModel({requestId:"multiple-excerpts"});
  const verify=async()=>legalVerificationSchema.parse(await model.verify({question,draft,claims:legalDraftClaims(draft),previous:null}));
  assert.equal((await verify()).complete,true);
  actionSupport[1]!.excerpt="Late requests are always accepted.";
  const mixedFragments=await verify();
  assert.equal(mixedFragments.complete,false,"A valid first fragment cannot hide a fabricated second fragment");
  assert.equal(mixedFragments.claims.find(claim=>claim.id==="action:0")?.supported,false);
  actionSupport[1]!.excerpt=qualification;
  for(const claimId of ["action:9","finding:0"]) {
    actionSupport[1]!.claimId=claimId;
    await assert.rejects(verify(),/Invalid audited claim binding/);
  }
  actionSupport[1]!.claimId="action:0";
  actionSupported=false;
  assert.equal((await verify()).complete,false,"Exact excerpts cannot approve an unsupported claim");
  actionSupported=true;
  duplicateActionVerdict=true;
  assert.equal((await verify()).complete,false,"Repeated excerpts cannot legitimize duplicate verdicts");
  duplicateActionVerdict=false;
  findingSupport[1]!.excerpt="A late request must always be accepted.";
  const unconfirmedFinding=await verify();
  assert.equal(unconfirmedFinding.complete,false,"Every finding fragment must also be grounded");
  assert.equal(unconfirmedFinding.claims.find(claim=>claim.id==="finding:0")?.supported,false);
  findingSupport[1]!.excerpt=qualification;
  assert.equal((await verify()).complete,true);
});

test("source-audit support cannot approve a claim that does not cite that source",async context=>{
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const text="Applicants may request their record.";
  const question:AnswerQuestion={question:"May I request my record?",locale:"en",mode:"fast",answerMode:"detailed",
    temporalScope:{kind:"current"},unresolved:[],evidence:["cited","uncited"].map(id=>({
      source:{id,actTitle:"Synthetic source",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",revisionDate:null,
        lastCheckedAt:"2026-09-20",locale:"en",publishedAt:null,sourceType:"lex",status:"current",verificationState:"verified",
        verifiedAt:"2026-09-20",contentSha256:"parent"},text,textSha256:"fixture",endpoint:{kind:"current"},origin:"indexed"}))};
  const draft=legalDraftSchema.parse({mainPoint:{text,sourceIds:["cited"]},
    findings:[{title:"Record access",explanation:text,sourceIds:["cited"]}],
    actions:[{title:"Request a record",description:text,sourceIds:["cited"]}],risks:[],questions:[],unresolved:[]});
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",model:"gpt-5.6-luna",output:[{content:[{type:"output_text",text:JSON.stringify({
    verification:{claims:legalDraftClaims(draft).map(claim=>({id:claim.id,supported:true,reason:"Approved"})),retention:[],coverage:[],complete:true,gaps:[],questions:[]},
    sourceAudit:{cited:{p0:{material:false,actionRequired:false,findingSupport:[],actionSupport:[],missingContent:[]}},
      uncited:{p0:{material:true,actionRequired:true,findingSupport:[{claimId:"finding:0",excerpt:text}],
        actionSupport:[{claimId:"action:0",excerpt:text}],missingContent:[]}}},
  })}]}]}));
  const checked=legalVerificationSchema.parse(await createLegalAnswerModel({requestId:"citation-binding"}).verify({question,draft,claims:legalDraftClaims(draft),previous:null}));
  assert.equal(checked.complete,false);
  assert.equal(checked.claims.find(claim=>claim.id==="finding:0")?.supported,false);
  assert.equal(checked.claims.find(claim=>claim.id==="action:0")?.supported,false);
  assert.equal(checked.sourceGaps[0]?.sourceId,"uncited");
});

test("unconfirmed action evidence cannot survive correction failure alongside supported findings", async context => {
  const previousKey=env.OPENAI_API_KEY;
  env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  const text="File within ten days after actual or constructive knowledge.";
  const question:AnswerQuestion={question:"When must I file?",locale:"en",mode:"fast",answerMode:"detailed",
    temporalScope:{kind:"current"},unresolved:[],evidence:[{
      source:{id:"source",actTitle:"Synthetic rule",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
        revisionDate:null,lastCheckedAt:"2026-09-19",locale:"en",publishedAt:null,sourceType:"lex",
        sourceClass:"OFFICIAL_LEGISLATION",status:"current",verificationState:"verified",verifiedAt:"2026-09-19",contentSha256:"a".repeat(64)},
      text,textSha256:createHash("sha256").update(text).digest("hex"),endpoint:{kind:"current"},origin:"indexed",
    }]};
  const draft=legalDraftSchema.parse({mainPoint:{text,sourceIds:["source"]},
    findings:[{title:"Period",explanation:text,sourceIds:["source"]}],
    actions:[{title:"File",description:"File within ten days after actual knowledge.",sourceIds:["source"]},
      {title:"Check the trigger",description:text,sourceIds:["source"]},
      {title:"Use that period",description:"Follow the filing period above.",sourceIds:["source"]}],risks:[],questions:[],unresolved:[]});
  let retention:Array<{priorId:string;priorSupported:boolean;currentIds:string[]}>=[];
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",model:"gpt-5.6-luna",
    output:[{content:[{type:"output_text",text:JSON.stringify({
      sourceAudit:{source:{p0:{material:true,actionRequired:true,missingContent:[],
        findingSupport:[{claimId:"finding:0",excerpt:text}],
        actionSupport:[{claimId:"action:0",excerpt:text},{claimId:"action:1",excerpt:text}]} }},
      verification:{retention,coverage:[{issue:"Filing",findingIds:["finding:0"],actionIds:["action:0","action:1"],gaps:[]}],
        claims:legalDraftClaims(draft).map(claim=>({id:claim.id,supported:true,reason:"Approved",dependsOn:claim.id==="action:2"?["action:0"]:[]})),
        complete:true,gaps:[],questions:[]},
    })}]}],usage:{input_tokens:10,output_tokens:10}}));
  const model=createLegalAnswerModel({requestId:"unconfirmed-action"});
  let writes=0;
  let correctionSupported:boolean|undefined;
  const outcome=await answerFromEvidence(question,{
    write:async input=>{
      if(++writes===1)return draft;
      correctionSupported=input.correction?.verification.claims.find(claim=>claim.id==="action:0")?.supported;
      throw Error("Correction unavailable");
    },verify:model.verify,
  });
  assert.equal(writes,2);
  assert.equal(correctionSupported,false);
  assert.equal(outcome.errorCode,"ANSWER_CORRECTION_UNAVAILABLE");
  assert.deepEqual(outcome.result.confirmedFindings,draft.findings);
  assert.deepEqual(outcome.result.actionPlan,[draft.actions[1]]);
  const original={...draft,actions:[draft.actions[1]!]};
  const originalVerification=legalVerificationSchema.parse({claims:legalDraftClaims(original).map(claim=>({id:claim.id,supported:true,reason:"Original approval"})),coverage:[],retention:[],complete:true,gaps:[],questions:[]});
  retention=[{priorId:"action:0",priorSupported:true,currentIds:["action:1"]}];
  const corrected=legalVerificationSchema.parse(await model.verify({question,draft,claims:legalDraftClaims(draft),previous:{draft:original,verification:originalVerification}}));
  assert.equal(corrected.claims.find(claim=>claim.id==="action:0")?.supported,false);
  assert.deepEqual(corrected.retention,retention,"A current binding failure cannot reject a different original body sharing its ID");
});

test("a material passage needs separately supported legal and practical coverage", async context => {
  const previousKey=env.OPENAI_API_KEY;
  env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  const question:AnswerQuestion={question:"When should I request review?",locale:"en",mode:"fast",answerMode:"detailed",
    temporalScope:{kind:"current"},unresolved:[],evidence:[{
      source:{id:"source",actTitle:"Official fixture",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
        revisionDate:null,lastCheckedAt:"2026-09-19",locale:"en",publishedAt:null,sourceType:"lex",status:"current",
        verificationState:"verified",verifiedAt:"2026-09-19",contentSha256:"parent"},
      text:"Review may be requested within ten days after written notice.\nReview means reconsideration of the decision.",textSha256:"text",endpoint:{kind:"current"},origin:"indexed",
    }]};
  const draft=legalDraftSchema.parse({mainPoint:{text:"You may request review.",sourceIds:["source"]},
    findings:[{title:"Review",explanation:"Review means reconsideration of the decision and is available within ten days after written notice.",sourceIds:["source"]}],
    actions:[{title:"Review request",description:"Request review within ten days after written notice.",sourceIds:["source"]}],
    risks:[],questions:[],unresolved:[]});
  let findingIds=["finding:0"];let actionIds:string[]=[];let actionExcerpt=draft.actions[0]!.description;let actionSupported=true;let definitionActionRequired=false;let operativeActionRequired=true;
  context.mock.method(globalThis,"fetch",async()=>Response.json({id:"response",model:"gpt-5.6-luna",
    output:[{content:[{type:"output_text",text:JSON.stringify({
      sourceAudit:{source:{
        p0:{material:true,actionRequired:operativeActionRequired,findingSupport:findingIds.map(claimId=>({claimId,excerpt:draft.findings[0]!.explanation})),actionSupport:actionIds.map(claimId=>({claimId,excerpt:actionExcerpt})),missingContent:[]},
        p1:{material:true,actionRequired:definitionActionRequired,findingSupport:[{claimId:"finding:0",excerpt:draft.findings[0]!.explanation}],actionSupport:[],missingContent:[]},
      }},
      verification:{retention:[],coverage:[],claims:legalDraftClaims(draft).map(claim=>({
        id:claim.id,supported:claim.id!=="action:0"||actionSupported,reason:"Fixture verdict",
      })),complete:true,gaps:[],questions:[]},
    })}]}],usage:{input_tokens:10,output_tokens:10}}));
  const model=createLegalAnswerModel({requestId:"passage-coverage"});
  const verify=async()=>legalVerificationSchema.parse(await model.verify({question,draft,claims:legalDraftClaims(draft),previous:null}));
  const missingAction=await verify();
  assert.equal(missingAction.complete,false);
  assert.match(missingAction.sourceGaps[0]!.passages[0]!.missingContent.join(" "),/practical/i);
  actionIds=["action:0"];
  assert.equal((await verify()).complete,true);
  const originalAction=draft.actions[0]!.description;
  actionExcerpt=originalAction.replace(/\.$/u,";");
  assert.equal((await verify()).complete,true, "Terminal quotation punctuation does not change the quoted operative words");
  actionExcerpt="12.";
  for (const period of ["120", "12.5", "12/25", "12:30", "12–15", "12 000"]) {
    draft.actions[0]!.description=`Request review within ${period} days after written notice.`;
    assert.equal((await verify()).complete,false, "Removing terminal punctuation cannot match part of a number");
  }
  draft.actions[0]!.description=originalAction;
  actionExcerpt="view.";
  assert.equal((await verify()).complete,false, "Removing terminal punctuation cannot match part of a word");
  actionExcerpt=originalAction;
  draft.actions[0]!.description="Request review after written notice.";
  const fabricatedSupport=await verify();
  assert.equal(fabricatedSupport.complete,false);
  assert.match(fabricatedSupport.sourceGaps[0]!.passages[0]!.missingContent.join(" "),/practical/i);
  operativeActionRequired=false;
  const optionalButInvalid=await verify();
  assert.equal(optionalButInvalid.claims.find(claim=>claim.id==="action:0")?.supported,false,"Optional supplied bindings still need actual claim text");
  assert.equal(optionalButInvalid.complete,false);
  actionIds=[];
  assert.equal((await verify()).complete,true,"An omitted optional binding alone cannot retract a claim");
  operativeActionRequired=true;
  actionIds=["action:0"];
  draft.actions[0]!.description=originalAction;
  actionExcerpt=draft.findings[0]!.explanation;
  assert.equal((await verify()).complete,false, "A finding cannot supply an action excerpt");
  actionExcerpt=draft.actions[0]!.title;
  assert.equal((await verify()).complete,false, "A title alone cannot supply practical support");
  actionExcerpt=originalAction;
  assert.equal((await verify()).complete,true);
  definitionActionRequired=true;
  assert.equal((await verify()).complete,false);
  definitionActionRequired=false;
  actionSupported=false;
  assert.equal((await verify()).complete,false);
  actionSupported=true;findingIds=[];
  const missingFinding=await verify();
  assert.equal(missingFinding.complete,false);
  assert.match(missingFinding.sourceGaps[0]!.passages[0]!.missingContent.join(" "),/legal explanation/i);
  findingIds=["action:0"];
  await assert.rejects(verify(),/audit.*claim/i);
  findingIds=["finding:99"];
  await assert.rejects(verify(),/audit.*claim/i);
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
  let actionSource = "source";
  let issueIndex = 0;
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      sourceReview: [{ sourceId: "source", coverage: [{ passageId: "p0", issueIndices: [issueIndex], unresolvedIndices: [] }] }],
      answer: { mainPoint: { reuse: "mainPoint" },
        issues: [{ finding: { reuse: findingReuse }, actions: [{ title: "Request review",
          instruction: "Record the written-notice date and request review within ten days after it.", sourceIds: [actionSource] }] }],
        risks: [], questions: [], unresolved: [],
      },
    }) }] }], usage: { input_tokens: 10, output_tokens: 10 },
  }));
  const model = createLegalAnswerModel({ requestId: "reuse-supported-claims" });
  const corrected = legalDraftSchema.parse(await model.write({ question, correction: { draft, verification } }));
  assert.deepEqual(corrected.mainPoint, draft.mainPoint);
  assert.deepEqual(corrected.findings, draft.findings);
  assert.match(corrected.actions[0]!.description, /within ten days after it/);
  assert.equal(corrected.actions[0]!.description,"Record the written-notice date and request review within ten days after it.");
  assert.ok(!("reuse" in corrected.findings[0]!));
  actionSource = "unrelated-source";
  // Source support can be complementary: the finding still cites this source.
  const combined = legalDraftSchema.parse(await model.write({ question, correction: { draft, verification } }));
  assert.deepEqual(combined.actions[0]!.sourceIds, ["source", "unrelated-source"]);
  draft.findings[0]!.sourceIds = ["unrelated-source"];
  // Planning metadata is not approval. The independent verifier evaluates
  // actual claims/citations even when the writer's internal map is mistaken.
  await model.write({ question, correction: { draft, verification } });
  draft.findings[0]!.sourceIds = ["source"];
  actionSource = "source";
  issueIndex = 1;
  await assert.rejects(model.write({ question, correction: { draft, verification } }), /answer issue/);
  issueIndex = 0;
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

test("a material passage can remain explicitly unresolved without inventing paired guidance", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const question: AnswerQuestion = {
    question: "Am I eligible?", locale: "en", mode: "fast", answerMode: "detailed",
    temporalScope: { kind: "current" }, unresolved: [], evidence: [{
      source: { id: "source", actTitle: "Official fixture", actIdentifier: null,
        officialUrl: "https://lex.uz/docs/123", revisionDate: null, lastCheckedAt: "2026-09-19",
        locale: "en", publishedAt: null, sourceType: "lex", status: "current",
        verificationState: "verified", verifiedAt: "2026-09-19", contentSha256: "parent" },
      text: "Eligibility is subject to the exceptions in a separate provision.", textSha256: "text",
      endpoint: { kind: "current" }, origin: "indexed",
    }],
  };
  const gap = "The referenced exceptions are not supplied, so eligibility remains unresolved.";
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      sourceReview: [{ sourceId: "source", coverage: [{ passageId: "p0", issueIndices: [], unresolvedIndices: [0] }] }],
      answer: { mainPoint: { text: "There is insufficient evidence for an eligibility conclusion.", sourceIds: [] },
        issues: [], risks: [], questions: [], unresolved: [gap] },
    }) }] }], usage: { input_tokens: 10, output_tokens: 10 },
  }));
  const draft = legalDraftSchema.parse(await createLegalAnswerModel({ requestId: "unresolved-passage" }).write({ question, correction: null }));
  assert.deepEqual(draft.findings, []);
  assert.deepEqual(draft.actions, []);
  assert.deepEqual(draft.unresolved, [gap]);
});

test("qualified issues preserve action membership without duplicating explanatory text", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const question: AnswerQuestion = { question: "How do I apply?", locale: "en", mode: "fast", answerMode: "detailed",
    temporalScope: { kind: "current" }, unresolved: [], evidence: [] };
  let explanation = "Workers may apply within ten days after written notice.";
  let instruction = "Record the notice date and submit your application.";
  let findingSources = ["rule"];
  let instructionSources = ["rule", "procedure"];
  let reuseAction = false;
  let hasAction = true;
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      sourceReview: [], answer: {
        mainPoint: { text: "Application guidance", sourceIds: [] },
        issues: [{ finding: { title: "Application", explanation, sourceIds: findingSources },
          actions: hasAction ? [reuseAction ? { reuse: "action:0" }
            : { title: "Apply", instruction, sourceIds: instructionSources }] : [] }],
        risks: [], questions: [], unresolved: [],
      },
    }) }] }], usage: { input_tokens: 10, output_tokens: 10 },
  }));
  const model = createLegalAnswerModel({ requestId: "composed-limits" });
  const write = () => model.write({ question, correction: null });
  const initial = legalDraftSchema.parse(await write());
  assert.equal(initial.actions[0]!.description, instruction);
  assert.deepEqual(initial.ruleBindings, [{findingId:"finding:0",actionIds:["action:0"]}]);
  assert.deepEqual(initial.actions[0]!.sourceIds, ["rule", "procedure"]);
  explanation = "x".repeat(4000);
  instruction = "y".repeat(2000);
  const bounded = legalDraftSchema.parse(await write());
  assert.equal(bounded.findings[0]!.explanation.length, 4000);
  assert.equal(bounded.actions[0]!.description.length, 2000);
  instruction += "y";
  await assert.rejects(write(), "Oversized guidance must fail without truncation");
  instruction = "Apply within ten days after written notice.";
  hasAction = false;
  explanation = "x".repeat(4000);
  assert.equal(legalDraftSchema.parse(await write()).findings[0]!.explanation.length, 4000);
  hasAction = true;
  explanation = "A supported rule.";
  findingSources = Array.from({ length: 12 }, (_, index) => `source-${index}`);
  instructionSources = ["additional-source"];
  await assert.rejects(write(), "Citation union must not silently discard a thirteenth source");
  findingSources = ["rule"];
  instructionSources = ["procedure"];
  reuseAction = true;
  const verification = legalVerificationSchema.parse({
    claims: [{ id: "action:0", supported: true, reason: "Supported earlier." }],
    complete: false, gaps: [], coverage: [], retention: [], questions: [],
  });
  const reused = legalDraftSchema.parse(await model.write({ question, correction: { draft: initial, verification } }));
  assert.deepEqual(reused.actions, initial.actions, "A changed finding must not prefix or otherwise edit an explicitly reused action");
  verification.claims[0]!.supported = false;
  await assert.rejects(model.write({ question, correction: { draft: initial, verification } }));
  instruction = "Changed instruction";
  await assert.rejects(write(), "Initial writing cannot reuse prior claims");
});
