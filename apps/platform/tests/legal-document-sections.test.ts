import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {completeDocumentSections} from "../lib/legal/document-sections";
import {normalizedLegalSourceSnapshotSchema} from "../lib/legal/source-parser";
import {createNormalizedDocumentEvidenceReader} from "../lib/legal-corpus/normalized-article-evidence";
import {parseResolvedOfficialEvidence} from "../lib/legal-corpus/target-evidence";
import {corpusAnswerEvidence} from "../lib/legal-chat/corpus-evidence";
import {resolveCitationEvidence} from "../lib/legal-corpus/citation-evidence";
import {MemoryEvidenceBucket} from "./helpers/legal-target";

const hash=(value:string|Uint8Array)=>createHash("sha256").update(value).digest("hex");
const snapshot=(texts:string[])=>normalizedLegalSourceSnapshotSchema.parse({schemaVersion:1,
  parser:{name:"parse5",version:"8.0.1",profile:"juro-legal-blocks-v1"},
  source:{sourceKind:"lex",locale:"en",canonicalId:"777",canonicalUrl:"https://lex.uz/en/docs/777",rawContentSha256:"a".repeat(64)},
  primarySelector:"lex-document",documentTitle:"Amending resolution",blocks:texts.map((text,index)=>({index,kind:"paragraph",text})),plainText:texts.join(" ")});

test("quoted replacement chapters preserve earlier complete amendment clauses",()=>{
  const source=snapshot(["The legislature amends the labor code as follows:",
    "1. 179 va 180-moddalar quyidagi tahrirda bayon etilsin:",
    "“179-modda. Medical examinations", "The employer must arrange examinations.",
    "180-modda. Additional examinations", "The employee may request an examination.”",
    "2. The following chapter shall read:", "“CHAPTER FOURTEEN. LABOR DISPUTES",
    "229-modda. Dispute bodies", "The authorized bodies hear disputes.",
    "230-modda. Procedure", "The procedural guarantees remain applicable.”",
    "3. A later replacement follows:", "“284-modda. Unclosed replacement", "Its boundary is uncertain."]);
  const sections=completeDocumentSections(source);
  assert.equal(sections.length,2);
  assert.match(sections[0]!.text,/179-modda/);assert.match(sections[0]!.text,/180-modda/);
  assert.doesNotMatch(sections[0]!.text,/229-modda/);
  assert.match(sections[1]!.text,/CHAPTER FOURTEEN/);assert.match(sections[1]!.text,/procedural guarantees/);
  const independent=snapshot(["A governing code follows:","Article 1. Governing rule","The complete governing rule applies to every covered party. ".repeat(4)]);
  assert.deepEqual(completeDocumentSections(independent),[]);
});

test("named amendment decisions retain inserted provision numbers inside the affected decision",()=>{
  const source=snapshot(["Ўзбекистон Республикаси Олий суди Пленуми қуйидаги қарорларга ўзгартиришлар киритади:",
    "I. Фуқаролик ишлари бўйича қарорлар:",
    "1. «Юридик фактларни белгилаш ҳақида»ги 1991 йил 20 декабрдаги 5-сонли қарори:",
    "Қарорнинг рус тили матни қуйидаги мазмундаги 21-банд билан тўлдирилсин:",
    "21. Обратить внимание судов на порядок исправления актовых записей.",
    "Отсутствие заключения не препятствует принятию заявления.»",
    "2. «Суд ишларини кўриш ҳақида»ги 1992 йил 19 июндаги 5-сонли қарори:","Муқаддимага тегишли ўзгартиришлар киритилсин."]);
  const sections=completeDocumentSections(source);assert.equal(sections.length,2);
  assert.match(sections[0]!.text,/21\. Обратить внимание/);
  assert.match(sections[0]!.text,/не препятствует/);
  assert.doesNotMatch(sections[0]!.text,/1992 йил/);
});

