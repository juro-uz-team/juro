import assert from "node:assert/strict";
import test from "node:test";
import {createHash} from "node:crypto";
import {createNormalizedSourceReader} from "../lib/legal-corpus/normalized-source-reader";
import {MemoryEvidenceBucket} from "./helpers/legal-target";

test("shared parsed sources require fresh physical authentication and cannot be mutated",async()=>{
 const key="corpus/normalized/revision:cache-integrity.json",bucket=new MemoryEvidenceBucket();
 const snapshot={schemaVersion:1,parser:{name:"parse5",version:"8.0.1",profile:"juro-legal-blocks-v1"},
  source:{sourceKind:"lex",locale:"en",canonicalId:"777",canonicalUrl:"https://lex.uz/en/docs/777",rawContentSha256:"a".repeat(64)},
  primarySelector:"lex-document",documentTitle:"Immutable rules",blocks:[{index:0,kind:"paragraph",text:"Article 1. Required conduct"},{index:1,kind:"paragraph",text:"A complete source rule applies."}],plainText:"Complete source rules remain authenticated and immutable. ".repeat(5)};
 const bytes=new TextEncoder().encode(JSON.stringify(snapshot)),sha=createHash("sha256").update(bytes).digest("hex");
 bucket.objects.set(key,{bytes,customMetadata:{}});let reads=0;
 const counted={get:async(key:string)=>{reads++;return bucket.get(key);}};
 const first=await createNormalizedSourceReader(counted)("revision:cache-integrity",sha);
 const second=await createNormalizedSourceReader(counted)("revision:cache-integrity",sha);
 assert.equal(reads,2);assert.equal(first.snapshot,second.snapshot);
 assert.throws(()=>{first.snapshot.blocks[1]!.text="Changed rule";},TypeError);
 assert.throws(()=>{first.snapshot.blocks.push(first.snapshot.blocks[0]!);},TypeError);
 bucket.objects.set(key,{bytes:new TextEncoder().encode(JSON.stringify({...snapshot,documentTitle:"Corrupt retained bytes"})),customMetadata:{}});
 await assert.rejects(createNormalizedSourceReader(counted)("revision:cache-integrity",sha),/PINNED_SOURCE_REVISION_INVALID/);
 bucket.objects.delete(key);
 await assert.rejects(createNormalizedSourceReader(counted)("revision:cache-integrity",sha),/PINNED_SOURCE_REVISION_UNAVAILABLE/);
 bucket.objects.set(key,{bytes,customMetadata:{}});
 assert.equal((await createNormalizedSourceReader(counted)("revision:cache-integrity",sha)).snapshot.documentTitle,"Immutable rules");
});
