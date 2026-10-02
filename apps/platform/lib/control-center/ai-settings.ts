import {sha256} from "../auth/crypto";
import { z } from "zod";
import { database } from "../storage/connection";
import { aiRuntimeConfigInputSchema, aiRuntimeModelAllowlist, type AiRuntimeSettings } from "../ai/runtime-settings";
import { getSelfHostedRuntime } from "../runtime/self-hosted";
import {OPENAI_FAST_CHAT_MODEL,OPENAI_DEEP_CHAT_MODEL} from "../ai/provider-models";
export async function controlAiSettings(base:AiRuntimeSettings,db:D1Database):Promise<AiRuntimeSettings>{
 const row=await db.prepare("SELECT version,settings,system_instructions AS systemInstructions,created_at AS createdAt FROM control_ai_versions WHERE applied_at IS NOT NULL ORDER BY applied_at DESC,version DESC LIMIT 1").first<{version:number;settings:string;systemInstructions:string;createdAt:string}>();
 if(!row)return base;const settings=JSON.parse(row.settings);
 return {...base,...settings,version:row.version,configHash:await sha256(JSON.stringify(settings)+row.systemInstructions),source:"database",createdAt:new Date(row.createdAt).toISOString(),systemInstructions:row.systemInstructions};
}
export async function applyControlAiSettings(input:unknown,email:string){
 const parsed=z.object({settings:aiRuntimeConfigInputSchema,systemInstructions:z.string().max(16000),apply:z.boolean().default(true)}).strict().parse(input);
 const settings=parsed.settings;
 const allow=aiRuntimeModelAllowlist(getSelfHostedRuntime());
 if(settings.openaiChatModel!==OPENAI_FAST_CHAT_MODEL||settings.openaiDeepModel!==OPENAI_DEEP_CHAT_MODEL||!allow.openai.includes(settings.openaiDocumentFallbackModel)||!allow.anthropic.includes(settings.anthropicChatFallbackModel)||!allow.anthropic.includes(settings.anthropicDocumentModel))throw Error("MODEL_NOT_ALLOWED");
 const client=await database().pool.connect();
 try{
  await client.query("BEGIN");await client.query("SELECT pg_advisory_xact_lock(94721817)");
  const rows=await client.query("SELECT version FROM control_ai_versions ORDER BY version DESC LIMIT 1");
  const current=rows.rows[0]?.version??0;if(current!==settings.expectedVersion)throw Error("VERSION_CONFLICT");
  const {expectedVersion,reason,...config}=settings;
  await client.query("INSERT INTO control_ai_versions(id,version,settings,system_instructions,actor_email,reason,applied_at) VALUES($1,$2,$3,$4,$5,$6,$7)",[crypto.randomUUID(),current+1,JSON.stringify(config),parsed.systemInstructions,email,reason,parsed.apply?new Date().toISOString():null]);
  await client.query("INSERT INTO control_admin_audit(id,actor_email,action,entity_type,metadata) VALUES($1,$2,$4,'ai_settings',$3)",[crypto.randomUUID(),email,JSON.stringify({version:current+1}),parsed.apply?"ai_settings_applied":"ai_settings_draft_saved"]);
  await client.query("COMMIT");return {version:current+1};
 }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
}