test("complete resolution clauses retain introductions and subordinate quoted numbering",()=>{
  const source=snapshot(["The competent authority adopts these amendments under the governing legislation:",
    "I. Amendments concerning civil procedure:","1. The following decision is amended:",
    "The first rule shall read: «Required conditions:","1. This is inside a quotation, not another resolution clause.",
    "2. This is the second quoted condition.»","A final exception remains applicable.",
    "2. A different decision is amended:","The former rule is repealed."]);
  const sections=completeDocumentSections(source);
  assert.equal(sections.length,2);
  assert.match(sections[0]!.text,/governing legislation/);
  assert.match(sections[0]!.text,/Amendments concerning civil procedure/);
  assert.match(sections[0]!.text,/final exception/);
  assert.doesNotMatch(sections[0]!.text,/different decision/);
  assert.match(sections[1]!.text,/former rule is repealed/);
  assert.deepEqual(completeDocumentSections({...source,blocks:[...source.blocks,{index:9,kind:"paragraph",text:"Article 7. A statutory article"}]}),[]);
  const incomplete=snapshot(["The competent authority adopts these amendments under the governing legislation and its expressly conferred statutory powers:","1. The first decision is amended:","New introductory conditions:","2. The second decision is amended:","A complete rule applies."]);
  assert.equal(completeDocumentSections(incomplete).length,1);
  const nested=snapshot(["The competent authority adopts these amendments under the governing legislation:",
    "1. Amend this decision as follows:","1. First subordinate condition.","2. Second subordinate condition.",
    "An exception applies to both subordinate conditions.","2. Amend the second decision as follows:","A complete rule applies."]);
  assert.deepEqual(completeDocumentSections(nested),[],"unquoted numbering resets cannot establish clause depth");
  const hierarchy=snapshot(["The competent authority adopts these procedural requirements under its statutory powers:",
    "Chapter: Pending cases only", "These rules apply only to pending cases.", "Section: Filing", "1. The applicant must file the complete request."]);
  hierarchy.blocks[1]={...hierarchy.blocks[1]!,kind:"heading",headingLevel:2,semanticRole:"chapter"};
  hierarchy.blocks[3]={...hierarchy.blocks[3]!,kind:"heading",headingLevel:3,semanticRole:"section"};
  assert.match(completeDocumentSections(hierarchy)[0]!.text,/apply only to pending cases/);
  delete hierarchy.blocks[3]!.headingLevel;
  assert.deepEqual(completeDocumentSections(hierarchy),[],"unknown structural ancestry remains unavailable");
});

test("oversized unnumbered sources reopen a complete clause without claiming article precision",async()=>{
  const fragment="The inheritance deadline wording is removed;";
  const source=snapshot(["This resolution changes the following identified decisions, retaining all other provisions:",
    "I. Civil procedure decisions:","1. Decision dated 20 December 1991 is amended:",
    "Earlier context remains applicable. ".repeat(700),fragment,"The following exception remains applicable.",
    "2. Another identified decision is amended:","Other amendments remain applicable. ".repeat(1400)]);
  assert.ok(source.plainText.length>64_000);
  const bytes=new TextEncoder().encode(JSON.stringify(source)),bucket=new MemoryEvidenceBucket(),key="corpus/normalized/revision:sections.json";
  bucket.objects.set(key,{bytes,customMetadata:{}});
  const original=parseResolvedOfficialEvidence({legalInstrumentId:"instrument:sections",officialExpressionId:"expression:sections",
    textRevisionId:"revision:sections",provisionConceptId:"concept:sections",provisionRenditionId:"rendition:sections",
    languageTag:"en",script:"Latn",textualAuthority:"unknown",provisionText:fragment,
    officialCitation:{url:source.source.canonicalUrl,label:"Amending resolution — Article 4"},
    evidence:{provisionRenditionId:"rendition:sections",r2Key:"fragment",byteCount:100,sha256:"b".repeat(64),sourceNormalizedSha256:hash(bytes),schemaVersion:1}});
  const read=createNormalizedDocumentEvidenceReader(bucket),documentContext=await read(original);
  assert.ok(documentContext);assert.equal(documentContext.evidence.normalizedScope,"section");
  const evidence=await corpusAnswerEvidence({resolution:{controlling:original,documentContext,materialCitation:documentContext.officialCitation},
    currentAt:"2026-09-25T00:00:00Z",endpoint:{kind:"timestamp",instant:"2017-01-01T00:00:00Z"}});
  assert.equal(evidence.source.article,null);assert.equal(evidence.source.citationEvidenceReceipt!.kind,"normalized-section");
  assert.match(evidence.text,/20 December 1991/);assert.match(evidence.text,/following exception/);
  assert.doesNotMatch(evidence.text,/Another identified/);
  assert.deepEqual(await resolveCitationEvidence(bucket,evidence.source.citationEvidenceReceipt!),{text:evidence.text,fullArticle:false,truncated:false});
  await assert.rejects(resolveCitationEvidence(bucket,{...evidence.source.citationEvidenceReceipt!,textSha256:hash(fragment)}));
  assert.equal(await read({...original,provisionText:"This resolution changes"}),null,"shared introductions cannot select a clause");
  const oversized={...source,blocks:source.blocks.map((block,index)=>index===7?{...block,text:block.text.repeat(2)}:block)};
  const oversizedBytes=new TextEncoder().encode(JSON.stringify(oversized));
  bucket.objects.set(key,{bytes:oversizedBytes,customMetadata:{}});
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)({...original,provisionText:"This resolution changes",
    evidence:{...original.evidence,sourceNormalizedSha256:hash(oversizedBytes)}}),null,"an oversized competing scope still makes a shared fragment ambiguous");
});

