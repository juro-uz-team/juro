"use client";
import {useEffect,useState} from "react";
import {createPortal} from "react-dom";
import {Check} from "lucide-react";

export function notifyChat(message:string) {
  window.dispatchEvent(new CustomEvent("juro:chat-notification",{detail:message}));
}
export function ChatNotifications(){
  const [notice,setNotice]=useState<{message:string;id:number;leaving:boolean}|null>(null);
  useEffect(()=>{
    let hide:ReturnType<typeof setTimeout>,remove:ReturnType<typeof setTimeout>;
    const receive=(event:Event)=>{
      clearTimeout(hide);clearTimeout(remove);
      setNotice({message:(event as CustomEvent<string>).detail,id:Date.now(),leaving:false});
      hide=setTimeout(()=>setNotice(current=>current?{...current,leaving:true}:null),3200);
      remove=setTimeout(()=>setNotice(null),3400);
    };
    window.addEventListener("juro:chat-notification",receive);
    return()=>{window.removeEventListener("juro:chat-notification",receive);clearTimeout(hide);clearTimeout(remove);};
  },[]);
  return notice?createPortal(<div key={notice.id} className="ai-chat-notification" data-leaving={notice.leaving} role="status" aria-live="polite"><Check aria-hidden="true"/><span>{notice.message}</span></div>,document.body):null;
}
