import { protectIdentityValue, type IdentityKeyring } from "../auth/keyring";
import {speechTextChunks} from "../ai/answer-speech-text";
import { aiText } from "../ai/localization";
import { runProviderRequestWithTimeouts } from "../ai/provider-request-timeout";
import { parseVoiceTranscript, revealVoiceTranscript, voiceRecordingForUser, voiceTranscriptContext,
  VoiceRecordingError, VOICE_MAX_BYTES, type VoiceRecordingRow } from "../ai/voice-recording";

async function boundedBody(response:Response,maximum:number):Promise<Uint8Array> {
  if(!response.ok || !response.body) throw new Error("AUDIO_PROVIDER_UNAVAILABLE");
  const reader=response.body.getReader();const chunks:Uint8Array[]=[];let size=0;
  try {
    for(;;) {const next=await reader.read();if(next.done) break;
      size+=next.value.byteLength;if(size>maximum) {await reader.cancel();throw Error("AUDIO_RESPONSE_TOO_LARGE");}
      chunks.push(next.value);
    }
  } finally {reader.releaseLock();}
  const result=new Uint8Array(size);let offset=0;
  for(const chunk of chunks) {result.set(chunk,offset);offset+=chunk.byteLength;}
  return result;
}

export async function transcribeRecording(input:{
  db:D1Database;bucket:R2Bucket;keyring:IdentityKeyring;recording:VoiceRecordingRow;
  apiKey:string;model:string;now?:string;signal?:AbortSignal;fetcher?:typeof fetch;
}):Promise<{recording:VoiceRecordingRow;transcript:string}> {
  const now=input.now??new Date().toISOString();
  const owner={id:input.recording.id,workspaceId:input.recording.workspaceId,userId:input.recording.userId};
  const recording=await voiceRecordingForUser(input.db,owner.id,owner.workspaceId,owner.userId);
  if(!recording || Date.parse(recording.expiresAt)<=Date.parse(now)) throw new VoiceRecordingError("VOICE_RECORDING_NOT_FOUND",404,"Recording unavailable");
  if(recording.status==='transcribed'||recording.status==='submitted') return {recording,transcript:await revealVoiceTranscript(input.keyring,recording)};
  if(!input.apiKey || input.signal?.aborted) throw new VoiceRecordingError("VOICE_TRANSCRIPTION_UNAVAILABLE",503,"Transcription unavailable");
  const staleBefore=new Date(Date.parse(now)-90_000).toISOString();
  const claim=await input.db.prepare(`UPDATE voice_recordings SET status='transcribing',error_code=NULL,updated_at=?
    WHERE id=? AND workspace_id=? AND user_id=? AND deleted_at IS NULL AND expires_at>?
      AND (status IN ('ready','failed') OR (status='transcribing' AND updated_at<?))`).bind(
      now,owner.id,owner.workspaceId,owner.userId,now,staleBefore).run();
  if(Number(claim.meta.changes??0)!==1) throw new VoiceRecordingError("VOICE_TRANSCRIPTION_BUSY",409,"Recording already being processed");
  try {
    const object=await input.bucket.get(recording.objectKey);
    if(!object||object.size!==recording.sizeBytes||object.size>VOICE_MAX_BYTES) throw Error("AUDIO_INTEGRITY_FAILED");
    const bytes=new Uint8Array(await object.arrayBuffer());
    const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(value=>value.toString(16).padStart(2,'0')).join('');
    if(bytes.byteLength!==recording.sizeBytes||digest!==recording.sha256) throw Error("AUDIO_INTEGRITY_FAILED");
    const form=new FormData();
    const extension=({"audio/webm":"webm","audio/mp4":"mp4","audio/mpeg":"mp3"} as Record<string,string>)[recording.mimeType]??"wav";
    form.set('file',new Blob([bytes],{type:recording.mimeType}),`recording.${extension}`);
    form.set('model',input.model);form.set('language',recording.locale);form.set('response_format','json');
    const response=await runProviderRequestWithTimeouts({firstByteTimeoutMs:45_000,totalResponseTimeoutMs:45_000,callerSignal:input.signal,
      start:signal=>(input.fetcher??fetch)('https://api.openai.com/v1/audio/transcriptions',{
        method:'POST',headers:{authorization:`Bearer ${input.apiKey}`},body:form,signal}),
      consume:response=>boundedBody(response,64_000)});
    const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(response)) as {text?:unknown};
    const transcript=parseVoiceTranscript({transcript:payload.text});
    const encrypted=await protectIdentityValue(input.keyring,transcript,voiceTranscriptContext(recording));
    if(input.signal?.aborted) throw Error("TRANSCRIPTION_CANCELLED");
    const saved=await input.db.prepare(`UPDATE voice_recordings SET status='transcribed',transcript_ciphertext=?,transcript_iv=?,
      transcript_key_version=?,provider='openai',model=?,transcribed_at=?,error_code=NULL,updated_at=?
      WHERE id=? AND workspace_id=? AND user_id=? AND status='transcribing' AND updated_at=? AND deleted_at IS NULL`).bind(
      encrypted.ciphertext,encrypted.iv,encrypted.keyVersion,input.model,now,now,owner.id,owner.workspaceId,owner.userId,now).run();
    if(Number(saved.meta.changes??0)!==1) throw Error("TRANSCRIPT_WRITE_CONFLICT");
    const updated=await voiceRecordingForUser(input.db,owner.id,owner.workspaceId,owner.userId);
    if(!updated) throw Error("TRANSCRIPT_UNAVAILABLE");
    return {recording:updated,transcript};
  } catch {
    await input.db.prepare(`UPDATE voice_recordings SET status='failed',error_code='VOICE_TRANSCRIPTION_UNAVAILABLE',updated_at=?
      WHERE id=? AND workspace_id=? AND user_id=? AND status='transcribing' AND updated_at=?`).bind(
      now,owner.id,owner.workspaceId,owner.userId,now).run();
    throw new VoiceRecordingError("VOICE_TRANSCRIPTION_UNAVAILABLE",503,"Transcription unavailable");
  }
}

