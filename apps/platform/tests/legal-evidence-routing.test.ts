import assert from "node:assert/strict";
import test from "node:test";
import {env} from "cloudflare:workers";
import {createAiExecutionBudget} from "../lib/ai/execution-budget";
import {legalAiProvider, type LegalChatRequest, type LegalSourceContext} from "../lib/ai/provider";
import {hasRequiredEvidenceReference} from "../lib/ai/legal-evidence-routing";

const completeSpans = (spans: Array<{sentences?: Array<{text: string}>; [key: string]: unknown}>) =>
  spans.map(({sentences, ...span}) => sentences ? {...span, text: sentences.map(part => part.text).join("")} : span);

const rule = "The buyer must register ownership. The seller must submit the transfer notice.";
const source: LegalSourceContext = {id: "official:registration", actTitle: "Registration rules", article: "1",
  actIdentifier: "777", officialUrl: "https://lex.uz/docs/777", revisionDate: "2026-09-01",
  lastCheckedAt: "2026-09-14T00:00:00Z", locale: "en", publishedAt: null, sourceType: "lex", status: "verified",
  verificationState: "direct_validated", verifiedAt: "2026-09-14T00:00:00Z", contentSha256: "a".repeat(64),
  applicabilityStatus: "current", sourceClass: "OFFICIAL_LEGISLATION",
  sourceQuality: {passed: true, title: true, sufficientText: true, clean: true, locale: true, canonicalUrl: true, structured: true},
  spans: [{id: "complete", article: "1", paragraph: null, text: rule, textSha256: "b".repeat(64), quality: "high"}]};

test("routing resolves separated support references before normal evidence validation", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const text = "An ordinary rule applies. A separate rule intervenes. An exception qualifies the ordinary rule.";
  const input: LegalChatRequest = {question: "Which rules apply?", sources: [{...source, spans: [{...source.spans![0]!, text}]}],
    locale: "en", answerMode: "detailed", reasoningMode: "fast", legalDatabaseAsOf: source.verifiedAt,
    requestId: "routing-references", safetyIdentifier: "test", coverageRequirements: [
      {id: "rule", statement: "The ordinary rule and its exception", priority: "core", sourceIds: []},
    ]};
  let passageIds = ["s1-1:p0", "s1-1:p2"];
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    assert.equal(payload.sources[0].spans[0].sentences.map((part: {text: string}) => part.text).join(""), text);
    assert.equal(request.max_output_tokens, 1_600);
    return Response.json({id: "routing-reference", model: request.model, output: [{content: [{type: "output_text", text: JSON.stringify({
      rule: {decision: "sufficient", support: [{passageIds}], missingEvidenceQuestion: ""},
    })}]}], usage: {input_tokens: 40, output_tokens: 20}});
  });
  const execution = {provider: "openai" as const, model: "gpt-5.6-luna"};
  const assessed = await legalAiProvider()!.assessEvidence!(input, ["rule"], execution);
  assert.deepEqual(assessed.data.rule!.support, [
    {sourceId: source.id, quotation: "An ordinary rule applies. "},
    {sourceId: source.id, quotation: "An exception qualifies the ordinary rule."},
  ]);
  for (passageIds of [["s1-1:p0", "s1-1:p0"], ["foreign"]]) {
    await assert.rejects(legalAiProvider()!.assessEvidence!(input, ["rule"], execution),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_AI_OUTPUT");
  }
});

for (const variant of ["long", "foreign", "mutation", "dependency"] as const) {
  test(`routing reference transport preserves ${variant} evidence semantics`, async context => {
    const previous = env.OPENAI_API_KEY;
    env.OPENAI_API_KEY = "test-only-key";
    context.after(() => {env.OPENAI_API_KEY = previous;});
    const text = variant === "long" ? "A".repeat(2_001)
      : variant === "dependency" ? "Применяются условия статьи 147 настоящего Кодекса." : rule;
    const input: LegalChatRequest = {question: "Which rule applies?", sources: [{...structuredClone(source),
      locale: variant === "dependency" ? "ru" : "en", spans: [{...source.spans![0]!, text}]}],
      locale: variant === "foreign" || variant === "dependency" ? "ru" : "en", answerMode: "detailed", reasoningMode: "fast",
      legalDatabaseAsOf: source.verifiedAt, requestId: "routing-reference-boundary", safetyIdentifier: "test",
      coverageRequirements: [{id: "rule", statement: "Applicable rule", priority: "core", sourceIds: []}]};
    context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
      const request = JSON.parse(String(init.body)), payload = JSON.parse(request.input);
      const span = payload.sources[0].spans[0];
      assert.equal(variant === "foreign" ? span.text : span.sentences.map((part: {text: string}) => part.text).join(""), text);
      if (variant === "mutation") input.sources[0]!.spans![0]!.text = "Changed after dispatch.";
      return Response.json({id: "routing-reference-boundary", model: request.model, output: [{content: [{type: "output_text", text: JSON.stringify({
        rule: {decision: "sufficient", support: [variant === "foreign" ? {sourceId: source.id, quotation: text}
          : {passageIds: span.sentences.map((part: {sourcePassageId: string}) => part.sourcePassageId)}], missingEvidenceQuestion: "",
        ...(variant === "dependency" ? {referenceApplicability: {[payload.missingReferences[0].id]: "outside"}} : {})},
      })}]}], usage: {input_tokens: 40, output_tokens: 20}});
    });
    const assessed = await legalAiProvider()!.assessEvidence!(input, ["rule"], {provider: "openai", model: "gpt-5.6-luna"});
    assert.deepEqual(assessed.data.rule!.support, [{sourceId: source.id, quotation: text}]);
    if (variant === "dependency") assert.equal(hasRequiredEvidenceReference(input, input.sources[0]!, assessed.data.rule), true);
  });
}

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
    assert.deepEqual(request.text.format.schema.properties.seller.properties.support.items.anyOf.find((option: {properties: {sourceId?: unknown}}) => option.properties.sourceId).properties.sourceId.enum, [source.id]);
    assert.equal(payload.question, input.question);
    assert.deepEqual(payload.requirements.map((scope: {id: string}) => scope.id), ["seller"]);
    assert.equal(payload.requirements[0].statement, input.coverageRequirements![1]!.statement);
    assert.equal(payload.requirements[0].sourceIds, undefined, "discovery mappings cannot supply a sufficiency verdict");
    assert.deepEqual(completeSpans(payload.sources[0].spans), source.spans);
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

