import {z} from "zod";
import {reserveCustomQueryBudget} from "./custom-search-service";
import {legalEnvironmentSchema,searchReleaseIdSchema} from "./target-domain-schemas";

const responseSchema=z.object({model:z.literal("text-embedding-3-large"),
  data:z.array(z.object({index:z.literal(0),embedding:z.array(z.number().finite()).length(3072)})).length(1),
  usage:z.object({prompt_tokens:z.number().int().positive(),total_tokens:z.number().int().positive()})});

/** Production query embeddings use the same durable spending ledger as native
 * search. Qualification must select capped mode and provision its authorized
 * budget separately. No retry, content logging or query cache is introduced. */
export function createPreparedQueryEmbedding(input:{environment:string;releaseId:string;apiKey:string;
  budgetDatabase:D1Database;budgetMode:"metered"|"capped";fetch?:typeof fetch}){
  const environment=legalEnvironmentSchema.parse(input.environment);
  const releaseId=searchReleaseIdSchema.parse(input.releaseId);
  const mode=z.enum(["metered","capped"]).parse(input.budgetMode);
  if(!input.apiKey||!/^[!-~]+$/u.test(input.apiKey))throw Error("PREPARED_EMBEDDING_UNAVAILABLE");
  return async(query:string,signal:AbortSignal):Promise<number[]>=>{
    // Keep exact request text, including whitespace. The 900-character bound
    // is within the existing conservative per-query budget reservation.
    if(typeof query!=="string"||!query.trim()||query.length>900)throw Error("PREPARED_EMBEDDING_QUERY_INVALID");
    signal.throwIfAborted();
    await reserveCustomQueryBudget({APP_ENV:environment,CUSTOM_QUERY_BUDGET_MODE:mode,
      CATALOG_DB:input.budgetDatabase},releaseId,1);
    signal.throwIfAborted();
    let response:Response;
    try{response=await (input.fetch??fetch)("https://api.openai.com/v1/embeddings",{
      method:"POST",redirect:"error",cache:"no-store",signal,
      headers:{"Content-Type":"application/json",Authorization:`Bearer ${input.apiKey}`},
      body:JSON.stringify({model:"text-embedding-3-large",dimensions:3072,encoding_format:"float",input:[query]}),
    });}catch{signal.throwIfAborted();throw Error("PREPARED_EMBEDDING_UNAVAILABLE");}
    if(!response.ok||!response.body){await response.body?.cancel();throw Error("PREPARED_EMBEDDING_UNAVAILABLE");}
    const reader=response.body.getReader();const parts:Uint8Array[]=[];let length=0;let raw:unknown;
    try{
      while(true){
        signal.throwIfAborted();const part=await reader.read();if(part.done)break;
        length+=part.value.byteLength;
        if(length>128*1024)throw Error("PREPARED_EMBEDDING_RESPONSE_INVALID");
        parts.push(part.value);
      }
      raw=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(Buffer.concat(parts,length)));
    }catch{signal.throwIfAborted();throw Error("PREPARED_EMBEDDING_RESPONSE_INVALID");}
    finally{await reader.cancel();reader.releaseLock();}
    signal.throwIfAborted();
    const parsed=responseSchema.safeParse(raw);
    if(!parsed.success)throw Error("PREPARED_EMBEDDING_RESPONSE_INVALID");
    const vector=parsed.data.data[0]!.embedding;
    if(vector.some(value=>!Number.isFinite(Math.fround(value)))||!vector.some(value=>Math.fround(value)!==0)){
      throw Error("PREPARED_EMBEDDING_RESPONSE_INVALID");
    }
    return vector;
  };
}
