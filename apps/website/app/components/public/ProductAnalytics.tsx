"use client";
import {useEffect,useRef,useState} from "react";
import {usePathname} from "next/navigation";
import {trackProductPage} from "../../../lib/analytics";
export function ProductAnalytics(){
 const path=usePathname();const last=useRef("");const [choice,setChoice]=useState<string|null>("loading");const [open,setOpen]=useState(false);
 useEffect(()=>{try{setChoice(localStorage.getItem("juro-cookie-consent"));}catch{setChoice("necessary");}},[]);
 useEffect(()=>{if(choice!=="analytics"||last.current===path)return;last.current=path;trackProductPage();},[choice,path]);
 const choose=(value:string)=>{try{localStorage.setItem("juro-cookie-consent",value);}catch{}setChoice(value);setOpen(false);};
 if(choice!==null&&!open)return <button type="button" onClick={()=>setOpen(true)} aria-label="Настройки cookie" style={{position:"fixed",bottom:8,right:8,zIndex:70,fontSize:11}}>Cookie</button>;
 const uz=path.startsWith("/uz"),en=path.startsWith("/en");
 return <div role="region" aria-label={uz?"Cookie sozlamalari":en?"Cookie preferences":"Настройки cookie"} style={{position:"fixed",bottom:16,left:16,right:16,maxWidth:640,zIndex:70,background:"var(--surface, #fff)",color:"var(--ink, #102333)",border:"1px solid #d9dee1",borderRadius:12,padding:20,boxShadow:"0 8px 30px #06284422"}}><p style={{margin:"0 0 12px",fontSize:14}}>{uz?"JURO anonim tashrif statistikasini faqat roziligingiz bilan yig‘adi. Hujjatlar va yozishmalar yig‘ilmaydi.":en?"JURO collects anonymous visit statistics only with your consent. Documents and messages are excluded.":"JURO собирает анонимную статистику посещений только с вашего согласия. Документы и переписки не передаются."}</p><div style={{display:"flex",gap:12,flexWrap:"wrap"}}><button onClick={()=>choose("necessary")} style={{padding:"10px 14px"}}>{uz?"Faqat zarur":en?"Necessary only":"Только необходимые"}</button><button onClick={()=>choose("analytics")} style={{padding:"10px 14px",background:"#062844",color:"#fff"}}>{uz?"Statistikaga roziman":en?"Allow analytics":"Разрешить аналитику"}</button></div></div>;
}
