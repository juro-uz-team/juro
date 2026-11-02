import assert from "node:assert/strict";
import test from "node:test";
import { createWritingProjection, type WritingDraft } from "../lib/legal-answer-workflow/writing-stream";
import { readProviderResponse } from "../lib/legal-answer-workflow/provider-stream";
import { citationProseNormalizer } from "../lib/legal-answer-workflow/citation-prose";
import { IssueWriting } from "../lib/legal-answer-workflow/issue-writing";
import { writtenAnswerSchema } from "../lib/legal-answer-workflow/contracts";

test("prepared research issues appear only after the streamed opening, before supporting sections", () => {
  const writing = new IssueWriting("en");
  writing.commit([{ id: "permit", baseVersion: "0", change: "upsert", reason: "", sourceIds: ["s1"],
    content: { title: "Permit", explanation: "The complete rule.", sourceIds: ["s1"], requirementIds: ["r1"], actions: [] },
  }], new Set(["s1"]), new Set(["r1"]));
  const drafts: WritingDraft[] = [];
  const write = createWritingProjection(draft => drafts.push(writing.publicSnapshot(draft)), undefined, true);
  write('{"turn":{"decision":"answer","content":{"summary":"The Main');
  assert.deepEqual(drafts.at(-1)!.blocks.map(block => block.key), ["turn/content/summary"]);
  write(' Point.","summarySourceIds":["s1"],"conditionalBranches":[{"condition":"Private event","outcome":"Exempt');
  assert.ok(drafts.at(-1)!.blocks.every(block => !block.key.startsWith("issue/")));
  write('","sourceIds":["s1"]}]');
  assert.equal(drafts.at(-1)!.blocks.at(-1)!.text, "The complete rule.");
  write(',"assumptions":[],"risks":[],"deadlines":[{"title":"Deadline","calculationMethod":"Ten days","sourceIds":["s1"]}],"requiredDocuments":[],"referenceNotes":[],"clarificationQuestions":[]}}}');
  const keys = drafts.at(-1)!.blocks.map(block => block.key);
  assert.ok(keys.indexOf("turn/content/conditionalBranches/0/outcome") < keys.indexOf("issue/permit/title"));
  assert.ok(keys.indexOf("issue/permit/explanation") < keys.indexOf("turn/content/deadlines/0/title"));
  assert.deepEqual(drafts.at(-1)!.citations?.["issue/permit/explanation"], ["s1"]);
  assert.deepEqual(Object.keys(writtenAnswerSchema.shape).slice(0, 4), ["summary", "summarySourceIds", "conditionalBranches", "issues"]);
});

test("qualified issue prose waits for the Main Point and conditional branches", () => {
  const drafts: WritingDraft[] = [];
  const write = createWritingProjection(draft => drafts.push(draft));
  write('{"turn":{"decision":"answer","content":{"issues":[{"title":"Permit","explanation":[{"statement":"Public events need a permit; private gatherings are exempt.","sourceIds":["s1"]}],"requirementIds":["permit"],"actions":[]}],');
  assert.equal(drafts.length, 0);
  write('"summary":"The permit requirement applies to public events.","summarySourceIds":["s1"],');
  assert.deepEqual(drafts.at(-1)!.blocks.map(block => block.key), ["turn/content/summary"]);
  write('"conditionalBranches":[]}}}');
  const final = drafts.at(-1)!;
  assert.ok(final.blocks.some(block => block.text === "Public events need a permit; private gatherings are exempt."));
  assert.ok(final.blocks.some(block => block.text === "The permit requirement applies to public events."));
});

test("streamed citation suffixes agree with saved prose without hiding quoted literal tokens", () => {
  for (const literal of [false, true]) {
    const drafts: WritingDraft[] = [];
    const write = createWritingProjection(draft => drafts.push(draft), citationProseNormalizer(literal ? "[s1]" : undefined));
    write('{"turn":{"decision":"answer","content":{"summary":"Есть право.');
    assert.equal(drafts.at(-1)?.blocks[0].text, "Есть право.");
    for (const delta of [' ', '[', 's', '1', ']', '","summarySourceIds":["s1"]']) write(delta);
    assert.equal(drafts.at(-1)?.blocks[0].text, literal ? "Есть право. [s1]" : "Есть право.");
    write('}}}');
    assert.ok(drafts.every((draft, index) => index === 0 || draft.blocks[0].text.startsWith(drafts[index - 1].blocks[0].text)));
    if (!literal) assert.ok(drafts.every(draft => !draft.blocks[0].text.includes("[")));
  }
});

test("grouped citation annotations are normalized consistently while literal groups remain intact", () => {
  for (const literal of [false, true]) {
    const drafts: WritingDraft[] = [];
    const normalize = citationProseNormalizer(literal ? "[s1, s2]" : undefined);
    const write = createWritingProjection(draft => drafts.push(draft), normalize);
    for (const char of '{"turn":{"decision":"answer","content":{"summary":"A rule. [s1, s2]","summarySourceIds":["s1","s2"]}}}') write(char);
    assert.equal(drafts.at(-1)?.blocks[0].text, literal ? "A rule. [s1, s2]" : "A rule.");
    assert.equal(drafts.at(-1)?.blocks[0].text, normalize("A rule. [s1, s2]", ["s1", "s2"]));
    assert.ok(drafts.every((draft, index) => index === 0 || draft.blocks[0].text.startsWith(drafts[index - 1].blocks[0].text)));
  }
});

