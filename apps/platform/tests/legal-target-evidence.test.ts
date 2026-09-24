import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createOfficialEvidenceClient,
  handleOfficialEvidenceRequest,
  importProvisionRendition,
  importProvisionRevision,
  resolveCompleteCorpusEvidence,
  resolveCompleteCorpusCurrentEvidence,
  resolveR2NativeCustomEvidence,
  parseResolvedOfficialEvidence,
} from "../lib/legal-corpus/target-evidence";
import { createNormalizedArticleEvidenceReader } from "../lib/legal-corpus/normalized-article-evidence";
import {createNormalizedSourceReader} from "../lib/legal-corpus/normalized-source-reader";
import {createPinnedSourceVerifier} from "../lib/legal-corpus/pinned-source-observation";
import { completeArticleText, createCompleteArticleReader, createCompleteArticleIndex } from "../lib/legal/article-context";
import { resolveCitationEvidence, handleCitationEvidenceRequest, CITATION_EVIDENCE_PATH } from "../lib/legal-corpus/citation-evidence";
import { recordProvisionTemporalEvidence } from "../lib/legal-corpus/target-temporal";
import { sqliteD1FixtureFromDirectory } from "./helpers/sqlite-d1";
import { MemoryEvidenceBucket, representativeProvision } from "./helpers/legal-target";

const migrationCutoff = "2026-08-31T06:26:27.225Z";

test("a single publisher paragraph can contain a complete operative article",()=>{
  for(const text of [
    "1-модда. Меҳнат кодексининг 192-моддасидаги «ўн саккиз» деган сўзлар «йигирма уч» деган сўзлар билан алмаштирилсин.",
    "1-modda. Ushbu Qonun rasmiy eʼlon qilingan kundan eʼtiboran kuchga kiradi.",
    "Статья 1. Внести в Закон Республики Узбекистан изменения и дополнения, утвердив его новую редакцию (прилагается).",
  ]) {
    const blocks=[text,"Статья 2. Следующее правило","Следующее правило имеет самостоятельное содержание."]
      .map((text,index)=>({index,kind:"paragraph" as const,text}));
    assert.equal(completeArticleText(blocks,"1")?.text,text);
    assert.equal(completeArticleText([...blocks,...blocks],"1"),null);
    assert.equal(completeArticleText([{...blocks[0]!,kind:"heading"},...blocks.slice(1)],"1"),null);
  }
  for(const text of ["Статья 1. Общие требования.","1-модда. Қуйидаги ўзгартишлар киритилсин:",
    "Статья 1. Внесение изменений в закон."]) {
    assert.equal(completeArticleText([{index:0,kind:"paragraph",text}],"1"),null);
  }
});

test("a parent article reader preserves unique headings, section boundaries and its captured text",()=>{
  const blocks = ["Article 1. First", "First rule.", "Chapter boundary", "Unrelated text.",
    "Article 2. Duplicate", "Second rule.", "Article 2. Duplicate", "Other rule.",
    "Article 3. Incomplete", "Conditions:", "Article 4. Heading only"]
    .map((text,index)=>({index,kind:"paragraph" as const,text,...(index===2?{semanticRole:"chapter" as const}:{})}));
  const read=createCompleteArticleReader(blocks);
  assert.deepEqual(read("1"),{heading:"Article 1. First",text:"Article 1. First First rule."});
  assert.equal(read("2"),null);
  assert.equal(read("3"),null);
  assert.equal(read("4"),null);
  assert.equal(read("missing"),null);
  assert.equal(read("1","Unrelated text"),null);
  blocks[1]!.text="Changed after reader creation.";
  assert.equal(read("1")?.text,"Article 1. First First rule.");
});

test("article references inside paragraphs do not split an authenticated article",()=>{
  const blocks=["Статья 7. Правило", "Общее правило действует при следующих обстоятельствах.",
    "Статья 784 Гражданского кодекса предусматривает очередность списания денежных средств.",
    "Исключение применяется при наличии специального основания.","Статья 8. Другое правило","Другой текст."]
    .map((text,index)=>({index,kind:"paragraph" as const,text}));
  const article=createCompleteArticleReader(blocks)("7");
  assert.ok(article?.text.includes("Исключение применяется"));
  assert.equal(createCompleteArticleReader(blocks)("784"),null);
  for(const heading of ["Статья 8 — Другое правило","Article 8 : Other rule","8-modda. Boshqa qoida",
    "Статья 8 Фирменное наименование общества","8-modda.Boshqa qoida","8-modda\nBoshqa qoida"]) {
    const withSpacing=blocks.map((block,index)=>index===4?{...block,text:heading}:block);
    assert.equal(createCompleteArticleReader(withSpacing)("7")?.text,article!.text);
    assert.ok(createCompleteArticleReader(withSpacing)("8"));
  }
});

test("annex article numbers require an authenticated distinguishing fragment and reopen by exact text",async()=>{
  const blocks=["Article 1. Enacting provision","The previous rules are replaced by the attached law. Shared wording.",
    "Article 2. Commencement","This law takes effect immediately.",
    "Article 1. Attached law","The application must identify the requested record. Shared wording.",
    "Article 2. Other provision","The authority responds in writing."]
    .map((text,index)=>({index,kind:"paragraph" as const,text}));
  const snapshot={schemaVersion:1,parser:{name:"parse5",version:"8.0.1",profile:"juro-legal-blocks-v2"},
    source:{sourceKind:"lex",locale:"en",canonicalId:"777",canonicalUrl:"https://lex.uz/en/docs/777",rawContentSha256:"a".repeat(64)},
    primarySelector:"lex-document",documentTitle:"Attached rules",blocks,plainText:blocks.map(b=>b.text).join(" ")};
  const bytes=new TextEncoder().encode(JSON.stringify(snapshot)),bucket=new MemoryEvidenceBucket();
  const key="corpus/normalized/revision:annex.json";
  bucket.objects.set(key,{bytes,customMetadata:{}});
  const original=parseResolvedOfficialEvidence({legalInstrumentId:"instrument:annex",officialExpressionId:"expression:annex",
    textRevisionId:"revision:annex",provisionConceptId:"concept:annex",provisionRenditionId:"rendition:annex",
    languageTag:"en",script:"Latn",textualAuthority:"unknown",provisionText:"The application must identify the requested record.",
    officialCitation:{url:snapshot.source.canonicalUrl,label:"Attached rules — Article 1"},
    evidence:{provisionRenditionId:"rendition:annex",r2Key:"fragment",byteCount:100,sha256:"b".repeat(64),sourceNormalizedSha256:sha256(bytes),schemaVersion:1}});
  assert.equal(completeArticleText(blocks,"1"),null);
  assert.equal(createCompleteArticleIndex(blocks)("1").occurrences,2);
  const read=createNormalizedArticleEvidenceReader(bucket);
  const context=await read(original,"1");
  assert.ok(context);
  assert.match(context.provisionText,/Article 1\. Attached law/);
  assert.doesNotMatch(context.provisionText,/Enacting|Article 2/);
  assert.equal(await read({...original,provisionText:"Shared wording."},"1"),null);
  const receipt={version:1 as const,capability:"current" as const,kind:"normalized-article" as const,r2Key:key,
    byteCount:bytes.length,sha256:sha256(bytes),officialUrl:snapshot.source.canonicalUrl,languageTag:"en" as const,
    articleNumber:"1",textSha256:sha256(context.provisionText)};
  assert.deepEqual(await resolveCitationEvidence(bucket,receipt),{text:context.provisionText,fullArticle:true,truncated:false});
  await assert.rejects(resolveCitationEvidence(bucket,{...receipt,textSha256:sha256("Shared wording.")}));
  const duplicateBytes=new TextEncoder().encode(JSON.stringify({...snapshot,blocks:[...blocks,...blocks]}));
  bucket.objects.set(key,{bytes:duplicateBytes,customMetadata:{}});
  await assert.rejects(resolveCitationEvidence(bucket,{...receipt,byteCount:duplicateBytes.length,sha256:sha256(duplicateBytes)}));
});

