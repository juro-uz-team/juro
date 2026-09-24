import assert from "node:assert/strict";
import test from "node:test";
import { lexDocumentIsRepealed, publisherTextFingerprint, readLexPublisherObservation } from "../lib/legal/lex-document-status";
import {normalizeLegalSourceHtml} from "../lib/legal/source-parser";
import {PDFDocument,StandardFonts} from "pdf-lib";
import {createSourceObservationReader, isCurrentSourceObservation, sourceObservationSchema} from "../lib/legal/source-observation";

test("official repeal banners exclude obsolete law in every corpus language", () => {
  for (const text of ["Документ утратил силу 17.04.1998", "Акт утратил силу&nbsp;19.05.2018", "Hujjat kuchini yo‘qotgan&nbsp;17.04.1998",
    "Ҳужжат кучини йўқотган 17.04.1998", "Document has lost its force 17.04.1998"]) {
    assert.equal(lexDocumentIsRepealed(`<header id="doc_header"><span>${text}</span></header>`), true);
  }
});

test("repealing another instrument does not repeal the current document", () => {
  assert.equal(lexDocumentIsRepealed('<header id="doc_header">Закон от 10.09.2026</header><main>Документ утратил силу: предыдущий закон.</main>'), false);
  assert.equal(lexDocumentIsRepealed('<header id="doc_header">Действующий акт</header><main>Акт утратил силу: предыдущий закон.</main>'), false);
  assert.equal(lexDocumentIsRepealed('<header id="doc_header"><span>Акт</span><strong>утратил силу</strong>&nbsp;19.05.2018</header>'), true);
});

test("observations from the obsolete publisher-status policy cannot establish current law", () => {
  const observation = {version: 1, officialUrl: "https://lex.uz/ru/docs/777", observedAt: "2026-09-11T00:00:00.000Z",
    current: true, normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)};
  assert.equal(isCurrentSourceObservation(observation, {officialUrl: observation.officialUrl,
    normalizedTextSha256: observation.normalizedTextSha256, now: Date.parse(observation.observedAt)}), false);
});

test("missing or unclosed publisher headers cannot create current observations", async context => {
  let header = "";
  context.mock.method(globalThis, "fetch", async (input: RequestInfo | URL) => String(input).endsWith('/robots.txt')
    ? new Response('User-agent: *\nAllow: /', {headers:{'content-type':'text/plain'}})
    : new Response(`<html>${header}<main><h1>Official act</h1><p>${"The official law establishes the parties' obligations. ".repeat(8)}</p></main></html>`,
      {headers:{'content-type':'text/html; charset=utf-8'}}));
  for (header of ['', '<header id="doc_header">Unclosed status']) {
    await assert.rejects(readLexPublisherObservation('https://lex.uz/ru/docs/777'), /LEX_DOCUMENT_STATUS_UNAVAILABLE/u);
  }
});

test("cancelled publisher observation aborts its pending request",async context=>{
  const controller=new AbortController();
  let started!:()=>void;
  const entered=new Promise<void>(resolve=>{started=resolve;});
  let aborted=false;
  context.mock.method(globalThis,"fetch",async(_input:RequestInfo|URL,init?:RequestInit)=>{
    started();
    return new Promise<Response>((_resolve,reject)=>{
      init!.signal!.addEventListener("abort",()=>{aborted=true;reject(init!.signal!.reason);},{once:true});
    });
  });
  const pending=readLexPublisherObservation("https://lex.uz/ru/docs/777",{signal:controller.signal});
  const rejected=assert.rejects(pending);
  await entered;controller.abort();await rejected;
  assert.equal(aborted,true);
});

test("PDF publisher observations authenticate the matching representation and document header",async context=>{
  const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText("Official building regulation. The applicant must comply with the stated safety conditions. ".repeat(4),{font,size:10,x:40,y:750,maxWidth:500,lineHeight:14});
  const bytes=await pdf.save();let documentId="777",status="Effective 03.07.2026";
  context.mock.method(globalThis,"fetch",async(input:RequestInfo|URL)=>{
    const url=String(input);
    if(url.endsWith("/robots.txt"))return new Response("User-agent: *\nAllow: /",{headers:{"content-type":"text/plain"}});
    if(url.includes("/pdffile/"))return new Response(new Uint8Array(bytes),{headers:{"content-type":"application/pdf"}});
    return new Response(`<html><main><div class="docHeader"><div><span id="lblNEffectDate">${status}</span></div></div>
      <div id="pdfBody"></div></main><script>PDFObject.embed("/pdffile/${documentId}", "#pdfBody");</script></html>`,
      {headers:{"content-type":"text/html; charset=utf-8"}});
  });
  const first=await readLexPublisherObservation("https://lex.uz/ru/docs/777");
  assert.equal(first.current,true);assert.match(first.normalizedTextSha256,/^[a-f0-9]{64}$/);
  status="Документ утратил силу 03.07.2026";
  assert.equal((await readLexPublisherObservation("https://lex.uz/ru/docs/777")).current,false);
  documentId="778";
  await assert.rejects(readLexPublisherObservation("https://lex.uz/ru/docs/777"),/LEX_DOCUMENT_STATUS_UNAVAILABLE/);
});

