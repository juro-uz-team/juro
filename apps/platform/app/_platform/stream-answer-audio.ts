function waitFor(target:EventTarget,event:string,signal:AbortSignal) {
  return new Promise<void>((resolve,reject)=>{
    const clean=()=>{target.removeEventListener(event,done);target.removeEventListener("error",fail);signal.removeEventListener("abort",fail);};
    const done=()=>{clean();resolve();};
    const fail=()=>{clean();reject(new Error("AUDIO_STREAM_INTERRUPTED"));};
    target.addEventListener(event,done,{once:true});target.addEventListener("error",fail,{once:true});signal.addEventListener("abort",fail,{once:true});
    if(signal.aborted)fail();
  });
}

/** Attach playable bytes as they arrive; older browsers retain blob playback. */
export async function streamAnswerAudio(response:Response,signal:AbortSignal,onUrl:(url:string)=>void) {
  if(!response.body||response.headers.get("content-type")?.split(";")[0]!=="audio/mpeg"||typeof MediaSource==="undefined"||!MediaSource.isTypeSupported("audio/mpeg")){
    const blob=await response.blob();if(!signal.aborted)onUrl(URL.createObjectURL(blob));return;
  }
  const source=new MediaSource();
  const ready=waitFor(source,"sourceopen",signal);
  const url=URL.createObjectURL(source);
  onUrl(url);
  const reader=response.body.getReader();
  try {
    await ready;
    const buffer=source.addSourceBuffer("audio/mpeg");buffer.mode="sequence";
    for(;;){
      const chunk=await reader.read();if(signal.aborted)throw Error("AUDIO_CANCELLED");if(chunk.done)break;
      const appended=waitFor(buffer,"updateend",signal);
      try {buffer.appendBuffer(new Uint8Array(chunk.value).buffer);}catch(error){void appended.catch(()=>{});throw error;}
      await appended;
    }
    if(source.readyState==="open")source.endOfStream();
  } catch(error){await reader.cancel().catch(()=>{});throw error;}
  finally {reader.releaseLock();}
}