test("accepted parent recovery authenticates full article context without replacing the original rendition", async () => {
  const blocks = [
    "Article 7. Filing requirements", "An application must contain the following information:",
    "1) the applicant's registered name and correspondence address;",
    "2) the requested action and the documents supporting that request.",
    "Article 8. Decision", "The authority communicates its decision in writing.",
  ].map((text, index) => ({index, kind: "paragraph" as const, text}));
  const source = {sourceKind: "lex", locale: "ru", canonicalId: "777",
    canonicalUrl: representativeProvision.sourceUrl, rawContentSha256: "a".repeat(64)};
  const snapshot = {schemaVersion: 1, parser: {name: "parse5", version: "8.0.1", profile: "juro-legal-blocks-v1"},
    source, primarySelector: "lex-document", documentTitle: "Filing rules", blocks,
    plainText: blocks.map(block => block.text).join(" ")};
  const bytes = new TextEncoder().encode(JSON.stringify(snapshot));
  const original = parseResolvedOfficialEvidence({
    legalInstrumentId: representativeProvision.legalInstrumentId,
    officialExpressionId: representativeProvision.officialExpressionId,
    textRevisionId: representativeProvision.textRevisionId,
    provisionConceptId: representativeProvision.provisionConceptId,
    provisionRenditionId: representativeProvision.provisionRenditionId,
    languageTag: "ru", script: "Cyrl", textualAuthority: "controlling",
    provisionText: blocks.slice(0, 2).map(block => block.text).join(" "),
    officialCitation: {label: "Filing rules — Article 7", url: representativeProvision.sourceUrl},
    evidence: {provisionRenditionId: representativeProvision.provisionRenditionId, r2Key: "original",
      byteCount: 100, sha256: "b".repeat(64), sourceNormalizedSha256: sha256(bytes), schemaVersion: 1},
  });
  const bucket = new MemoryEvidenceBucket();
  const sourceRevisionId = "revision:original-parent";
  const anchored = parseResolvedOfficialEvidence({...original, evidence: {...original.evidence, sourceRevisionId}});
  const key = `corpus/normalized/${sourceRevisionId}.json`;
  bucket.objects.set(key, {bytes, customMetadata: {}});
  let reads = 0;
  const countedBucket = {get: async (key: string) => {reads++; return bucket.get(key);}};
  const readParent = createNormalizedSourceReader(countedBucket);
  const reader = createNormalizedArticleEvidenceReader(countedBucket, readParent);
  const read = (evidence: typeof original, article: string) => reader(evidence, article, sourceRevisionId);
  const [context, second] = await Promise.all([read(original, "7"), read(original, "7")]);
  assert.equal(reads, 1);
  assert.deepEqual(context, second);
  const verify = createPinnedSourceVerifier({bucket: countedBucket, readParent,
    observe: async () => {throw new Error("Publisher unavailable");}});
  const sourceStatus = await verify(anchored);
  assert.equal(sourceStatus.observation, null);
  assert.equal(reads, 1, "Article expansion and publisher comparison share one freshly authenticated parent");
  await assert.rejects(verify({...anchored, languageTag: "en"}));
  assert.match(context!.provisionText, /2\) the requested action/u);
  assert.doesNotMatch(context!.provisionText, /Article 8/u);
  assert.equal(context!.evidence.sha256, sha256(bytes));
  assert.equal(context!.evidence.r2Key, key);
  const alreadyComplete = await read({...original, provisionText: context!.provisionText}, "7");
  assert.equal(alreadyComplete?.evidence.r2Key, key,
    "An already complete provision still needs an authenticated full-article locator");
  assert.equal(alreadyComplete?.provisionText, context!.provisionText);
  const middle = await read({...original, provisionText: "2) the requested action"}, "7");
  assert.equal(middle?.provisionText, context!.provisionText,
    "A middle fragment recovers the complete authenticated article");
  assert.equal(await read({...original, provisionText:""}, "7"), null);
  const receipt = {version: 1 as const, capability: "current" as const, kind: "normalized-article" as const,
    r2Key: key, byteCount: bytes.length, sha256: sha256(bytes), officialUrl: representativeProvision.sourceUrl,
    languageTag: "ru" as const, articleNumber: "7", textSha256: sha256(context!.provisionText)};
  const reopened = await resolveCitationEvidence(bucket, receipt);
  assert.equal(reopened.text, context!.provisionText);
  assert.equal(reopened.fullArticle, true);
  await assert.rejects(resolveCitationEvidence(bucket, {...receipt, articleNumber: "8"}));
  await assert.rejects(resolveCitationEvidence(bucket, {...receipt, languageTag: "en"}));
  await assert.rejects(resolveCitationEvidence(bucket, {...receipt, officialUrl: "https://lex.uz/ru/docs/999"}));
  await assert.rejects(resolveCitationEvidence(bucket, {...receipt, textSha256: "c".repeat(64)}));
  const publicRequest = new Request(`https://example.com${CITATION_EVIDENCE_PATH}`, {
    method: "POST", headers: {"content-type": "application/json"}, body: JSON.stringify(receipt)});
  assert.equal((await handleCitationEvidenceRequest(publicRequest, {APP_ENV: "production", LEGAL_EVIDENCE_BUCKET: bucket})).status, 404);
  assert.equal(original.evidence.r2Key, "original");
  assert.match(original.provisionText, /information:$/u);
  assert.equal(await read({...original, officialCitation: {...original.officialCitation, url: "https://lex.uz/ru/docs/999"}}, "7"), null);
  assert.equal(await read({...original, provisionText: "Different statutory introduction:"}, "7"), null);
  assert.equal(completeArticleText([...blocks, ...blocks], "7"), null);
  for (let index = 0; index < 4; index++) {
    const revision = `revision:additional-${index}`;
    const parentKey = `corpus/normalized/${revision}.json`;
    bucket.objects.set(parentKey, {bytes, customMetadata: {}});
    const complete = await reader(original, "7", revision);
    assert.equal(complete?.evidence.r2Key, parentKey, "Cache capacity cannot reject a later authenticated article");
  }
  let activeReads = 0, peakReads = 0;
  const boundedReader = createNormalizedArticleEvidenceReader({async get(parentKey) {
    activeReads++; peakReads = Math.max(peakReads, activeReads);
    await new Promise(resolve => setImmediate(resolve));
    try {return await bucket.get(parentKey);} finally {activeReads--;}
  }});
  const parallelArticles = await Promise.all(Array.from({length: 4}, (_, index) =>
    boundedReader(original, "7", `revision:additional-${index}`)));
  assert.equal(peakReads, 2);
  assert.ok(parallelArticles.every(article => article?.provisionText === context!.provisionText));
  const corrupt = bytes.slice();
  corrupt[corrupt.length - 1] = 0;
  bucket.objects.set(key, {bytes: corrupt, customMetadata: {}});
  await assert.rejects(resolveCitationEvidence(bucket, receipt));
  assert.equal(await createNormalizedArticleEvidenceReader(bucket)(original, "7", sourceRevisionId), null);
  await assert.rejects(createPinnedSourceVerifier({bucket, observe: async () => {throw new Error("Unavailable");}})(
    anchored),
  "A new request authenticates physical bytes again, even after a prior request succeeded");
  const largeBlocks=[...blocks,...Array.from({length:22},(_,index)=>({
    index:blocks.length+index,kind:"paragraph" as const,text:"Unrelated retained text. ".repeat(4000)}))];
  const largeBytes=new TextEncoder().encode(JSON.stringify({...snapshot,blocks:largeBlocks,
    plainText:largeBlocks.map(block=>block.text).join(" ")}));
  assert.ok(largeBytes.byteLength>4_000_000&&largeBytes.byteLength<8_000_000);
  bucket.objects.set(key,{bytes:largeBytes,customMetadata:{}});
  const largeOriginal=parseResolvedOfficialEvidence({...anchored,evidence:{...anchored.evidence,
    sourceNormalizedSha256:sha256(largeBytes)}});
  const largeContext=await createNormalizedArticleEvidenceReader(bucket)(largeOriginal,"7",sourceRevisionId);
  assert.equal(largeContext?.provisionText,context!.provisionText,
    "A valid parent within the citation envelope must retain complete article access");
  const largeReceipt={...receipt,byteCount:largeBytes.length,sha256:sha256(largeBytes)};
  assert.equal((await resolveCitationEvidence(bucket,largeReceipt)).text,context!.provisionText);
});

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function migrationProvision<T extends Record<string, unknown> = Record<never, never>>(
  overrides?: T,
) {
  const merged = { ...representativeProvision, ...overrides };
  return {
    ...merged,
    renditionStatus: "active" as const,
    sourceRawSha256: sha256(merged.rawCapture),
    sourceNormalizedSha256: sha256(merged.normalizedRevision),
    sourceProvisionSha256: sha256(merged.provisionText),
    migrationRunId: "source-snapshot-current-20260831t062627z",
    cutoffAt: migrationCutoff,
    editorialValidity: {
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: null,
      recordedAt: migrationCutoff,
    },
    applicability: {
      id: `applicability:${merged.provisionRenditionId}`,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: null,
      evidenceUrl: merged.sourceUrl,
      evidenceKind: "official_timeline" as const,
      recordedAt: migrationCutoff,
    },
    currentPointer: {
      evidenceUrl: merged.sourceUrl,
      verifiedAt: migrationCutoff,
      recordedAt: migrationCutoff,
    },
  };
}

