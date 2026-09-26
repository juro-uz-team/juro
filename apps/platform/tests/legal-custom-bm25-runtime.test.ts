import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {setImmediate as nextTurn} from "node:timers/promises";
import {runIndexedRetrieval} from "../lib/runtime/indexed-retrieval";

import { buildCustomBm25Artifacts, customBm25TermHash } from "../lib/legal-corpus/custom-bm25";
import { buildCustomBm25RuntimeArtifacts, queryCustomBm25Runtime, queryCustomBm25RuntimeBatch,
  resolveCustomBm25RuntimeItemKeys, resolveCustomBm25RuntimeMembership,
  resolveCustomBm25RuntimeMembershipEntries }
  from "../lib/legal-corpus/custom-bm25-runtime";
import { stableSourceSnapshotJson } from "../lib/legal-corpus/source-snapshot";
import {CustomRuntimeCache} from "../lib/legal-corpus/custom-runtime-cache";

class MemoryR2 {
  readonly objects = new Map<string, Uint8Array>();
  readonly reads = new Map<string, number>();
  async get(key: string, options?: { range?: { offset: number; length: number } }) {
    this.reads.set(key, (this.reads.get(key) ?? 0) + 1);
    const source = this.objects.get(key);
    if (!source) return null;
    const bytes = options?.range
      ? source.slice(options.range.offset, options.range.offset + options.range.length)
      : source;
    return { size: bytes.byteLength, body: new ReadableStream({
      start(controller) { controller.enqueue(bytes); controller.close(); },
    }), async arrayBuffer() { return bytes.buffer.slice(
      bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  }
}

async function streamSearchFixture() {
  const built=await buildCustomBm25Artifacts(Array.from({length:20},(_,index)=>({
    segmentId:"base",itemKey:`record-${index}`,language:"en",documentType:"law",validFromEpoch:1,validToEpoch:null,
    fields:{title:"Employment contract",hierarchy:"Rights",article:String(index+1),text:"employment contract annual leave notice"},
  })),{analyzer:"word-v1"});
  const runtime=await buildCustomBm25RuntimeArtifacts({releaseId:"release:test:concurrent-cache",
    sparseManifestSha256:"a".repeat(64),manifest:built.manifest});
  const bucket=new MemoryR2();
  bucket.objects.set(runtime.documentsReference.key,runtime.documentsBytes);
  for(const artifact of built.artifacts)bucket.objects.set(artifact.key,artifact.bytes);
  const search=(cache:CustomRuntimeCache)=>queryCustomBm25RuntimeBatch(bucket as unknown as R2Bucket,
    runtime.descriptor,[{text:"employment annual leave",atEpoch:2,topK:10}],cache);
  return {bucket,runtime,search};
}

test("cancelling a search closes its pending document stream and permits a clean retry",async context=>{
  const {bucket,runtime,search}=await streamSearchFixture();
  const get=bucket.get.bind(bucket),entered=Promise.withResolvers<void>();
  let cancelled=false;
  context.mock.method(bucket,"get",async(...args:Parameters<typeof get>)=>{
    const object=await get(...args);
    if(!object||args[0]!==runtime.documentsReference.key)return object;
    return {...object,body:new ReadableStream<Uint8Array>({
      pull(){entered.resolve();},cancel(){cancelled=true;},
    })};
  });
  const controller=new AbortController(),reason=new Error("Search cancelled"),cache=new CustomRuntimeCache();
  const pending=runIndexedRetrieval(controller.signal,()=>search(cache));
  const rejected=assert.rejects(pending,error=>error===reason);
  await entered.promise;
  controller.abort(reason);
  await rejected;
  await nextTurn();
  assert.equal(cancelled,true);
  context.mock.restoreAll();
  assert.equal((await search(cache))[0]!.length,10);
});

test("native ordinal lookup caches compact identities only after authenticating the pinned page",async()=>{
  const keys=[`retrieval-chunk-v1:${"a".repeat(64)}`,`retrieval-chunk-v1:${"b".repeat(64)}`];
  const built=await buildCustomBm25Artifacts(keys.map((itemKey,index)=>({segmentId:"base",itemKey,
    language:"en",documentType:"law",validFromEpoch:1,validToEpoch:null,
    fields:{title:"Rule",hierarchy:"",article:String(index+1),text:"work contract"}})),{analyzer:"word-v1"});
  built.manifest.documents[0]!.ordinal=1000;
  built.manifest.documents[1]!.ordinal=8000002;
  const runtime=await buildCustomBm25RuntimeArtifacts({releaseId:"release:test:ordinal-cache",
    sparseManifestSha256:"a".repeat(64),manifest:built.manifest});
  const bucket=new MemoryR2(),cache=new CustomRuntimeCache();
  for(const page of runtime.ordinalMappingPages)bucket.objects.set(page.reference.key,page.bytes);
  for(let attempt=0;attempt<2;attempt++)assert.deepEqual(await resolveCustomBm25RuntimeItemKeys(
    bucket as unknown as R2Bucket,runtime.descriptor,[8000002,1000,8000002],cache),[keys[1],keys[0],keys[1]]);
  assert.ok([...bucket.reads.values()].every(count=>count===1));
  await assert.rejects(resolveCustomBm25RuntimeItemKeys(bucket as unknown as R2Bucket,
    {...runtime.descriptor,releaseId:"release:test:different"},[1000],cache));
  const page=runtime.ordinalMappingPages[0]!;
  bucket.objects.set(page.reference.key,new Uint8Array(page.bytes.length));
  await assert.rejects(resolveCustomBm25RuntimeItemKeys(bucket as unknown as R2Bucket,
    runtime.descriptor,[1000],new CustomRuntimeCache()));
});

test("article matches remain identifiable without overriding lexical relevance", async () => {
  const built = await buildCustomBm25Artifacts([
    {segmentId: "base", itemKey: "cross-reference", language: "en", documentType: "law", validFromEpoch: 1, validToEpoch: null,
      fields: {title: "Employment termination", hierarchy: "Termination grounds", article: "Article 99", text: "Employment termination grounds exceptions under article 72 employment termination grounds"}},
    {segmentId: "base", itemKey: "operative", language: "en", documentType: "law", validFromEpoch: 1, validToEpoch: null,
      fields: {title: "Code", hierarchy: "", article: "Article 72", text: "The contract may end on the following grounds."}},
    {segmentId: "base", itemKey: "different-number", language: "en", documentType: "law", validFromEpoch: 1, validToEpoch: null,
      fields: {title: "Employment termination", hierarchy: "Termination grounds", article: "Article 172", text: "Employment termination grounds exceptions article 72"}},
  ], {analyzer: "word-v1"});
  const runtime = await buildCustomBm25RuntimeArtifacts({releaseId: "release:test:current:custom-v1", sparseManifestSha256: "a".repeat(64), manifest: built.manifest});
  const bucket = new MemoryR2();
  bucket.objects.set(runtime.documentsReference.key, runtime.documentsBytes);
  for (const artifact of built.artifacts) bucket.objects.set(artifact.key, artifact.bytes);
  const hits = await queryCustomBm25Runtime(bucket as unknown as R2Bucket, runtime.descriptor, {text: "employment termination grounds exceptions article 72", atEpoch: 2, topK: 3});
  assert.ok(hits.every((hit,index)=>index===0 || hits[index-1]!.score >= hit.score));
  assert.equal(built.manifest.documents.find(doc => doc.ordinal === hits.find(hit=>hit.explicitArticleMatch)?.ordinal)?.itemKey, "operative");
  assert.equal(hits.filter(hit => hit.explicitArticleMatch).length, 1);
  const topical = await queryCustomBm25Runtime(bucket as unknown as R2Bucket, runtime.descriptor, {text: "employment termination grounds exceptions 72", atEpoch: 2, topK: 3});
  assert.ok(topical.every(hit => !hit.explicitArticleMatch));
  const queries = [
    {text: "employment termination grounds exceptions article 72", atEpoch: 2, topK: 3},
    {text: "employment termination grounds exceptions 72", atEpoch: 2, topK: 3},
    {text: "unmatchedtoken", atEpoch: 2, topK: 3},
    {text: "employment", atEpoch: 0, topK: 3},
  ];
  const expected = await Promise.all(queries.map(query =>
    queryCustomBm25Runtime(bucket as unknown as R2Bucket, runtime.descriptor, query)));
  bucket.reads.clear();
  assert.deepEqual(await queryCustomBm25RuntimeBatch(bucket as unknown as R2Bucket,
    runtime.descriptor, queries), expected);
  assert.equal(bucket.reads.get(runtime.documentsReference.key), 1,
    "all formulations must share one fully verified document stream");
  for (const segment of runtime.descriptor.segments) for (const reference of Object.values(segment.lexicons)) {
    assert.ok((bucket.reads.get(reference.key) ?? 0) <= 1, "shared lexicons are read once");
  }
  const cache=new CustomRuntimeCache();
  bucket.reads.clear();
  let firstReads: Map<string, number> | undefined;
  for(let attempt=0;attempt<2;attempt++) {
    assert.deepEqual(await queryCustomBm25RuntimeBatch(
      bucket as unknown as R2Bucket,runtime.descriptor,queries,cache),expected);
    if(attempt===0)firstReads=new Map(bucket.reads);
  }
  assert.deepEqual(bucket.reads,firstReads,"warm searches reuse authenticated posting ranges as well as tables");
  assert.equal(bucket.reads.get(runtime.documentsReference.key),1,
    "native warm searches reuse authenticated document bytes across different formulations");
  for(const segment of runtime.descriptor.segments)for(const reference of Object.values(segment.lexicons))
    assert.ok((bucket.reads.get(reference.key)??0)<=1,"immutable lexicons are authenticated once per native cache");
  const termHash=await customBm25TermHash("employment");
  const reference=runtime.descriptor.segments[0]!.lexicons[termHash[0]!]!;
  const originalLexicon=bucket.objects.get(reference.key)!;
  for(const fault of ["hash","frequency"] as const) {
    const lexicon=JSON.parse(new TextDecoder().decode(originalLexicon));
    if(fault==="hash")lexicon[termHash].sha256="0".repeat(64);
    else lexicon[termHash].documentFrequency++;
    const bytes=new TextEncoder().encode(JSON.stringify(lexicon));
    const changed=structuredClone(runtime.descriptor);
    changed.segments[0]!.lexicons[termHash[0]!] = {...reference,sizeBytes:bytes.byteLength,
      sha256:createHash("sha256").update(bytes).digest("hex")};
    bucket.objects.set(reference.key,bytes);
    await assert.rejects(queryCustomBm25RuntimeBatch(bucket as unknown as R2Bucket,
      changed,[{text:"employment",atEpoch:2,topK:3}],cache));
  }
  bucket.objects.set(reference.key,originalLexicon);
  const corrupt = runtime.documentsBytes.slice();
  corrupt[corrupt.length - 1] ^= 1;
  bucket.objects.set(runtime.documentsReference.key, corrupt);
  await assert.rejects(queryCustomBm25RuntimeBatch(bucket as unknown as R2Bucket,
    runtime.descriptor, queries), /DOCUMENTS_CORRUPT/u);
  await assert.rejects(queryCustomBm25RuntimeBatch(bucket as unknown as R2Bucket,
    runtime.descriptor, queries,new CustomRuntimeCache()), /DOCUMENTS_CORRUPT/u);
});

test("runtime BM25 projection preserves durable ordinals without loading the JSON document manifest", async () => {
  const built = await buildCustomBm25Artifacts([{
    segmentId: "base", itemKey: "chunk-a", language: "en", documentType: "law",
    validFromEpoch: 1, validToEpoch: null,
    fields: { title: "Work law", hierarchy: "", article: "Article 1", text: "work contract" },
  }, {
    segmentId: "base", itemKey: "chunk-b", language: "en", documentType: "law",
    validFromEpoch: 3, validToEpoch: null,
    fields: { title: "Tax law", hierarchy: "", article: "Article 2", text: "income tax" },
  }], { analyzer: "word-v1" });
  built.manifest.documents[0]!.ordinal = 1_000;
  built.manifest.documents[1]!.ordinal = 8_000_002;
  const termHash = await customBm25TermHash("work");
  const encode = (value: unknown) => new TextEncoder().encode(`${stableSourceSnapshotJson(value)}\n`);
  const postingBytes = encode({ blockMaximum: 1, documentFrequency: 1,
    postings: [{ ordinal: 1_000, termFrequencies: { title: 1, hierarchy: 0, article: 0, text: 1 } }],
    skip: [{ ordinal: 1_000, postingIndex: 0 }], termHash });
  const postingReference = { key: "runtime-postings", sizeBytes: postingBytes.byteLength,
    sha256: createHash("sha256").update(postingBytes).digest("hex") };
  const lexiconBytes = encode({ [termHash]: { ...postingReference, offset: 0,
    length: postingBytes.byteLength, documentFrequency: 1, blockMaximum: 1 } });
  const lexiconReference = { key: "runtime-lexicon", sizeBytes: lexiconBytes.byteLength,
    sha256: createHash("sha256").update(lexiconBytes).digest("hex") };
  built.manifest.segments = [{ id: "base", postings: { [termHash[0]!]: postingReference },
    lexicons: { [termHash[0]!]: lexiconReference } }];
  const runtime = await buildCustomBm25RuntimeArtifacts({
    releaseId: "release:test:current:custom-v1", sparseManifestSha256: "a".repeat(64),
    manifest: built.manifest,
    resolveLegalIdentitySha256: async (itemKeys) => new Map(itemKeys.map((itemKey, index) =>
      [itemKey, String(index + 1).padStart(64, "0")])),
    resolveRuntimeLegalIdentities: async (itemKeys) => new Map(itemKeys.map((itemKey, index) => [
      itemKey,
      {
        legalIdentitySha256: String(index + 1).padStart(64, "0"),
        legalInstrumentId: `instrument-${index}`,
        officialExpressionId: `expression-${index}`,
        textRevisionId: `revision-${index}`,
        provisionConceptId: `concept-${index}`,
        provisionRenditionId: `rendition-${index}`,
        evidenceProvisionRenditionId: `rendition-${index}`,
        languageTag: "en" as const,
        script: "Latn" as const,
        textualAuthority: "controlling" as const,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: null,
        evidence: { r2Key: `evidence-${index}.json`, byteCount: 10,
          sha256: "a".repeat(64), sourceNormalizedSha256: "b".repeat(64),
          mediaType: "application/json; charset=utf-8" as const },
        citation: { label: `Act ${index} — Article 1`, url: "https://lex.uz/docs/123" },
      },
    ])),
  });
  const bucket = new MemoryR2();
  bucket.objects.set(runtime.documentsReference.key, runtime.documentsBytes);
  for (const page of runtime.ordinalMappingPages) {
    bucket.objects.set(page.reference.key, page.bytes);
  }
  bucket.objects.set(runtime.membership.reference.key, runtime.membership.bytes);
  for (const page of runtime.membership.pages) bucket.objects.set(page.reference.key, page.bytes);
  bucket.objects.set(postingReference.key, postingBytes);
  bucket.objects.set(lexiconReference.key, lexiconBytes);

  const concurrentHits = await Promise.all([1, 2, 3].map(() => queryCustomBm25Runtime(
    bucket as unknown as R2Bucket, runtime.descriptor, { text: "work", atEpoch: 2, topK: 5 })));
  assert.deepEqual(concurrentHits.map((hits) => hits.map((hit) => hit.ordinal)),
    [[1_000], [1_000], [1_000]]);
  assert.equal(bucket.reads.get(runtime.documentsReference.key), 3);
  const oversizedLexiconBytes = encode({ [termHash]: { ...postingReference, offset: 0,
    length: 1024 * 1024 + 1, documentFrequency: 1, blockMaximum: 1 } });
  const oversizedLexiconReference = { key: "runtime-lexicon-oversized",
    sizeBytes: oversizedLexiconBytes.byteLength,
    sha256: createHash("sha256").update(oversizedLexiconBytes).digest("hex") };
  const oversizedBucket = new MemoryR2();
  oversizedBucket.objects.set(oversizedLexiconReference.key, oversizedLexiconBytes);
  const oversizedDescriptor = structuredClone(runtime.descriptor);
  oversizedDescriptor.segments[0]!.lexicons[termHash[0]!] = oversizedLexiconReference;
  assert.deepEqual(await queryCustomBm25Runtime(oversizedBucket as unknown as R2Bucket,
    oversizedDescriptor, { text: "work", atEpoch: 2, topK: 5 }), []);
  assert.equal(oversizedBucket.reads.get(runtime.documentsReference.key), undefined);
  assert.equal(runtime.documentsBytes.byteLength, 16 + 2 * 32);
  assert.equal(runtime.documentsReference.sha256,
    createHash("sha256").update(runtime.documentsBytes).digest("hex"));
  assert.deepEqual(await resolveCustomBm25RuntimeItemKeys(
    bucket as unknown as R2Bucket, runtime.descriptor, [8_000_002, 1_000]),
  ["chunk-b", "chunk-a"]);
  assert.equal(await resolveCustomBm25RuntimeMembership(bucket as unknown as R2Bucket,
    runtime.descriptor.releaseId, runtime.membership.reference.sha256, ["chunk-a"]), true);
  assert.equal(await resolveCustomBm25RuntimeMembership(bucket as unknown as R2Bucket,
    runtime.descriptor.releaseId, runtime.membership.reference.sha256, ["chunk-missing"]), false);
  assert.equal((await resolveCustomBm25RuntimeMembershipEntries(bucket as unknown as R2Bucket,
    runtime.descriptor.releaseId, runtime.membership.reference.sha256,
    ["chunk-a"]))?.get("chunk-a")?.legalIdentitySha256, "1".padStart(64, "0"));
  assert.equal((await resolveCustomBm25RuntimeMembershipEntries(bucket as unknown as R2Bucket,
    runtime.descriptor.releaseId, runtime.membership.reference.sha256,
    ["chunk-a"]))?.get("chunk-a")?.legalIdentity?.provisionRenditionId, "rendition-0");
  assert.equal(termHash.length, 64);
});
