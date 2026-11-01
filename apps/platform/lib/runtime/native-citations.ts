import type {Pool} from "pg";
import {LocalObjectStore} from "../storage/objects";
import {PreparedEvidenceStore,isPreparedPostgresEvidenceStore} from "../storage/prepared-evidence-objects";
import {isRetiredCorpusObject} from "../storage/corpus-retirement";
import {CITATION_EVIDENCE_PATH,handleCitationEvidenceRequest} from "../legal-corpus/citation-evidence";
import retainedReleases from "../../config/corpus-releases.json";

/** Saved-citation storage is shared across chat implementations. This binding
 * exposes only receipt reopening; it cannot create a research session. */
export function createNativeCitationService(input:{pool:Pool;objectRoot:string;environment:string}){
  return {async fetch(value:Request|string|URL,init?:RequestInit){
    const request=new Request(value,init);
    if(new URL(request.url).pathname!==CITATION_EVIDENCE_PATH)
      return Response.json({code:"CITATION_UNAVAILABLE"},{status:404,headers:{"cache-control":"no-store"}});
    return handleCitationEvidenceRequest(request,{
      APP_ENV:input.environment,
      LEGAL_EVIDENCE_BUCKET:new LocalObjectStore(input.pool,input.objectRoot,retainedReleases.evidenceNamespace,true),
      LEGAL_HISTORY_EVIDENCE_BUCKET:new LocalObjectStore(input.pool,input.objectRoot,retainedReleases.historyEvidenceNamespace,true),
      isRetiredEvidence:receipt=>isRetiredCorpusObject(input.pool,
        receipt.store?.namespace??(receipt.capability==="history"?retainedReleases.historyEvidenceNamespace:retainedReleases.evidenceNamespace),
        receipt.r2Key,receipt.sha256),
      resolveEvidenceStore:async store=>{
        const known=await input.pool.query("SELECT manifest FROM storage.corpus_evidence_stores WHERE generation_sha256=$1 AND namespace=$2",[store.generationSha256,store.namespace]);
        if(known.rows.length!==1)return null;
        return isPreparedPostgresEvidenceStore(known.rows[0].manifest)?new PreparedEvidenceStore(input.pool,store.namespace,true)
          :new LocalObjectStore(input.pool,input.objectRoot,store.namespace,true);
      },
    });
  }};
}