test("R2-native runtime identity hydrates accepted immutable legal evidence formats", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    const controllingProvision = { ...representativeProvision,
      textualAuthority: "controlling" as const, controllingOnConflict: true,
      derivedFromExpressionId: null };
    const imported = await importProvisionRendition({ db: d1, bucket }, controllingProvision);
    const resolve = () => resolveR2NativeCustomEvidence({
      bucket,
      currentAt: "2026-06-01T00:00:00.000Z",
      readArticleContext: async (original, article, sourceRevisionId) => {
        assert.equal(sourceRevisionId, representativeProvision.textRevisionId);
        assert.equal(original.textRevisionId, "revision:remapped-runtime");
        assert.equal(article, representativeProvision.articleNumber);
        return null;
      },
    }, {
      legalIdentitySha256: "a".repeat(64),
      legalInstrumentId: representativeProvision.legalInstrumentId,
      officialExpressionId: representativeProvision.officialExpressionId,
      textRevisionId: "revision:remapped-runtime",
      provisionConceptId: representativeProvision.provisionConceptId,
      provisionRenditionId: representativeProvision.provisionRenditionId,
      evidenceProvisionRenditionId: representativeProvision.provisionRenditionId,
      languageTag: representativeProvision.languageTag,
      script: representativeProvision.script,
      textualAuthority: controllingProvision.textualAuthority,
      validFrom: "2026-01-01T00:00:00.000Z",
      validTo: null,
      evidence: {
        r2Key: imported.provisionLocator.r2Key,
        byteCount: imported.provisionLocator.byteCount,
        sha256: imported.provisionLocator.sha256,
        sourceNormalizedSha256: sha256(representativeProvision.normalizedRevision),
        mediaType: "application/json; charset=utf-8",
      },
      citation: { label: `${representativeProvision.actTitle} — Article ${representativeProvision.articleNumber}`,
        url: representativeProvision.sourceUrl },
    }, { kind: "current" });

    const acceptedMetadata: Record<string, string>[] = [{
      schemaversion: "1", objectkind: "provision_rendition", sha256: imported.provisionLocator.sha256,
    }, {
      schemaversion: "complete-corpus-evidence-v1", kind: "provision_rendition",
      sha256: imported.provisionLocator.sha256, bytecount: String(imported.provisionLocator.byteCount),
    }, {
      schemaVersion: "complete-corpus-evidence-v1",
      kind: "provision_rendition",
      sha256: imported.provisionLocator.sha256,
      byteCount: String(imported.provisionLocator.byteCount),
      mediaType: "application/json; charset=utf-8",
    }, {
      sha256: imported.provisionLocator.sha256,
      source: "evidence",
      kind: "provision_rendition",
    }];
    for (const customMetadata of acceptedMetadata) {
      bucket.objects.get(imported.provisionLocator.r2Key)!.customMetadata = customMetadata;
      const result = await resolve();
      assert.equal(result.controlling.provisionText, controllingProvision.provisionText);
      assert.equal(result.controlling.evidence.sha256, imported.provisionLocator.sha256);
    }
    const rejectedMetadata: Record<string, string>[] = [
      {schemaVersion: "1", schemaversion: "unsupported", sha256: imported.provisionLocator.sha256},
      {schemaversion: "1", sha256: "f".repeat(64)},
      {schemaversion: "complete-corpus-evidence-v1", kind: "provision_rendition",
        sha256: imported.provisionLocator.sha256, bytecount: "1"},
    ];
    for (const customMetadata of rejectedMetadata) {
      bucket.objects.get(imported.provisionLocator.r2Key)!.customMetadata = customMetadata;
      await assert.rejects(resolve(), /SOURCE_UNAVAILABILITY/u);
    }
  } finally { sqlite.close(); }
});

async function markCurrent(
  db: D1Database,
  value: {
    textRevisionId: string;
    provisionRenditionId: string;
    sourceUrl: string;
    capturedAt: string;
  },
): Promise<void> {
  await recordProvisionTemporalEvidence({ db }, {
    id: `current-${value.provisionRenditionId}`,
    textRevisionId: value.textRevisionId,
    provisionRenditionId: value.provisionRenditionId,
    editorialValidFrom: value.capturedAt,
    editorialValidTo: null,
    applicability: {
      validFrom: value.capturedAt,
      validTo: null,
      evidenceUrl: value.sourceUrl,
      evidenceKind: "official_timeline",
    },
    currentPointer: { evidenceUrl: value.sourceUrl, verifiedAt: value.capturedAt },
    recordedAt: value.capturedAt,
  });
}

