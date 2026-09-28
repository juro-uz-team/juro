import assert from "node:assert/strict";
import test from "node:test";
import {privateDocumentContext} from "./helpers/private-document-context";
import { createHash } from "node:crypto";
import { env } from "./helpers/runtime-env";
import { createLegalAnswerModel } from "../lib/legal-chat/answer-model";
import { type AnswerQuestion } from "../lib/legal-chat/answer-engine";
import { legalDraftSchema, legalVerificationSchema } from "../lib/legal-chat/answer-contract";

type ProviderSchemaNode = {
  $ref?: string; type?: string; enum?: string[]; const?: string;
  required?: string[]; additionalProperties?: boolean;
  properties?: Record<string, ProviderSchemaNode>; items?: ProviderSchemaNode;
};

test("writer receives the selected output language as application policy in both modes", async context => {
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  let expectedLanguage="";
  context.mock.method(globalThis,"fetch",async (_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    assert.ok(body.instructions.includes(`The required output language for THIS answer is ${expectedLanguage}.`));
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
      answer:{mainPoint:{text:"Synthetic answer",sourceIds:[]},issues:[],risks:[],questions:[],unresolved:[]},
    })}]}]});
  });
  for(const mode of ["fast","deep"] as const) {
    for(const [locale,language] of [["en","English"],["uz","Uzbek using the Latin script"],["ru","Russian"]] as const) {
      expectedLanguage=language;
      await createLegalAnswerModel({requestId:"output-language"}).write({question:{
        question:"Synthetic question",locale,mode,answerMode:"short",temporalScope:{kind:"current"},unresolved:[],evidence:[],
      },correction:null});
    }
  }
});

test("writer produces the answer without redundant planning references and cites only supplied evidence", async context => {
  const oldKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=oldKey;});
  const ids=["s0",...Array.from({length:23},(_,index)=>`corpus-${createHash("sha256").update(String(index)).digest("hex")}`)];
  const question:AnswerQuestion={question:"What is supported?",locale:"en",mode:"fast",answerMode:"short",
    temporalScope:{kind:"current"},unresolved:[],evidence:ids.map(id=>({
      source:{id,actTitle:"Synthetic official evidence",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
        revisionDate:null,lastCheckedAt:"2026-09-26",locale:"en",publishedAt:null,sourceType:"lex",status:"current",
        verificationState:"verified",verifiedAt:"2026-09-26",contentSha256:"parent"},
      text:"An applicant may request a copy.",textSha256:"text",endpoint:{kind:"current"},origin:"indexed",
    }))};
  context.mock.method(globalThis,"fetch",async (_url:unknown,init?:RequestInit)=>{
    const body=JSON.parse(String(init?.body));
    assert.equal(body.text.verbosity,"low","Short answers use the provider's concise output profile");
    const schema=body.text.format.schema;
    const resolve=(value:ProviderSchemaNode):ProviderSchemaNode=>value.$ref
      ? resolve(value.$ref.slice(2).split("/").reduce((node:Record<string,unknown>,key:string)=>
        node[key] as Record<string,unknown>,schema) as ProviderSchemaNode) : value;
    assert.deepEqual(Object.keys(schema.properties),["answer"],"Coverage belongs to the independent audit, not a second writer-authored reference map");
    const wireIds=ids.map((_,index)=>`s${index}`);
    assert.deepEqual(JSON.parse(body.input).context.evidence.map((item:{id:string})=>item.id),wireIds,
      "Every source still reaches the writer");
    const mainPoint=resolve(resolve(schema.properties.answer).properties!.mainPoint!);
    assert.deepEqual(resolve(resolve(mainPoint.properties!.sourceIds!).items!).enum,wireIds);
    return Response.json({output:[{content:[{type:"output_text",text:JSON.stringify({
      answer:{mainPoint:{text:"The applicant may request a copy. [s1, s2] Keep [the original], [s3], [s0] and [s1](https://example.com).",sourceIds:[wireIds[1],wireIds[2]]},
        issues:[],risks:[],questions:[],unresolved:[]},
    })}]}]});
  });
  const draft=legalDraftSchema.parse(await createLegalAnswerModel({requestId:"source-grammar"}).write({question,correction:null}));
  assert.deepEqual(draft.mainPoint.sourceIds,[ids[1],ids[2]]);
  assert.equal(draft.mainPoint.text,"The applicant may request a copy. Keep [the original], [s3], [s0] and [s1](https://example.com).",
    "Remove redundant declared transport citations only; preserve ordinary brackets, undeclared aliases, canonical IDs and links");
});

