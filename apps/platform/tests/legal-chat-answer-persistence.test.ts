import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import test from "node:test";
import {sqliteD1FixtureFromDirectory} from "./helpers/sqlite-d1";
import {reserveAiRun} from "../lib/ai/run-store";
import {saveSignedInLegalAnswer,saveGuestLegalAnswer} from "../lib/legal-chat/answer-persistence";
import {readSavedLegalAnswer} from "../lib/legal-chat/saved-answer";
import {legalChatResponseSchema} from "../lib/ai/legal-chat-schema";
import type {LegalSourceContext} from "../lib/legal/source-context";
import {parseIdentityKeyring} from "../lib/auth/keyring";
import {createGuestAiSession,reserveGuestAiRun,revealGuestAiRunResult,latestGuestAiRun} from "../lib/ai/guest-session";
import {readConversationContext,readSavedConversationTurns} from "../lib/legal-chat/conversation-context";
import {listAiAnswerVersions,listAiBranches} from "../lib/ai/branch-store";
import {corpusAnswerEvidence} from "../lib/legal-chat/corpus-evidence";
import {parseResolvedOfficialEvidence} from "../lib/legal-corpus/target-evidence";
import {executeLegalChat} from "../lib/legal-chat/execution";
import {legalDraftClaims,legalDraftSchema} from "../lib/legal-chat/answer-contract";

const sourceText="Article 7. Synthetic record access. "+"Private ephemeral source continuation. ".repeat(80);
const hash=createHash("sha256").update(sourceText).digest("hex");
const source:LegalSourceContext={id:"source",actTitle:"Synthetic rule",actIdentifier:null,
  officialUrl:"https://lex.uz/docs/777",revisionDate:null,lastCheckedAt:"2026-09-20",locale:"ru",publishedAt:null,
  sourceType:"lex",status:"current",verificationState:"verified",verifiedAt:"2026-09-20",contentSha256:hash,
  spans:[{id:"span",article:"7",paragraph:null,text:sourceText,textSha256:hash,quality:"high"}],
  citationEvidenceReceipt:{version:1,kind:"provision",capability:"current",r2Key:"exact/provision",byteCount:Buffer.byteLength(sourceText),
    sha256:hash,textSha256:hash,officialUrl:"https://lex.uz/docs/777",languageTag:"ru",articleNumber:"7"}};
const result=legalChatResponseSchema.parse({responseKind:"answer",summary:"You may request a record.",answer:"You may request a record.",
  language:"en",jurisdiction:"UZ",answerMode:"detailed",reasoningMode:"fast",clarificationQuestions:[],
  confirmedFindings:[{title:"Record access",explanation:"You may request a record.",sourceIds:["source"]}],
  assumptions:[],risks:[],sources:[{sourceId:"source",actTitle:"Synthetic rule",actIdentifier:null,article:"7",
    excerpt:"Article 7.",originalUrl:source.officialUrl,status:"current",effectiveDate:null,verifiedAt:"2026-09-20"}],
  requiredDocuments:[],actionPlan:[],deadlines:[],successOutlook:null,urgency:"normal",suggestedDocument:null,
  suggestLawyer:false,legalDatabaseAsOf:"2026-09-20"});

async function fixture(){
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));
  const now=new Date().toISOString();
  sqlite.prepare("INSERT INTO user_profiles(id,email,locale,created_at,updated_at) VALUES (?,?,?,?,?)").run("owner","owner@example.test","en",now,now);
  sqlite.prepare("INSERT INTO workspaces(id,type,name,locale,created_at,updated_at) VALUES (?,'individual',?,'en',?,?)").run("workspace","Workspace",now,now);
  const reservation={db:d1,workspaceId:"workspace",userId:"owner",idempotencyKey:"one",requestHash:"request-hash",
    conversationId:null,provider:"openai",model:"gpt-5.6-luna",answerMode:"detailed" as const,reasoningMode:"fast" as const,
    legalDatabaseAsOf:"unavailable",instructionHash:"instructions",sourceVersionHash:"sources"};
  const run=await reserveAiRun(reservation);
  if(run.kind!=="reserved")throw new Error("Expected reservation");
  const input:Parameters<typeof saveSignedInLegalAnswer>[0]={...reservation,runId:run.runId,ledgerId:run.ledgerId,
    provider:"openai",providerResponseId:null,fallbackFromProvider:null,inputTokens:10,outputTokens:5,cachedInputTokens:0,attempts:4,latencyMs:10,
    branch:{operation:"new",question:"May I request a record?",sourceMessageId:null,forkedFromMessageId:null,parentBranchId:null,versionNumber:1},
    result,sources:[source]};
  return {sqlite,d1,input,reservation};
}