test("one provision imports idempotently and resolves only from hash-verified R2 evidence", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    const first = await importProvisionRendition({ db: d1, bucket }, representativeProvision);
    const second = await importProvisionRendition({ db: d1, bucket }, representativeProvision);
    assert.deepEqual(second, first);
    const objectCountBeforeConflict = bucket.objects.size;
    await assert.rejects(
      () => importProvisionRendition({ db: d1, bucket }, {
        ...representativeProvision,
        legalInstrumentId: "instrument-conflicting-alias",
        officialExpressionId: "expression-conflicting-alias",
        textRevisionId: "revision-conflicting-alias",
        provisionConceptId: "concept-conflicting-alias",
        provisionRenditionId: "rendition-conflicting-alias",
        captureId: "capture-conflicting-alias",
      }),
      /LEGAL_EVIDENCE_IDENTITY_CONFLICT/u,
      "one publisher instrument token cannot acquire a second incidental identifier",
    );
    assert.equal(bucket.objects.size, objectCountBeforeConflict);
    assert.deepEqual([...bucket.objects.keys()].sort(), [
      "corpus/normalized/revision-labor-code-ru-2026-01-01.json",
      "corpus/provisions/revision-labor-code-ru-2026-01-01/rendition-labor-code-ru-2026-article-10.json",
      "corpus/raw/lex/lex-100-2026-01-01/source.html",
    ]);
    const normalized = bucket.objects.get(
      "corpus/normalized/revision-labor-code-ru-2026-01-01.json",
    );
    assert.equal(
      new TextDecoder().decode(normalized?.bytes),
      representativeProvision.normalizedRevision,
      "a Text Revision must retain the byte-exact normalized legal text",
    );

    const service = {
      fetch(input: RequestInfo | URL, init?: RequestInit) {
        return handleOfficialEvidenceRequest(new Request(input, init), {
          APP_ENV: "development",
          LEGAL_DB: d1,
          LEGAL_EVIDENCE_BUCKET: bucket,
        });
      },
    } as Fetcher;
    const resolved = await createOfficialEvidenceClient({
      service,
      environment: "development",
    }).resolve(representativeProvision.provisionRenditionId);

    assert.equal(resolved.provisionText, representativeProvision.provisionText);
    assert.deepEqual(resolved.officialCitation, {
      label: "Трудовой кодекс Республики Узбекистан — Article 10",
      url: representativeProvision.sourceUrl,
    });
    assert.equal(resolved.evidence.provisionRenditionId, representativeProvision.provisionRenditionId);
    assert.match(resolved.evidence.sha256, /^[a-f0-9]{64}$/u);

    const bodyColumns = sqlite.prepare(`SELECT name FROM pragma_table_info('legal_provision_renditions')
      WHERE lower(name) IN ('content_text','provision_text','exact_quote','body_text')`).all();
    assert.deepEqual(bodyColumns, []);
  } finally {
    sqlite.close();
  }
});

test("complete-corpus evidence resolves an eligible historical plain-text rendition at its timestamp", async () => {
  const bucket = new MemoryEvidenceBucket();
  const provisionText = "Historical controlling provision text.";
  const bytes = new TextEncoder().encode(provisionText);
  const target = {
    legalInstrumentId: "instrument:historical",
    officialExpressionId: "expression:historical",
    textRevisionId: "revision:historical",
    provisionConceptId: "concept:historical",
    provisionRenditionId: "rendition:historical",
  };
  const key = `legal-corpus/provision/${sha256(bytes)}.txt`;
  await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, customMetadata: {
    sha256: sha256(bytes), schemaVersion: "1",
  } });
  let declaredSha256 = sha256(bytes);
  let textualAuthority = "controlling";
  const db = { prepare(sql: string) {
    assert.match(sql, /release\.capability AS capability/u);
    assert.match(sql, /record\.historical_eligible=1/u);
    assert.match(sql, /authority_revision\.authority_evidence_json IS NOT NULL/u);
    assert.match(sql, /authority_expression\.controlling_on_conflict=1/u);
    return { bind(...values: string[]) {
      assert.deepEqual(values, ["staging", "release:staging:history:pinned", target.provisionRenditionId]);
      return { async all() { return { results: [{
        ...target, capability: "history", legacyCurrentRenditionId: "legacy:historical",
        languageTag: "uz-Latn", script: "Latn", textualAuthority,
        sourceUrl: "https://lex.uz/docs/123", provisionKey: key,
        provisionBytes: bytes.byteLength, provisionSha256: declaredSha256,
        provisionMediaType: "text/plain;charset=utf-8", sourceNormalizedSha256: sha256("normalized"),
        validFrom: "2020-01-01T00:00:00.000Z", validTo: "2022-01-01T00:00:00.000Z",
      }] }; } }; } };
  } } as unknown as D1Database;

  const resolved = await resolveCompleteCorpusEvidence({
    db, bucket, environment: "staging", releaseId: "release:staging:history:pinned",
    currentAt: "2026-09-06T00:00:00.000Z",
  }, target.provisionRenditionId, { kind: "timestamp", instant: "2021-06-01T00:00:00.000Z" });
  assert.equal(resolved.controlling.provisionText, provisionText);
  assert.equal(resolved.controlling.officialCitation.label, "Official provision");
  for (const unsupportedAuthority of ["official_translation", "unknown"]) {
    textualAuthority = unsupportedAuthority;
    await assert.rejects(() => resolveCompleteCorpusEvidence({
      db, bucket, environment: "staging", releaseId: "release:staging:history:pinned",
      currentAt: "2026-09-06T00:00:00.000Z",
    }, target.provisionRenditionId, { kind: "timestamp", instant: "2021-06-01T00:00:00.000Z" }),
    /SOURCE_UNAVAILABILITY/u);
  }
  textualAuthority = "controlling";
  declaredSha256 = "f".repeat(64);
  await assert.rejects(() => resolveCompleteCorpusEvidence({
    db, bucket, environment: "staging", releaseId: "release:staging:history:pinned",
    currentAt: "2026-09-06T00:00:00.000Z",
  }, target.provisionRenditionId, { kind: "timestamp", instant: "2021-06-01T00:00:00.000Z" }),
  /SOURCE_UNAVAILABILITY/u);
});

