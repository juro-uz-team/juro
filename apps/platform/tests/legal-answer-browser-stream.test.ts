import assert from "node:assert/strict";
import test from "node:test";
import { readLegalChatStream, LegalChatClientError } from "../lib/legal-answer-workflow/browser-stream";
import { createAnswerEventStream } from "../lib/legal-answer-workflow/answer-stream";
import { requestLifetime } from "../lib/legal-answer-workflow/lifetime";
import type { WritingDraft } from "../lib/legal-answer-workflow/writing-stream";
import { createWritingProjection } from "../lib/legal-answer-workflow/writing-stream";
import { readProviderResponse } from "../lib/legal-answer-workflow/provider-stream";

test("explicit revisions replace and retract earlier prose without silently retaining obsolete text", async () => {
  const disconnected = new AbortController(), lifetime = requestLifetime(Date.now(), 30_000, disconnected.signal);
  const stream = createAnswerEventStream({ lifetime, disconnected, async execute(_budget, _progress, write) {
    write({ blocks: [{ key: "issue/a/explanation", text: "Earlier qualified rule." }, { key: "issue/b/explanation", text: "Unaffected rule." }] });
    write({ revision: 1, notices: ["Updated after reading an additional exception."],
      blocks: [{ key: "issue/a/explanation", text: "Revised" }, { key: "issue/b/explanation", text: "Unaffected rule." }] });
    write({ revision: 1, notices: ["Updated after reading an additional exception."],
      blocks: [{ key: "issue/a/explanation", text: "Revised rule with exception." }, { key: "issue/b/explanation", text: "Unaffected rule." }] });
    write({ revision: 2, notices: ["Updated after reading an additional exception.", "The second issue was retracted because its regime does not apply."],
      blocks: [{ key: "issue/a/explanation", text: "Revised rule with exception." }] });
    return null;
  } });
  const seen: WritingDraft[] = [];
  await assert.rejects(readLegalChatStream(new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    () => {}, undefined, draft => seen.push(draft)), /LEGAL_ANSWER_NOT_COMPLETED/);
  assert.equal(seen.length, 4);
  assert.deepEqual(seen.at(-1), { revision: 2,
    notices: ["Updated after reading an additional exception.", "The second issue was retracted because its regime does not apply."],
    blocks: [{ key: "issue/a/explanation", text: "Revised rule with exception." }] });
  assert.ok(!JSON.stringify(seen.at(-1)).includes("Earlier qualified rule"));
});

test("cancelling browser delivery after provider writing cancels generation without publishing", async () => {
  const disconnected = new AbortController(), browser = new AbortController();
  const lifetime = requestLifetime(Date.now(), 30_000, disconnected.signal);
  let providerCancelled = false, published = false;
  const encoder = new TextEncoder();
  const provider = new ReadableStream<Uint8Array>({ start(controller) {
    for (const event of [
      { type: "response.output_item.added", output_index: 0, item: { type: "message", role: "assistant" } },
      { type: "response.output_text.delta", output_index: 0, delta: '{"turn":{"decision":"answer","content":{"summary":"Правило действует.' },
    ]) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
  }, cancel() { providerCancelled = true; } });
  const stream = createAnswerEventStream({ lifetime, disconnected, async execute(_budget, _progress, write) {
    await readProviderResponse(new Response(provider, { headers: { "content-type": "text/event-stream" } }),
      lifetime.signal, createWritingProjection(write));
    published = true;
    return null;
  } });
  const seen: string[] = [];
  await assert.rejects(readLegalChatStream(new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    () => {}, browser.signal, draft => { seen.push(draft.blocks[0].text); browser.abort(new Error("Stopped")); }), /Stopped/u);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(seen, ["Правило действует."]);
  assert.equal(disconnected.signal.aborted, true);
  assert.equal(providerCancelled, true);
  assert.equal(published, false);
});

test("server writing reaches the browser incrementally before publication, and interrupted writing is not a saved result", async () => {
  const disconnected = new AbortController();
  const lifetime = requestLifetime(Date.now(), 30_000, disconnected.signal);
  let finish!: () => void;
  const gate = new Promise<void>(resolve => { finish = resolve; });
  const stream = createAnswerEventStream({ lifetime, disconnected, async execute(_budget, _progress, write) {
    write({ blocks: [{ key: "turn/content/summary", text: "A supported" }] });
    await gate;
    write({ blocks: [{ key: "turn/content/summary", text: "A supported rule." }] });
    throw new Error("Saving failed");
  } });
  const seen: WritingDraft[] = [];
  let first!: () => void;
  const arrived = new Promise<void>(resolve => { first = resolve; });
  const reading = readLegalChatStream(new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    () => {}, new AbortController().signal, draft => { seen.push(draft); first(); });
  await arrived;
  assert.equal(seen[0].blocks[0].text, "A supported");
  finish();
  await assert.rejects(reading, error => error instanceof LegalChatClientError && error.code === "LEGAL_ANSWER_UNAVAILABLE");
  assert.equal(seen.at(-1)?.blocks[0].text, "A supported rule.");
});

test("SSE handles CRLF split across byte chunks and displays continued research", async () => {
  const payload = 'event: progress\r\ndata: {"stage":"researching","targetMissed":true}\r\n\r\n'
    + 'event: error\r\ndata: {"code":"EXPECTED_ERROR","retryable":false}\r\n\r\n';
  const stages: string[] = [];
  const stream = new ReadableStream<Uint8Array>({ start(controller) {
    for (const byte of new TextEncoder().encode(payload)) controller.enqueue(Uint8Array.of(byte));
    controller.close();
  } });
  await assert.rejects(readLegalChatStream(new Response(stream, { headers: { "content-type": "text/event-stream" } }), stage => stages.push(stage)),
    error => error instanceof LegalChatClientError && error.code === "EXPECTED_ERROR" && !error.retryable);
  assert.deepEqual(stages, ["deeper_research"]);
});

test("public source metadata arrives before prose and survives subsequent deltas", async () => {
 const disconnected=new AbortController(), lifetime=requestLifetime(Date.now(),30_000,disconnected.signal);
 const sources=[{sourceId:"labor",actTitle:"Трудовой кодекс",actIdentifier:null,article:"Статья 408",excerpt:null,originalUrl:"https://lex.uz/docs/6257288#408",status:"unconfirmed" as const,effectiveDate:null,verifiedAt:"2026-11-03T00:00:00Z"}];
 const stream=createAnswerEventStream({lifetime,disconnected,async execute(_budget,_progress,write){
   write({sources,blocks:[{key:"issue/a/explanation",text:"ст. 408 ТК"}]});
   write({sources,blocks:[{key:"issue/a/explanation",text:"ст. 408 ТК применяется."}]});return null;
 }});
 const seen:WritingDraft[]=[];
 await assert.rejects(readLegalChatStream(new Response(stream,{headers:{"content-type":"text/event-stream"}}),()=>{},undefined,d=>seen.push(d)),/LEGAL_ANSWER_NOT_COMPLETED/);
 assert.deepEqual(seen[0].sources,sources);assert.deepEqual(seen[0].blocks,[]);
 assert.equal(seen.at(-1)?.blocks[0].text,"ст. 408 ТК применяется.");assert.deepEqual(seen.at(-1)?.sources,sources);
});
