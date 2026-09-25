import {createHash,randomUUID} from "node:crypto";
import {nativeCorpusAcceptanceSchema,nativeCorpusBinding} from "../../lib/storage/native-corpus-acceptance";
import retainedReleases from "../../config/corpus-releases.json";
const hash=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
export function nativeAcceptanceFixture(change?:(proofs:Record<string,any>)=>void){
  const ref={bucket:"proofs",key:"placeholder",sha256:"a".repeat(64),sizeBytes:1};
  const release=(capability:string)=>({releaseId:`release:production:${capability}:test`,artifactNamespace:capability,
    vectorCollection:capability,configurationIdentity:"custom-hybrid-production-v1",instanceId:`custom-${capability}-production-v1`,
    shardId:`${capability}-base-v1`,descriptor:{...ref,bucket:capability},
    membership:{generation:randomUUID(),sha256:(capability==="current"?"b":"e").repeat(64),count:1},vector:{generation:randomUUID(),sourceRevision:"1"}});
  const protocol=Buffer.from(JSON.stringify({version:"native-indexed-retrieval-v1",denseQueryIds:["current","history"],
    heldOutQueryIds:["history"],firstTouchIds:["first"],expiredObservationIds:["expired"],semanticCaseIds:["case"],
    warmAttemptIds:Array.from({length:30},(_,i)=>`warm:${i}`),heldOutCaseIds:["case"],requiredChecks:["tests","typecheck","build"],expectedScopes:2,
    fixtureHashes:["f".repeat(64)],sourceInventoryHashes:["b".repeat(64),"e".repeat(64)]}));
  const manifest=nativeCorpusAcceptanceSchema.parse({version:1,environment:"production",productRevision:"c".repeat(40),
    current:release("current"),history:release("history"),evidenceNamespace:retainedReleases.evidenceNamespace,historyEvidenceNamespace:retainedReleases.historyEvidenceNamespace,
    legacyArtifactNamespace:"legacy",gatewayIdentity:"gateway",projectIdentity:"project",
    protocol:{bucket:"proofs",key:"protocol",sha256:hash(protocol),sizeBytes:protocol.length},
    proofs:{dense:ref,native:ref,semantic:ref,integrity:ref,verification:ref}});
  const descriptors=new Map<string,Uint8Array>();
  for(const selected of [manifest.current,manifest.history]){
    const bytes=Buffer.from(JSON.stringify({schemaVersion:"custom-bm25-runtime-v1",releaseId:selected.releaseId,
      sparseManifestSha256:"a".repeat(64),analyzer:"word-v1",statistics:{documentCount:1,averageFieldLengths:{title:1,hierarchy:1,article:1,text:1}},
      documents:{key:"documents",sha256:"a".repeat(64),sizeBytes:1},segments:[{id:"segment",lexicons:{}}]}));
    selected.descriptor={bucket:selected.artifactNamespace,key:`descriptor:${selected.releaseId}`,sha256:hash(bytes),sizeBytes:bytes.length};
    descriptors.set(selected.descriptor.key,bytes);
  }
  const bindingSha256=nativeCorpusBinding(manifest);
  const proofs:Record<string,any>={
    dense:{bindingSha256,expectedQueryIds:["current","history"],heldOutQueryIds:["history"],results:[{id:"current",recall:1},{id:"history",recall:.96}]},
    native:{bindingSha256,expectedFirstTouchIds:["first"],expectedExpiredObservationIds:["expired"],requests:[
      {id:"first",phase:"first_touch",concurrency:1,milliseconds:8000,outcome:"success"},
      {id:"expired",phase:"expired_observation",concurrency:1,milliseconds:9000,outcome:"success"},
      ...Array.from({length:30},(_,i)=>({id:`warm:${i}`,phase:"warm",concurrency:5,milliseconds:4000,outcome:"success"}))]},
    semantic:{bindingSha256,expectedCaseIds:["case"],heldOutCaseIds:["case"],results:[{id:"case",completed:true,passed:true,unresolvedNeeds:0,sourceUnavailable:false}]},
    integrity:{bindingSha256,expectedScopes:2,verifiedScopes:2,failures:0,sourceInventoryHashes:["b".repeat(64),"e".repeat(64)]},
    verification:{bindingSha256,requiredChecks:["tests","typecheck","build"],results:["tests","typecheck","build"].map(id=>({id,passed:true}))},
  };
  change?.(proofs);
  const bytes=new Map<string,Uint8Array>([["protocol",protocol],...descriptors]);
  for(const kind of ["dense","native","semantic","integrity","verification"] as const){
    const body=Buffer.from(JSON.stringify(proofs[kind]));bytes.set(kind,body);
    manifest.proofs[kind]={bucket:"proofs",key:kind,sha256:hash(body),sizeBytes:body.length};
  }
  return {manifest,read:async(reference:{key:string})=>bytes.get(reference.key)!};
}
