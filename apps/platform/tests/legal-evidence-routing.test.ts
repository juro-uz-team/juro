import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {createAiExecutionBudget} from "../lib/ai/execution-budget";
import {legalAiProvider, type LegalChatRequest, type LegalSourceContext} from "../lib/ai/provider";

const rule = "The buyer must register ownership. The seller must submit the transfer notice.";
const source: LegalSourceContext = {id: "official:registration", actTitle: "Registration rules", article: "1",
  actIdentifier: "777", officialUrl: "https://lex.uz/docs/777", revisionDate: "2026-09-01",
  lastCheckedAt: "2026-09-14T00:00:00Z", locale: "en", publishedAt: null, sourceType: "lex", status: "verified",
  verificationState: "direct_validated", verifiedAt: "2026-09-14T00:00:00Z", contentSha256: "a".repeat(64),
  applicabilityStatus: "current", sourceClass: "OFFICIAL_LEGISLATION",
  sourceQuality: {passed: true, title: true, sufficientText: true, clean: true, locale: true, canonicalUrl: true, structured: true},
  spans: [{id: "complete", article: "1", paragraph: null, text: rule, textSha256: "b".repeat(64), quality: "high"}]};

for (const mode of ["fast", "deep"] as const) test(`${mode} evidence routing preserves full question and sources at the provider boundary`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const model = mode === "fast" ? "gpt-5.6-luna" : "gpt-5.6-terra";
  const input: LegalChatRequest = {question: "What must the buyer and seller do?", sources: [source], locale: "en",
    answerMode: "detailed", reasoningMode: mode, legalDatabaseAsOf: source.verifiedAt,
    requestId: "routing-request", safetyIdentifier: "routing-owner", coverageRequirements: [
      {id: "buyer", statement: "Buyer registration", priority: "core", sourceIds: [source.id]},
      {id: "seller", statement: "Seller notification", priority: "core", sourceIds: [source.id]},
    ]};
  const before = structuredClone(input);
  let controls = 0;
  const observations: Array<{part: string; outcome: string}> = [];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    assert.equal(request.model, model);
    assert.equal(request.text.format.name, "juro_legal_evidence_routing");
    assert.deepEqual(request.text.format.schema.properties.seller.properties.support.items.properties.sourceId.enum, [source.id]);
    assert.equal(payload.question, input.question);
    assert.deepEqual(payload.requirements.map((scope: {id: string}) => scope.id), ["seller"]);
    assert.equal(payload.requirements[0].statement, input.coverageRequirements![1]!.statement);
    assert.equal(payload.requirements[0].sourceIds, undefined, "discovery mappings cannot supply a sufficiency verdict");
    assert.deepEqual(payload.sources[0].spans, source.spans);
    assert.equal(payload.safetyIdentifier, undefined);
    assert.equal(payload.sources[0].citationEvidenceReceipt, undefined);
    return Response.json({id: "routing-response", model, output: [{content: [{type: "output_text", text: JSON.stringify({
      seller: {decision: "sufficient", support: [{sourceId: source.id, quotation: "The seller must submit the transfer notice."}], missingEvidenceQuestion: ""},
    })}]}], usage: {input_tokens: 40, output_tokens: 20}});
  });
  const routed = await legalAiProvider()!.assessEvidence!(input, ["seller"], {provider: "openai", model}, {
    beforeProviderCall: async () => {controls++;}, onProviderAttemptFinished: observation => {observations.push(observation);},
  });
  assert.equal(routed.data.seller?.decision, "sufficient");
  assert.equal(routed.usage.inputTokens, 40);
  assert.equal(routed.attempts, 1);
  assert.equal(controls, 1);
  assert.deepEqual(observations.map(item => [item.part, item.outcome]), [["evidence_validation", "completed"]]);
  assert.deepEqual(input, before);
});