test("Uzbek word apostrophes preserve citation cleanup throughout fragmented writing", () => {
  for (const apostrophe of ["'", "‘", "’", "ʻ", "ʼ"]) {
    const drafts: WritingDraft[] = [];
    const prose = `Ota-onaning o${apostrophe}zaro kelishuvi hisobga olinadi.`;
    const write = createWritingProjection(draft => drafts.push(draft));
    for (const char of JSON.stringify({ turn: { decision: "answer", content: {
      summary: `${prose} [s1]`, summarySourceIds: ["s1"],
    } } })) write(char);
    assert.equal(drafts.at(-1)?.blocks[0].text, prose);
    assert.ok(drafts.every(draft => !draft.blocks.some(block => block.text.includes("[s"))));
  }
});

test("bracketed citation suffixes stay private across token boundaries and preserve source literals", () => {
  for (const annotation of ["【s1】【s2】", "(s1) (s2)", "(s1, s2)"])
  for (const literal of [false, true]) for (const space of ["", " "]) {
    const text = `A rule.${space}${annotation}`;
    const normalize = citationProseNormalizer(literal ? annotation : undefined);
    const drafts: WritingDraft[] = [];
    const write = createWritingProjection(draft => drafts.push(draft), normalize);
    for (const char of JSON.stringify({ turn: { decision: "answer", content: {
      summary: text, summarySourceIds: ["s1", "s2"],
    } } })) write(char);
    assert.equal(drafts.at(-1)?.blocks[0].text, literal ? text : "A rule.");
    assert.equal(drafts.at(-1)?.blocks[0].text, normalize(text, ["s1", "s2"]));
    if (!literal) assert.ok(drafts.every(draft => !draft.blocks[0].text.includes(annotation[0])));
  }
});

test("unfinished structured output streams only answer prose, preserving split escapes and non-Latin text", () => {
  const drafts: WritingDraft[] = [];
  const write = createWritingProjection(draft => drafts.push(draft));
  write('{"turn":{"decision":"answer","content":{"summary":"Закон: ');
  assert.equal(drafts.at(-1)?.blocks[0].text, "Закон: ");
  write('\\u00');
  assert.equal(drafts.at(-1)?.blocks[0].text, "Закон: ");
  write('abда\\u00bb","summarySourceIds":["s1"],"conditionalBranches":[],"issues":[{"title":"Правило","explanation":[{"statement":"Есть право.","sourceIds":["secret"]}]}]}}}');
  assert.deepEqual(drafts.at(-1)?.blocks.map(block => block.text), ["Закон: «да»", "Правило", "Есть право."]);
  assert.ok(!JSON.stringify(drafts.map(draft=>draft.blocks)).includes("secret"));
  assert.deepEqual(drafts.at(-1)?.citations?.["turn/content/issues/0/explanation/0/statement"],["secret"]);
});

test("research, insufficient results and nested user-like prose never become streamed answers", () => {
  const drafts: WritingDraft[] = [];
  for (const decision of ["research", "insufficient_evidence"]) {
    createWritingProjection(draft => drafts.push(draft))(JSON.stringify({ turn: { decision, content: null,
      gaps: [{ description: "Private research" }], actions: [{ query: "Private search" }] } }));
  }
  assert.deepEqual(drafts, []);
});

test("provider stream delivers text before completion and excludes commentary, tools and reasoning", async () => {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const frame = (value: unknown) => { for (const byte of encoder.encode(`data: ${JSON.stringify(value)}\r\n\r\n`)) controller.enqueue(Uint8Array.of(byte)); };
  const texts: string[] = [];
  let first!: () => void;
  const firstText = new Promise<void>(resolve => { first = resolve; });
  const reading = readProviderResponse(new Response(body, { headers: { "content-type": "text/event-stream" } }),
    new AbortController().signal, text => { texts.push(text); first(); });
  frame({ type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant", phase: "commentary" } });
  frame({ type: "response.output_text.delta", output_index: 0, delta: "Hidden commentary" });
  frame({ type: "response.function_call_arguments.delta", delta: "Hidden tool arguments" });
  frame({ type: "response.output_item.added", output_index: 2, item: { type: "function_call", name: "research_law" } });
  frame({ type: "response.function_call_arguments.delta", output_index: 2,
    delta: '{"opening":{"summarySourceIds":["s1"],"summary":"A preliminary conclusion."}}' });
  frame({ type: "response.output_item.added", output_index: 1, item: { type: "message", role: "assistant", phase: "final_answer" } });
  frame({ type: "response.output_text.delta", output_index: 1, delta: "Правило" });
  await firstText;
  assert.deepEqual(texts, ["Правило"]);
  frame({ type: "response.completed", response: { id: "saved-provider-response", usage: { input_tokens: 1 } } });
  controller.close();
  assert.deepEqual(await reading, { id: "saved-provider-response", usage: { input_tokens: 1 } });
});

test("an interrupted provider stream is not a completed answer", async () => {
  await assert.rejects(readProviderResponse(new Response('data: {"type":"response.created"}\n\n',
    { headers: { "content-type": "text/event-stream" } }), new AbortController().signal), /PROVIDER_OUTPUT_INCOMPLETE/u);
});

test("stream errors retain only allowlisted diagnostic labels without exposing provider messages", async () => {
  for (const nested of [false, true]) {
    const observed: unknown[] = [];
    const error = { type: "invalid_request_error", code: "context_length_exceeded", param: "input", message: "Private echoed input" };
    const event = nested ? { type: "error", error } : { ...error, type: "error" };
    const response = new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });
    await assert.rejects(readProviderResponse(response, new AbortController().signal, undefined,
      metadata => observed.push(metadata)), /PROVIDER_STREAM_FAILED/);
    assert.deepEqual(observed, [{ type: nested ? "invalid_request_error" : "unrecognized", code: "context_length_exceeded", param: "input" }]);
    assert.ok(!JSON.stringify(observed).includes("Private"));
  }
});
