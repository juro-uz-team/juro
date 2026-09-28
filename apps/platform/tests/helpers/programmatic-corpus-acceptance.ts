import {createHash} from "node:crypto";
import {nativeAcceptanceFixture} from "./native-corpus-acceptance";
import {nativeCorpusAcceptanceSchema,nativeCorpusBinding} from "../../lib/storage/native-corpus-acceptance";
import {nativeChatWorkload,nativeChatWorkloadSha256} from "../../lib/storage/native-chat-workload";

const hash=(bytes:Uint8Array)=>createHash("sha256").update(bytes).digest("hex");
type Bound<T>=T&{bindingSha256:string};
export type ProgrammaticFixtureProofs={
  dense:Bound<{results:Array<{recall:number}>}>;
  native:Bound<{requests:Array<{milliseconds:number}>}>;
  integrity:Bound<{verifiedScopes:number}>;
  verification:Bound<{requiredChecks:string[];results:Array<{id:string;passed:boolean}>}>;
  chat:Bound<{expectedCaseIds:string[];heldOutCaseIds:string[];results:Array<{
    id:string;inputSha256:string;mode:string;locale:string|undefined;actor:string;concurrency:number;milliseconds:number;
    outcome:string;gapCount:number;findingCount:number;sourceCount:number;validationMethod:string;
    interpretationIndependentlyReviewed:boolean;sourceChecksPassed:boolean;reloadPassed:boolean;
    verificationModelCalls:number;modelCalls:Array<{stage:string;model:string}>;complete?:boolean;
  }>}>
};
export async function programmaticAcceptanceFixture(change?:(proofs:ProgrammaticFixtureProofs)=>void,
  changeProtocol?:(protocol:{version:string;requiredChecks:string[];workloadSha256:string;chatCaseIds:string[];heldOutChatCaseIds:string[]})=>void){
  const legacy=nativeAcceptanceFixture();
  const oldProtocol=JSON.parse(Buffer.from(await legacy.read(legacy.manifest.protocol)).toString());
  delete oldProtocol.semanticCaseIds;delete oldProtocol.heldOutCaseIds;
  const requiredChecks=["tests","typecheck","build","browser","model_only_modes","no_model_verification",
    "citation_integrity","tenant_isolation","saved_replay","historical_questions","comparison_questions","private_context"];
  const caseIds=nativeChatWorkload.map(row=>row.id);
  const heldOutCaseIds=nativeChatWorkload.filter(row=>row.heldOut).map(row=>row.id);
  const protocolValue={...oldProtocol,version:"native-programmatic-chat-v2",chatCaseIds:[...caseIds],
    heldOutChatCaseIds:[...heldOutCaseIds],workloadSha256:nativeChatWorkloadSha256,requiredChecks};
  changeProtocol?.(protocolValue);
  const protocol=Buffer.from(JSON.stringify(protocolValue));
  const frozenChecks:string[]=protocolValue.requiredChecks;
  const {semantic,...commonProofs}=legacy.manifest.proofs;
  const manifest=nativeCorpusAcceptanceSchema.parse({...legacy.manifest,version:2,
    protocol:{...legacy.manifest.protocol,sha256:hash(protocol),sizeBytes:protocol.length},
    proofs:{...commonProofs,chat:semantic}});
  const bindingSha256=nativeCorpusBinding(manifest);
  const load=async(kind:"dense"|"native"|"integrity")=>JSON.parse(Buffer.from(await legacy.read(legacy.manifest.proofs[kind])).toString());
  const proofs:ProgrammaticFixtureProofs={dense:await load("dense"),native:await load("native"),integrity:await load("integrity"),
    verification:{bindingSha256,requiredChecks:frozenChecks,results:frozenChecks.map(id=>({id,passed:true}))},
    chat:{bindingSha256,expectedCaseIds:[...caseIds],heldOutCaseIds:[...heldOutCaseIds],
    results:nativeChatWorkload.map(({id,inputSha256,mode,locale,actor,concurrency})=>({id,inputSha256,mode,locale,
      actor,concurrency,milliseconds:12000,outcome:"partial",gapCount:1,
      findingCount:1,sourceCount:1,validationMethod:"programmatic",interpretationIndependentlyReviewed:false,
      sourceChecksPassed:true,reloadPassed:true,verificationModelCalls:0,
      modelCalls:["interpreting","writing"].map(stage=>({stage,model:mode==="fast"?"gpt-6-luna":"gpt-5.6-terra"}))}))}};
  for(const proof of Object.values(proofs))proof.bindingSha256=bindingSha256;
  for(const row of proofs.native.requests)row.milliseconds=12000;
  change?.(proofs);
  const bytes=new Map<string,Uint8Array>([["protocol",protocol]]);
  if(manifest.version!==2)throw Error("Expected programmatic manifest");
  for(const kind of ["dense","native","chat","integrity","verification"] as const){
    const body=Buffer.from(JSON.stringify(proofs[kind]));bytes.set(kind,body);
    manifest.proofs[kind]={bucket:"proofs",key:kind,sha256:hash(body),sizeBytes:body.length};
  }
  return {manifest,read:async(reference:{key:string})=>bytes.get(reference.key)??await legacy.read(reference)};
}
