import {createHash} from "node:crypto";
import type {Pool} from "pg";
import {acquireRetrievalClient,retrievalQuery} from "./retrieval-connection";

const maximum=64*1024*1024;
const hash=(value:Uint8Array)=>createHash("sha256").update(value).digest("hex");
export const preparedEvidenceStoreFormat="prepared-postgres-evidence-store-v1";
export function isPreparedPostgresEvidenceStore(manifest:Uint8Array){
  try{return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(manifest)).format===preparedEvidenceStoreFormat;}
  catch{return false;}
}

/** Public captures and qualification artifacts under a registered generation.
 * Writes use a narrow append-only database function; application corpus roles
 * retain no write privileges on existing objects or private data. */
export class PreparedEvidenceStore {
  constructor(readonly pool:Pool,readonly namespace:string,readonly readOnly=false){
    if(!/^legal-prepared-[a-f0-9]{64}$/u.test(namespace))throw Error("PREPARED_EVIDENCE_NAMESPACE_INVALID");
  }
  private validateKey(key:string){
    if(!key||Buffer.byteLength(key)>1024||key.includes("\0"))throw Error("PREPARED_EVIDENCE_KEY_INVALID");
  }
  async head(key:string){
    this.validateKey(key);
    const {rows}=await retrievalQuery<{size:number}>(this.pool,
      "SELECT octet_length(content) AS size FROM storage.prepared_evidence_objects WHERE namespace=$1 AND key=$2",
      [this.namespace,key]);
    return rows[0]?{key,size:rows[0].size}:null;
  }
  async get(key:string){
    this.validateKey(key);
    const {rows}=await retrievalQuery<{sha256:string;content:Buffer}>(this.pool,
      "SELECT sha256,content FROM storage.prepared_evidence_objects WHERE namespace=$1 AND key=$2",
      [this.namespace,key]);
    const row=rows[0];if(!row)return null;
    if(!Buffer.isBuffer(row.content)||row.content.byteLength<1||row.content.byteLength>maximum
      ||hash(row.content)!==row.sha256)throw Error("PREPARED_EVIDENCE_CORRUPT");
    return {key,size:row.content.byteLength,bytes:async()=>new Uint8Array(row.content)};
  }
  async put(key:string,value:Uint8Array){
    if(this.readOnly)throw Error("PREPARED_EVIDENCE_READ_ONLY");
    this.validateKey(key);
    if(value.byteLength<1||value.byteLength>maximum)throw Error("PREPARED_EVIDENCE_SIZE_INVALID");
    const bytes=Buffer.from(value),digest=hash(bytes);
    // Shared corpus pools default to read-only transactions. Override that
    // default only on this exclusively leased append transaction; role grants
    // still prohibit direct writes to either prepared or existing objects.
    const lease=await acquireRetrievalClient(this.pool);
    try{
      await lease.client.query("BEGIN READ WRITE");
      const {rows}=await lease.client.query<{sha256:string}>(
        "SELECT storage.append_prepared_evidence($1,$2,$3) AS sha256",[this.namespace,key,bytes]);
      if(rows[0]?.sha256!==digest)throw Error("PREPARED_EVIDENCE_WRITE_MISMATCH");
      await lease.client.query("COMMIT");
    }catch(error){
      try{await lease.client.query("ROLLBACK");}catch{}
      throw error;
    }finally{lease.release();}
    return {key,size:bytes.byteLength};
  }
}
