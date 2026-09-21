import assert from "node:assert/strict";
import test from "node:test";
import {appendPrivateDocumentExcerpts} from "../lib/legal-chat/private-document-projection";
import {emptyLegalAnswer} from "../lib/legal-chat/answer-engine";
import {privateDocumentContext} from "./helpers/private-document-context";

test("authorized excerpts survive unavailable law as attributed document text, never legal findings",()=>{
  const result=emptyLegalAnswer({locale:"en",mode:"fast",answerMode:"detailed",unresolved:["Official law unavailable"]});
  const document=privateDocumentContext();
  const projected=appendPrivateDocumentExcerpts(result,[document]);
  assert.equal(projected.responseKind,"answer");
  assert.equal(projected.evidenceMode,"private_only");
  assert.deepEqual(projected.confirmedFindings,[]);
  assert.deepEqual(projected.actionPlan,[]);
  assert.equal(projected.summary,result.summary);
  assert.deepEqual(projected.coverageGaps,result.coverageGaps);
  assert.equal(projected.sources[0]?.sourceClass,"USER_TRUSTED_PRIVATE");
  assert.match(projected.referenceNotes![0]!.note,/Document content, not a legal conclusion/);
  assert.ok(projected.referenceNotes![0]!.note.includes(document.text));
});

test("long document excerpts are preserved in ordered parts without claiming a law or losing text",()=>{
  const document=privateDocumentContext();
  document.text="📝".repeat(1600);
  const result=appendPrivateDocumentExcerpts(emptyLegalAnswer({locale:"ru",mode:"deep",answerMode:"detailed",unresolved:[]}),[document]);
  assert.equal(result.referenceNotes?.length,2);
  const quoted=result.referenceNotes!.map(note=>note.note.slice(note.note.indexOf("«")+1,-1)).join("");
  assert.equal(quoted,document.text);
  assert.deepEqual(result.referenceNotes!.map(note=>note.sourceIds),[[document.source.id],[document.source.id]]);
  assert.equal(result.sources.length,1);
});

test("private projection rejects unrelated source classes and fails explicitly rather than truncating supported context",()=>{
  const document=privateDocumentContext();
  const result=emptyLegalAnswer({locale:"en",mode:"fast",answerMode:"detailed",unresolved:[]});
  assert.throws(()=>appendPrivateDocumentExcerpts(result,[{...document,source:{...document.source,sourceClass:"OWNER_TRUSTED_GLOBAL"}}]),
    /PRIVATE_DOCUMENT_IDENTITY_INVALID/);
  assert.throws(()=>appendPrivateDocumentExcerpts({...result,referenceNotes:Array.from({length:8},()=>({title:"Existing note",note:"Retained text",sourceIds:[]}))},[document]),
    /LEGAL_CONTEXT_CAPACITY_EXCEEDED/);
  assert.throws(()=>appendPrivateDocumentExcerpts(result,[document,document]),/PRIVATE_DOCUMENT_IDENTITY_INVALID/);
});