test("answer, version, receipt and usage commit together and replay without a second charge",async()=>{
  const {sqlite,d1,input,reservation}=await fixture();
  try {
    const saved=await saveSignedInLegalAnswer(input);
    const loaded=await readSavedLegalAnswer({db:d1,userId:"owner",workspaceId:"workspace",conversationId:saved.conversationId});
    assert.deepEqual(loaded?.result,result);
    const reference=sqlite.prepare("SELECT evidence_receipt_json,excerpt FROM legal_source_references").get();
    assert.deepEqual(JSON.parse(String(reference?.evidence_receipt_json)),source.citationEvidenceReceipt);
    assert.equal(reference?.excerpt,"Article 7.");
    assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM conversation_messages").all()),/ephemeral source/);
    assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM legal_source_references").all()),/ephemeral source/);
    assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"consumed");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM message_versions").get()?.n,1);
    assert.equal((await reserveAiRun(reservation)).kind,"completed");
    await assert.rejects(saveSignedInLegalAnswer(input),/FINALIZATION_CLAIM_FAILED/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get()?.n,2);
  } finally {sqlite.close();}
});

test("actual corpus evidence reaches receipt persistence through the execution boundary",async()=>{
  const {sqlite,input}=await fixture();
  try {
    const now=new Date().toISOString();
    const text="Synthetic rule: applicants may request their records.";
    const textHash=createHash("sha256").update(text).digest("hex");
    const controlling=parseResolvedOfficialEvidence({legalInstrumentId:"instrument",officialExpressionId:"expression",
      textRevisionId:"revision",provisionConceptId:"concept",provisionRenditionId:"rendition",languageTag:"ru",script:"Cyrl",
      textualAuthority:"controlling",provisionText:text,officialCitation:{label:"Synthetic record rule",url:"https://lex.uz/docs/777"},
      evidence:{provisionRenditionId:"rendition",r2Key:"exact/rule",byteCount:Buffer.byteLength(text),sha256:textHash,
        sourceNormalizedSha256:"b".repeat(64),schemaVersion:1}});
    const evidence=await corpusAnswerEvidence({resolution:{controlling,materialCitation:controlling.officialCitation},currentAt:now,
      endpoint:{kind:"current"},currentSourceStatus:{pinnedTextSha256:"b".repeat(64),observation:{version:2,observedAt:now,
        officialUrl:controlling.officialCitation.url,current:true,normalizedTextSha256:"b".repeat(64),rawContentSha256:"c".repeat(64)}}});
    assert.equal(evidence.source.spans,undefined,"Corpus transport avoids duplicating the full evidence body");
    const sourceIds=[evidence.source.id];
    const draft=legalDraftSchema.parse({mainPoint:{text:"You may request your record.",sourceIds},
      findings:[{title:"Record access",explanation:text,sourceIds}],actions:[],risks:[],questions:[],unresolved:[],
      ruleBindings:[{findingId:"finding:0",actionIds:[]}]});
    const saved=await executeLegalChat({context:{question:input.branch.question,locale:"en",priorTurns:[]},mode:"fast",answerMode:"detailed",
      interpret:async()=>({topics:["Record access"],facts:[],temporal:{kind:"current"},questions:[]}),
      research:{indexed:async()=>({evidence:[evidence],needs:[]}),official:async()=>assert.fail("Corpus sufficient"),assess:async()=>[]},
      model:{write:async()=>draft,verify:async()=>({claims:legalDraftClaims(draft).map(claim=>({id:claim.id,supported:true,reason:"Synthetic support"})),
        retention:[],coverage:[{issue:"Record access",findingIds:["finding:0"],actionIds:[],gaps:[]}],complete:true,gaps:[],questions:[]})},
      renew:async()=>true,release:async()=>assert.fail("Save should succeed"),
      commit:async(terminal,sources)=>{
        if(!("result" in terminal))throw new Error("Expected answer");
        return saveSignedInLegalAnswer({...input,result:terminal.result,sources});
      }});
    assert.equal(saved.result.responseKind,"answer");
    const receipt=sqlite.prepare("SELECT evidence_receipt_json FROM legal_source_references").get();
    assert.deepEqual(JSON.parse(String(receipt?.evidence_receipt_json)),evidence.source.citationEvidenceReceipt);
  } finally {sqlite.close();}
});