for (const corruption of ["secondary", "unverified", "wrong-publisher", "historical", "source-hash", "span-hash"] as const) test(`evidence routing cannot authorize repair from ${corruption} source witnesses`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const candidate: LegalSourceContext = {...source,
    ...(corruption === "secondary" ? {sourceClass: "SECONDARY_REFERENCE" as const} : {}),
    ...(corruption === "unverified" ? {verificationState: "unverified"} : {}),
    ...(corruption === "wrong-publisher" ? {officialUrl: "https://example.com/docs/777"} : {}),
    ...(corruption === "historical" ? {applicabilityStatus: "historical" as const} : {}),
    ...(corruption === "source-hash" ? {contentSha256: "missing"} : {}),
    ...(corruption === "span-hash" ? {spans: [{...source.spans![0]!, textSha256: "missing"}]} : {})};
  const input: LegalChatRequest = {question: "What must the seller do now?", sources: [candidate], locale: "en",
    answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt,
    requestId: "untrusted-routing", safetyIdentifier: "test", coverageRequirements: [
      {id: "seller", statement: "Current seller duty", priority: "core", sourceIds: [source.id]},
    ]};
  context.mock.method(globalThis, "fetch", async () => Response.json({id: "untrusted-routing", model: "gpt-5.6-terra",
    output: [{content: [{type: "output_text", text: JSON.stringify({seller: {decision: "sufficient",
      support: [{sourceId: source.id, quotation: rule}], missingEvidenceQuestion: ""}})}]}], usage: {input_tokens: 40, output_tokens: 20}}));
  await assert.rejects(legalAiProvider()!.assessEvidence!(input, ["seller"], {provider: "openai", model: "gpt-5.6-terra"}),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_AI_OUTPUT");
});

for (const matchingEndpoint of [true, false]) test(`historical routing ${matchingEndpoint ? "retains" : "rejects"} the source endpoint`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const instant = "2025-01-01T00:00:00Z";
  const historical = {...source, applicabilityStatus: "historical" as const,
    effectiveDate: matchingEndpoint ? instant : "2024-01-01T00:00:00Z"};
  const input: LegalChatRequest = {question: "What was the seller duty on 1 January 2025?", applicableAt: instant,
    sources: [historical], locale: "en", answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt,
    requestId: "historical-routing", safetyIdentifier: "test", coverageRequirements: [
      {id: "seller", statement: "Historical seller duty", priority: "core", sourceIds: [source.id]},
    ]};
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const payload = JSON.parse(JSON.parse(String(init.body)).input);
    assert.equal(payload.applicableAt, instant);
    assert.equal(payload.sources[0].effectiveDate, historical.effectiveDate);
    return Response.json({id: "historical-routing", model: "gpt-5.6-terra", output: [{content: [{type: "output_text",
      text: JSON.stringify({seller: {decision: "sufficient", support: [{sourceId: source.id, quotation: rule}], missingEvidenceQuestion: ""}})}]}],
      usage: {input_tokens: 40, output_tokens: 20}});
  });
  const pending = legalAiProvider()!.assessEvidence!(input, ["seller"], {provider: "openai", model: "gpt-5.6-terra"});
  if (matchingEndpoint) assert.equal((await pending).data.seller?.decision, "sufficient");
  else await assert.rejects(pending, (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_AI_OUTPUT");
});

