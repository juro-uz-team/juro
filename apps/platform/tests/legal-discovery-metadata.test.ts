import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {readR2NativeDiscoveryMetadata,resolveR2NativeCustomEvidence} from "../lib/legal-corpus/target-evidence";
import {customRuntimeLegalIdentitySchema} from "../lib/legal-corpus/custom-bm25-runtime";
import {MemoryEvidenceBucket,representativeProvision} from "./helpers/legal-target";

function fixture(fields:Record<string,unknown>={}) {
  const bytes=new TextEncoder().encode(JSON.stringify({...representativeProvision,sourceNormalizedSha256:"b".repeat(64),...fields}));
  const hash=createHash("sha256").update(bytes).digest("hex"),bucket=new MemoryEvidenceBucket();
  bucket.objects.set("provision",{bytes,customMetadata:{schemaversion:"1",sha256:hash}});
  const identity=customRuntimeLegalIdentitySchema.parse({
    legalIdentitySha256:"a".repeat(64),
    legalInstrumentId:representativeProvision.legalInstrumentId,
    officialExpressionId:representativeProvision.officialExpressionId,
    textRevisionId:representativeProvision.textRevisionId,
    provisionConceptId:representativeProvision.provisionConceptId,
    provisionRenditionId:representativeProvision.provisionRenditionId,
    languageTag:representativeProvision.languageTag,script:representativeProvision.script,
    textualAuthority:representativeProvision.textualAuthority,
    evidenceProvisionRenditionId:representativeProvision.provisionRenditionId,
    validFrom:"2026-01-01T00:00:00.000Z",validTo:null,
    evidence:{r2Key:"provision",byteCount:bytes.byteLength,sha256:hash,
      sourceNormalizedSha256:"b".repeat(64),mediaType:"application/json; charset=utf-8"},
    citation:{label:"Official provision",url:representativeProvision.sourceUrl},
  });
  return {bucket,identity};
}

test("discovery receives authenticated headings without legal text or an evidence approval",async()=>{
  const {bucket,identity}=fixture();
  assert.deepEqual(await readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"}),{
    actTitle:representativeProvision.actTitle,articleTitle:representativeProvision.articleTitle,
    languageTag:"ru",
  });
});

test("unusable optional headings do not change immutable legal evidence compatibility",async()=>{
  const {bucket,identity}=fixture({articleTitle:42});
  const dependencies={bucket,currentAt:"2026-06-01T00:00:00.000Z"};
  assert.equal(await readR2NativeDiscoveryMetadata(dependencies,identity,{kind:"current"}),null);
  assert.equal((await resolveR2NativeCustomEvidence(dependencies,identity,{kind:"current"})).controlling.provisionText,representativeProvision.provisionText);
});

test("discovery rejects foreign identities, corrupt receipts and out-of-scope revisions",async()=>{
  for(const fields of [
    {sourceUrl:"https://lex.uz/ru/docs/999"}, {languageTag:"uz-Latn"},
    {provisionRenditionId:"rendition:foreign"}, {sourceNormalizedSha256:"c".repeat(64)},
  ]) {
    const {bucket,identity}=fixture(fields);
    await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"}),/SOURCE_UNAVAILABILITY/);
  }
  const {bucket,identity}=fixture();
  await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2025-06-01T00:00:00.000Z"},identity,{kind:"current"}));
  await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"timestamp",instant:"2025-06-01T00:00:00.000Z"}));
  bucket.objects.get("provision")!.bytes[0]=0;
  await assert.rejects(readR2NativeDiscoveryMetadata({bucket,currentAt:"2026-06-01T00:00:00.000Z"},identity,{kind:"current"}),/SOURCE_UNAVAILABILITY/);
});
