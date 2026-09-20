import {z} from "zod";
import {legalChatResponseSchema} from "../ai/legal-chat-schema";
import type {LegalChatDelivery} from "./delivery-stream";
import type {LegalChatStage} from "./execution";

const deliverySchema=z.object({runId:z.string(),conversationId:z.string().optional(),requestMessageId:z.string().optional(),
  messageId:z.string().optional(),branchId:z.string().optional(),result:legalChatResponseSchema});
const stageSchema=z.enum(["interpreting","researching","writing","verifying","correcting","saving"]);
export class LegalChatClientError extends Error {
  constructor(readonly code:string,readonly retryable:boolean=true){super(code);}
}

/** Consume only the committed terminal result. Partial network frames and
 * heartbeat comments must never be interpreted as answer text. */
export async function readLegalChatStream(response:Response,onStage:(stage:LegalChatStage)=>void):Promise<LegalChatDelivery> {
  if(!response.ok){
    const body=z.object({code:z.string()}).safeParse(await response.json().catch(()=>null));
    throw new LegalChatClientError(body.success?body.data.code:"LEGAL_CHAT_UNAVAILABLE",response.status>=500);
  }
  if(!response.headers.get("content-type")?.includes("text/event-stream")||!response.body)throw new LegalChatClientError("INVALID_CHAT_STREAM");
  const reader=response.body.getReader(),decoder=new TextDecoder();
  let pending="";
  try {
    while(true){
      const {done,value}=await reader.read();
      pending+=decoder.decode(value,{stream:!done});
      if(pending.length>2_000_000)throw new LegalChatClientError("INVALID_CHAT_STREAM");
      let boundary:number;
      while((boundary=pending.indexOf("\n\n"))>=0){
        const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
        const lines=frame.split("\n");
        const event=lines.find(line=>line.startsWith("event:"))?.slice(6).trim();
        const data=lines.filter(line=>line.startsWith("data:")).map(line=>line.slice(5).trimStart()).join("\n");
        if(!data)continue;
        const parsed:unknown=JSON.parse(data);
        if(event==="result")return deliverySchema.parse(parsed);
        if(event==="progress"){
          const progress=z.object({stage:stageSchema}).safeParse(parsed);if(progress.success)onStage(progress.data.stage);
        }
        if(event==="error"){
          const error=z.object({code:z.string(),retryable:z.boolean().optional()}).parse(parsed);
          throw new LegalChatClientError(error.code,error.retryable??true);
        }
      }
      if(done)throw new LegalChatClientError("CHAT_STREAM_INTERRUPTED");
    }
  } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** An uncertain disconnect must replay; a confirmed failed run cannot succeed
 * under that key, so the next explicit submission may create a new attempt. */
export function shouldReuseLegalChatRequest(error:unknown):boolean {
  return !(error instanceof LegalChatClientError)||!["AI_RUN_FAILED","AI_RUN_EXPIRED","GUEST_RUN_FAILED",
    "GUEST_RESERVATION_LOST","GUEST_CONFIGURATION_UNAVAILABLE","IDEMPOTENCY_CONFLICT","GUEST_RUN_CONFLICT"].includes(error.code);
}