test("a stalled answer provider is cancelled by the selected chat mode watchdog",async context=>{
  const previousKey=env.OPENAI_API_KEY;env.OPENAI_API_KEY="test-key";
  context.after(()=>{env.OPENAI_API_KEY=previousKey;});
  context.mock.timers.enable({apis:["setTimeout"]});
  for(const [mode,limit] of [["fast",60_000],["deep",60_000]] as const) {
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
  const payloads: Array<{model:string;input:string;prompt_cache_options?:unknown;reasoning:{effort:string;mode:string};text:{verbosity:string;format:{strict:boolean}}}> = [];
  context.mock.method(globalThis, "fetch", async (_url: string | URL | Request, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    assertStrictProviderObjects(body.text.format.schema);
    payloads.push(body);
    return Response.json({ id: "response", model: body.model,
      output: [{ content: [{ type: "output_text", text: JSON.stringify({
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
      topics:["Record request eligibility", "Application procedure"],
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
  assert.deepEqual(payloads.map(body => body.text.verbosity), ["medium", "medium"]);
  assert.deepEqual({...payloads[0],model:payloads[1]!.model},payloads[1],"Mode changes only the provider model");
  assert.deepEqual(payloads.map(body => body.prompt_cache_options),[undefined,undefined],"Writing retains provider caching in both modes");
  assert.deepEqual(payloads.map(body=>body.reasoning),[
    {effort:"low",mode:"standard"},{effort:"low",mode:"standard"},
  ]);
  assert.equal(observations.length, 2);
  for (const body of payloads) {
    assert.equal(body.text.format.strict, true);
    assert.ok(!body.input.includes("fingerprint"));
    assert.ok(!body.input.includes("https://lex.uz"));
    assert.ok(body.input.includes("Official provision"));
    const input=JSON.parse(body.input);
    assert.deepEqual(input.context.topics,["Record request eligibility", "Application procedure"]);
    assert.deepEqual(input.context.privateDocuments,[{id:privateDocumentContext().source.id,
      title:"Uploaded agreement",text:privateDocumentContext().text}]);
    assert.doesNotMatch(body.input,/juro-private:|private-object-checksum/);
    assert.ok(input.context.evidence[0].passages.length <=160);
    assert.equal(input.context.evidence[0].passages.map((passage:{text:string})=>passage.text).join("\n"),
      sourceText);
  }
});

test("a fabricated citation is rejected before a draft can reach verification", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      answer: {mainPoint:{text:"Pay the penalty",sourceIds:["fabricated-source"]}, issues:[],risks:[],questions:[],unresolved:[]},
    }) }] }], usage: {input_tokens:10,output_tokens:10},
  }));
  const question: AnswerQuestion = {
    question:"What should I do?", locale:"en", mode:"fast", answerMode:"detailed", temporalScope:{kind:"current"}, unresolved:[],
    evidence:[{source:{id:"source",actTitle:"Official text",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
      revisionDate:null,lastCheckedAt:"2026-09-14",locale:"en",publishedAt:null,sourceType:"lex",status:"current",
      verificationState:"verified",verifiedAt:"2026-09-14",contentSha256:"parent"},
      text:"The person may request review.",textSha256:"text",endpoint:{kind:"current"},origin:"indexed"}],
  };
  await assert.rejects(createLegalAnswerModel({requestId:"forged-passage"}).write({question,correction:null}),
    (error:unknown)=>error instanceof Error && "code" in error && error.code==="INVALID_AI_OUTPUT");
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
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      answer: { mainPoint: { reuse: "mainPoint" },
        issues: [{ finding: { reuse: findingReuse }, actions: [{ title: "Request review",
          instruction: "Record the written-notice date and request review within ten days after it.", sourceIds: [actionSource] }] }],
        risks: [], questions: [], unresolved: [],
      },
    }) }] }], usage: { input_tokens: 10, output_tokens: 10 },
  }));
  question.evidence=[...question.evidence,{...question.evidence[0]!,source:{...question.evidence[0]!.source,id:"unrelated-source"}}];
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

test("qualified issues preserve action membership without duplicating explanatory text", async context => {
  const previousKey = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-key";
  context.after(() => { env.OPENAI_API_KEY = previousKey; });
  const question: AnswerQuestion = { question: "How do I apply?", locale: "en", mode: "fast", answerMode: "detailed",
    temporalScope: { kind: "current" }, unresolved: [], evidence: [] };
  for(const id of ["rule","procedure",...Array.from({length:12},(_,index)=>`source-${index}`),"additional-source"]) {
    question.evidence=[...question.evidence,{source:{id,actTitle:"Synthetic rule",actIdentifier:null,officialUrl:"https://lex.uz/docs/123",
      revisionDate:null,lastCheckedAt:"2026-09-26",locale:"en",publishedAt:null,sourceType:"lex",status:"current",
      verificationState:"verified",verifiedAt:"2026-09-26",contentSha256:"parent"},text:"A synthetic rule.",
      textSha256:"text",endpoint:{kind:"current"},origin:"indexed"}];
  }
  let explanation = "Workers may apply within ten days after written notice.";
  let instruction = "Record the notice date and submit your application.";
  let findingSources = ["rule"];
  let instructionSources = ["rule", "procedure"];
  let reuseAction = false;
  let hasAction = true;
  context.mock.method(globalThis, "fetch", async () => Response.json({
    id: "response", model: "gpt-5.6-luna", output: [{ content: [{ type: "output_text", text: JSON.stringify({
      answer: {
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