test("a citation write failure rolls back every attached save and usage settlement",async()=>{
  const {sqlite,input}=await fixture();
  try {
    sqlite.exec("CREATE TRIGGER fail_citation BEFORE INSERT ON legal_source_references BEGIN SELECT RAISE(ABORT,'SYNTHETIC_CITATION_FAILURE'); END");
    await assert.rejects(saveSignedInLegalAnswer(input),/SYNTHETIC_CITATION_FAILURE/);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM conversations").get()?.n,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get()?.n,0);
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM message_versions").get()?.n,0);
    assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"reserved");
    assert.equal(sqlite.prepare("SELECT status FROM idempotency_keys").get()?.status,"started");
  } finally {sqlite.close();}
});

test("foreign conversation and invalid receipts cannot accept a completed answer",async()=>{
  const {sqlite,input}=await fixture();
  try {
    await assert.rejects(saveSignedInLegalAnswer({...input,sources:[]}),/CITATION_PERSISTENCE_INCOMPLETE/);
    assert.equal(sqlite.prepare("SELECT status FROM ai_runs").get()?.status,"reserved");
    const now=new Date().toISOString();
    sqlite.prepare("INSERT INTO user_profiles(id,email,locale,created_at,updated_at) VALUES (?,?,?,?,?)").run("foreign","foreign@example.test","en",now,now);
    sqlite.prepare("INSERT INTO conversations(id,workspace_id,owner_user_id,title,locale,created_at,updated_at) VALUES (?,?,?,?,?,?,?)")
      .run("foreign-conversation","workspace","foreign","Foreign","en",now,now);
    await assert.rejects(saveSignedInLegalAnswer({...input,conversationId:"foreign-conversation",
      branch:{...input.branch,operation:"follow_up"}}));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get()?.n,0);
    assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"reserved");
  } finally {sqlite.close();}
});

test("a saved clarification releases the allowance",async()=>{
  const {sqlite,input}=await fixture();
  try {
    await saveSignedInLegalAnswer({...input,sources:[],result:{...result,responseKind:"clarification_required",
      summary:"Which date?",answer:"Which date?",clarificationQuestions:["Which date?"],confirmedFindings:[],sources:[]}});
    assert.equal(sqlite.prepare("SELECT status FROM ai_usage_ledger").get()?.status,"released");
  } finally {sqlite.close();}
});

test("edited answers keep version ancestry and follow-ups use the active facts",async()=>{
  const {sqlite,d1,input,reservation}=await fixture();
  try {
    const first=await saveSignedInLegalAnswer(input);
    const owner={db:d1,workspaceId:"workspace",userId:"owner",conversationId:first.conversationId};
    const edited=await readConversationContext({...owner,requestedOperation:"edit",sourceMessageId:first.messageId,
      question:"May an authorized representative request the record?"});
    const reserved=await reserveAiRun({...reservation,idempotencyKey:"edit",requestHash:"edit-hash",conversationId:first.conversationId});
    if(reserved.kind!=="reserved")throw new Error("Expected edit reservation");
    const saved=await saveSignedInLegalAnswer({...input,idempotencyKey:"edit",runId:reserved.runId,ledgerId:reserved.ledgerId,
      conversationId:first.conversationId,branch:edited.branch});
    const versions=await listAiAnswerVersions({...owner,branchId:saved.branchId});
    assert.deepEqual(versions.map(version=>version.versionNumber),[1,2]);
    assert.deepEqual(versions.map(version=>version.operation),["new","edit"]);
    const next=await readConversationContext({...owner,requestedOperation:"follow_up",sourceMessageId:saved.messageId,question:"What next?"});
    assert.deepEqual(next.turns.map(turn=>turn.question),[edited.branch.question]);
    assert.equal(next.branch.parentBranchId,saved.branchId);
  } finally {sqlite.close();}
});