test("complete annex scopes preserve adoption and ignore annexes of quoted older instruments",()=>{
  const adoption="Oʻzbekiston Respublikasi Prezidentining 2025-yil 25-martdagi PF-57-son Farmoniga";
  const source=snapshot(["This instrument sets the following complete conditions for the public bodies in its official schedules:",
    "1. Adopt both schedules under the applicable conditions.",adoption+"\n1-ILOVA","The first schedule applies.",
    "Oʻzbekiston Respublikasi Prezidentining 2020-yil 25-martdagi PF-57-son Farmoniga\n2-ILOVA","The older schedule is amended as stated here.",
    adoption+"\n2-ILOVA","The second schedule applies."]);
  const sections=completeDocumentSections(source);assert.equal(sections.length,3);
  assert.match(sections[1]!.text,/older schedule/);assert.doesNotMatch(sections[2]!.text,/older schedule/);
  source.blocks.at(-1)!.text="The following exceptions apply:";
  assert.equal(completeDocumentSections(source).length,2);
});

test("annex chapter extraction retains complete chapters and rejects ambiguous section ancestry",()=>{
  const source=snapshot(["This instrument establishes the applicable procedural requirements and adopts the following official schedule:",
    "1. The schedule is adopted.","Oʻzbekiston Respublikasi Prezidentining 2025-yil 25-martdagi PF-57-son Farmoniga\n1-ILOVA",
    "The schedule applies only to pending cases.","1-боб. First chapter","First complete rule. ".repeat(1900),
    "2-боб. Second chapter","Second complete rule. ".repeat(1900)]);
  const sections=completeDocumentSections(source);assert.equal(sections.length,3);
  assert.match(sections[2]!.text,/only to pending cases/);assert.doesNotMatch(sections[2]!.text,/First complete rule/);
  source.blocks[6]={...source.blocks[6]!,semanticRole:"section",headingLevel:2};
  assert.equal(completeDocumentSections(source).length,1);
});

test("article parents expose complete non-article annexes without bypassing article completeness",()=>{
  const source=snapshot(["The legislature adopts this law and its official annexes with the following stated conditions:",
    "Article 1. Incomplete article heading", "Oʻzbekiston Respublikasi Prezidentining 2025-yil 25-martdagi PF-57-son Farmoniga\n1-ILOVA",
    "The full schedule lists the applicable exemptions and all required supporting conditions."]);
  const sections=completeDocumentSections(source);assert.equal(sections.length,1);
  assert.match(sections[0]!.text,/full schedule/);assert.doesNotMatch(sections[0]!.text,/Incomplete article heading/);
  source.blocks.push({index:4,kind:"paragraph",text:"Article 2. Incomplete annex article"});
  assert.deepEqual(completeDocumentSections(source),[]);
});