test("complete-corpus evidence binds migrated identities to the sealed legacy provision object", async () => {
  const bucket = new MemoryEvidenceBucket();
  const provisionObject = {
    schemaVersion: 1 as const,
    legalInstrumentId: representativeProvision.legalInstrumentId,
    publisherInstrumentToken: representativeProvision.publisherInstrumentToken,
    officialExpressionId: representativeProvision.officialExpressionId,
    textRevisionId: representativeProvision.textRevisionId,
    provisionConceptId: representativeProvision.provisionConceptId,
    publisherProvisionToken: representativeProvision.publisherProvisionToken,
    provisionRenditionId: representativeProvision.provisionRenditionId,
    languageTag: representativeProvision.languageTag,
    script: representativeProvision.script,
    textualAuthority: representativeProvision.textualAuthority,
    actTitle: representativeProvision.actTitle,
    documentType: representativeProvision.documentType,
    articleNumber: representativeProvision.articleNumber,
    articleTitle: representativeProvision.articleTitle,
    provisionSequence: representativeProvision.provisionSequence,
    provisionText: representativeProvision.provisionText,
    renditionStatus: "active" as const,
    sourceUrl: representativeProvision.sourceUrl,
    capturedAt: representativeProvision.capturedAt,
    sourceNormalizedSha256: sha256(representativeProvision.normalizedRevision),
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(provisionObject)}\n`);
  const objectSha256 = sha256(bytes);
  const key = "corpus/provisions/legacy/representative.json";
  await bucket.put(key, bytes, { onlyIf: { etagDoesNotMatch: "*" }, customMetadata: {
    sha256: objectSha256, schemaVersion: "1",
  } });
  const target = {
    legalInstrumentId: "instrument:migrated",
    officialExpressionId: "expression:migrated",
    textRevisionId: "revision:migrated",
    provisionConceptId: "concept:migrated",
    provisionRenditionId: "rendition:migrated",
  };
  const releaseId = "release:staging:current:pinned";
  const currentAt = "2026-09-06T00:00:00.000Z";
  let interval: { validFrom: string | null; validTo: string | null } = {
    validFrom: "2026-01-01T00:00:00.000Z", validTo: null,
  };
  const db = {
    prepare(sql: string) {
      assert.equal(sql.includes("legal_custom_search_runtime_items"), false,
        "one evidence lookup must not multiply a rendition by its retrieval chunks");
      assert.equal(sql.includes("legal_active_activation_sets"), false,
        "hydration must follow the pinned release when activation changes");
      return { bind(...values: string[]) {
        assert.deepEqual(values, ["staging", releaseId, target.provisionRenditionId]);
        return { async all() { return { results: [{
        ...target,
        ...interval,
        capability: "current",
        legacyCurrentRenditionId: representativeProvision.provisionRenditionId,
        languageTag: representativeProvision.languageTag,
        script: representativeProvision.script,
        textualAuthority: "controlling",
        sourceUrl: representativeProvision.sourceUrl,
        provisionKey: key,
        provisionBytes: bytes.byteLength,
        provisionSha256: objectSha256,
        provisionMediaType: "application/json;charset=utf-8",
        sourceNormalizedSha256: provisionObject.sourceNormalizedSha256,
      }] }; } }; },
      };
    },
  } as unknown as D1Database;

  const resolved = await resolveCompleteCorpusCurrentEvidence(
    { db, bucket, environment: "staging", releaseId, currentAt },
    target.provisionRenditionId,
    { kind: "current" },
  );
  assert.equal(resolved.controlling.provisionRenditionId, target.provisionRenditionId);
  assert.equal(resolved.controlling.legalInstrumentId, target.legalInstrumentId);
  assert.equal(resolved.controlling.provisionText, representativeProvision.provisionText);
  for (const invalid of [
    { validFrom: "2026-09-07T00:00:00.000Z", validTo: null },
    { validFrom: "2026-01-01T00:00:00.000Z", validTo: currentAt },
    { validFrom: null, validTo: null },
  ]) {
    interval = invalid;
    await assert.rejects(() => resolveCompleteCorpusCurrentEvidence(
      { db, bucket, environment: "staging", releaseId, currentAt },
      target.provisionRenditionId, { kind: "current" },
    ), /SOURCE_UNAVAILABILITY/u);
  }
});

test("source article titles are retained exactly when official table text exceeds ordinary title length", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  const articleTitle = `Official annex cell: ${"legal table content ".repeat(550)}final cell`;
  try {
    await importProvisionRendition({ db: d1, bucket }, {
      ...representativeProvision,
      articleTitle,
    });

    const stored = sqlite.prepare(`SELECT article_title AS articleTitle
      FROM legal_provision_renditions WHERE id=?`)
      .get(representativeProvision.provisionRenditionId) as { articleTitle: string };
    assert.equal(stored.articleTitle, articleTitle);
  } finally {
    sqlite.close();
  }
});

test("a Russian translation is presented while its material proposition resolves to controlling Uzbek", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    const controlling = {
      ...representativeProvision,
      officialExpressionId: "expression-labor-code-uz-latn",
      textRevisionId: "revision-labor-code-uz-latn-2026-01-01",
      provisionRenditionId: "rendition-labor-code-uz-latn-2026-article-10",
      captureId: "lex-100-uz-latn-2026-01-01",
      languageTag: "uz-Latn" as const,
      script: "Latn" as const,
      textualAuthority: "controlling" as const,
      origin: "certified_original" as const,
      controllingOnConflict: true,
      derivedFromExpressionId: null,
      authorityEvidence: {
        kind: "publisher_certification" as const,
        sourceUrl: "https://lex.uz/docs/100",
        recordedAt: "2026-08-30T00:00:00.000Z",
      },
      provisionText: "10-modda. Mehnat shartnomasi faqat qonunda belgilangan asoslar bo'yicha bekor qilinadi.",
      rawCapture: "<html><body>10-modda. Mehnat shartnomasi faqat qonunda belgilangan asoslar bo'yicha bekor qilinadi.</body></html>",
      sourceUrl: "https://lex.uz/docs/100",
    };
    await importProvisionRendition({ db: d1, bucket }, controlling);
    const disagreeingTranslation = {
      ...representativeProvision,
      provisionText: "Статья 10. Перевод ошибочно утверждает, что прекращение разрешено всегда.",
      rawCapture: "<html><body>Статья 10. Перевод ошибочно утверждает, что прекращение разрешено всегда.</body></html>",
    };
    await importProvisionRendition({ db: d1, bucket }, disagreeingTranslation);
    await markCurrent(d1, controlling);
    await markCurrent(d1, disagreeingTranslation);

    const service = {
      fetch(input: RequestInfo | URL, init?: RequestInit) {
        return handleOfficialEvidenceRequest(new Request(input, init), {
          APP_ENV: "development",
          LEGAL_DB: d1,
          LEGAL_EVIDENCE_BUCKET: bucket,
        });
      },
    } as Fetcher;
    const result = await createOfficialEvidenceClient({
      service,
      environment: "development",
    }).resolveControlling(representativeProvision.provisionRenditionId);

    assert.equal(result.controlling.provisionText, controlling.provisionText);
    assert.equal(result.controlling.languageTag, "uz-Latn");
    assert.equal(result.controlling.textualAuthority, "controlling");
    assert.equal(result.translation?.provisionText, disagreeingTranslation.provisionText);
    assert.equal(result.translation?.textualAuthority, "official_translation");
    assert.equal(result.translationLabel, "Official Translation");
    assert.equal(result.materialCitation.url, controlling.sourceUrl);
  } finally {
    sqlite.close();
  }
});

test("historical Uzbek Cyrillic authority evidence controls despite a misleading route prefix", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    const cyrillic = {
      ...representativeProvision,
      officialExpressionId: "expression-labor-code-uz-cyrl",
      textRevisionId: "revision-labor-code-uz-cyrl-1998-05-01-1",
      provisionRenditionId: "rendition-labor-code-uz-cyrl-1998-article-10",
      captureId: "lex-100-uz-cyrl-1998-05-01-1",
      publisherRevisionToken: "1998-05-01-1",
      languageTag: "uz-Cyrl" as const,
      script: "Cyrl" as const,
      textualAuthority: "controlling" as const,
      origin: "adopted_original" as const,
      controllingOnConflict: true,
      derivedFromExpressionId: null,
      authorityEvidence: {
        kind: "adoption_record" as const,
        sourceUrl: "https://lex.uz/ru/docs/101",
        recordedAt: "2026-08-30T00:00:00.000Z",
      },
      provisionText: "10-модда. Назорат қилувчи тарихий матн.",
      rawCapture: "<html><body>10-модда. Назорат қилувчи тарихий матн.</body></html>",
      sourceUrl: "https://lex.uz/ru/docs/101",
    };
    const russian = {
      ...representativeProvision,
      legalInstrumentId: cyrillic.legalInstrumentId,
      provisionConceptId: cyrillic.provisionConceptId,
      derivedFromExpressionId: cyrillic.officialExpressionId,
    };
    await importProvisionRendition({ db: d1, bucket }, cyrillic);
    await importProvisionRendition({ db: d1, bucket }, russian);
    await markCurrent(d1, cyrillic);
    await markCurrent(d1, russian);

    const result = await (async () => {
      const service = {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          return handleOfficialEvidenceRequest(new Request(input, init), {
            APP_ENV: "development",
            LEGAL_DB: d1,
            LEGAL_EVIDENCE_BUCKET: bucket,
          });
        },
      } as Fetcher;
      return createOfficialEvidenceClient({ service, environment: "development" })
        .resolveControlling(russian.provisionRenditionId);
    })();

    assert.equal(result.controlling.languageTag, "uz-Cyrl");
    assert.equal(result.controlling.script, "Cyrl");
    assert.equal(result.materialCitation.url, "https://lex.uz/ru/docs/101");
  } finally {
    sqlite.close();
  }
});

test("unknown textual authority is ineligible and cannot silently become controlling evidence", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    const unknown = {
      ...representativeProvision,
      officialExpressionId: "expression-labor-code-unknown",
      textRevisionId: "revision-labor-code-unknown",
      provisionRenditionId: "rendition-labor-code-unknown",
      captureId: "lex-100-unknown",
      textualAuthority: "unknown" as const,
      origin: "unknown" as const,
      publicationStatus: "unknown" as const,
      controllingOnConflict: false,
      derivedFromExpressionId: null,
      authorityEvidence: null,
    };
    await importProvisionRendition({ db: d1, bucket }, unknown);
    const service = {
      fetch(input: RequestInfo | URL, init?: RequestInit) {
        return handleOfficialEvidenceRequest(new Request(input, init), {
          APP_ENV: "development",
          LEGAL_DB: d1,
          LEGAL_EVIDENCE_BUCKET: bucket,
        });
      },
    } as Fetcher;
    await assert.rejects(
      () => createOfficialEvidenceClient({ service, environment: "development" })
        .resolveControlling(unknown.provisionRenditionId),
      /SOURCE_UNAVAILABILITY/u,
    );
    const eligibility = sqlite.prepare(`SELECT status,reason_codes_json AS reasons
      FROM legal_official_eligibility WHERE subject_id=?`).get(
      unknown.provisionRenditionId,
    ) as { status: string; reasons: string };
    assert.equal(eligibility.status, "ineligible");
    assert.equal(
      eligibility.reasons,
      '["TEXTUAL_AUTHORITY_UNKNOWN","PUBLICATION_STATUS_UNKNOWN","ORIGIN_UNKNOWN"]',
    );
  } finally {
    sqlite.close();
  }
});

test("immutable evidence rejects a different-byte overwrite", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    await importProvisionRendition({ db: d1, bucket }, representativeProvision);
    await assert.rejects(
      () => importProvisionRendition({ db: d1, bucket }, {
        ...representativeProvision,
        provisionText: `${representativeProvision.provisionText} Изменено.`,
      }),
      (error: unknown) => error instanceof Error
        && error.message === "IMMUTABLE_EVIDENCE_CONFLICT",
    );
  } finally {
    sqlite.close();
  }
});

test("a mismatched declared source-normalized hash is rejected before evidence is written", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    await assert.rejects(
      () => importProvisionRendition({ db: d1, bucket }, {
        ...representativeProvision,
        sourceNormalizedSha256: "0".repeat(64),
      }),
      (error: unknown) => error instanceof Error
        && error.message === "SOURCE_UNAVAILABILITY",
    );
    assert.equal(bucket.objects.size, 0);
    const rows = sqlite.prepare("SELECT COUNT(*) AS count FROM legal_evidence_locators").get() as {
      count: number;
    };
    assert.equal(rows.count, 0);
  } finally {
    sqlite.close();
  }
});

test("a mismatched declared raw-source hash is rejected before evidence is written", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    await assert.rejects(
      () => importProvisionRendition({ db: d1, bucket }, {
        ...representativeProvision,
        sourceRawSha256: "0".repeat(64),
      }),
      /SOURCE_UNAVAILABILITY/u,
    );
    assert.equal(bucket.objects.size, 0);
  } finally {
    sqlite.close();
  }
});

test("a mismatched declared provision hash is rejected before evidence is written", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    await assert.rejects(
      () => importProvisionRendition({ db: d1, bucket }, {
        ...representativeProvision,
        sourceProvisionSha256: "0".repeat(64),
      }),
      /SOURCE_UNAVAILABILITY/u,
    );
    assert.equal(bucket.objects.size, 0);
  } finally {
    sqlite.close();
  }
});

test("a current rendition retains source status and verified temporal provenance", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  const verifiedAt = "2026-08-31T06:26:27.225Z";
  try {
    const temporalInput = {
      ...representativeProvision,
      renditionStatus: "active" as const,
      sourceProvisionSha256: createHash("sha256")
        .update(representativeProvision.provisionText)
        .digest("hex"),
      editorialValidity: {
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: null,
        recordedAt: verifiedAt,
      },
      applicability: {
        id: `applicability:${representativeProvision.provisionRenditionId}`,
        validFrom: "2026-01-01T00:00:00.000Z",
        validTo: null,
        evidenceUrl: representativeProvision.sourceUrl,
        evidenceKind: "official_timeline" as const,
        recordedAt: verifiedAt,
      },
      currentPointer: {
        evidenceUrl: representativeProvision.sourceUrl,
        verifiedAt,
        recordedAt: verifiedAt,
      },
    };
    await importProvisionRendition({ db: d1, bucket }, temporalInput);
    await importProvisionRendition({ db: d1, bucket }, temporalInput);

    assert.equal((sqlite.prepare(`SELECT status FROM legal_provision_renditions WHERE id=?`)
      .get(representativeProvision.provisionRenditionId) as { status: string }).status, "active");
    const validity = sqlite.prepare(`SELECT valid_from AS validFrom,valid_to AS validTo
      FROM legal_text_revision_validity WHERE text_revision_id=?`)
      .get(representativeProvision.textRevisionId) as { validFrom: string; validTo: string | null };
    assert.equal(validity.validFrom, "2026-01-01T00:00:00.000Z");
    assert.equal(validity.validTo, null);
    assert.equal((sqlite.prepare(`SELECT evidence_kind AS evidenceKind
      FROM legal_applicability_periods WHERE provision_rendition_id=?`)
      .get(representativeProvision.provisionRenditionId) as { evidenceKind: string }).evidenceKind,
    "official_timeline");
    assert.equal((sqlite.prepare(`SELECT verified_at AS verifiedAt
      FROM legal_current_provision_pointers WHERE provision_rendition_id=?`)
      .get(representativeProvision.provisionRenditionId) as { verifiedAt: string }).verifiedAt,
    verifiedAt);
    assert.equal((sqlite.prepare(`SELECT COUNT(*) AS count FROM legal_applicability_periods`)
      .get() as { count: number }).count, 1);
  } finally {
    sqlite.close();
  }
});

test("unknown applicability is explicit and the source rendition status cannot drift on replay", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  const unknown = {
    ...representativeProvision,
    renditionStatus: "active" as const,
    temporalGap: {
      id: `gap:${representativeProvision.provisionRenditionId}`,
      kind: "unknown" as const,
      evidenceUrl: representativeProvision.sourceUrl,
      reason: "The cutoff source does not establish a verified applicability interval.",
      recordedAt: "2026-08-31T06:26:27.225Z",
    },
    currentPointer: {
      evidenceUrl: representativeProvision.sourceUrl,
      verifiedAt: "2026-08-31T06:26:27.225Z",
      recordedAt: "2026-08-31T06:26:27.225Z",
    },
  };
  try {
    await importProvisionRendition({ db: d1, bucket }, unknown);
    assert.equal((sqlite.prepare(`SELECT status FROM legal_provision_renditions WHERE id=?`)
      .get(representativeProvision.provisionRenditionId) as { status: string }).status, "active");
    assert.equal((sqlite.prepare(`SELECT gap_kind AS gapKind,status FROM legal_temporal_coverage_gaps
      WHERE provision_rendition_id=?`).get(representativeProvision.provisionRenditionId) as {
      gapKind: string;
      status: string;
    }).gapKind, "unknown");
    assert.deepEqual(sqlite.prepare(`SELECT capability,status,reason_codes_json AS reasons
      FROM legal_official_eligibility WHERE subject_id=? ORDER BY capability`)
      .all(representativeProvision.provisionRenditionId).map((row) => ({ ...row })), [
      {
        capability: "as_of",
        status: "gap",
        reasons: '["TEMPORAL_UNKNOWN"]',
      },
      {
        capability: "current",
        status: "eligible",
        reasons: "[]",
      },
    ]);
    await assert.rejects(
      () => importProvisionRendition({ db: d1, bucket }, { ...unknown, renditionStatus: "unknown" }),
      /LEGAL_EVIDENCE_IDENTITY_CONFLICT/u,
    );
  } finally {
    sqlite.close();
  }
});

test("a complete revision import shares verified source evidence and restarts idempotently", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  const secondProvision = {
    ...representativeProvision,
    provisionConceptId: "concept-labor-code-article-11",
    publisherProvisionToken: "article-11",
    provisionRenditionId: "rendition-labor-code-ru-2026-article-11",
    articleNumber: "11",
    articleTitle: "Срок трудового договора",
    provisionSequence: 11,
    provisionText: "Статья 11. Срок трудового договора определяется законом.",
  };
  try {
    const first = await importProvisionRevision(
      { db: d1, bucket },
      [migrationProvision(), migrationProvision(secondProvision)],
    );
    assert.equal(bucket.putCalls, 4, "shared revision evidence is written once per import");
    const repeated = await importProvisionRevision(
      { db: d1, bucket },
      [migrationProvision(), migrationProvision(secondProvision)],
    );
    assert.deepEqual(repeated, first);
    assert.equal(first.provisionCount, 2);
    assert.equal(bucket.putCalls, 8, "restart repeats only create-only object checks");
    assert.equal(bucket.objects.size, 4, "one raw, one normalized, and two rendition objects");
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM legal_text_revisions").get() as {
      count: number;
    }).count, 1);
    assert.equal((sqlite.prepare("SELECT COUNT(*) AS count FROM legal_provision_renditions").get() as {
      count: number;
    }).count, 2);
    const cutoff = sqlite.prepare(`SELECT migration_run_id AS migrationRunId,
      cutoff_at AS cutoffAt FROM legal_migration_cutoffs WHERE scope='current'`).get();
    assert.deepEqual({ ...cutoff }, {
      migrationRunId: "source-snapshot-current-20260831t062627z",
      cutoffAt: migrationCutoff,
    });
  } finally {
    sqlite.close();
  }
});

test("revision replay verifies an existing object when a remote conditional put throws", async () => {
  class ThrowingConditionalBucket extends MemoryEvidenceBucket {
    override async put(
      key: string,
      value: Uint8Array,
      options: Parameters<MemoryEvidenceBucket["put"]>[2],
    ) {
      if (this.objects.has(key)) throw new Error("REMOTE_PRECONDITION_TRANSPORT_ERROR");
      return super.put(key, value, options);
    }
  }
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new ThrowingConditionalBucket();
  try {
    const first = await importProvisionRevision(
      { db: d1, bucket },
      [migrationProvision(), migrationProvision({
        ...representativeProvision,
        provisionConceptId: "concept-labor-code-article-12",
        publisherProvisionToken: "article-12",
        provisionRenditionId: "rendition-labor-code-ru-2026-article-12",
        articleNumber: "12",
        provisionSequence: 12,
        provisionText: "Статья 12. Проверка повторного импорта.",
      })],
    );
    const repeated = await importProvisionRevision(
      { db: d1, bucket },
      [migrationProvision()],
    );
    assert.equal(first.provisionCount, 2);
    assert.equal(repeated.provisionCount, 1);
  } finally {
    sqlite.close();
  }
});

test("current revision migration requires explicit byte and cutoff-pinned temporal evidence", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    await assert.rejects(
      () => importProvisionRevision({ db: d1, bucket }, [representativeProvision]),
      /Invalid input/u,
    );
    await assert.rejects(
      () => importProvisionRevision({ db: d1, bucket }, [{
        ...migrationProvision(),
        currentPointer: {
          ...migrationProvision().currentPointer,
          verifiedAt: "2026-08-31T06:26:27.226Z",
        },
      }]),
      /cutoff/u,
    );
    await assert.rejects(
      () => importProvisionRevision({ db: d1, bucket }, [{
        ...migrationProvision(),
        applicability: {
          ...migrationProvision().applicability,
          validFrom: "2026-02-01T00:00:00.000Z",
          validTo: "2026-01-01T00:00:00.000Z",
        },
      }]),
      /non-empty interval/u,
    );
    assert.equal(bucket.objects.size, 0);
  } finally {
    sqlite.close();
  }
});

test("current revision migration rejects a page larger than the D1 checkpoint budget", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  try {
    const input = migrationProvision();
    await assert.rejects(
      () => importProvisionRevision({ db: d1, bucket }, Array.from({ length: 49 }, () => input)),
      /Too big/u,
    );
    assert.equal(bucket.objects.size, 0);
  } finally {
    sqlite.close();
  }
});

test("replay rejects drift in immutable canonical and provenance metadata", async () => {
  const changes = [
    { canonicalInstrumentTitle: "Changed canonical title" },
    { documentType: "changed-type" },
    { canonicalInstrumentUrl: "https://lex.uz/docs/101" },
    { origin: "unknown" as const },
    { publicationStatus: "withdrawn" as const },
    { capturedAt: "2026-08-29T00:00:00.000Z" },
  ];
  for (const change of changes) {
    const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
      new URL("../legal-drizzle/", import.meta.url),
    );
    const bucket = new MemoryEvidenceBucket();
    try {
      await importProvisionRendition({ db: d1, bucket }, representativeProvision);
      await assert.rejects(
        () => importProvisionRendition({ db: d1, bucket }, {
          ...representativeProvision,
          ...change,
        }),
        /LEGAL_EVIDENCE_IDENTITY_CONFLICT/u,
      );
    } finally {
      sqlite.close();
    }
  }
});

test("separate revision calls cannot mix immutable current-baseline migration runs", async () => {
  const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
    new URL("../legal-drizzle/", import.meta.url),
  );
  const bucket = new MemoryEvidenceBucket();
  const input = migrationProvision();
  try {
    await importProvisionRevision({ db: d1, bucket }, [input]);
    const objectCount = bucket.objects.size;
    await assert.rejects(
      () => importProvisionRevision({ db: d1, bucket }, [{
        ...input,
        migrationRunId: "source-snapshot-current-later-run",
      }]),
      /LEGAL_EVIDENCE_IDENTITY_CONFLICT/u,
    );
    assert.equal(bucket.objects.size, objectCount);
  } finally {
    sqlite.close();
  }
});

test("current eligibility rejects superseded, withdrawn, unknown-origin, and unproven authority", async () => {
  const unsafe = [
    { change: { renditionStatus: "historical" as const }, reason: "RENDITION_STATUS_HISTORICAL" },
    { change: { renditionStatus: "repealed" as const }, reason: "RENDITION_STATUS_REPEALED" },
    { change: { publicationStatus: "withdrawn" as const }, reason: "PUBLICATION_STATUS_WITHDRAWN" },
    { change: { origin: "unknown" as const }, reason: "ORIGIN_UNKNOWN" },
    { change: { authorityEvidence: null }, reason: "AUTHORITY_EVIDENCE_MISSING" },
  ];
  for (const { change, reason } of unsafe) {
    const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
      new URL("../legal-drizzle/", import.meta.url),
    );
    const bucket = new MemoryEvidenceBucket();
    try {
      await importProvisionRendition({ db: d1, bucket }, {
        ...representativeProvision,
        ...change,
        applicability: {
          id: `applicability:${representativeProvision.provisionRenditionId}`,
          validFrom: "2026-01-01T00:00:00.000Z",
          validTo: null,
          evidenceUrl: representativeProvision.sourceUrl,
          evidenceKind: "official_timeline" as const,
          recordedAt: migrationCutoff,
        },
        currentPointer: {
          evidenceUrl: representativeProvision.sourceUrl,
          verifiedAt: migrationCutoff,
          recordedAt: migrationCutoff,
        },
      });
      const eligibility = sqlite.prepare(`SELECT status,reason_codes_json AS reasons
        FROM legal_official_eligibility
        WHERE subject_id=? AND capability='current'`)
        .get(representativeProvision.provisionRenditionId) as {
        status: string;
        reasons: string;
      };
      assert.equal(eligibility.status, "ineligible");
      assert.ok((JSON.parse(eligibility.reasons) as string[]).includes(reason));
    } finally {
      sqlite.close();
    }
  }
});

test("shared target creation provenance is independent of revision import order", async () => {
  const first = migrationProvision();
  const second = migrationProvision({
    textRevisionId: "revision-labor-code-ru-2026-02-01",
    provisionRenditionId: "rendition-labor-code-ru-2026-02-article-10",
    captureId: "lex-100-2026-02-01",
    publisherRevisionToken: "2026-02-01",
    capturedAt: "2026-08-30T01:00:00.000Z",
  });
  const forward = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  const reverse = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  const forwardBucket = new MemoryEvidenceBucket();
  const reverseBucket = new MemoryEvidenceBucket();
  try {
    for (const input of [first, second]) {
      await importProvisionRevision({ db: forward.d1, bucket: forwardBucket }, [input]);
    }
    for (const input of [second, first]) {
      await importProvisionRevision({ db: reverse.d1, bucket: reverseBucket }, [input]);
    }
    const provenanceSql = `SELECT 'instrument' AS kind,id,created_at AS createdAt
      FROM legal_instruments UNION ALL
      SELECT 'expression',id,created_at FROM legal_official_expressions UNION ALL
      SELECT 'concept',id,created_at FROM legal_provision_concepts ORDER BY kind,id`;
    const forwardRows = forward.sqlite.prepare(provenanceSql).all().map((row) => ({ ...row }));
    const reverseRows = reverse.sqlite.prepare(provenanceSql).all().map((row) => ({ ...row }));
    assert.deepEqual(forwardRows, reverseRows);
    assert.ok(forwardRows.every((row) => row.createdAt === migrationCutoff));
  } finally {
    forward.sqlite.close();
    reverse.sqlite.close();
  }
});

test("revision migration restarts identically after a partial R2 write failure", async () => {
  class FailAfterSharedEvidenceBucket extends MemoryEvidenceBucket {
    failed = false;

    override async put(
      key: string,
      value: Uint8Array,
      options: Parameters<MemoryEvidenceBucket["put"]>[2],
    ) {
      if (!this.failed && this.putCalls === 2) {
        this.failed = true;
        throw new Error("INJECTED_PARTIAL_WRITE_FAILURE");
      }
      return super.put(key, value, options);
    }
  }
  const firstInput = migrationProvision();
  const secondInput = migrationProvision({
    provisionConceptId: "concept-labor-code-article-13",
    publisherProvisionToken: "article-13",
    provisionRenditionId: "rendition-labor-code-ru-2026-article-13",
    articleNumber: "13",
    provisionSequence: 13,
    provisionText: "Статья 13. Проверка возобновления после частичной ошибки.",
  });
  const interrupted = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  const clean = sqliteD1FixtureFromDirectory(new URL("../legal-drizzle/", import.meta.url));
  const interruptedBucket = new FailAfterSharedEvidenceBucket();
  const cleanBucket = new MemoryEvidenceBucket();
  try {
    await assert.rejects(
      () => importProvisionRevision(
        { db: interrupted.d1, bucket: interruptedBucket },
        [firstInput, secondInput],
      ),
      /INJECTED_PARTIAL_WRITE_FAILURE/u,
    );
    const restarted = await importProvisionRevision(
      { db: interrupted.d1, bucket: interruptedBucket },
      [firstInput, secondInput],
    );
    const expected = await importProvisionRevision(
      { db: clean.d1, bucket: cleanBucket },
      [firstInput, secondInput],
    );
    assert.deepEqual(restarted, expected);
    assert.deepEqual(
      [...interruptedBucket.objects.entries()],
      [...cleanBucket.objects.entries()],
    );
    const inventorySql = `SELECT id FROM legal_evidence_locators
      UNION ALL SELECT id FROM legal_instruments
      UNION ALL SELECT id FROM legal_official_expressions
      UNION ALL SELECT id FROM legal_text_revisions
      UNION ALL SELECT id FROM legal_provision_concepts
      UNION ALL SELECT id FROM legal_provision_renditions
      UNION ALL SELECT id FROM legal_applicability_periods
      UNION ALL SELECT id FROM legal_official_eligibility ORDER BY id`;
    assert.deepEqual(
      interrupted.sqlite.prepare(inventorySql).all(),
      clean.sqlite.prepare(inventorySql).all(),
    );
  } finally {
    interrupted.sqlite.close();
    clean.sqlite.close();
  }
});

for (const corruption of ["missing", "size", "content", "source-hash"] as const) {
  test(`${corruption} evidence corruption becomes Source Unavailability`, async () => {
    const { sqlite, d1 } = sqliteD1FixtureFromDirectory(
      new URL("../legal-drizzle/", import.meta.url),
    );
    const bucket = new MemoryEvidenceBucket();
    try {
      const imported = await importProvisionRendition(
        { db: d1, bucket },
        representativeProvision,
      );
      const stored = bucket.objects.get(imported.provisionLocator.r2Key)!;
      if (corruption === "missing") {
        bucket.objects.delete(imported.provisionLocator.r2Key);
      } else if (corruption === "size") {
        const changed = new Uint8Array(stored.bytes.byteLength + 1);
        changed.set(stored.bytes);
        changed[changed.byteLength - 1] = 1;
        stored.bytes = changed;
      } else if (corruption === "content") {
        stored.bytes[0] = stored.bytes[0] === 123 ? 91 : 123;
      } else {
        sqlite.exec("DROP TRIGGER legal_evidence_locators_no_update");
        sqlite.prepare(`UPDATE legal_evidence_locators
          SET source_normalized_sha256=? WHERE id=?`).run(
          "0".repeat(64),
          imported.provisionLocator.id,
        );
      }

      const service = {
        fetch(input: RequestInfo | URL, init?: RequestInit) {
          return handleOfficialEvidenceRequest(new Request(input, init), {
            APP_ENV: "development",
            LEGAL_DB: d1,
            LEGAL_EVIDENCE_BUCKET: bucket,
          });
        },
      } as Fetcher;
      await assert.rejects(
        () => createOfficialEvidenceClient({
          service,
          environment: "development",
        }).resolve(representativeProvision.provisionRenditionId),
        (error: unknown) => error instanceof Error
          && error.message === "SOURCE_UNAVAILABILITY",
      );
    } finally {
      sqlite.close();
    }
  });
}