test("follow-ups retain the saved explanation, practical options and questions beyond the Main Point",async()=>{
  const {sqlite,d1,input}=await fixture();
  try {
    const saved=await saveSignedInLegalAnswer({...input,result:{...result,
      confirmedFindings:[{title:"Representative",explanation:"An authorized representative may request the record.",sourceIds:["source"]}],
      actionPlan:[{title:"Second option",description:"Ask your representative to file the request.",sourceIds:["source"]}],
      clarificationQuestions:["Has a representative been authorized?"],
    }});
    const context=await readConversationContext({db:d1,userId:"owner",workspaceId:"workspace",conversationId:saved.conversationId,
      sourceMessageId:saved.messageId,requestedOperation:"follow_up",question:"Yes. How do I use the second option?"});
    assert.match(context.turns[0]!.answer,/An authorized representative may request the record/);
    assert.match(context.turns[0]!.answer,/Ask your representative to file the request/);
    assert.match(context.turns[0]!.answer,/Has a representative been authorized/);
    assert.doesNotMatch(context.turns[0]!.answer,/exact\/provision|ephemeral source/);
    const display=await readSavedConversationTurns({db:d1,userId:"owner",workspaceId:"workspace",conversationId:saved.conversationId,responseMessageId:saved.messageId});
    assert.equal(display[0]!.answer,result.answer);
  } finally {sqlite.close();}
});

test("exact user facts are proposed atomically and a rejected fact is not proposed again",async()=>{
  const {sqlite,d1,input,reservation}=await fixture();
  try {
    const question="I am an applicant. May I request a record?";
    const first=await saveSignedInLegalAnswer({...input,branch:{...input.branch,question},proposedFacts:["I am an applicant."]});
    const facts=sqlite.prepare("SELECT statement,status FROM confirmed_facts WHERE conversation_id=?").all(first.conversationId);
    assert.deepEqual(facts.map(row=>({...row})),[{statement:"I am an applicant.",status:"proposed"}]);
    sqlite.prepare("UPDATE confirmed_facts SET status='rejected' WHERE conversation_id=?").run(first.conversationId);
    const next=await readConversationContext({db:d1,userId:"owner",workspaceId:"workspace",conversationId:first.conversationId,
      sourceMessageId:first.messageId,requestedOperation:"follow_up",question});
    const reserved=await reserveAiRun({...reservation,idempotencyKey:"fact-followup",requestHash:"fact-followup",conversationId:first.conversationId});
    if(reserved.kind!=="reserved")throw Error("Expected reservation");
    await saveSignedInLegalAnswer({...input,runId:reserved.runId,ledgerId:reserved.ledgerId,idempotencyKey:"fact-followup",
      conversationId:first.conversationId,branch:next.branch,proposedFacts:["I am an applicant."]});
    assert.deepEqual(sqlite.prepare("SELECT statement,status FROM confirmed_facts").all().map(row=>({...row})),
      [{statement:"I am an applicant.",status:"rejected"}]);
  } finally {sqlite.close();}
});

test("unsupported source locales fail before finalization rather than being relabeled",async()=>{
  const {sqlite,input}=await fixture();
  try {
    for(const locale of ["invented"]){
      await assert.rejects(saveSignedInLegalAnswer({...input,sources:[{...source,locale}]}),/CITATION_LOCALE_UNSUPPORTED/);
    }
    assert.equal(sqlite.prepare("SELECT status FROM ai_runs").get()?.status,"reserved");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM conversation_messages").get()?.n,0);
  } finally {sqlite.close();}
});

