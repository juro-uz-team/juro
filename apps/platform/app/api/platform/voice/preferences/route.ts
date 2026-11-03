import {z} from "zod";
import {assertSafeWrite, requireApiUser, withApiErrors} from "../../../../../lib/document-builder/auth/api";
import {requireD1} from "../../../../../lib/document-builder/storage/runtime";
import {parseJsonRequest} from "../../../../../lib/auth/input";
const response=(body:unknown)=>Response.json(body,{headers:{"cache-control":"private, no-store"}});
export const GET=withApiErrors(async(request:Request)=>{
  const user=await requireApiUser(request);
  const row=await requireD1().prepare("SELECT speech_voice AS voice FROM user_profiles WHERE id=?").bind(user.id).first<{voice:string}>();
  return response({voice:row?.voice??"marin"});
});
export const PUT=withApiErrors(async(request:Request)=>{
  assertSafeWrite(request);const user=await requireApiUser(request);
  const parsed=await parseJsonRequest(request,z.object({voice:z.enum(["marin","cedar"])}).strict(),1024);
  if(!parsed.ok)return Response.json({code:"INVALID_REQUEST"},{status:400});
  await requireD1().prepare("UPDATE user_profiles SET speech_voice=?,updated_at=? WHERE id=?").bind(parsed.data.voice,new Date().toISOString(),user.id).run();
  return response({voice:parsed.data.voice});
});
