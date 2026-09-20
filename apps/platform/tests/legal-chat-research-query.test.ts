import assert from "node:assert/strict";
import test from "node:test";
import {privateResearchQueries} from "../lib/legal-chat/research-query";
import type {QuestionInterpretation} from "../lib/legal-corpus/legal-candidate-index";

const plan=(text:string,privateNameSpans:string[]=[],legalTitleSpans:string[]=[]):QuestionInterpretation=>({
  id:"request:one",formulations:[{id:"query:one",text,privateNameSpans,legalTitleSpans,readingIds:["reading:one"],requirementIds:["need:one"]}]});

test("case names, contacts and private identifiers do not enter search queries",async()=>{
  const result=await privateResearchQueries(plan("record access for Alice Example alice@example.com +998 90 123 45 67 account 123456789012",["Alice Example"]),[]);
  assert.equal(result.formulations[0]!.text,"record access for account");
});

test("a model cannot disguise a private name as a public legal title",async()=>{
  const result=await privateResearchQueries(plan("rights under Alice Example and Public Records Act",[],["Alice Example","Public Records Act"]),["Public Records Act"]);
  assert.equal(result.formulations[0]!.text,"rights under and Public Records Act");
  assert.deepEqual(result.formulations[0]!.legalTitleSpans,["Public Records Act"]);
});

test("a missing model-declared private span fails instead of silently skipping redaction",async()=>{
  await assert.rejects(privateResearchQueries(plan("record requests",["Missing Name"]),[]),/PRIVATE_SPAN_INVALID/);
});

test("queries retain ordinary provision numbers and their semantic associations",async()=>{
  const input=plan("record requests under articles 100 200 300 on 2025-01-01");
  assert.deepEqual(await privateResearchQueries(input,[]),input);
});