for (const corruption of ["empty-support", "foreign-source", "noncontiguous", "missing-scope", "surplus-scope", "contradictory"] as const) {
  test(`the provider boundary rejects ${corruption} routing output`, async context => {
    const previous = env.OPENAI_API_KEY;
    env.OPENAI_API_KEY = "test-only-key";
    context.after(() => {env.OPENAI_API_KEY = previous;});
    const input: LegalChatRequest = {question: "What must the seller do?", sources: [source], locale: "en", answerMode: "detailed",
      reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt, requestId: "malformed-routing", safetyIdentifier: "test",
      coverageRequirements: [{id: "seller", statement: "Seller duty", priority: "core", sourceIds: [source.id]}]};
    const decision = {decision: "sufficient", support: corruption === "empty-support" ? [] : [{
      sourceId: corruption === "foreign-source" ? "official:foreign" : source.id,
      quotation: corruption === "noncontiguous" ? "The buyer ... the transfer notice." : rule}],
      missingEvidenceQuestion: corruption === "contradictory" ? "Which missing rule applies?" : ""};
    const data = corruption === "missing-scope" ? {} : {seller: decision,
      ...(corruption === "surplus-scope" ? {foreign: decision} : {})};
    let calls = 0;
    context.mock.method(globalThis, "fetch", async () => {calls++; return Response.json({id: "malformed-routing", model: "gpt-5.6-terra",
      output: [{content: [{type: "output_text", text: JSON.stringify(data)}]}], usage: {input_tokens: 40, output_tokens: 20}});});
    await assert.rejects(legalAiProvider()!.assessEvidence!(input, ["seller"], {provider: "openai", model: "gpt-5.6-terra"}),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_AI_OUTPUT");
    assert.equal(calls, 1);
  });
}

for (const swapped of [false, true]) test(`concurrent routing ${swapped ? "rejects a foreign" : "keeps each request's"} source decision`, async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const makeInput = (owner: string): LegalChatRequest => ({question: `What is the seller duty for ${owner}?`,
    sources: [{...source, id: `official:${owner}`, spans: [{...source.spans![0]!, text: `The seller must notify registry ${owner}.`}]}],
    locale: "en", answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt,
    requestId: `request-${owner}`, safetyIdentifier: `owner-${owner}`, coverageRequirements: [
      {id: "seller", statement: `Seller duty for ${owner}`, priority: "core", sourceIds: [`official:${owner}`]},
    ]});
  const left = makeInput("alpha"), right = makeInput("beta");
  let ready!: () => void;
  const dispatched = new Promise<void>(resolve => {ready = resolve;});
  const pending: Array<{question: string; resolve: (response: Response) => void}> = [];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => new Promise<Response>(resolve => {
    const payload = JSON.parse(JSON.parse(String(init.body)).input);
    pending.push({question: payload.question, resolve});
    if (pending.length === 2) ready();
  }));
  const execution = {provider: "openai" as const, model: "gpt-5.6-terra"};
  const leftResult = legalAiProvider()!.assessEvidence!(left, ["seller"], execution);
  const rightResult = legalAiProvider()!.assessEvidence!(right, ["seller"], execution);
  await dispatched;
  const response = (input: LegalChatRequest) => Response.json({id: input.requestId, model: execution.model,
    output: [{content: [{type: "output_text", text: JSON.stringify({seller: {decision: "sufficient",
      support: [{sourceId: input.sources[0]!.id, quotation: input.sources[0]!.spans![0]!.text}], missingEvidenceQuestion: ""}})}]}],
    usage: {input_tokens: 40, output_tokens: 20}});
  pending.find(item => item.question === right.question)!.resolve(response(right));
  assert.equal((await rightResult).data.seller?.support[0]?.sourceId, "official:beta");
  pending.find(item => item.question === left.question)!.resolve(response(swapped ? right : left));
  if (swapped) await assert.rejects(leftResult, (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_AI_OUTPUT");
  else assert.equal((await leftResult).data.seller?.support[0]?.sourceId, "official:alpha");
});

for (const phase of ["before-dispatch", "during-admission", "during-fetch"] as const) {
  test(`budget caller cancellation stops evidence routing ${phase}`, async context => {
    const previous = env.OPENAI_API_KEY;
    env.OPENAI_API_KEY = "test-only-key";
    context.after(() => {env.OPENAI_API_KEY = previous;});
    const caller = new AbortController();
    const budget = createAiExecutionBudget({callerSignal: caller.signal, enforceOverallTimeout: false});
    context.after(() => budget.dispose());
    const input: LegalChatRequest = {question: "What must the seller do?", sources: [source], locale: "en",
      answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt,
      requestId: "cancelled-routing", safetyIdentifier: "test", coverageRequirements: [
        {id: "seller", statement: "Seller duty", priority: "core", sourceIds: [source.id]},
      ]};
    let calls = 0;
    let fetchCancelled = false;
    context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      calls++;
      if (phase === "during-fetch") {
        caller.abort();
        fetchCancelled = init.signal?.aborted === true;
        init.signal?.throwIfAborted();
      }
      return Response.json({id: "cancelled-routing", model: "gpt-5.6-terra", output: [{content: [{type: "output_text",
        text: JSON.stringify({seller: {decision: "sufficient", support: [{sourceId: source.id, quotation: rule}], missingEvidenceQuestion: ""}})}]}],
        usage: {input_tokens: 40, output_tokens: 20}});
    });
    if (phase === "before-dispatch") caller.abort();
    await assert.rejects(legalAiProvider()!.assessEvidence!(input, ["seller"], {provider: "openai", model: "gpt-5.6-terra"}, {
      budget, beforeProviderCall: async () => {if (phase === "during-admission") caller.abort();},
    }));
    assert.equal(calls, phase === "during-fetch" ? 1 : 0);
    if (phase === "during-fetch") assert.equal(fetchCancelled, true);
  });
}
