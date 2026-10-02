import test from "node:test";
import assert from "node:assert/strict";
import {deploymentRequest,bindOperatorBundle,runDeploymentPhase,selectionState} from "./corpus-deployment-contract.mjs";
const revision="a".repeat(40),original="b".repeat(64),acceptance="c".repeat(64);
const args=["prepare","production",revision,`/srv/juro/production/releases/${revision}-123`,""];
const bundle={version:1,environment:"production",revision,previous:null,expectedParent:original,acceptanceSha256:acceptance,manifest:{file:"/etc/juro/corpus-deployment/production/manifest.json",sha256:"d".repeat(64),sizeBytes:100},environmentFile:"/etc/juro/corpus-operator.env"};
function fixture(phase="prepare"){
 const request=deploymentRequest([phase,...args.slice(1)]),events=[];let actual=original;
 const operations={guard:async services=>events.push(services?"process-guard":"guard"),selected:async()=>actual,qualify:async()=>events.push("qualify"),fences:async()=>events.push("fences"),activate:async()=>{events.push("activate");actual=acceptance;}};
 return {request,events,operations,setActual:value=>actual=value};
}
test("retry verifies the committed selection and live services without republishing",async()=>{
 const f=fixture("verify");f.setActual(acceptance);
 assert.equal((await runDeploymentPhase(f.request,bundle,f.operations)).selectionState,"committed");
 assert.deepEqual(f.events,["guard","qualify","fences","process-guard"]);
});
test("retry rejects original, changed or raced selections and failed service guards",async()=>{
 for(const actual of [original,"e".repeat(64),undefined]){
  const f=fixture("verify");f.setActual(actual);await assert.rejects(runDeploymentPhase(f.request,bundle,f.operations));
 }
 const f=fixture("verify");f.setActual(acceptance);f.operations.fences=async()=>f.setActual(original);
 await assert.rejects(runDeploymentPhase(f.request,bundle,f.operations));
 const broken=fixture("verify");broken.setActual(acceptance);broken.operations.guard=async services=>{if(services)throw Error("service changed");};
 await assert.rejects(runDeploymentPhase(broken.request,bundle,broken.operations),/service changed/);
});
test("exact reviewed environment/revision and canonical release required",()=>{
 assert.deepEqual(bindOperatorBundle(deploymentRequest(args),bundle),bundle);
 for(const bad of [["prepare","other",...args.slice(2)],[...args,"extra"],[...args.slice(0,3),args[3]+"/../evil",""]])assert.throws(()=>deploymentRequest(bad));
 assert.throws(()=>bindOperatorBundle(deploymentRequest(args),{...bundle,revision:"e".repeat(40)}));
 assert.throws(()=>bindOperatorBundle(deploymentRequest(args),{...bundle,previous:"/wrong"}));
});
test("prepare authenticates proof and live fences without activation",async()=>{
 const f=fixture();const receipt=await runDeploymentPhase(f.request,bundle,f.operations);assert.equal(receipt.selectionState,"original");assert.deepEqual(f.events,["guard","qualify","fences","guard"]);
});
test("failed prepare fence cannot activate",async()=>{
 const f=fixture();f.operations.fences=async()=>{throw Error("changed member");};await assert.rejects(runDeploymentPhase(f.request,bundle,f.operations),/changed member/);assert(!f.events.includes("activate"));
});
test("activation checks services then verifies actual committed selection",async()=>{
 const f=fixture("activate");const receipt=await runDeploymentPhase(f.request,bundle,f.operations);assert.equal(receipt.selectionState,"committed");assert.equal(receipt.originalSelectionSha256,original);assert.deepEqual(f.events,["guard","qualify","process-guard","activate"]);
});
test("parent race fails before qualification or mutation",async()=>{
 const f=fixture("activate");f.setActual("e".repeat(64));await assert.rejects(runDeploymentPhase(f.request,bundle,f.operations));assert.deepEqual(f.events,["guard"]);
});
test("status after ambiguous commit never declares rollback safe",async()=>{
 for(const [actual,expected]of [[original,"original"],[acceptance,"committed"],["e".repeat(64),"ambiguous"],[undefined,"ambiguous"]]){
  const f=fixture("status");f.setActual(actual);assert.equal((await runDeploymentPhase(f.request,bundle,f.operations)).selectionState,expected);assert.deepEqual(f.events,["guard"]);
 }
 assert.equal(selectionState(null,bundle),"ambiguous");
});
test("changed selection after prepare checks blocks service switch",async()=>{
 const f=fixture();f.operations.fences=async()=>f.setActual(acceptance);await assert.rejects(runDeploymentPhase(f.request,bundle,f.operations));
});