test("an article fragment duplicated in an annex cannot bypass failed article recovery",async()=>{
  const fragment="An invalid article fragment also appears in an unrelated schedule.";
  const source=snapshot(["Article 1. "+fragment,
    "Oʻzbekiston Respublikasi Prezidentining 2025-yil 25-martdagi PF-57-son Farmoniga\n1-ILOVA",
    fragment+" The schedule contains separate and complete conditions."]);
  assert.equal(completeDocumentSections(source).length,1);
  assert.doesNotMatch(completeDocumentSections(source)[0]!.text,/Article 1/);
  const bytes=new TextEncoder().encode(JSON.stringify(source)),bucket=new MemoryEvidenceBucket();
  bucket.objects.set("corpus/normalized/revision:annex-ambiguity.json",{bytes,customMetadata:{}});
  const original=parseResolvedOfficialEvidence({legalInstrumentId:"instrument:annex",officialExpressionId:"expression:annex",
    textRevisionId:"revision:annex-ambiguity",provisionConceptId:"concept:annex",provisionRenditionId:"rendition:annex",
    languageTag:"en",script:"Latn",textualAuthority:"unknown",provisionText:fragment,
    officialCitation:{url:source.source.canonicalUrl,label:"Article 1"},
    evidence:{provisionRenditionId:"rendition:annex",r2Key:"fragment",byteCount:100,sha256:"b".repeat(64),sourceNormalizedSha256:hash(bytes),schemaVersion:1}});
  assert.equal(await createNormalizedDocumentEvidenceReader(bucket)(original),null);
});


test("amending schedules preserve slash identifiers and optional grammatical suffixes",()=>{
 const source=snapshot(["The plenary court adopts these amendments:",
 "I. First section:",
 "1. Ўзбекистон Республикаси Олий суди Пленумининг «Суд ҳокимияти тўғрисида»ги 1996 йил 20 декабрдаги 1/60-сонли қарори:",
 "The affected decision is amended as follows:","27.1. This subordinate replacement rule remains in its named decision.",
 "2. Ўзбекистон Республикаси Олий суди Пленумининг «Суд ишлари тўғрисида» 2000 йил 20 декабрдаги 19-сонли қарори:","44-бандидаги «Adopted «Old title» деган сўзлар «Approved «New title» деган сўзлар билан алмаштирилсин.",
 "45-бандидаги «Old phrase« деган сўзлар «New phrase» деган сўзлар билан алмаштирилсин;",
 "II. Second section:","1. Ўзбекистон Республикаси Олий суди Пленумининг «Суд ишлари тўғрисида»ги 2001 йил 20 декабрдаги 20-сонли қарори:","The third complete amendment applies."]);
 const sections=completeDocumentSections(source);assert.equal(sections.length,3);
 assert.match(sections[0]!.text,/27.1/);assert.doesNotMatch(sections[0]!.text,/second complete/);
 assert.match(sections[2]!.text,/Second section/);
});


test("source tails retain enclosing context and reject nested chapter ancestry",()=>{
  const source=snapshot(["Introduction.","Chapter 1. Original chapter","Article 1. Amendment",
    "Replace the chapter with «Chapter 1. Quoted chapter", "Chapter 2. Quoted continuation", "Quoted chapter closes».",
    "Chapter 2 of the previous law is replaced as follows:","«Article 178. Unclosed replacement","The last rule applies."]);
  const sections=completeDocumentSections(source);assert.equal(sections.length,1);
  assert.equal(sections[0]!.text,source.blocks.map(block=>block.text).join(" "));
  const nested=snapshot(["Introduction.","Chapter 1. Parent", "The parent chapter conditions apply to every subordinate provision and must remain in the evidence context.","Chapter 2. Nested",
    "Article 46. Amendment","«Article 178. Unclosed replacement","The rule applies."]);
  nested.blocks[1]!.headingLevel=1;nested.blocks[3]!.headingLevel=2;
  assert.deepEqual(completeDocumentSections(nested),[]);
});