test("layered public observation caches never extend publisher observation age", async () => {
  let time = Date.parse("2026-09-11T00:00:00.000Z");
  const url = "https://lex.uz/ru/docs/777";
  const fingerprint = "a".repeat(64);
  let reads = 0;
  let fail = false;
  let saved: ReturnType<typeof sourceObservationSchema.parse> | null = null;
  const store = {async get() {return saved;}, async put(observation: NonNullable<typeof saved>) {saved = observation;}};
  const publisher = async () => {
    reads++; if (fail) throw new Error("Publisher unavailable");
    return sourceObservationSchema.parse({version: 2, officialUrl: url, observedAt: new Date(time).toISOString(),
      current: true, normalizedTextSha256: fingerprint, rawContentSha256: "b".repeat(64)});
  };
  const first = createSourceObservationReader({readPublisher: publisher, store, now: () => time});
  const original = await first(url);
  time += 299_999;
  const second = createSourceObservationReader({readPublisher: publisher, store, now: () => time});
  assert.deepEqual(await second(url), original);
  assert.equal(reads, 1);
  assert.equal(isCurrentSourceObservation(original, {officialUrl: url, normalizedTextSha256: fingerprint, now: time}), true);
  time++;
  assert.equal(isCurrentSourceObservation(original, {officialUrl: url, normalizedTextSha256: fingerprint, now: time}), false);
  fail = true;
  await assert.rejects(second(url), /Publisher unavailable/u);
  assert.equal(saved!.observedAt, original.observedAt);
  fail = false;
  const refreshed = await second(url);
  assert.equal(refreshed.observedAt, new Date(time).toISOString());
  for (const changed of [{...refreshed, current: false}, {...refreshed, normalizedTextSha256: "c".repeat(64)},
    {...refreshed, officialUrl: "https://lex.uz/en/docs/777"}, {...refreshed, observedAt: new Date(time + 1).toISOString()}]) {
    assert.equal(isCurrentSourceObservation(changed, {officialUrl: url, normalizedTextSha256: fingerprint, now: time}), false);
  }
});

test("independent readers coalesce public publisher work without retaining private inputs", async () => {
  let reads = 0;
  const now = Date.parse("2026-09-11T00:00:00.000Z");
  const url = "https://lex.uz/ru/docs/777";
  const read = createSourceObservationReader({now: () => now, async readPublisher(officialUrl) {
    reads++; await new Promise(resolve => setTimeout(resolve, 5));
    return {version: 2, officialUrl, observedAt: new Date(now).toISOString(), current: true,
      normalizedTextSha256: "a".repeat(64), rawContentSha256: "b".repeat(64)};
  }});
  const [first, second] = await Promise.all([read(url), read(url)]);
  assert.deepEqual(first, second);
  assert.equal(reads, 1);
  first.observedAt = new Date(now + 299_000).toISOString();
  assert.equal((await read(url)).observedAt, second.observedAt, "Callers cannot mutate a reusable observation");
});

test("publisher text fingerprints detect changed operative text independently of volatile page markup", async () => {
  const reference = {sourceKind: "lex" as const, locale: "ru" as const, canonicalId: "777", canonicalUrl: "https://lex.uz/ru/docs/777"};
  const normalize = (text: string, rawContentSha256: string) => normalizeLegalSourceHtml({reference, rawContentSha256,
    html: `<html><title>Official law</title><header id="doc_header">Current</header><main><h1>Official law</h1><p>${text}</p></main></html>`});
  const text = "The official operative provision establishes the general obligations of each party. ".repeat(6);
  const first = normalize(text, "a".repeat(64));
  const freshMarkup = normalize(text, "b".repeat(64));
  assert.equal(await publisherTextFingerprint(first), await publisherTextFingerprint(freshMarkup));
  assert.equal(await publisherTextFingerprint(first), await publisherTextFingerprint({...first,
    source: {...first.source, canonicalId: `lexuz:${first.source.canonicalId}`}}),
  "Stored corpus identifiers and publisher document identifiers share the authenticated canonical URL");
  assert.notEqual(await publisherTextFingerprint(first), await publisherTextFingerprint(normalize(text.replace("obligations", "exceptions"), "c".repeat(64))));
  assert.notEqual(await publisherTextFingerprint(first), await publisherTextFingerprint({...first,
    source: {...first.source, locale: "en", canonicalUrl: "https://lex.uz/en/docs/777"}}));
});
