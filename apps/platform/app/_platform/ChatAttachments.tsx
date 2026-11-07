"use client";
import {useEffect,useRef,useState} from "react";
import {Paperclip,X,FileText} from "lucide-react";
import {uploadDocumentForAnalysis} from "../../lib/document-analysis/client-upload";
import {aiText} from "../../lib/ai/localization";
import type {PlatformLocale} from "../../lib/platform/routing";
const formats:Record<string,string>={pdf:"application/pdf",docx:"application/vnd.openxmlformats-officedocument.wordprocessingml.document",jpg:"image/jpeg",jpeg:"image/jpeg",png:"image/png",txt:"text/plain",html:"text/html",htm:"text/html",json:"application/json"};
type Attachment={key:string;name:string;documentId?:string;error?:string;pending:boolean};
export function ChatAttachments({locale,workspaceId,disabled,onDocuments,onBusy}:{locale:PlatformLocale;workspaceId:string;disabled:boolean;onDocuments:(ids:string[])=>void;onBusy:(busy:boolean)=>void}){
 const [files,setFiles]=useState<Attachment[]>([]),[error,setError]=useState("");const input=useRef<HTMLInputElement>(null),lifetime=useRef<AbortController|null>(null);
 useEffect(()=>{const controller=new AbortController();lifetime.current=controller;return()=>controller.abort();},[]);
 useEffect(()=>{onDocuments(files.flatMap(file=>file.documentId?[file.documentId]:[]));onBusy(files.some(file=>file.pending));},[files,onDocuments,onBusy]);
 const text=(ru:string,uz:string,en:string)=>aiText(locale,ru,uz,en);
 async function attach(selected:FileList|null){if(!selected)return;const controller=lifetime.current;if(!controller)return;setError("");if(files.length+selected.length>12){setError(text("Не более 12 файлов.","Ko‘pi bilan 12 fayl.","Up to 12 files."));return;}
 for(const original of Array.from(selected)){
 const mime=formats[original.name.split('.').pop()?.toLowerCase()||""];if(!mime){setError(text("Этот формат не поддерживается. Архивы не принимаются. Доступны PDF, DOCX, JPG, PNG, TXT, HTML и JSON.","Format mavjud emas. Arxivlar qabul qilinmaydi. PDF, DOCX, JPG, PNG, TXT, HTML va JSON tanlang.","Unsupported format. Archives are not accepted. Choose PDF, DOCX, JPG, PNG, TXT, HTML or JSON."));continue;}
 const key=crypto.randomUUID();setFiles(current=>[...current,{key,name:original.name,pending:true}]);
 try {const uploaded=await uploadDocumentForAnalysis(new File([original],original.name,{type:mime}),locale,undefined,undefined,undefined,workspaceId);if(controller.signal.aborted)return;const deadline=Date.now()+300000;
 while(true){controller.signal.throwIfAborted();if(Date.now()>deadline)throw Error();const response=await fetch(`/api/platform/ai/attachments?analysisId=${encodeURIComponent(uploaded.analysis.id)}`,{signal:controller.signal,headers:{"x-juro-workspace-id":workspaceId}});if(!response.ok)throw Error();const state=await response.json();if(state.status==="completed"&&state.documentId){setFiles(current=>current.map(item=>item.key===key?{...item,pending:false,documentId:state.documentId}:item));break;}if(["failed","rejected","infected","cancelled"].includes(state.status)||state.errorCode)throw Error();await new Promise<void>((resolve,reject)=>{const done=()=>{controller.signal.removeEventListener("abort",abort);resolve();};const timer=setTimeout(done,1500);const abort=()=>{clearTimeout(timer);reject(Error());};controller.signal.addEventListener("abort",abort,{once:true});});}
 }catch{if(!controller.signal.aborted)setFiles(current=>current.map(item=>item.key===key?{...item,pending:false,error:text("Не удалось обработать файл","Faylni qayta ishlab bo‘lmadi","Could not process file")}:item));}
 }
 }
 return <><input ref={input} type="file" multiple accept={Object.keys(formats).map(ext=>'.'+ext).join(',')} hidden onChange={event=>{void attach(event.target.files);event.target.value="";}}/><button className="ai-attach-trigger" type="button" disabled={disabled||files.some(file=>file.pending)} onClick={()=>input.current?.click()} aria-label={text("Прикрепить файл","Fayl biriktirish","Attach file")}><Paperclip/></button>{(files.length>0||error)&&<div className="ai-attachment-list">{files.map(file=><div key={file.key} aria-busy={file.pending}><FileText/><span>{file.name}<small>{file.error||(file.pending?text("Обрабатываем…","Qayta ishlanmoqda…","Processing…"):text("Готово","Tayyor","Ready"))}</small></span><button type="button" disabled={disabled} aria-label={text("Убрать файл","Faylni olib tashlash","Remove file")} onClick={()=>setFiles(current=>current.filter(item=>item.key!==file.key))}><X/></button></div>)}{error&&<p role="alert">{error}</p>}</div>}</>;
}