async function speakChunk(input:{apiKey:string;model:string;voice:"marin"|"cedar";text:string;
  locale:"ru"|"uz"|"en";signal?:AbortSignal;fetcher?:typeof fetch}):Promise<Response> {
  if(!input.apiKey||!input.text.trim()||input.text.length>4096||!['marin','cedar'].includes(input.voice)) {
    throw new VoiceRecordingError("VOICE_SPEECH_UNAVAILABLE",503,"Speech unavailable");
  }
  const controller=new AbortController();
  const abort=()=>controller.abort();
  input.signal?.addEventListener("abort",abort,{once:true});
  if(input.signal?.aborted)controller.abort();
  const timer=setTimeout(abort,45_000);
  const cleanup=()=>{clearTimeout(timer);input.signal?.removeEventListener("abort",abort);};
  try {
    const response=await (input.fetcher??fetch)('https://api.openai.com/v1/audio/speech',{method:'POST',signal:controller.signal,
      headers:{authorization:`Bearer ${input.apiKey}`,'content-type':'application/json'},
      body:JSON.stringify({model:input.model,voice:input.voice,input:input.text,response_format:'mp3',instructions:aiText(input.locale,
        'AI-озвучивание: читайте по-русски спокойно и разборчиво. Озвучьте текст без добавлений.',
        'AI ovozi: o‘zbek tilida xotirjam va aniq o‘qing. Matnga hech narsa qo‘shmang.',
        'Speak calmly, professionally and clearly in English. This is an AI voice. Read the supplied text without additions.')})});
    if(!response.ok||!response.body)throw Error("AUDIO_PROVIDER_UNAVAILABLE");
    const reader=response.body.getReader();
    const first=await reader.read();
    if(first.done||!first.value.byteLength||first.value.byteLength>VOICE_MAX_BYTES){await reader.cancel();throw Error("INVALID_AUDIO");}
    let size=first.value.byteLength;
    const stream=new ReadableStream<Uint8Array>({
      start(target){target.enqueue(first.value);},
      async pull(target){
        try {
          const next=await reader.read();
          if(next.done){cleanup();target.close();return;}
          size+=next.value.byteLength;
          if(size>VOICE_MAX_BYTES)throw Error("AUDIO_RESPONSE_TOO_LARGE");
          target.enqueue(next.value);
        }catch(error){cleanup();controller.abort();void reader.cancel().catch(()=>{});target.error(error);}
      },
      async cancel(){cleanup();controller.abort();await reader.cancel().catch(()=>{});},
    });
    return new Response(stream,{headers:{'content-type':'audio/mpeg','cache-control':'private, no-store','x-accel-buffering':'no'}});
  } catch {cleanup();controller.abort();throw new VoiceRecordingError("VOICE_SPEECH_UNAVAILABLE",503,"Speech unavailable");}
}

export async function speakAnswer(input:Parameters<typeof speakChunk>[0]):Promise<Response>{
  if(!input.text.trim()||input.text.length>120_000)throw new VoiceRecordingError("VOICE_SPEECH_UNAVAILABLE",503,"Speech unavailable");
  const chunks=speechTextChunks(input.text);
  const controller=new AbortController(),abort=()=>controller.abort();
  input.signal?.addEventListener("abort",abort,{once:true});if(input.signal?.aborted)abort();
  const cleanup=()=>input.signal?.removeEventListener("abort",abort);
  try{
    const first=await speakChunk({...input,text:chunks[0],signal:controller.signal});
    let reader=first.body!.getReader(),index=1,size=0;
    const stream=new ReadableStream<Uint8Array>({
      async pull(target){
        try{
          for(;;){
            const next=await reader.read();
            if(!next.done){size+=next.value.byteLength;if(size>VOICE_MAX_BYTES)throw Error("AUDIO_RESPONSE_TOO_LARGE");target.enqueue(next.value);return;}
            reader.releaseLock();
            if(index===chunks.length){cleanup();target.close();return;}
            controller.signal.throwIfAborted();
            const response=await speakChunk({...input,text:chunks[index++],signal:controller.signal});reader=response.body!.getReader();
          }
        }catch(error){cleanup();controller.abort();void reader.cancel().catch(()=>{});target.error(error);}
      },
      async cancel(){cleanup();controller.abort();await reader.cancel().catch(()=>{});},
    });
    return new Response(stream,{headers:first.headers});
  }catch(error){cleanup();controller.abort();throw error;}
}
