"use client";

import {useEffect, useState} from "react";
import {Select} from "../_components/Select";
import {aiText} from "../../lib/ai/localization";
import type {PlatformLocale} from "../../lib/platform/routing";

export function VoicePreferences({locale}:{locale:PlatformLocale}) {
  const [voice,setVoice]=useState("marin"),[ready,setReady]=useState(false),[saving,setSaving]=useState(false),[status,setStatus]=useState("");
  const failed=aiText(locale,"Не удалось сохранить голос. Попробуйте ещё раз.","Ovozni saqlab bo‘lmadi. Qayta urinib ko‘ring.","Could not save the voice. Please retry.");
  useEffect(()=>{
    const controller=new AbortController();
    void fetch("/api/platform/voice/preferences",{signal:controller.signal}).then(async response=>{
      if(!response.ok)throw Error();const data=await response.json();
      setVoice(data.voice);setReady(true);
    }).catch(()=>{if(!controller.signal.aborted)setStatus(aiText(locale,"Не удалось загрузить настройки голоса.","Ovoz sozlamalarini yuklab bo‘lmadi.","Could not load voice preferences."));});
    return()=>controller.abort();
  },[locale]);
  async function save(value:string){
    setSaving(true);setStatus("");
    try{
      const response=await fetch("/api/platform/voice/preferences",{method:"PUT",headers:{"content-type":"application/json","x-juro-csrf":"1"},body:JSON.stringify({voice:value})});
      if(!response.ok)throw Error();setVoice(value);setStatus(aiText(locale,"Голос сохранён.","Ovoz saqlandi.","Voice saved."));
    }catch{setStatus(failed);}finally{setSaving(false);}
  }
  return <section className="account-edit-form ai-voice-preference">
    <div className="account-section-heading"><h2>{aiText(locale,"Озвучивание ответов","Javoblarni ovozli o‘qish","Read answers aloud")}</h2><p>{aiText(locale,"Выберите голос для ответов AI. Настройка сохраняется для вашего аккаунта.","AI javoblari uchun ovozni tanlang. Sozlama hisobingizda saqlanadi.","Choose the voice for AI answers. This preference is saved to your account.")}</p></div>
    <label>{aiText(locale,"Голос AI","AI ovozi","AI voice")}<Select aria-label={aiText(locale,"Голос AI","AI ovozi","AI voice")} value={voice} disabled={!ready||saving} onChange={event=>void save(event.target.value)}><option value="marin">Marin</option><option value="cedar">Cedar</option></Select></label>
    <p role="status">{saving?aiText(locale,"Сохраняем…","Saqlanmoqda…","Saving…"):status}</p>
  </section>;
}