test("guest saves retain encryption and commit exact receipts with session consumption",async()=>{
  const {sqlite,d1}=sqliteD1FixtureFromDirectory(new URL("../drizzle/",import.meta.url));
  try {
    const keyring=parseIdentityKeyring(JSON.stringify({active:"test",versions:{test:{
      aead:Buffer.alloc(32,1).toString("base64url"),hmac:Buffer.alloc(32,2).toString("base64url")}}}));
    const created=await createGuestAiSession({db:d1,keyring,connectingIp:"203.0.113.1",locale:"en"});
    const reservation={db:d1,keyring,session:created.session,idempotencyKey:"guest-request-one",requestHash:"a".repeat(64),
      provider:"openai",model:"gpt-5.6-luna",legalDatabaseAsOf:"unavailable",instructionHash:"b".repeat(64),
      sourceVersionHash:"c".repeat(64),question:"A private guest question"};
    const reserved=await reserveGuestAiRun(reservation);
    if(reserved.kind!=="created")throw new Error("Expected created guest run");
    await saveGuestLegalAnswer({db:d1,keyring,run:reserved.run,result,sources:[source],provider:"openai",model:"gpt-5.6-luna",
      inputTokens:1,outputTokens:1,cachedInputTokens:0,attempts:4,latencyMs:10});
    const saved=await latestGuestAiRun(d1,created.session.id);
    assert.ok(saved);
    assert.deepEqual(JSON.parse(await revealGuestAiRunResult({keyring,run:saved})),result);
    assert.doesNotMatch(JSON.stringify(sqlite.prepare("SELECT * FROM guest_ai_runs").all()),/private guest|You may request|ephemeral source/);
    assert.equal(sqlite.prepare("SELECT state FROM guest_ai_sessions").get()?.state,"consumed");
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM legal_source_references WHERE guest_run_id=?").get(reserved.run.id)?.n,1);
    assert.equal((await reserveGuestAiRun(reservation)).kind,"completed");
  } finally {sqlite.close();}
});


test("selected history remains available after its branch leaves the branch menu",async()=>{
  const {sqlite,d1,input,reservation}=await fixture();
  try {
    const first=await saveSignedInLegalAnswer(input);
    const owner={db:d1,workspaceId:"workspace",userId:"owner",conversationId:first.conversationId};
    for(let index=0;index<41;index++) {
      const idempotencyKey=`follow-${index}`;
      const reserved=await reserveAiRun({...reservation,idempotencyKey,requestHash:idempotencyKey,monthlyLimit:null,conversationId:first.conversationId});
      if(reserved.kind!=="reserved")throw new Error("Expected reservation");
      await saveSignedInLegalAnswer({...input,idempotencyKey,runId:reserved.runId,ledgerId:reserved.ledgerId,
        conversationId:first.conversationId,branch:{...input.branch,operation:"follow_up",parentBranchId:first.branchId}});
    }
    assert.equal((await listAiBranches(owner)).some(branch=>branch.branchId===first.branchId),false);
    const turns=await readSavedConversationTurns({...owner,responseMessageId:first.messageId});
    assert.deepEqual(turns.map(turn=>turn.question),[input.branch.question]);
    await assert.rejects(readSavedConversationTurns({...owner,userId:"foreign",responseMessageId:first.messageId}),/SOURCE_MESSAGE_NOT_FOUND/);
  } finally {sqlite.close();}
});


for(const [locale,languageTag] of [["en","en"],["uzc","uz-Cyrl"]] as const){
  test(`citation persistence retains exact ${locale} source identity`,async()=>{
    const {sqlite,input}=await fixture();
    try {
      await saveSignedInLegalAnswer({...input,sources:[{...source,locale,
        citationEvidenceReceipt:{...source.citationEvidenceReceipt!,languageTag}}]});
      const row=sqlite.prepare("SELECT source_locale,evidence_receipt_json FROM legal_source_references").get();
      assert.equal(row?.source_locale,locale);
      assert.equal(JSON.parse(String(row?.evidence_receipt_json)).languageTag,languageTag);
    } finally {sqlite.close();}
  });
}
