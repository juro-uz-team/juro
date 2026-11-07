import assert from "node:assert/strict";
import test from "node:test";
import {answerSpeechText,speechTextChunks} from "../lib/ai/answer-speech-text";
import type {LegalAnswerViewResult} from "../lib/ai/legal-answer-presentation";
const result:LegalAnswerViewResult={responseKind:"answer",summary:"SUMMARY",answer:"LEGACY_ONLY",confirmedFindings:[{title:"FINDING",explanation:"LAW"}],actionPlan:[{title:"ACTION",description:"STEPS"}],assumptions:[{statement:"ASSUMPTION",impact:"IMPACT"}],risks:[{level:"high",title:"RISK",explanation:"CAUTION"}],deadlines:[{title:"DEADLINE",dueDate:"2027-01-01",calculationMethod:"CALCULATION",confidence:"high"}],requiredDocuments:[{name:"DOCUMENT",reason:"REASON",required:true}],suggestedDocument:{title:"TEMPLATE",reason:"PURPOSE"},referenceNotes:[{title:"REFERENCE",note:"NOTE",sourceIds:[]}],coverageGaps:["GAP"],clarificationQuestions:["QUESTION"],sources:[],urgency:"high",legalDatabaseAsOf:"2026-11-04"};
test("speech includes every answer section in visible order instead of the legacy answer column",()=>{
 const text=answerSpeechText(result,"en");let last=-1;
 for(const marker of ["SUMMARY","FINDING","LAW","ACTION","STEPS","ASSUMPTION","IMPACT","RISK","CAUTION","DEADLINE","2027-01-01","CALCULATION","DOCUMENT","REASON","TEMPLATE","PURPOSE","REFERENCE","NOTE","GAP","QUESTION"]){const index=text.indexOf(marker);assert(index>last,marker);last=index;}
 assert(!text.includes("LEGACY_ONLY"));
});
test("speech follows interleaved legal issues and their actions",()=>{
 const text=answerSpeechText({...result,confirmedFindings:[...result.confirmedFindings,{title:"SECOND",explanation:"SECOND_RULE"}],actionPlan:[...result.actionPlan,{title:"SECOND_ACTION",description:"SECOND_STEPS"}],issues:[{findingIndex:1,actionIndices:[1]},{findingIndex:0,actionIndices:[0]}]},"en");
 assert(text.indexOf("SECOND_STEPS")<text.indexOf("FINDING"));assert.equal(text.split("SECOND_STEPS").length,2);
});
test("long narration is split without truncation or broken Unicode",()=>{
 const text=("Sentence with a legal condition. 🏠 ").repeat(400)+"Final clarification question.";
 const chunks=speechTextChunks(text);assert(chunks.length>1);assert.equal(chunks.join(""),text);assert(chunks.every(chunk=>chunk.length<=3500));assert(chunks.every(chunk=>!/[\uD800-\uDBFF]$/u.test(chunk)));
});

for(const legacy of [false,true])test(`greeting narration matches the visible reply (legacy: ${legacy})`,()=>{
 const greeting:LegalAnswerViewResult={...result,presentationKind:legacy?undefined:"conversation",validationMethod:"programmatic",evidenceMode:"none",summary:"Привет! Чем могу помочь?",confirmedFindings:[],actionPlan:[],assumptions:[],risks:[],deadlines:[],requiredDocuments:[],referenceNotes:[],coverageGaps:[],clarificationQuestions:[],urgency:"normal",suggestedDocument:null};
 assert.equal(answerSpeechText(greeting,"ru"),greeting.summary);
});
