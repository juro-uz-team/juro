"use client";

import {Check, Copy, ThumbsDown, ThumbsUp, X} from "lucide-react";
import {useEffect, useState} from "react";
import {Button, Dialog, DialogTrigger, Heading, Popover} from "react-aria-components";
import {aiText} from "../../lib/ai/localization";
import type {PlatformLocale} from "../../lib/platform/routing";
import type {VoiceSpeechPhase} from "../../lib/ai/voice-ui";
import {notifyChat} from "./ChatNotifications";
import {AssistantSpeechControls} from "./VoiceMessageControls";

export function CopyMessageButton({text,locale}:{text:string;locale:PlatformLocale}) {
  const [copied,setCopied]=useState(false),[error,setError]=useState(false);
  useEffect(()=>{if(!copied)return;const timer=setTimeout(()=>setCopied(false),2000);return()=>clearTimeout(timer);},[copied]);
  const label=aiText(locale,"Копировать","Nusxalash","Copy");
  return <><button className="ai-icon-button" type="button" title={label} aria-label={copied?aiText(locale,"Скопировано","Nusxalandi","Copied"):label} onClick={()=>void navigator.clipboard.writeText(text).then(()=>{setCopied(true);setError(false);},()=>setError(true))}>{copied?<Check/>:<Copy/>}</button>{error&&<span role="alert">{aiText(locale,"Не удалось скопировать.","Nusxalab bo‘lmadi.","Could not copy.")}</span>}</>;
}

type FeedbackType="helpful"|"not_helpful"|"wrong_norm"|"incomplete"|"language";
export function AnswerActions({locale,workspaceId,messageId,text,disabled,onSpeechPhaseChange}:{locale:PlatformLocale;workspaceId:string;messageId?:string;text:string;disabled:boolean;onSpeechPhaseChange?:(phase:VoiceSpeechPhase)=>void}) {
  const [rating,setRating]=useState<string>(""),[open,setOpen]=useState(false),[category,setCategory]=useState<FeedbackType>("not_helpful"),[comment,setComment]=useState(""),[saving,setSaving]=useState(false),[status,setStatus]=useState("");
  const labels={helpful:aiText(locale,"Полезно","Foydali","Helpful"),not_helpful:aiText(locale,"Не полезно","Foydasiz","Not helpful"),wrong_norm:aiText(locale,"Неверная норма","Noto‘g‘ri norma","Wrong legal rule"),incomplete:aiText(locale,"Неполный ответ","To‘liq emas","Incomplete answer"),language:aiText(locale,"Сложно понять","Tushunish qiyin","Hard to understand")};
  useEffect(()=>{
    if(!messageId)return;const controller=new AbortController();
    void fetch(`/api/platform/ai/feedback?${new URLSearchParams({assistantMessageId:messageId})}`,{signal:controller.signal,headers:{"x-juro-workspace-id":workspaceId}}).then(async response=>{
      if(!response.ok)return;const data=await response.json();const latest=data.feedback?.sort((a:{updatedAt:string},b:{updatedAt:string})=>a.updatedAt.localeCompare(b.updatedAt)).at(-1);if(latest)setRating(latest.feedbackType);
    }).catch(()=>{});return()=>controller.abort();
  },[messageId,workspaceId]);
  async function save(type:FeedbackType){
    const removing=type==="helpful"&&rating==="helpful";
    if(!messageId||saving)return;setSaving(true);setStatus("");
    try{
      const response=await fetch("/api/platform/ai/feedback",{method:removing?"DELETE":"POST",headers:{"content-type":"application/json","x-juro-csrf":"1","x-juro-workspace-id":workspaceId,"x-juro-locale":locale},body:JSON.stringify({assistantMessageId:messageId,feedbackType:type,...(type!=="helpful"?{comment}: {})})});
      if(!response.ok)throw Error();setRating(removing?"":type);setOpen(false);setStatus("");
      notifyChat(removing?aiText(locale,"Оценка удалена.","Baho olib tashlandi.","Rating removed."):type==="helpful"?aiText(locale,"Спасибо за отзыв.","Fikringiz uchun rahmat.","Thanks for your feedback."):aiText(locale,"Спасибо, что помогаете улучшать JURO.","JUROni yaxshilashga yordam berganingiz uchun rahmat.","Thank you for helping improve JURO."));
    }catch{setStatus(aiText(locale,"Не удалось сохранить отзыв. Попробуйте ещё раз.","Fikrni saqlab bo‘lmadi. Qayta urinib ko‘ring.","Could not save feedback. Please retry."));}finally{setSaving(false);}
  }
  if(!messageId)return null;
  return <div className="ai-answer-footer">
    <div className="ai-message-actions" role="group" aria-label={aiText(locale,"Действия с ответом","Javob amallari","Answer actions")}>
      <CopyMessageButton text={text} locale={locale}/>
      <button className="ai-icon-button" type="button" title={labels.helpful} aria-label={labels.helpful} aria-pressed={rating==="helpful"} disabled={disabled||saving} onClick={()=>void save("helpful")}><ThumbsUp/></button>
      <DialogTrigger isOpen={open} onOpenChange={setOpen}>
        <Button className="ai-icon-button" aria-label={labels.not_helpful} aria-pressed={Boolean(rating&&rating!=="helpful")} isDisabled={disabled||saving}><ThumbsDown/></Button>
        <Popover className="ai-rating-popover" placement="top start" offset={8}>
          <Dialog>{({close})=><form onSubmit={event=>{event.preventDefault();void save(category);}}>
            <header><Heading slot="title">{aiText(locale,"Что можно улучшить?","Nimani yaxshilash mumkin?","What could be better?")}</Heading><button type="button" className="ai-icon-button" aria-label={aiText(locale,"Закрыть","Yopish","Close")} onClick={close}><X/></button></header>
            <div className="ai-rating-options" role="group" aria-label={aiText(locale,"Причина отзыва","Fikr sababi","Feedback reason")}>{(["not_helpful","wrong_norm","incomplete","language"] as const).map(type=><button type="button" key={type} aria-pressed={category===type} onClick={()=>setCategory(type)}>{labels[type]}</button>)}</div>
            <label>{aiText(locale,"Комментарий — необязательно","Izoh — ixtiyoriy","Comment — optional")}<textarea rows={3} maxLength={2000} value={comment} onChange={event=>setComment(event.target.value)}/></label>
            <footer><p role="status">{status}</p><button className="ai-rating-submit" type="submit" disabled={saving}>{saving?aiText(locale,"Сохраняем…","Saqlanmoqda…","Saving…"):aiText(locale,"Отправить отзыв","Fikrni yuborish","Send feedback")}</button></footer>
          </form>}</Dialog>
        </Popover>
      </DialogTrigger>
      <AssistantSpeechControls workspaceId={workspaceId} locale={locale} assistantMessageId={messageId} disabled={disabled} onPhaseChange={onSpeechPhaseChange}/>

    </div>
    {!open&&status&&<p className="ai-action-status" role="alert">{status}</p>}
  </div>;
}