test("evidence routing assesses every missing reference with full scope and source context", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const referring = "Secondment conditions are governed by article 147 of this Act.";
  const candidate = {...source, spans: [{...source.spans![0]!, text: `${rule} ${referring}`}]};
  const input: LegalChatRequest = {question: "What must the seller do?", sources: [candidate], locale: "en",
    answerMode: "detailed", reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt, requestId: "reference-context",
    safetyIdentifier: "test", coverageRequirements: [{id: "seller", statement: "Seller duty", priority: "core", sourceIds: [source.id]}]};
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const request = JSON.parse(String(init.body));
    const payload = JSON.parse(request.input);
    assert.equal(payload.question, input.question);
    assert.deepEqual(completeSpans(payload.sources[0].spans), candidate.spans);
    assert.deepEqual(payload.missingReferences, [{id: "ref-1", sourceId: source.id, sourceSpanId: source.spans![0]!.id,
      sourceSpanTextSha256: source.spans![0]!.textSha256, referencedArticle: "147", exactReferringSentence: referring,
      startUtf16: rule.length + 1, endUtf16: candidate.spans[0]!.text.length}]);
    assert.deepEqual(request.text.format.schema.properties.seller.properties.referenceApplicability.required, ["ref-1"]);
    return Response.json({id: "reference-context", model: "gpt-5.6-terra", output: [{content: [{type: "output_text",
      text: JSON.stringify({seller: {decision: "sufficient", support: [{sourceId: source.id, quotation: rule}], missingEvidenceQuestion: "",
        referenceApplicability: {"ref-1": "outside"}}})}]}], usage: {input_tokens: 40, output_tokens: 20}});
  });
  const result = await legalAiProvider()!.assessEvidence!(input, ["seller"], {provider: "openai", model: "gpt-5.6-terra"});
  assert.equal(result.data.seller?.referenceApplicability?.["ref-1"], "outside");
});

test("long repeated reference contexts retain complete sources without exceeding the evidence text bound", async context => {
  const previous = env.OPENAI_API_KEY;
  env.OPENAI_API_KEY = "test-only-key";
  context.after(() => {env.OPENAI_API_KEY = previous;});
  const text = `${rule} ${"Context ".repeat(3500)}article 147 of this Act and article 148 of this Act govern secondment.`;
  const candidate = {...source, spans: [{...source.spans![0]!, text}]};
  const input: LegalChatRequest = {question: "What must the seller do?", sources: [candidate], locale: "en", answerMode: "detailed",
    reasoningMode: "deep", legalDatabaseAsOf: source.verifiedAt, requestId: "long-reference-context", safetyIdentifier: "test",
    coverageRequirements: [{id: "seller", statement: "Seller duty", priority: "core", sourceIds: [source.id]}]};
  context.mock.method(globalThis, "fetch", async (_url: unknown, init: RequestInit) => {
    const payload = JSON.parse(JSON.parse(String(init.body)).input);
    assert.deepEqual(completeSpans(payload.sources[0].spans), candidate.spans);
    assert.equal(payload.missingReferences.length, 2);
    for (const reference of payload.missingReferences) {
      assert.equal(reference.exactReferringSentence, undefined, "full source text already supplies this long reference context");
      assert.equal(reference.sourceSpanId, source.spans![0]!.id);
      assert.equal(reference.sourceSpanTextSha256, source.spans![0]!.textSha256);
      assert.ok(text.slice(reference.startUtf16, reference.endUtf16).includes(`article ${reference.referencedArticle} of this Act`));
    }
    return Response.json({id: "long-reference-context", model: "gpt-5.6-terra", output: [{content: [{type: "output_text",
      text: JSON.stringify({seller: {decision: "sufficient", support: [{sourceId: source.id, quotation: rule}], missingEvidenceQuestion: "",
        referenceApplicability: {"ref-1": "outside", "ref-2": "outside"}}})}]}], usage: {input_tokens: 40, output_tokens: 20}});
  });
  const result = await legalAiProvider()!.assessEvidence!(input, ["seller"], {provider: "openai", model: "gpt-5.6-terra"});
  assert.equal(result.data.seller?.referenceApplicability?.["ref-2"], "outside");
});
