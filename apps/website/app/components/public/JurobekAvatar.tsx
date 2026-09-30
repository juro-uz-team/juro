"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";

import type { PublicLanguage } from "../../../content/types";
import styles from "./jurobek-avatar.module.css";

type Pose="idle"|"wave"|"point"|"guide"|"smile";
type Puppet={setState:(pose:Pose)=>void;setPaused:(value:boolean)=>void;destroy:()=>void};

const copy={ru:{role:"Ваш проводник в JURO",pause:"Остановить движение Jurobek",play:"Включить движение Jurobek",alt:"Jurobek — цифровой помощник JURO",group:"Анимации Jurobek",labels:["Покой","Привет","Показать","Объяснить","Улыбка"]},uz:{role:"JURO bo‘ylab yo‘lboshlovchingiz",pause:"Jurobek harakatini to‘xtatish",play:"Jurobek harakatini yoqish",alt:"Jurobek — JURO raqamli yordamchisi",group:"Jurobek animatsiyalari",labels:["Sokin","Salom","Ko‘rsatish","Izohlash","Tabassum"]},en:{role:"Your guide to JURO",pause:"Pause Jurobek motion",play:"Play Jurobek motion",alt:"Jurobek — JURO digital guide",group:"Jurobek animations",labels:["Idle","Wave","Point","Guide","Smile"]}};
export function JurobekAvatar({language}:{language:PublicLanguage}){
 const t=copy[language],root=useRef<HTMLDivElement>(null),stage=useRef<HTMLDivElement>(null),puppet=useRef<Puppet|null>(null);
 const [ready,setReady]=useState(false);
 useEffect(()=>{const el=root.current,host=stage.current;if(!el||!host)return;let disposed=false,loading=false;
  const observer=new IntersectionObserver(async([entry])=>{if(!entry.isIntersecting||loading)return;loading=true;try{const moduleUrl=new URL("/characters/jurobek/jurobek.mjs",window.location.origin).href;const asset=await import(/* webpackIgnore: true */ /* @vite-ignore */ moduleUrl);if(disposed)return;puppet.current=asset.createJurobek(host,{assetBase:"/characters/jurobek/",state:"wave",autoplay:true});setReady(true);}catch{if(!disposed)setReady(false);}},{rootMargin:"120px"});observer.observe(el);
  return()=>{disposed=true;observer.disconnect();puppet.current?.destroy();puppet.current=null;};
 },[]);
 return <div ref={root} className={styles.avatar} data-ready={ready}>
  <div className={styles.orbit} aria-hidden="true"/>
  <div className={styles.identity}><span>JUROBEK</span><small>{t.role}</small></div>
  <div className={styles.portrait2d}>
    {!ready&&<Image src="/characters/jurobek/reference.webp" alt={t.alt} width={941} height={1672} unoptimized/>}
    <div className={styles.puppetHost} ref={stage}/>
  </div>
 </div>;
}
