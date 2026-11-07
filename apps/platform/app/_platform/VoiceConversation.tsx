"use client";
import {useEffect,useRef,useState} from "react";
import {Mic,MicOff,X,RotateCcw} from "lucide-react";
import {uploadAndTranscribeVoice} from "../../lib/ai/client-voice";
import {aiText} from "../../lib/ai/localization";
import type {PlatformLocale} from "../../lib/platform/routing";

/** A turn-based microphone session. Silence ends a turn; playback never records itself. */
export function VoiceConversation({locale,workspaceId,busy,messageId,onTranscript,onClose}:{locale:PlatformLocale;workspaceId:string;busy:boolean;messageId?:string;onTranscript:(value:{recordingId:string;transcript:string})=>void;onClose:()=>void}) {
 const [muted,setMuted]=useState(false),[phase,setPhase]=useState("starting"),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
 const activeRecorder=useRef<MediaRecorder|null>(null);
 const microphone=useRef<MediaStream|null>(null),mutedRef=useRef(false);
 useEffect(()=>{mutedRef.current=muted;microphone.current?.getAudioTracks().forEach(track=>{track.enabled=!muted;});const recorder=activeRecorder.current;if(muted&&recorder?.state==="recording")recorder.pause();else if(!muted&&recorder?.state==="paused")recorder.resume();},[muted]);
 const bars=useRef<HTMLDivElement>(null),callback=useRef(onTranscript),played=useRef(messageId),audio=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{callback.current=onTranscript;},[onTranscript]);
 useEffect(()=>{
  const controller=new AbortController();let stream:MediaStream|undefined,context:AudioContext|undefined,recorder:MediaRecorder|undefined,frame=0,url="";
  const text=(ru:string,uz:string,en:string)=>aiText(locale,ru,uz,en);
  const meter=(analyser:AnalyserNode,onLevel?:(level:number)=>void)=>{const data=new Uint8Array(analyser.frequencyBinCount);const tick=()=>{if(controller.signal.aborted)return;analyser.getByteTimeDomainData(data);const level=Math.sqrt(data.reduce((sum,n)=>sum+((n-128)/128)**2,0)/data.length);onLevel?.(level);const children=bars.current?.children; if(children)Array.from(children).forEach((bar,i)=>{(bar as HTMLElement).style.transform=`scaleY(${Math.min(1,0.12+level*8*(0.5+Math.sin(i*1.7+performance.now()/200)**2))})`;});frame=requestAnimationFrame(tick);};tick();};
  const cleanup=()=>{cancelAnimationFrame(frame);if(recorder&&recorder.state!=="inactive"){recorder.onstop=null;recorder.stop();}stream?.getTracks().forEach(track=>track.stop());microphone.current=null;activeRecorder.current=null;bars.current?.querySelectorAll("i").forEach(bar=>{bar.style.transform="scaleY(.12)";});audio.current?.pause();audio.current=null;void context?.close();if(url)URL.revokeObjectURL(url);};
  async function run(){
   if(busy){setPhase("thinking");return;}
   setError("");
   try {
    if(messageId&&played.current!==messageId){
     setPhase("speaking");
     const preference=await fetch("/api/platform/voice/preferences",{signal:controller.signal});if(!preference.ok)throw Error();
     const {voice}=await preference.json();
     const response=await fetch("/api/platform/voice/speech",{method:"POST",signal:controller.signal,headers:{"content-type":"application/json","x-juro-csrf":"1","x-juro-locale":locale,"x-juro-workspace-id":workspaceId},body:JSON.stringify({assistantMessageId:messageId,locale,voice})});if(!response.ok)throw Error();
     url=URL.createObjectURL(await response.blob());controller.signal.throwIfAborted();
     const element=new Audio(url);audio.current=element;context=new AudioContext();const source=context.createMediaElementSource(element),analyser=context.createAnalyser();source.connect(analyser);analyser.connect(context.destination);await context.resume();meter(analyser);
     await new Promise<void>((resolve,reject)=>{element.onended=()=>resolve();element.onerror=()=>reject(Error());controller.signal.addEventListener("abort",()=>reject(Error()),{once:true});void element.play().catch(reject);});
     played.current=messageId;cancelAnimationFrame(frame);await context.close();context=undefined;URL.revokeObjectURL(url);url="";audio.current=null;
    }
    setPhase("starting");stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});if(controller.signal.aborted){stream.getTracks().forEach(track=>track.stop());return;}
    microphone.current=stream;stream.getAudioTracks().forEach(track=>{track.enabled=!mutedRef.current;});
    context=new AudioContext();await context.resume();const analyser=context.createAnalyser();context.createMediaStreamSource(stream).connect(analyser);
    const mimeType=["audio/webm","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type));recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);const chunks:Blob[]=[];const started=performance.now();let bytes=0,lastSpeech=started,heard=false;
    recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;}};
    recorder.onstop=()=>{stream?.getTracks().forEach(track=>track.stop());cancelAnimationFrame(frame);if(controller.signal.aborted)return;setPhase("processing");void uploadAndTranscribeVoice({blob:new Blob(chunks,{type:recorder!.mimeType}),durationMs:Math.min(300000,Math.round(performance.now()-started)),locale,workspaceId,idempotencyKey:crypto.randomUUID(),signal:controller.signal,onPhase:()=>{},onRecording:()=>{}}).then(value=>{if(controller.signal.aborted)return;if(!value.transcript.trim())throw Error();callback.current(value);}).catch(()=>{if(!controller.signal.aborted){setPhase("error");setError(text("Не удалось распознать речь. Повторите попытку.","Nutqni aniqlab bo‘lmadi. Qayta urining.","Could not transcribe your speech. Please retry."));}});};
    activeRecorder.current=recorder;recorder.start(250);if(mutedRef.current)recorder.pause();setPhase("listening");meter(analyser,level=>{const now=performance.now();if(mutedRef.current){lastSpeech=now;return;}if(level>0.025){heard=true;lastSpeech=now;}if(recorder?.state==="recording"&&((heard&&now-lastSpeech>1400)||now-started>120000||bytes>20*1024*1024))recorder.stop();});
   }catch{if(!controller.signal.aborted){cleanup();setPhase("error");setError(text("Голосовой режим недоступен. Проверьте микрофон и повторите попытку.","Ovozli rejim mavjud emas. Mikrofonni tekshiring.","Voice mode is unavailable. Check microphone access and retry."));}}
  }
  void run();return()=>{controller.abort();cleanup();};
 },[locale,workspaceId,busy,messageId,attempt]);
 const label=error||(muted&&phase==="listening"?aiText(locale,"Микрофон выключен","Mikrofon o‘chirilgan","Microphone muted"):null)||aiText(locale,phase==="listening"?"Слушаю…":phase==="speaking"?"JURO отвечает…":phase==="muted"?"Микрофон выключен":"Обрабатываем…",phase==="listening"?"Tinglayapman…":phase==="speaking"?"JURO javob bermoqda…":phase==="muted"?"Mikrofon o‘chirilgan":"Qayta ishlanmoqda…",phase==="listening"?"Listening…":phase==="speaking"?"JURO is speaking…":phase==="muted"?"Microphone muted":"Processing…");
 return <div className="ai-live-voice"><div className="ai-voice-meter" ref={bars} aria-hidden="true">{Array.from({length:32},(_,i)=><i key={i}/>)}</div><span role={error?"alert":"status"}>{label}</span>{error&&<button type="button" onClick={()=>setAttempt(n=>n+1)} aria-label={aiText(locale,"Повторить","Qayta urinish","Retry")}><RotateCcw/></button>}<button type="button" aria-pressed={muted} aria-label={aiText(locale,muted?"Включить микрофон":"Выключить микрофон",muted?"Mikrofonni yoqish":"Mikrofonni o‘chirish",muted?"Unmute microphone":"Mute microphone")} onClick={()=>setMuted(value=>!value)}>{muted?<MicOff/>:<Mic/>}</button><button type="button" onClick={onClose} aria-label={aiText(locale,"Выйти из голосового режима","Ovozli rejimdan chiqish","Exit voice mode")}><X/></button></div>;
}
