import assert from "node:assert/strict";
import test from "node:test";
import { legalAnswerStorageFixture } from "./helpers/legal-answer-storage";
import { persistSignedInAnswer } from "../lib/legal-answer-workflow/persistence";
import { reserveAiRun } from "../lib/ai/run-store";
import { readSavedAnswerConversation } from "../lib/legal-answer-workflow/saved-conversation";
import { conversationVersions } from "../lib/ai/conversation-versions";
import { prepareSignedAnswerRequest } from "../lib/legal-answer-workflow/request-adapter";
import { planAnswerBranch } from "../lib/legal-answer-workflow/branches";
import { loadAnswerHistory } from "../lib/legal-answer-workflow/history";

test("prompt editions and answer variants select only their own ancestry, including identical edits", async()=>{
 const fixture=await legalAnswerStorageFixture();
 try {
  const root=await persistSignedInAnswer(fixture.input);
  let sequence=0;
  const actor={db:fixture.d1,workspaceId:"w",userId:"u",conversationId:root.conversationId,signal:new AbortController().signal};
  const publish=async(operation:"edit"|"regenerate"|"follow_up",sourceMessageId:string,question:string)=>{
   const key=`version-${++sequence}`;
   const request=await prepareSignedAnswerRequest({...actor,payload:{operation,sourceMessageId,question,conversationId:root.conversationId,locale:"en",idempotencyKey:key}});
   const plan=await planAnswerBranch({...actor,question:request.question,branch:request.branch});
   const history=await loadAnswerHistory({...actor,parentBranchId:plan.parentBranchId});
   const input={...fixture.input,conversationId:root.conversationId,idempotencyKey:key,requestHash:key};
   const reserved=await reserveAiRun(input);
   if(reserved.kind!=="reserved")throw Error("Expected reservation");
   return {saved:await persistSignedInAnswer({...input,...reserved,question:request.question,branch:request.branch}),history};
  };
  const follow=await publish("follow_up",root.responseMessageId,"Original follow-up");
  const regen=await publish("regenerate",follow.saved.responseMessageId,"Original follow-up");
  const edit=await publish("edit",regen.saved.requestMessageId,"Changed facts");
  const editedRegen=await publish("regenerate",edit.saved.responseMessageId,"Changed facts");
  const sameEdit=await publish("edit",editedRegen.saved.requestMessageId,"Original follow-up");
  for(const turn of [follow,regen,edit,editedRegen,sameEdit])assert.deepEqual(turn.history.map(item=>item.role==="user"?item.content:null).filter(Boolean),[fixture.input.question]);
  const selected=await readSavedAnswerConversation({...actor,branchId:editedRegen.saved.branchId});
  const groups=conversationVersions(selected.turns.at(-1)!.versions,editedRegen.saved.branchId);
  assert.equal(groups.prompts.length,3);
  assert.equal(groups.promptIndex,1);
  assert.deepEqual(groups.answers.map(item=>item.branchId),[edit.saved.branchId,editedRegen.saved.branchId]);
  assert.deepEqual(selected.turns.map(item=>item.question),[fixture.input.question,"Changed facts"]);
  const continued=await publish("follow_up",regen.saved.responseMessageId,"Continue original edition");
  assert.deepEqual(continued.history.filter(item=>item.role==="user").map(item=>item.content),[fixture.input.question,"Original follow-up"]);
  const saved=await readSavedAnswerConversation({...actor,branchId:continued.saved.branchId});
  assert.deepEqual(saved.turns.map(item=>item.question),[fixture.input.question,"Original follow-up","Continue original edition"]);
  assert.equal(saved.turns.at(-1)!.versions.length,1);
 } finally {fixture.sqlite.close();}
});
