"use client";
import {useEffect,useId,useRef,useState} from "react";
import {Mic,MicOff,X,RotateCcw} from "lucide-react";
import {uploadAndTranscribeVoice} from "../../lib/ai/client-voice";
import {streamAnswerAudio} from "./stream-answer-audio";
import {aiText} from "../../lib/ai/localization";
import type {PlatformLocale} from "../../lib/platform/routing";

/** A turn-based microphone session. Silence ends a turn; playback never records itself. */
export function VoiceConversation({locale,workspaceId,busy,messageId,onTranscript,onClose}:{locale:PlatformLocale;workspaceId:string;busy:boolean;messageId?:string;onTranscript:(value:{recordingId:string;transcript:string})=>void;onClose:()=>void}) {
 const [muted,setMuted]=useState(false),[phase,setPhase]=useState("starting"),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
 const activeRecorder=useRef<MediaRecorder|null>(null);
 const microphone=useRef<MediaStream|null>(null),mutedRef=useRef(false);
 useEffect(()=>{mutedRef.current=muted;microphone.current?.getAudioTracks().forEach(track=>{track.enabled=!muted;});const recorder=activeRecorder.current;if(muted&&recorder?.state==="recording")recorder.pause();else if(!muted&&recorder?.state==="paused")recorder.resume();},[muted]);
 const waveId=useId().replace(/:/g, "");
 const pending=useRef<{blob:Blob;durationMs:number;idempotencyKey:string}|null>(null);
 const wave=useRef<SVGSVGElement>(null),callback=useRef(onTranscript),played=useRef(messageId),audio=useRef<HTMLAudioElement|null>(null);
 useEffect(()=>{callback.current=onTranscript;},[onTranscript]);
 useEffect(()=>{
  const controller=new AbortController();let stream:MediaStream|undefined,context:AudioContext|undefined,recorder:MediaRecorder|undefined,frame=0,url="";
  const text=(ru:string,uz:string,en:string)=>aiText(locale,ru,uz,en);
  const meter=(analyser:AnalyserNode,onLevel?:(level:number)=>void)=>{
   const data=new Uint8Array(analyser.frequencyBinCount);let smooth=0;
   const reduced=window.matchMedia("(prefers-reduced-motion: reduce)").matches;
   const tick=()=>{if(controller.signal.aborted)return;
    analyser.getByteTimeDomainData(data);
    const level=Math.sqrt(data.reduce((sum,n)=>sum+((n-128)/128)**2,0)/data.length);
    onLevel?.(level);smooth+=(Math.min(1,level*9)-smooth)*.16;
    const svg=wave.current;if(svg){svg.dataset.level=smooth.toFixed(3);
     svg.querySelectorAll<SVGPathElement>("[data-wave]").forEach((path,index)=>{
      const time=reduced?0:performance.now()/850;
      const amplitude=reduced?4:5+smooth*35;
      const points=Array.from({length:41},(_,i)=>{const x=i*8;const envelope=Math.sin(Math.PI*i/40);const y=92-index*7+amplitude*envelope*Math.sin(i/6+time*(index%2?-1:1)+index*1.7);return `${x},${y.toFixed(2)}`;});
      path.setAttribute("d",`M${points.join(" L")} L320,160 L0,160 Z`);
     });
    }frame=requestAnimationFrame(tick);
   };tick();
  };
  async function transcribe(){
   if(!pending.current)return;
   setPhase("processing");
   try{const value=await uploadAndTranscribeVoice({...pending.current,locale,workspaceId,signal:controller.signal,onPhase:()=>{},onRecording:()=>{}});
    if(controller.signal.aborted)return;
    if(!value.transcript.trim()){pending.current=null;throw Error();}
    callback.current(value);pending.current=null;
   }catch{if(!controller.signal.aborted){setPhase("error");setError(text("Не удалось обработать запись. Повторите попытку.","Yozuvni qayta ishlab bo‘lmadi. Qayta urining.","Could not process the recording. Please retry."));}}
  }
  const cleanup=()=>{cancelAnimationFrame(frame);if(recorder&&recorder.state!=="inactive"){recorder.onstop=null;recorder.stop();}stream?.getTracks().forEach(track=>track.stop());microphone.current=null;activeRecorder.current=null;audio.current?.pause();audio.current=null;void context?.close();if(url)URL.revokeObjectURL(url);};
  async function run(){
   if(busy){setPhase("thinking");return;}
   setError("");
   try {
    if(pending.current){await transcribe();return;}
    if(messageId&&played.current!==messageId){
     setPhase("speaking");
     const preference=await fetch("/api/platform/voice/preferences",{signal:controller.signal});if(!preference.ok)throw Error();
     const {voice}=await preference.json();
     const response=await fetch("/api/platform/voice/speech",{method:"POST",signal:controller.signal,headers:{"content-type":"application/json","x-juro-csrf":"1","x-juro-locale":locale,"x-juro-workspace-id":workspaceId},body:JSON.stringify({assistantMessageId:messageId,locale,voice})});if(!response.ok)throw Error();
     let resolvePlayback!:()=>void,rejectPlayback!:(reason:unknown)=>void;
     const playback=new Promise<void>((resolve,reject)=>{resolvePlayback=resolve;rejectPlayback=reject;});
     controller.signal.addEventListener("abort",()=>rejectPlayback(Error("AUDIO_CANCELLED")),{once:true});
     const download=streamAnswerAudio(response,controller.signal,sourceUrl=>{
      url=sourceUrl;const element=new Audio(url);audio.current=element;
      context=new AudioContext();const source=context.createMediaElementSource(element),analyser=context.createAnalyser();source.connect(analyser);analyser.connect(context.destination);meter(analyser);
      element.onended=resolvePlayback;element.onerror=()=>rejectPlayback(Error("AUDIO_PLAYBACK_FAILED"));
      void context.resume().then(()=>element.play()).catch(rejectPlayback);
     });
     await Promise.all([download,playback]);
     played.current=messageId;cancelAnimationFrame(frame);await context?.close();context=undefined;URL.revokeObjectURL(url);url="";audio.current=null;
    }
    setPhase("starting");stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});if(controller.signal.aborted){stream.getTracks().forEach(track=>track.stop());return;}
    microphone.current=stream;stream.getAudioTracks().forEach(track=>{track.enabled=!mutedRef.current;});
    context=new AudioContext();await context.resume();const analyser=context.createAnalyser();context.createMediaStreamSource(stream).connect(analyser);
    const mimeType=["audio/webm","audio/mp4"].find(type=>MediaRecorder.isTypeSupported(type));recorder=new MediaRecorder(stream,mimeType?{mimeType}:undefined);const chunks:Blob[]=[];const started=performance.now();let bytes=0,lastSpeech=started,heard=false;
    recorder.ondataavailable=event=>{if(event.data.size){chunks.push(event.data);bytes+=event.data.size;}};
    recorder.onstop=()=>{stream?.getTracks().forEach(track=>track.stop());cancelAnimationFrame(frame);if(controller.signal.aborted)return;
     if(!heard){setAttempt(value=>value+1);return;}
     pending.current={blob:new Blob(chunks,{type:recorder!.mimeType}),durationMs:Math.min(300000,Math.round(performance.now()-started)),idempotencyKey:crypto.randomUUID()};
     void transcribe();
    };
    activeRecorder.current=recorder;recorder.start(250);if(mutedRef.current)recorder.pause();setPhase("listening");meter(analyser,level=>{const now=performance.now();if(mutedRef.current){lastSpeech=now;return;}if(level>0.025){heard=true;lastSpeech=now;}if(recorder?.state==="recording"&&((heard&&now-lastSpeech>1400)||now-started>120000||bytes>20*1024*1024))recorder.stop();});
   }catch{if(!controller.signal.aborted){cleanup();setPhase("error");setError(text("Голосовой режим недоступен. Проверьте микрофон и повторите попытку.","Ovozli rejim mavjud emas. Mikrofonni tekshiring.","Voice mode is unavailable. Check microphone access and retry."));}}
  }
  void run();return()=>{controller.abort();cleanup();};
 },[locale,workspaceId,busy,messageId,attempt]);
 const label=error||(muted&&phase==="listening"?aiText(locale,"Микрофон выключен","Mikrofon o‘chirilgan","Microphone muted"):null)||aiText(locale,phase==="listening"?"Слушаю…":phase==="speaking"?"JURO отвечает…":phase==="muted"?"Микрофон выключен":"Обрабатываем…",phase==="listening"?"Tinglayapman…":phase==="speaking"?"JURO javob bermoqda…":phase==="muted"?"Mikrofon o‘chirilgan":"Qayta ishlanmoqda…",phase==="listening"?"Listening…":phase==="speaking"?"JURO is speaking…":phase==="muted"?"Microphone muted":"Processing…");
 return <div className="ai-live-voice" data-phase={phase}><svg className="ai-voice-wave" ref={wave} viewBox="0 0 320 160" aria-hidden="true">
  <defs><linearGradient id={`${waveId}-base`} x2="0" y2="1"><stop stopColor="var(--surface-canvas)"/><stop offset="1" stopColor="var(--surface-elevated)"/></linearGradient>
  <linearGradient id={`${waveId}-light`} x2="0" y2="1"><stop stopColor="var(--brand-gold-text)" stopOpacity="0"/><stop offset=".7" stopColor="var(--brand-gold-text)" stopOpacity=".6"/><stop offset="1" stopColor="var(--brand-gold-text)"/></linearGradient>
  <filter id={`${waveId}-blur`} x="-30%" y="-50%" width="160%" height="200%"><feGaussianBlur stdDeviation="12"/></filter>
  <clipPath id={`${waveId}-clip`}><rect width="320" height="160" rx="80"/></clipPath></defs>
  <g clipPath={`url(#${waveId}-clip)`}><rect width="320" height="160" fill={`url(#${waveId}-base)`}/>
   {[0,1,2].map(index=><path key={index} data-wave={index} d={`M0,${92-index*7} Q160,65 320,92 L320,160 L0,160 Z`} fill={`url(#${waveId}-light)`} opacity={.45+index*.2} filter={`url(#${waveId}-blur)`}/>)}</g>
 </svg><span role={error?"alert":"status"}>{label}</span>{error&&<button type="button" onClick={()=>setAttempt(n=>n+1)} aria-label={aiText(locale,"Повторить","Qayta urinish","Retry")}><RotateCcw/></button>}<button type="button" aria-pressed={muted} aria-label={aiText(locale,muted?"Включить микрофон":"Выключить микрофон",muted?"Mikrofonni yoqish":"Mikrofonni o‘chirish",muted?"Unmute microphone":"Mute microphone")} onClick={()=>setMuted(value=>!value)}>{muted?<MicOff/>:<Mic/>}</button><button type="button" onClick={onClose} aria-label={aiText(locale,"Выйти из голосового режима","Ovozli rejimdan chiqish","Exit voice mode")}><X/></button></div>;
}
