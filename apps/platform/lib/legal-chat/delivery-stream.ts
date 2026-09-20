import {LegalContextCapacityError} from "./context-capacity";
import type {GuestAiError} from "../ai/guest-session";
import type {LegalChatStage} from "./execution";
import {legalChatResponseSchema,type LegalChatResponse} from "../ai/legal-chat-schema";

export type LegalChatDelivery={
  runId:string;
  conversationId?:string;
  requestMessageId?:string;
  messageId?:string;
  branchId?:string;
  result:LegalChatResponse;
};
export class LegalChatDeliveryError extends Error {
  constructor(readonly code:GuestAiError["code"]|"AI_RUN_PROCESSING"|"AI_RUN_FAILED"|"AI_RUN_EXPIRED"|"LEGAL_CHAT_UNAVAILABLE"
    |"LEGAL_CONTEXT_CAPACITY_EXCEEDED"|"PLAN_LIMIT"|"IDEMPOTENCY_CONFLICT"|"SOURCE_MESSAGE_NOT_FOUND"|"INVALID_BRANCH_OPERATION",
    readonly status:number,readonly runId?:string){super(code);}
}

/** Progress contains stage names only. The work callback returns only after
 * atomic persistence; the response never streams drafts, research feedback or
 * verifier output as an answer. Cancellation is propagated to the reservation. */
export function legalChatStream(input:{
  signal?:AbortSignal;
  work:(signal:AbortSignal,onStage:(stage:LegalChatStage)=>void)=>Promise<LegalChatDelivery>;
}):Response {
  const abort=new AbortController();
  const encoder=new TextEncoder();
  let finished=false;
  let heartbeat:ReturnType<typeof setInterval>|undefined;
  let cancel:()=>void=()=>{};
  const cleanup=()=>{if(heartbeat)clearInterval(heartbeat);input.signal?.removeEventListener("abort",cancel);};
  const stream=new ReadableStream<Uint8Array>({
    async start(controller){
      const send=(event:string,value:unknown)=>{
        if(!finished)controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(value)}\n\n`));
      };
      cancel=()=>{
        abort.abort(input.signal?.reason??new DOMException("Request cancelled","AbortError"));
        if(!finished){finished=true;controller.error(new DOMException("Request cancelled","AbortError"));}
        cleanup();
      };
      input.signal?.addEventListener("abort",cancel,{once:true});
      if(input.signal?.aborted){cancel();return;}
      heartbeat=setInterval(()=>{
        if(!finished)controller.enqueue(encoder.encode(": keepalive\n\n"));
      },15_000);
      try {
        const saved=await input.work(abort.signal,stage=>send("progress",{stage}));
        // An explicit field projection prevents request-local receipts or
        // diagnostics from leaking even if a caller returns extra properties.
        send("result",{runId:saved.runId,conversationId:saved.conversationId,
          requestMessageId:saved.requestMessageId,messageId:saved.messageId,branchId:saved.branchId,
          result:legalChatResponseSchema.parse(saved.result)});
      } catch(error) {
        if(!abort.signal.aborted)send("error",{code:(error instanceof LegalChatDeliveryError||error instanceof LegalContextCapacityError)?error.code:"LEGAL_CHAT_UNAVAILABLE",
          runId:error instanceof LegalChatDeliveryError?error.runId:undefined,
          retryable:!(error instanceof LegalContextCapacityError)&&(!(error instanceof LegalChatDeliveryError)||!["LEGAL_CONTEXT_CAPACITY_EXCEEDED","PLAN_LIMIT","IDEMPOTENCY_CONFLICT","SOURCE_MESSAGE_NOT_FOUND","INVALID_BRANCH_OPERATION"].includes(error.code))});
      } finally {
        cleanup();
        if(!finished){finished=true;controller.close();}
      }
    },
    cancel(){finished=true;abort.abort(new DOMException("Response cancelled","AbortError"));cleanup();},
  });
  return new Response(stream,{headers:{"content-type":"text/event-stream; charset=utf-8",
    "cache-control":"private, no-store, no-transform",pragma:"no-cache","x-accel-buffering":"no"}});
}
