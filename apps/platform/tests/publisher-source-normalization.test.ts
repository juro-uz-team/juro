import assert from "node:assert/strict";
import test from "node:test";
import {resolve} from "node:path";
import {WorkerTaskPool} from "../lib/runtime/worker-task-pool";
import {publisherHtmlFingerprints,readLexPublisherObservation} from "../lib/legal/lex-document-status";

const input = {html:`<main><h1>Кодекс</h1><p>Статья 18<sup>1</sup>. Специальное правило</p>
  <p>${"Обязательства сторон определяются настоящим законом. ".repeat(8)}</p></main>`,
  reference:{sourceKind:"lex" as const,locale:"ru" as const,canonicalId:"777",canonicalUrl:"https://lex.uz/ru/docs/777"},
  rawContentSha256:"a".repeat(64)};

test("publisher worker returns exactly the original profile fingerprints and rejects invalid sources", async () => {
  const pool = new WorkerTaskPool<typeof input,Awaited<ReturnType<typeof publisherHtmlFingerprints>>>(
    resolve("server/publisher-source-worker.cjs"),1);
  try {
    assert.deepEqual(await pool.run(input),await publisherHtmlFingerprints(input));
    await assert.rejects(pool.run({...input,html:"<main>Incomplete</main>"}),/LEGAL_SOURCE_CONTENT_INSUFFICIENT/);
    assert.deepEqual(await pool.run(input),await publisherHtmlFingerprints(input));
  } finally {await pool.close();}
});

test("publisher normalization receives the shared cancellation signal and cannot renew its fetch timestamp", async context => {
  const controller=new AbortController();
  context.mock.method(globalThis,"fetch",async (url:RequestInfo|URL)=>String(url).endsWith('/robots.txt')
    ?new Response('User-agent: *\nAllow: /',{headers:{'content-type':'text/plain'}})
    :new Response(`<header id="doc_header">Действующий акт</header>${input.html}`,{headers:{'content-type':'text/html; charset=utf-8'}}));
  await assert.rejects(readLexPublisherObservation(input.reference.canonicalUrl,{signal:controller.signal,
    async fingerprintHtml(source,signal){
      assert.equal(signal,controller.signal);
      assert.equal(source.reference.canonicalUrl,input.reference.canonicalUrl);
      const result=await publisherHtmlFingerprints(source);
      controller.abort(new Error("request expired during normalization"));
      return result;
    }}),/request expired during normalization/);
});
