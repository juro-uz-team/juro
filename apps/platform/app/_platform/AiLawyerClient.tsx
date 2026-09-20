"use client";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated remote data is hydrated after the first browser render */

import { AudioLines, BookmarkPlus, BookOpenCheck, Bot, CalendarDays, Check, ChevronLeft, ChevronRight, CircleAlert, ExternalLink, FilePlus2, FileQuestion, History, Keyboard, ListPlus, LoaderCircle, Mic, Pencil, Plus, RotateCcw, Send, Settings2, ShieldAlert, Square, ThumbsUp, Trash2, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, KeyboardEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { resolveVoiceModeState, type VoiceModeState, type VoiceRecorderPhase, type VoiceSpeechPhase } from "../../lib/ai/voice-ui";
import { formatPlatformDate, formatPlatformLongDate, formatPlatformMonth } from "../../lib/platform/date-time";
import type { PlatformLocale } from "../../lib/platform/routing";
import { aiText } from "../../lib/ai/localization";
import type { LegalAnswerFailureReason } from "../../lib/ai/legal-answer-failure";
import { uzbekistanCalendarDate } from "../../lib/legal/applicability-date";
import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";
import {readLegalChatStream,shouldReuseLegalChatRequest,LegalChatClientError} from "../../lib/legal-chat/client-stream";
import {chatStageLabel} from "../../lib/legal-chat/stage-label";
import { AiSelect } from "./AiSelect";
import { LegalAnswerView } from "./LegalAnswerView";
import { AssistantSpeechControls, VoiceMessageControls } from "./VoiceMessageControls";

type ProviderStatus = { configured: boolean; provider: string | null; model: string | null; fallbackConfigured: boolean };
type Usage = { used: number; limit: number | null; periodEnd: string };
type SourceFreshness = { status: "fresh" | "stale" | "unavailable"; asOf: string; ageDays: number | null; maxAgeDays: number };
type Conversation = { id: string; title: string; locale: string; status: string; updatedAt: string; lastAnswer: string | null; facts: Fact[] };
type CaseOption = { id: string; title: string; status: string; updatedAt: string };
type Fact = { id: string; statement: string; status: string };
type Source = {
  sourceId: string;
  actTitle: string;
  actIdentifier: string | null;
  article: string | null;
  excerpt?: string | null;
  originalUrl: string;
  status: string;
  effectiveDate: string | null;
  verifiedAt: string;
  documentType?: string | null;
  documentNumber?: string | null;
  adoptingAuthority?: string | null;
  sourceClass?: string;
  language?: "uz-Latn" | "uz-Cyrl" | "ru" | "en";
  sourceOrigin?: "indexed" | "live" | "web";
};
type ArticleDetails = {
  documentTitle: string;
  documentType: string | null;
  documentNumber: string | null;
  adoptingAuthority: string | null;
  sourceClass: string;
  articleNumber: string | null;
  articleTitle: string | null;
  part: string | null;
  chapter: string | null;
  section: string | null;
  text: string | null;
  fullArticle: boolean;
  evidenceUnavailable?: boolean;
  fullDocument?: boolean;
  privateSource?: boolean;
  truncated: boolean;
  language: string;
  status: string;
  validFrom: string | null;
  validTo: string | null;
  versionDate: string | null;
  officialUrl: string;
  verifiedAt: string;
  availableLanguages: Array<{ language: string; officialUrl: string; verifiedAt: string; official: boolean }>;
  versionHistory: Array<{ versionNumber: number; status: string; validFrom: string | null; validTo: string | null; versionDate: string | null; fetchedAt: string }>;
};
type AiPreliminary = {
  kind: "grounded_answer";
  message: string;
  claim: {
    text: string;
    type: "legal_basis" | "action" | "deadline" | "risk" | "fact";
    sourceId: string | null;
    sourceSpanId: string | null;
    confidence: number;
  };
  source: {
    sourceId: string;
    title: string;
    article: string | null;
    paragraph: string | null;
    canonicalUrl: string;
    accessedAt: string;
    contentSha256: string;
  };
};
type LegalResult = {
  failureReason?: LegalAnswerFailureReason;
  responseKind: "answer" | "clarification_required";
  summary: string;
  answer: string;
  clarificationQuestions: string[];
  confirmedFindings: Array<{ title: string; explanation: string; sourceIds?: string[] }>;
  assumptions: Array<{ statement: string; impact: string }>;
  risks: Array<{ level: "low" | "medium" | "high" | "critical"; title: string; explanation: string; sourceIds?: string[] }>;
  sources: Source[];
  requiredDocuments: Array<{ name: string; reason: string; required: boolean }>;
  actionPlan: Array<{ title: string; description: string; sourceIds?: string[] }>;
  deadlines: Array<{ title: string; dueDate: string | null; calculationMethod: string; confidence: string; sourceIds?: string[] }>;
  urgency: "normal" | "high" | "critical";
  suggestedDocument: { templateCode: string | null; title: string; reason: string } | null;
  suggestLawyer: boolean;
  legalDatabaseAsOf: string;
  sourceAccessMode?: "direct" | "approved_package" | "mixed";
  evidenceMode?: "official" | "mixed" | "secondary_only" | "private_only" | "none";
  referenceNotes?: Array<{ title: string; note: string; sourceIds: string[] }>;
  conditionalBranches?: Array<{ condition: string; outcome: string; sourceIds: string[] }>;
  sourcesRetrievedAt?: string | null;
  sourceValidationStatus?: "validated" | "unavailable";
  coverageStatus?: "good_coverage" | "partial_coverage" | "weak_coverage" | "no_coverage";
};
type AiMessageOperation = "new" | "follow_up" | "edit" | "regenerate";
type Branch = { branchId: string; parentBranchId: string | null; requestMessageId: string; responseMessageId: string; operation: AiMessageOperation; versionNumber: number; question: string; createdAt: string };
type ConversationTurn = { branchId: string; requestMessageId: string; responseMessageId: string; question: string; createdAt: string; result: LegalResult|null; answer?:string; sourceFreshness?: SourceFreshness };
type Answer = { conversationId: string; messageId?: string; requestMessageId?: string | null; branchId?: string | null; operation?: AiMessageOperation; question?: string; branches?: Branch[]; turns?: ConversationTurn[]; result: LegalResult; facts: Fact[]; sourceFreshness?: SourceFreshness; usage?: Usage };
type AiRequestPayload = {
  question?: string;
  locale: PlatformLocale;
  answerMode: "short" | "detailed";
  reasoningMode: "fast" | "deep";
  conversationId?: string;
  operation: AiMessageOperation;
  sourceMessageId?: string;
  voiceRecordingId?: string;
  legalContextDate?: string;
};
type AiFeedbackType = "helpful" | "not_helpful" | "wrong_norm" | "broken_link" | "outdated" | "incomplete" | "language" | "unsafe" | "ignored_facts";
type AiFeedback = { feedbackType: AiFeedbackType; comment: string | null; updatedAt: string };
type DocumentPrefillCandidate = { fieldId: string; label: string; value: string; source: "profile" | "workspace" | "ai_answer"; sensitive: boolean };
type DocumentPrefillPreview = { templateCode: string; categorySlug: string; title: string; reason: string; caseId: string | null; candidates: DocumentPrefillCandidate[] };
const feedbackOptions: AiFeedbackType[] = ["wrong_norm", "incomplete", "language", "not_helpful"];

export function AiLawyerClient({ locale }: { locale: PlatformLocale }) {
  const router=useRouter(),pathname=usePathname(),params=useSearchParams();
  const basePath=usePlatformBasePath(),workspaceId=usePlatformWorkspaceId();
  const text=useCallback((ru:string,uz:string,en:string)=>aiText(locale,ru,uz,en),[locale]);
  const [status,setStatus]=useState<ProviderStatus|null>(null),[usage,setUsage]=useState<Usage|null>(null);
  const [conversations,setConversations]=useState<Conversation[]>([]),[cases,setCases]=useState<CaseOption[]>([]);
  const [answer,setAnswer]=useState<Answer|null>(null),[question,setQuestion]=useState("");
  const [citationContext,setCitationContext]=useState<{messageId:string;result:LegalResult}|null>(null);
  const [requestSending,setSending]=useState(false),[error,setError]=useState(""),[streamStatus,setStreamStatus]=useState("");
  const [loadingConversation,setLoadingConversation]=useState(false);
  const sending=requestSending||loadingConversation;
  const [historyCursor,setHistoryCursor]=useState<{before:string;beforeId:string}|null>(null),[loadingHistory,setLoadingHistory]=useState(false);
  const activeScope=useRef(workspaceId),currentMessage=useRef<string|undefined>(undefined),currentSelection=useRef("");
  const [optimisticQuestion,setOptimisticQuestion]=useState(""),[canRetry,setCanRetry]=useState(false);
  const [answerMode,setAnswerMode]=useState<"short"|"detailed">("detailed"),[reasoningMode,setReasoningMode]=useState<"fast"|"deep">("fast");
  const [legalContextDate,setLegalContextDate]=useState(""),[editSourceMessageId,setEditSourceMessageId]=useState("");
  const [voiceMode,setVoiceMode]=useState(false),[voiceRecordingId,setVoiceRecordingId]=useState("");
  const [voiceRecorderPhase,setVoiceRecorderPhase]=useState<VoiceRecorderPhase>("idle"),[voiceSpeechPhase,setVoiceSpeechPhase]=useState<VoiceSpeechPhase>("idle");
  const [historyCollapsed,setHistoryCollapsed]=useState(false),[evidenceCollapsed,setEvidenceCollapsed]=useState(false);
  const [mobileContextOpen,setMobileContextOpen]=useState(false),[mobileContextTab,setMobileContextTab]=useState<"facts"|"sources">("sources");
  const [deleteCandidateId,setDeleteCandidateId]=useState(""),[deletingConversationId,setDeletingConversationId]=useState(""),[conversationDeleteError,setConversationDeleteError]=useState("");
  const [dismissedPlanMessageId,setDismissedPlanMessageId]=useState(""),[planEditorOpen,setPlanEditorOpen]=useState(false);
  const [targetCaseId,setTargetCaseId]=useState(""),[savingPlan,setSavingPlan]=useState(false),[planConfirmationOpen,setPlanConfirmationOpen]=useState(false);
  const [openingSuggestedDocument,setOpeningSuggestedDocument]=useState(false),[creatingSuggestedDocument,setCreatingSuggestedDocument]=useState(false);
  const [documentPrefill,setDocumentPrefill]=useState<DocumentPrefillPreview|null>(null),[documentPrefillMessageId,setDocumentPrefillMessageId]=useState("");
  const [sensitivePrefillConsent,setSensitivePrefillConsent]=useState(false);
  const [feedback,setFeedback]=useState<AiFeedback[]>([]),[savingFeedback,setSavingFeedback]=useState(false),[feedbackStatus,setFeedbackStatus]=useState("");
  const [feedbackType,setFeedbackType]=useState<AiFeedbackType>("incomplete"),[feedbackComment,setFeedbackComment]=useState("");
  const composerRef=useRef<HTMLTextAreaElement>(null),transcriptRef=useRef<HTMLDivElement>(null),latestAnswerRef=useRef<HTMLDivElement>(null);
  const mobileContextRef=useRef<HTMLElement>(null),mobileFactsTabRef=useRef<HTMLButtonElement>(null),mobileSourcesTabRef=useRef<HTMLButtonElement>(null);
  const planConfirmationRef=useRef<HTMLDivElement>(null),streamAbortRef=useRef<AbortController|null>(null);
  const retryRef=useRef<(AiRequestPayload&{idempotencyKey:string})|null>(null),nearBottom=useRef(true);
  const handoffKey=useRef(crypto.randomUUID()),handoffGeneration=useRef(0);
  const selectedConversationId=params.get("conversationId")??"",selectedBranchId=params.get("branchId")??"";
  useLayoutEffect(()=>{activeScope.current=workspaceId;currentMessage.current=answer?.messageId;currentSelection.current=selectedConversationId;},[workspaceId,answer?.messageId,selectedConversationId]);
  useLayoutEffect(()=>{const invalidate=()=>{handoffGeneration.current++;};invalidate();handoffKey.current=crypto.randomUUID();setOpeningSuggestedDocument(false);setCreatingSuggestedDocument(false);return invalidate;},[workspaceId,selectedConversationId,selectedBranchId,answer?.messageId]);
  const preliminary:AiPreliminary|null=null;
  const aiLocation=(query:URLSearchParams)=>`${pathname}${query.size?`?${query}`:""}`;
  const requestJson=useCallback(async<T,>(url:string,options:RequestInit={}):Promise<T>=>{
    const headers=new Headers(options.headers);headers.set("x-juro-workspace-id",workspaceId);headers.set("x-juro-locale",locale);
    if(options.method&&options.method!=="GET"){headers.set("content-type","application/json");headers.set("x-juro-csrf","1");}
    const response=await fetch(url,{...options,headers,cache:"no-store"});
    if(!response.ok)throw new Error(text("Не удалось выполнить действие. Повторите попытку.","Amal bajarilmadi. Qayta urinib ko‘ring.","The action could not be completed. Please retry."));
    return await response.json() as T;
  },[workspaceId,locale,text]);
  const refresh=useCallback(async(signal?:AbortSignal)=>{
    const scope=workspaceId;
    const data=await requestJson<{provider:ProviderStatus;usage:Usage;conversations:Conversation[];cases:CaseOption[];next:{before:string;beforeId:string}|null}>("/api/platform/ai",{signal});
    if(signal?.aborted||activeScope.current!==scope)return;setStatus(data.provider);setUsage(data.usage);setConversations(data.conversations);setCases(data.cases??[]);setHistoryCursor(data.next);
  },[requestJson,workspaceId]);
  async function loadMoreHistory(){
    if(!historyCursor||loadingHistory)return;const scope=workspaceId;setLoadingHistory(true);
    try {const data=await requestJson<{conversations:Conversation[];next:{before:string;beforeId:string}|null}>(`/api/platform/ai?${new URLSearchParams(historyCursor)}`);
      if(activeScope.current!==scope)return;setConversations(current=>[...current,...data.conversations.filter(item=>!current.some(existing=>existing.id===item.id))]);setHistoryCursor(data.next);
    }catch(cause){if(activeScope.current===scope)setConversationDeleteError(String(cause instanceof Error?cause.message:cause));}
    finally{if(activeScope.current===scope)setLoadingHistory(false);}
  }
  const loadAnswer=useCallback(async(conversationId:string,branchId?:string,signal?:AbortSignal)=>{
    const query=new URLSearchParams({conversationId});if(branchId)query.set("branchId",branchId);
    const saved=await requestJson<Answer>(`/api/platform/ai?${query}`,{signal});
    if(signal?.aborted)return;setAnswer(saved);setOptimisticQuestion("");
    const data=await requestJson<{feedback:AiFeedback[]}>(`/api/platform/ai/feedback?${new URLSearchParams({assistantMessageId:saved.messageId??""})}`,{signal}).catch(()=>({feedback:[]}));
    if(!signal?.aborted)setFeedback(data.feedback);
  },[requestJson]);
  useEffect(()=>{const controller=new AbortController();void refresh(controller.signal).catch(()=>{if(!controller.signal.aborted)setError(text("Чат временно недоступен.","Suhbat vaqtincha mavjud emas.","Chat is temporarily unavailable."));});return()=>controller.abort();},[refresh,text]);
  useEffect(()=>{const controller=new AbortController();const running=streamAbortRef.current;streamAbortRef.current=null;running?.abort();setSending(false);setError("");setCanRetry(false);retryRef.current=null;setAnswer(null);setQuestion("");setEditSourceMessageId("");setOptimisticQuestion("");setFeedback([]);setFeedbackStatus("");setDocumentPrefill(null);setCitationContext(null);setLoadingConversation(Boolean(selectedConversationId));
    if(selectedConversationId)void loadAnswer(selectedConversationId,selectedBranchId||undefined,controller.signal).catch(()=>{if(!controller.signal.aborted)setError(text("Диалог недоступен.","Suhbat mavjud emas.","Conversation unavailable."));}).finally(()=>{if(!controller.signal.aborted)setLoadingConversation(false);});
    else setAnswer(null);return()=>controller.abort();
  },[selectedConversationId,selectedBranchId,loadAnswer,text]);
  useEffect(()=>()=>{const running=streamAbortRef.current;streamAbortRef.current=null;running?.abort();},[]);
  useEffect(()=>{if(nearBottom.current)transcriptRef.current?.scrollTo({top:transcriptRef.current.scrollHeight,behavior:"smooth"});},[answer,optimisticQuestion,streamStatus]);
  useEffect(()=>{if(planConfirmationOpen)planConfirmationRef.current?.focus();},[planConfirmationOpen]);
  useEffect(()=>{if(!mobileContextOpen)return;const onKey=(event:globalThis.KeyboardEvent)=>{if(event.key==="Escape")setMobileContextOpen(false);};document.addEventListener("keydown",onKey);mobileSourcesTabRef.current?.focus();return()=>document.removeEventListener("keydown",onKey);},[mobileContextOpen]);
  async function send(payload:AiRequestPayload&{idempotencyKey:string}){
    if(streamAbortRef.current)return;const controller=new AbortController();streamAbortRef.current=controller;retryRef.current=payload;
    setSending(true);setCanRetry(false);setError("");setOptimisticQuestion(payload.question||answer?.question||"");
    try {
      const response=await fetch("/api/platform/ai",{method:"POST",headers:{"content-type":"application/json",accept:"text/event-stream","x-juro-csrf":"1","x-juro-locale":locale,"x-juro-workspace-id":workspaceId},body:JSON.stringify(payload),signal:controller.signal});
      const saved=await readLegalChatStream(response,stage=>{if(streamAbortRef.current===controller)setStreamStatus(chatStageLabel(stage,locale));});
      if(controller.signal.aborted)return;
      if(!saved.conversationId)throw new Error("Missing saved conversation");
      setQuestion("");setEditSourceMessageId("");setVoiceRecordingId("");retryRef.current=null;setOptimisticQuestion("");
      await loadAnswer(saved.conversationId,saved.branchId,controller.signal);await refresh(controller.signal);
      router.replace(aiLocation(new URLSearchParams({conversationId:saved.conversationId,...(saved.branchId?{branchId:saved.branchId}:{})})),{scroll:false});
    } catch(cause){
      if(streamAbortRef.current!==controller)return;
      retryRef.current=shouldReuseLegalChatRequest(cause)?payload:{...payload,idempotencyKey:crypto.randomUUID()};
      const retryable=controller.signal.aborted||!(cause instanceof LegalChatClientError)||cause.retryable;
      setCanRetry(retryable);if(!retryable)retryRef.current=null;
      setError(cause instanceof LegalChatClientError&&cause.code==="LEGAL_CONTEXT_CAPACITY_EXCEEDED"?text("Объём переписки или сохранённого контекста слишком велик. Начните новый чат или сократите сохранённые факты и память.","Suhbat yoki saqlangan kontekst hajmi juda katta. Yangi chat boshlang yoki saqlangan faktlar va xotirani qisqartiring.","The conversation or saved context is too large. Start a new chat or reduce saved facts and memory."):!retryable?text("Запрос нельзя повторить без изменений. Проверьте данные запроса и доступный лимит.","So‘rovni o‘zgartirmasdan qayta yuborib bo‘lmaydi. So‘rov ma’lumotlari va mavjud limitni tekshiring.","This request needs changes before it can be submitted again. Check your request and available allowance."):controller.signal.aborted?text("Запрос остановлен. Можно проверить сохранённый результат повтором.","So‘rov to‘xtatildi. Qayta urinish orqali saqlangan natijani tekshirish mumkin.","Request stopped. Retry to check for a saved result."):text("Не удалось завершить запрос. Можно безопасно повторить.","So‘rov yakunlanmadi. Xavfsiz qayta urinishingiz mumkin.","The request did not finish. You can retry safely."));
    } finally {if(streamAbortRef.current===controller){streamAbortRef.current=null;setSending(false);setStreamStatus("");}}
  }
  function submit(event:FormEvent){event.preventDefault();if(!question.trim()||sending||(selectedConversationId&&!answer))return;void send({question,locale,answerMode,reasoningMode,conversationId:answer?.conversationId,
    operation:editSourceMessageId?"edit":answer?"follow_up":"new",sourceMessageId:editSourceMessageId||answer?.messageId,
    legalContextDate:legalContextDate||undefined,...(voiceRecordingId?{voiceRecordingId}:{}),idempotencyKey:crypto.randomUUID()});}
  const retryQuestion=()=>{if(retryRef.current)void send(retryRef.current);};
  const regenerateAnswer=()=>{if(answer?.messageId)void send({locale,answerMode,reasoningMode,conversationId:answer.conversationId,sourceMessageId:answer.messageId,operation:"regenerate",legalContextDate:legalContextDate||undefined,idempotencyKey:crypto.randomUUID()});};
  const editQuestion=()=>{if(answer?.requestMessageId){setEditSourceMessageId(answer.requestMessageId);setQuestion(answer.question??"");composerRef.current?.focus();}};
  const cancelQuestionEdit=()=>{setEditSourceMessageId("");setQuestion("");};
  const startNewQuestion=()=>{const running=streamAbortRef.current;streamAbortRef.current=null;running?.abort();setSending(false);setLoadingConversation(false);setAnswer(null);setQuestion("");setEditSourceMessageId("");setOptimisticQuestion("");setError("");setCanRetry(false);retryRef.current=null;router.push(aiLocation(new URLSearchParams()));};
  const changeQuestion=(event:React.ChangeEvent<HTMLTextAreaElement>)=>{setQuestion(event.target.value);resizeComposer(event.target);};
  const handleComposerKeyDown=(event:KeyboardEvent<HTMLTextAreaElement>)=>{if(event.key==="Enter"&&!event.shiftKey&&!event.nativeEvent.isComposing){event.preventDefault();event.currentTarget.form?.requestSubmit();}};
  const selectFollowUpQuestion=(value:string)=>{setQuestion(value);composerRef.current?.focus();};
  const changeLegalContextDate=(value:string)=>setLegalContextDate(value);
  const acceptVoiceTranscript=({recordingId,transcript}:{recordingId:string;transcript:string})=>{setVoiceRecordingId(recordingId);setQuestion(transcript);composerRef.current?.focus();};
  const setComposerMode=(mode:"text"|"voice")=>setVoiceMode(mode==="voice");
  const trackTranscriptScroll=()=>{const element=transcriptRef.current;if(element)nearBottom.current=element.scrollHeight-element.scrollTop-element.clientHeight<100;};
  const toggleHistory=()=>setHistoryCollapsed(value=>!value),toggleEvidencePanel=()=>{if(window.matchMedia("(max-width: 1380px)").matches)setMobileContextOpen(value=>!value);else setEvidenceCollapsed(value=>!value);};
  const openMobileContext=(tab:"facts"|"sources")=>{setMobileContextTab(tab);setMobileContextOpen(true);},closeMobileContext=()=>{setMobileContextOpen(false);composerRef.current?.focus();};
  const handleMobileContextTabKeyDown=(event:KeyboardEvent<HTMLButtonElement>)=>{if(["ArrowLeft","ArrowRight","Home","End"].includes(event.key)){event.preventDefault();const tab=event.key==="Home"?"facts":event.key==="End"?"sources":mobileContextTab==="facts"?"sources":"facts";setMobileContextTab(tab);(tab==="facts"?mobileFactsTabRef:mobileSourcesTabRef).current?.focus();}};
  const revealCitation=(sourceId:string,turn?:ConversationTurn)=>{setCitationContext(turn?.result?{messageId:turn.responseMessageId,result:turn.result}:null);setEvidenceCollapsed(false);setMobileContextTab("sources");if(window.matchMedia("(max-width: 1380px)").matches)setMobileContextOpen(true);requestAnimationFrame(()=>focusSourceCard(sourceId));};
  const toggleConversationDeletion=(id:string)=>setDeleteCandidateId(current=>current===id?"":id);
  async function deleteConversation(id:string){const scope=workspaceId;setDeletingConversationId(id);setConversationDeleteError("");try{await requestJson("/api/platform/ai",{method:"DELETE",body:JSON.stringify({conversationId:id})});if(activeScope.current!==scope)return;if(currentSelection.current===id)startNewQuestion();setDeleteCandidateId("");await refresh();}catch(cause){if(activeScope.current===scope)setConversationDeleteError(String(cause instanceof Error?cause.message:cause));}finally{if(activeScope.current===scope)setDeletingConversationId("");}}
  async function updateFact(factId:string,status:"confirmed"|"rejected"){try{await requestJson("/api/platform/ai/facts",{method:"POST",body:JSON.stringify({factId,status})});setAnswer(current=>current?{...current,facts:current.facts.map(fact=>fact.id===factId?{...fact,status}:fact)}:current);}catch(cause){setError(String(cause instanceof Error?cause.message:cause));}}
  async function saveFeedback(feedbackType:AiFeedbackType,comment?:string){if(!answer?.messageId||savingFeedback)return;const messageId=answer.messageId;setSavingFeedback(true);try{await requestJson("/api/platform/ai/feedback",{method:"POST",body:JSON.stringify({assistantMessageId: answer.messageId,feedbackType,comment})});const data=await requestJson<{feedback:AiFeedback[]}>(`/api/platform/ai/feedback?${new URLSearchParams({assistantMessageId:answer.messageId})}`);if(currentMessage.current!==messageId)return;setFeedback(data.feedback);setFeedbackStatus(text("Отзыв сохранён.","Fikr saqlandi.","Feedback saved."));}catch(cause){if(currentMessage.current===messageId)setFeedbackStatus(String(cause instanceof Error?cause.message:cause));}finally{setSavingFeedback(false);}}
  const feedbackLabel=(value:AiFeedbackType)=>({helpful:text("Полезно","Foydali","Helpful"),not_helpful:text("Не полезно","Foydasiz","Not helpful"),wrong_norm:text("Неверная норма","Noto‘g‘ri norma","Wrong legal rule"),broken_link:text("Ссылка не работает","Havola ishlamaydi","Broken link"),outdated:text("Устарело","Eskirgan","Outdated"),incomplete:text("Неполно","To‘liq emas","Incomplete"),language:text("Язык","Til","Language"),unsafe:text("Небезопасно","Xavfli","Unsafe"),ignored_facts:text("Факты не учтены","Faktlar hisobga olinmagan","Facts ignored")}[value]);
  async function savePlanToCase(){if(!answer?.messageId||savingPlan)return;setSavingPlan(true);try{const saved=await requestJson<{caseId:string}>("/api/platform/ai/action-plan",{method:"POST",headers:{"idempotency-key":`plan-${answer.messageId}-${targetCaseId||"new"}`},body:JSON.stringify({assistantMessageId:answer.messageId,targetCaseId:targetCaseId||undefined,locale})});setPlanConfirmationOpen(false);router.push(`${basePath}/cases/${encodeURIComponent(saved.caseId)}`);}catch(cause){setError(String(cause instanceof Error?cause.message:cause));}finally{setSavingPlan(false);}}
  function dismissDocumentPrefill(){handoffGeneration.current++;setOpeningSuggestedDocument(false);setCreatingSuggestedDocument(false);setDocumentPrefill(null);setDocumentPrefillMessageId("");setSensitivePrefillConsent(false);handoffKey.current=crypto.randomUUID();}
  async function openSuggestedDocument(){
    if(!answer?.messageId||openingSuggestedDocument)return;
    const generation=handoffGeneration.current,messageId=answer.messageId;
    setOpeningSuggestedDocument(true);
    try{
      const preview=await requestJson<DocumentPrefillPreview>("/api/platform/ai/suggested-document",{method:"POST",body:JSON.stringify({action:"preview",assistantMessageId:messageId,locale})});
      if(handoffGeneration.current!==generation)return;
      setDocumentPrefill(preview);setDocumentPrefillMessageId(messageId);setSensitivePrefillConsent(false);
    }catch(cause){if(handoffGeneration.current===generation)setError(String(cause instanceof Error?cause.message:cause));}
    finally{if(handoffGeneration.current===generation)setOpeningSuggestedDocument(false);}
  }
  const updateDocumentPrefillField=(id:string,value:string)=>setDocumentPrefill(current=>current?{...current,candidates:current.candidates.map(field=>field.fieldId===id?{...field,value}:field)}:current);
  const removeDocumentPrefillField=(id:string)=>setDocumentPrefill(current=>current?{...current,candidates:current.candidates.filter(field=>field.fieldId!==id)}:current);
  async function confirmSuggestedDocument(){
    if(!documentPrefill||!answer?.messageId||documentPrefillMessageId!==answer.messageId||creatingSuggestedDocument)return;
    const generation=handoffGeneration.current;
    setCreatingSuggestedDocument(true);
    try{
      const saved=await requestJson<{documentId:string}>("/api/platform/ai/suggested-document",{method:"POST",headers:{"idempotency-key":handoffKey.current},body:JSON.stringify({action:"confirm",assistantMessageId:answer.messageId,locale,fields:documentPrefill.candidates.map(({fieldId,value})=>({fieldId,value})),sensitiveDataConsent:sensitivePrefillConsent})});
      if(handoffGeneration.current!==generation)return;
      dismissDocumentPrefill();router.push(`${basePath}/documents/${encodeURIComponent(saved.documentId)}`);
    }catch(cause){if(handoffGeneration.current===generation)setError(String(cause instanceof Error?cause.message:cause));}
    finally{if(handoffGeneration.current===generation)setCreatingSuggestedDocument(false);}
  }
  const sourceResult=citationContext?.result??answer?.result;
  const sourceMessageId=citationContext?.messageId??answer?.messageId;
  const visibleSources=(sourceResult?.sources??[]).filter(source=>isTrustedPrivateSource(source)||isSafeSecondarySource(source)||safeOfficialUrl(source.originalUrl));
  const hasCaseFacts=Boolean(answer?.facts.length),hasAnswerContext=hasCaseFacts||visibleSources.length>0;
  const hasPrivateSources=visibleSources.some(isTrustedPrivateSource),hasSecondarySources=visibleSources.some(isSafeSecondarySource);
  const sourceWasUnavailable=answer?.result.sourceValidationStatus==="unavailable";

  return (
    <section className={`ai-workspace ${voiceMode ? "ai-workspace-voice" : ""} ${historyCollapsed ? "ai-history-collapsed" : ""} ${evidenceCollapsed ? "ai-evidence-collapsed" : ""}`}>
      <aside className="ai-conversations" id="ai-conversations-panel" aria-label={text("История диалогов", "Suhbatlar tarixi", "Conversation history")}>
        <header><Bot /><div><small>JURO</small><strong>{text("Диалоги", "Suhbatlar", "Conversations")}</strong></div></header>
        <button className="ai-new" onClick={startNewQuestion}><Plus />{text("Новый вопрос", "Yangi savol", "New question")}</button>
        <nav className="ai-conversation-list" aria-label={text("История диалогов", "Suhbatlar tarixi", "Conversation history")}>
          {conversationDeleteError && <p className="ai-conversation-delete-error" role="alert">{conversationDeleteError}</p>}
          {conversations.length ? conversations.map((item) => <div className="ai-conversation-item" key={item.id}>
            <a aria-current={item.id === selectedConversationId ? "page" : undefined} href={aiLocation(new URLSearchParams({ conversationId: item.id }))}><span className="ai-conversation-marker" aria-hidden="true" /><strong>{item.title}</strong><small>{formatDate(item.updatedAt, locale)}</small></a>
            <button className="ai-conversation-delete" type="button" disabled={sending || Boolean(deletingConversationId)} aria-expanded={deleteCandidateId === item.id} aria-label={text(`Удалить диалог «${item.title}»`, `“${item.title}” suhbatini o‘chirish`, `Delete conversation “${item.title}”`)} title={text("Удалить диалог", "Suhbatni o‘chirish", "Delete conversation")} onClick={() => toggleConversationDeletion(item.id)}><Trash2 /></button>
            {deleteCandidateId === item.id && <div className="ai-conversation-delete-confirm" role="group" aria-label={text("Подтверждение удаления", "O‘chirishni tasdiqlash", "Confirm deletion")}><span>{text("Удалить без возможности восстановления?", "Tiklash imkoniyatisiz o‘chirilsinmi?", "Permanently delete this conversation?")}</span><button type="button" disabled={Boolean(deletingConversationId)} onClick={() => setDeleteCandidateId("")}>{text("Отмена", "Bekor qilish", "Cancel")}</button><button className="is-danger" type="button" disabled={Boolean(deletingConversationId)} onClick={() => void deleteConversation(item.id)}>{deletingConversationId === item.id ? text("Удаляем…", "O‘chirilmoqda…", "Deleting…") : text("Удалить", "O‘chirish", "Delete")}</button></div>}
          </div>) : <p>{text("История появится после первого обработанного вопроса.", "Tarix birinchi qayta ishlangan savoldan keyin paydo bo‘ladi.", "Your history will appear after the first completed question.")}</p>}
          {historyCursor&&<button type="button" disabled={loadingHistory} onClick={()=>void loadMoreHistory()}>{loadingHistory?text("Загружаем…","Yuklanmoqda…","Loading…"):text("Ещё диалоги","Yana suhbatlar","More conversations")}</button>}
        </nav>
      </aside>
      <section className="ai-dialog" aria-labelledby="ai-lawyer-heading">
        <header><span><Bot /></span><div><h1 id="ai-lawyer-heading">{text("AI-юрист JURO", "JURO AI-yuristi", "JURO AI Lawyer")}</h1><p>{status?.configured ? (usage?.limit === null
          ? text(`Право Узбекистана · безлимитно (локально) · ${usage.used} ответов`, `O‘zbekiston huquqi · lokal cheklanmagan · ${usage.used} javob`, `Law of Uzbekistan · unlimited locally · ${usage.used} answers`)
          : text(`Право Узбекистана · ${usage?.used ?? 0} из ${usage?.limit ?? 20} ответов`, `O‘zbekiston huquqi · ${usage?.used ?? 0}/${usage?.limit ?? 20} javob`, `Law of Uzbekistan · ${usage?.used ?? 0} of ${usage?.limit ?? 20} answers`)) : text("Провайдер не подключён", "Provayder ulanmagan", "Provider not connected")}</p></div><div className="ai-panel-controls"><button type="button" aria-controls="ai-conversations-panel" aria-expanded={!historyCollapsed} onClick={toggleHistory}><History aria-hidden="true" /><span>{text("История", "Tarix", "History")}</span></button><button type="button" aria-controls="ai-context-panel" aria-expanded={mobileContextOpen || !evidenceCollapsed} onClick={toggleEvidencePanel}><BookOpenCheck aria-hidden="true" /><span>{text("Источники", "Manbalar", "Sources")}</span></button></div><nav className="ai-composer-mode" aria-label={text("Способ общения", "Muloqot usuli", "Interaction mode")}><button type="button" aria-pressed={!voiceMode} onClick={() => setComposerMode("text")}><Keyboard />{text("Текст", "Matn", "Text")}</button><button type="button" aria-pressed={voiceMode} onClick={() => setComposerMode("voice")}><Mic />{text("Голос", "Ovoz", "Voice")}</button></nav></header>
        {voiceMode && <VoiceModeStage
          locale={locale}
          configured={Boolean(status?.configured)}
          answerReady={Boolean(answer)}
          sending={sending}
          recorderPhase={voiceRecorderPhase}
          speechPhase={voiceSpeechPhase}
        />}
        {!status?.configured && <div className="ai-unavailable" role="status"><ShieldAlert /><div><strong>{text("AI пока недоступен", "AI hozircha ishlamaydi", "AI is currently unavailable")}</strong><p>{text("Сервер не подтвердил ключ AI-провайдера. JURO не имитирует ответ и не показывает ложный success.", "Server AI-provayder kalitini tasdiqlamadi. JURO javobni taqlid qilmaydi va soxta muvaffaqiyatni ko‘rsatmaydi.", "The server could not verify the AI provider configuration. JURO will not simulate an answer or report a false success.")}</p></div></div>}
        {error && <div className="ai-error" role="alert"><CircleAlert /><div><p>{error}</p>{canRetry && <button type="button" disabled={sending} onClick={retryQuestion}>{text("Безопасно повторить запрос", "So‘rovni xavfsiz qaytarish", "Retry safely")}</button>}</div></div>}
        <p className="sr-only" role="status" aria-live="polite">{sending ? streamStatus : answer?.messageId ? text("Проверенный ответ готов", "Tekshirilgan javob tayyor", "Verified answer ready") : ""}</p>
        <div className="ai-answer-stream" ref={transcriptRef} role="log" aria-label={text("Юридический диалог", "Huquqiy suhbat", "Legal conversation")} aria-busy={sending} onScroll={trackTranscriptScroll}>
          {!answer && !optimisticQuestion ? (
            <div className="ai-start"><FileQuestion /><h2>{text("Опишите юридическую ситуацию", "Yuridik vaziyatni yozing", "Describe your legal situation")}</h2><p>{text("Не указывайте лишние персональные данные. JURO отделит подтверждённые нормы от предположений.", "Ortiqcha shaxsiy ma’lumotlarni yozmang. JURO tasdiqlangan normalarni taxminlardan ajratadi.", "Avoid unnecessary personal data. JURO separates verified law from assumptions.")}</p></div>
          ) : <>
            {answer && <>
            <div className="ai-transcript">
              {(answer.turns ?? []).filter((turn) => turn.responseMessageId !== answer.messageId).map((turn) => <ConversationTurnPair key={turn.branchId} turn={turn} locale={locale} onCitationSelect={sourceId=>revealCitation(sourceId,turn)} />)}
              <HumanMessage question={answer.question || answer.turns?.at(-1)?.question || ""} locale={locale} />
              <div className="ai-current-answer" data-message-id={answer.messageId} data-request-message-id={answer.requestMessageId} ref={latestAnswerRef}><LegalAnswer result={answer.result} freshness={answer.sourceFreshness} locale={locale} onCitationSelect={revealCitation} onQuestionSelect={selectFollowUpQuestion} /></div>
            </div>
            {answer.result.responseKind === "answer" && answer.result.actionPlan.length > 0 && dismissedPlanMessageId !== answer.messageId && <section className="ai-plan-card" aria-labelledby="ai-plan-card-title">
              <header><small>{text("После ответа AI", "AI javobidan so‘ng", "After the AI answer")}</small><h2 id="ai-plan-card-title">{text("Создать план действий", "Harakatlar rejasini yaratish", "Create an action plan")}</h2></header>
              <p>{text("Сохраните следующие шаги из ответа как задачи в новом или существующем деле.", "Javobdagi keyingi qadamlarni yangi yoki mavjud ishda vazifalar sifatida saqlang.", "Save the next steps from this answer as tasks in a new or existing matter.")}</p>
              {planEditorOpen && <div className="ai-plan-destination"><label htmlFor="ai-plan-case">{text("Куда добавить план", "Rejani qayerga qo‘shish", "Where to add the plan")}</label><AiSelect id="ai-plan-case" value={targetCaseId} disabled={savingPlan} onChange={setTargetCaseId} options={[{ value: "", label: text("Новое дело", "Yangi ish", "New matter") }, ...cases.map((item) => ({ value: item.id, label: item.title }))]} /></div>}
              {!planConfirmationOpen ? <footer><button type="button" disabled={!answer.messageId || sending || savingPlan} onClick={() => setPlanConfirmationOpen(true)}><ListPlus />{targetCaseId ? text("Создать в выбранном деле", "Tanlangan ishda yaratish", "Create in selected matter") : text("Создать план", "Reja yaratish", "Create plan")}</button><button type="button" className="secondary" disabled={savingPlan} onClick={() => setPlanEditorOpen((current) => !current)}>{text("Изменить", "O‘zgartirish", "Change")}</button><button type="button" className="quiet" disabled={savingPlan} onClick={() => setDismissedPlanMessageId(answer.messageId || "")}>{text("Не предлагать", "Taklif qilmaslik", "Dismiss")}</button></footer> : <div className="ai-plan-confirmation" ref={planConfirmationRef} tabIndex={-1} role="group" aria-label={text("Подтверждение сохранения плана", "Rejani saqlashni tasdiqlash", "Confirm plan save")}>
                <p>{targetCaseId
                  ? text(`Добавить задачи в дело «${cases.find((item) => item.id === targetCaseId)?.title ?? "Выбранное дело"}»?`, `Vazifalar “${cases.find((item) => item.id === targetCaseId)?.title ?? "Tanlangan ish"}” ishiga qo‘shilsinmi?`, `Add these tasks to “${cases.find((item) => item.id === targetCaseId)?.title ?? "Selected matter"}”?`)
                  : text("Создать новое дело и задачи по этому плану?", "Bu reja bo‘yicha yangi ish va vazifalar yaratiladimi?", "Create a new matter and tasks from this plan?")}</p>
                <div><button type="button" className="secondary" disabled={savingPlan} onClick={() => setPlanConfirmationOpen(false)}>{text("Отмена", "Bekor qilish", "Cancel")}</button><button type="button" disabled={savingPlan} aria-busy={savingPlan} onClick={() => void savePlanToCase()}>{savingPlan ? <LoaderCircle className="spin" /> : <ListPlus />}{savingPlan ? text("Сохраняем…", "Saqlanmoqda…", "Saving…") : text("Подтвердить и сохранить", "Tasdiqlash va saqlash", "Confirm and save")}</button></div>
              </div>}
            </section>}
            <div className="ai-answer-actions">
              {answer.result.responseKind === "answer" && answer.result.suggestedDocument && <button type="button" disabled={!answer.messageId || sending || openingSuggestedDocument} onClick={() => void openSuggestedDocument()}><FilePlus2 />{openingSuggestedDocument ? text("Проверяем шаблон…", "Shablon tekshirilmoqda…", "Verifying template…") : text("Открыть шаблон JURO", "JURO shablonini ochish", "Open JURO template")}</button>}
              <button type="button" disabled={!answer.requestMessageId || sending} onClick={editQuestion}><Pencil />{text("Редактировать вопрос", "Savolni tahrirlash", "Edit question")}</button>
              <button type="button" disabled={!answer.messageId || sending || !status?.configured} onClick={regenerateAnswer}><RotateCcw />{sourceWasUnavailable ? text("Повторить поиск источников", "Manbalarni qayta qidirish", "Retry source search") : text("Повторить ответ", "Javobni qayta yaratish", "Regenerate answer")}</button>
              {answer.messageId && answer.result.responseKind === "answer" && <AssistantSpeechControls locale={locale} assistantMessageId={answer.messageId} disabled={sending} onPhaseChange={setVoiceSpeechPhase} />}
            </div>
            {documentPrefill && documentPrefillMessageId === answer.messageId && <section className="ai-document-prefill" aria-labelledby="ai-document-prefill-title" aria-busy={creatingSuggestedDocument}>
              <header><div><small>{text("Проверка перед созданием", "Yaratishdan oldin tekshirish", "Review before creation")}</small><h2 id="ai-document-prefill-title">{documentPrefill.title}</h2><p>{documentPrefill.reason}</p></div><button type="button" aria-label={text("Закрыть проверку заполнения", "To‘ldirish tekshiruvini yopish", "Close prefill review")} disabled={creatingSuggestedDocument} onClick={dismissDocumentPrefill}><X /></button></header>
              <p className="ai-document-prefill-note">{text(
                "JURO предлагает только данные из вашего профиля, workspace и сохранённого AI-ответа. Проверьте роль каждой стороны: можно исправить или удалить любое поле. Данные не помещаются в URL.",
                "JURO faqat profilingiz, workspace va saqlangan AI javobidagi ma’lumotlarni taklif qiladi. Har bir taraf rolini tekshiring: istalgan maydonni tuzatish yoki olib tashlash mumkin. Ma’lumotlar URLga joylanmaydi.",
                "JURO only suggests data from your profile, workspace and saved AI answer. Check each party’s role; you can edit or remove any field. These details are never placed in the URL.",
              )}</p>
              {documentPrefill.candidates.length ? <div className="ai-document-prefill-fields">{documentPrefill.candidates.map((candidate) => <div className="ai-document-prefill-field" key={candidate.fieldId}>
                <label><span>{candidate.label}<em>{candidate.source === "profile" ? text("Профиль", "Profil", "Profile") : candidate.source === "workspace" ? "Workspace" : text("AI-ответ", "AI javobi", "AI answer")}{candidate.sensitive ? ` · ${text("проверьте конфиденциальные данные", "maxfiy ma’lumotlarni tekshiring", "check sensitive details")}` : ""}</em></span>{candidate.value.length > 160 ? <textarea rows={4} value={candidate.value} disabled={creatingSuggestedDocument} onChange={(event) => updateDocumentPrefillField(candidate.fieldId, event.target.value)} /> : <input value={candidate.value} disabled={creatingSuggestedDocument} onChange={(event) => updateDocumentPrefillField(candidate.fieldId, event.target.value)} />}</label>
                <button type="button" disabled={creatingSuggestedDocument} onClick={() => removeDocumentPrefillField(candidate.fieldId)}>{text("Удалить", "Olib tashlash", "Remove")}</button>
              </div>)}</div> : <p role="status">{text("Безопасных данных для автозаполнения не найдено. Можно создать пустой черновик и заполнить его вручную.", "Xavfsiz avtomatik to‘ldirish ma’lumotlari topilmadi. Bo‘sh qoralama yaratib, uni qo‘lda to‘ldirish mumkin.", "No safe prefill data was found. You can create an empty draft and complete it manually.")}</p>}
              {documentPrefill.candidates.some((candidate) => candidate.sensitive) && <label className="ai-document-sensitive-consent"><input type="checkbox" checked={sensitivePrefillConsent} disabled={creatingSuggestedDocument} onChange={(event) => setSensitivePrefillConsent(event.target.checked)} /><span>{text("Я подтверждаю сохранение только выбранных конфиденциальных реквизитов в этом черновике.", "Faqat tanlangan maxfiy rekvizitlarni ushbu qoralamada saqlashni tasdiqlayman.", "I confirm that only the selected sensitive details may be saved in this draft.")}</span></label>}
              <footer><button type="button" className="secondary" disabled={creatingSuggestedDocument} onClick={dismissDocumentPrefill}>{text("Отмена", "Bekor qilish", "Cancel")}</button><button type="button" disabled={creatingSuggestedDocument || (documentPrefill.candidates.some((candidate) => candidate.sensitive) && !sensitivePrefillConsent)} aria-busy={creatingSuggestedDocument} onClick={() => void confirmSuggestedDocument()}>{creatingSuggestedDocument ? <LoaderCircle className="spin" /> : <FilePlus2 />}{creatingSuggestedDocument ? text("Создаём черновик…", "Qoralama yaratilmoqda…", "Creating draft…") : text("Подтвердить и создать черновик", "Tasdiqlash va qoralama yaratish", "Confirm and create draft")}</button><span className="sr-only" role="status" aria-live="polite">{creatingSuggestedDocument ? text("JURO создаёт черновик документа", "JURO hujjat qoralamasini yaratmoqda", "JURO is creating the document draft") : ""}</span></footer>
            </section>}
            {answer.messageId && <section className="ai-feedback" aria-labelledby="ai-feedback-heading">
              <div><h2 id="ai-feedback-heading">{text("Оцените этот ответ", "Bu javobni baholang", "Rate this answer")}</h2><p>{text("Отзыв привязан к этому сохранённому ответу и помогает проверить качество источников.", "Fikr-mulohaza shu saqlangan javobga bog‘lanadi va manbalar sifatini tekshirishga yordam beradi.", "Your feedback is linked to this saved answer and helps JURO review source quality.")}</p></div>
              <div className="ai-feedback-actions">
                <button type="button" className={feedback.some((item) => item.feedbackType === "helpful") ? "selected" : undefined} disabled={savingFeedback} onClick={() => void saveFeedback("helpful")}><ThumbsUp />{feedback.some((item) => item.feedbackType === "helpful") ? text("Полезно — сохранено", "Foydali — saqlandi", "Helpful — saved") : feedbackLabel("helpful")}</button>
                <details>
                  <summary><CircleAlert aria-hidden="true" /><span>{text("Сообщить о проблеме", "Muammo haqida xabar berish", "Report an issue")}</span></summary>
                  <div className="ai-feedback-form">
                    <div className="ai-feedback-categories" role="group" aria-labelledby="ai-feedback-type-label"><span id="ai-feedback-type-label">{text("Что не так", "Nima noto‘g‘ri", "What went wrong")}</span><div>{feedbackOptions.map((item) => <button type="button" className={feedbackType === item ? "selected" : undefined} aria-pressed={feedbackType === item} key={item} onClick={() => setFeedbackType(item)}>{feedbackLabel(item)}</button>)}</div></div>
                    <label>{text("Комментарий — необязательно", "Izoh — ixtiyoriy", "Comment — optional")}<textarea value={feedbackComment} maxLength={2_000} onChange={(event) => setFeedbackComment(event.target.value)} placeholder={text("Не указывайте лишние персональные данные.", "Ortiqcha shaxsiy ma’lumotlarni kiritmang.", "Avoid unnecessary personal data.")} /></label>
                    <button type="button" disabled={savingFeedback} onClick={() => void saveFeedback(feedbackType, feedbackComment)}>{savingFeedback ? text("Сохраняем…", "Saqlanmoqda…", "Saving…") : text("Сохранить отзыв", "Fikrni saqlash", "Save feedback")}</button>
                  </div>
                </details>
              </div>
              {feedbackStatus && <p className="ai-feedback-status" role="status">{feedbackStatus}</p>}
            </section>}
            {answer.branches && answer.branches.length > 1 && <nav className="ai-branch-history" aria-label={text("Версии ответа", "Javob versiyalari", "Answer versions")}>
              <span><History />{text("Версии", "Versiyalar", "Versions")}</span>
              <div>{answer.branches.map((branch) => <a aria-current={branch.branchId === answer.branchId ? "page" : undefined} key={branch.branchId} href={aiLocation(new URLSearchParams({ conversationId: answer.conversationId, branchId: branch.branchId }))}>{branch.versionNumber === 1 ? text("Исходный ответ", "Asl javob", "Original answer") : `${text("Версия", "Versiya", "Version")} ${branch.versionNumber}`}</a>)}</div>
            </nav>}
            </>}
            {optimisticQuestion && <PendingConversationTurn question={optimisticQuestion} preliminary={preliminary} status={streamStatus} failed={Boolean(error) && !sending} locale={locale} />}
          </>}
        </div>
        <form className="ai-composer" onSubmit={submit}>
          {editSourceMessageId && <div className="ai-edit-notice" role="status"><span>{text("Редактирование создаст новую версию; исходный ответ сохранится.", "Tahrirlash yangi versiya yaratadi; oldingi javob saqlanadi.", "Editing creates a new version; the original answer remains available.")}</span><button type="button" onClick={cancelQuestionEdit}>{text("Отменить", "Bekor qilish", "Cancel")}</button></div>}
          <details className="ai-composer-options">
            <summary><Settings2 aria-hidden="true" /><span>{text("Настройки ответа", "Javob sozlamalari", "Answer settings")}</span><small>{answerMode === "short" ? text("Кратко", "Qisqa", "Concise") : text("Подробно", "Batafsil", "Detailed")} · {reasoningMode === "fast" ? text("Быстро", "Tez", "Fast") : text("Глубоко", "Chuqur", "Deep")}{legalContextDate ? ` · ${formatDate(legalContextDate, locale)}` : ""}</small></summary>
            <div className="ai-modes">
              <div className="ai-mode-field"><span id="ai-answer-mode-label">{text("Формат ответа", "Javob formati", "Answer format")}</span><div className="ai-segmented" role="group" aria-labelledby="ai-answer-mode-label"><button type="button" aria-pressed={answerMode === "short"} onClick={() => setAnswerMode("short")}>{text("Кратко", "Qisqa", "Concise")}</button><button type="button" aria-pressed={answerMode === "detailed"} onClick={() => setAnswerMode("detailed")}>{text("Подробно", "Batafsil", "Detailed")}</button></div></div>
              <div className="ai-mode-field"><span id="ai-reasoning-mode-label">{text("Глубина анализа", "Tahlil chuqurligi", "Analysis depth")}</span><div className="ai-segmented" role="group" aria-labelledby="ai-reasoning-mode-label"><button type="button" aria-pressed={reasoningMode === "fast"} onClick={() => setReasoningMode("fast")}>{text("Быстро", "Tez", "Fast")}</button><button type="button" aria-pressed={reasoningMode === "deep"} onClick={() => setReasoningMode("deep")}>{text("Глубоко", "Chuqur", "Deep")}</button></div></div>
              <AiDatePicker locale={locale} value={legalContextDate} max={uzbekistanCalendarDate()} onChange={changeLegalContextDate} />
            </div>
          </details>
          <div className="ai-composer-input">
            <VoiceMessageControls
              locale={locale}
              disabled={!status?.configured || sending}
              recordingId={voiceRecordingId}
              presentation={voiceMode ? "stage" : "inline"}
              onPhaseChange={setVoiceRecorderPhase}
              onTranscript={acceptVoiceTranscript}
              onClear={() => setVoiceRecordingId("")}
            />
            <label className="sr-only" htmlFor="ai-question">{text("Юридический вопрос", "Yuridik savol", "Legal question")}</label>
            <textarea ref={composerRef} id="ai-question" value={question} rows={1} onChange={changeQuestion} onKeyDown={handleComposerKeyDown} disabled={!status?.configured || sending} placeholder={text("Опишите ситуацию или задайте вопрос…", "Vaziyatni yozing yoki savol bering…", "Describe your situation or ask a question…")} />
            {sending
              ? <button type="button" onClick={() => streamAbortRef.current?.abort()} aria-label={text("Остановить генерацию", "Javob yaratishni to‘xtatish", "Stop generation")}><Square /></button>
              : <button disabled={!status?.configured || !question.trim() || Boolean(selectedConversationId&&!answer)} aria-label={text("Отправить", "Yuborish", "Send")}><Send /></button>}
          </div>
          <small className="ai-composer-hint">{text("Enter — отправить · Shift + Enter — новая строка · не указывайте лишние персональные данные", "Enter — yuborish · Shift + Enter — yangi satr · ortiqcha shaxsiy ma’lumotlarni kiritmang", "Enter — send · Shift + Enter — new line · avoid unnecessary personal data")}</small>
        </form>
      </section>
      <nav className="ai-mobile-context-bar" aria-label={text("Факты и источники ответа", "Javob faktlari va manbalari", "Answer facts and sources")}>
        {hasCaseFacts && <button type="button" onClick={() => openMobileContext("facts")}><Check aria-hidden="true" />{text(`Факты ${answer?.facts.length ?? 0}`, `Faktlar ${answer?.facts.length ?? 0}`, `Facts ${answer?.facts.length ?? 0}`)}</button>}
        <button type="button" onClick={() => openMobileContext("sources")}><BookOpenCheck aria-hidden="true" />{hasAnswerContext ? text(`Источники ${visibleSources.length}`, `Manbalar ${visibleSources.length}`, `Sources ${visibleSources.length}`) : text("Статус источников", "Manbalar holati", "Source status")}</button>
      </nav>
      <aside ref={mobileContextRef} className={`ai-context ${mobileContextOpen ? "is-mobile-open" : ""}`} id="ai-context-panel" role={mobileContextOpen ? "dialog" : undefined} aria-modal={mobileContextOpen || undefined} aria-label={text("Факты и источники", "Faktlar va manbalar", "Facts and sources")}>
        <header><BookOpenCheck aria-hidden="true" /><strong>{text("Контекст ответа", "Javob konteksti", "Answer context")}</strong><button className="ai-context-close" type="button" aria-label={text("Закрыть факты и источники", "Faktlar va manbalarni yopish", "Close facts and sources")} onClick={closeMobileContext}><X /></button></header>
        {hasAnswerContext ? <><div className="ai-context-tabs" role="tablist" aria-label={text("Раздел контекста", "Kontekst bo‘limi", "Context section")}>
          {hasCaseFacts && <button ref={mobileFactsTabRef} id="ai-context-facts-tab" type="button" role="tab" aria-selected={mobileContextTab === "facts"} aria-controls="ai-context-facts-panel" tabIndex={mobileContextTab === "facts" ? 0 : -1} onKeyDown={handleMobileContextTabKeyDown} onClick={() => setMobileContextTab("facts")}>{text("Факты", "Faktlar", "Facts")}</button>}
          <button ref={mobileSourcesTabRef} id="ai-context-sources-tab" type="button" role="tab" aria-selected={mobileContextTab === "sources" || !hasCaseFacts} aria-controls="ai-context-sources-panel" tabIndex={mobileContextTab === "sources" || !hasCaseFacts ? 0 : -1} onKeyDown={handleMobileContextTabKeyDown} onClick={() => setMobileContextTab("sources")}>{text("Источники", "Manbalar", "Sources")}</button>
        </div>
        {answer?.facts.length ? <section id="ai-context-facts-panel" role={mobileContextOpen ? "tabpanel" : undefined} aria-labelledby={mobileContextOpen ? "ai-context-facts-tab" : undefined} hidden={mobileContextOpen && mobileContextTab !== "facts"}><h2>{text("Факты для подтверждения", "Tasdiqlash uchun faktlar", "Facts to verify")}</h2>{answer.facts.map((fact) => <div className={`ai-fact ${fact.status}`} key={fact.id}><p>{fact.statement}</p>{fact.status === "proposed" ? <span><button onClick={() => void updateFact(fact.id, "confirmed")} aria-label={text("Подтвердить факт", "Faktni tasdiqlash", "Verify fact")}><Check /></button><button onClick={() => void updateFact(fact.id, "rejected")} aria-label={text("Отклонить факт", "Faktni rad etish", "Reject fact")}><X /></button></span> : <small>{fact.status === "confirmed" ? text("Подтверждено", "Tasdiqlandi", "Verified") : text("Отклонено", "Rad etildi", "Rejected")}</small>}</div>)}</section> : null}
        {visibleSources.length ? <section id="ai-context-sources-panel" role={mobileContextOpen ? "tabpanel" : undefined} aria-labelledby={mobileContextOpen ? "ai-context-sources-tab" : undefined} className="ai-evidence" hidden={mobileContextOpen && hasCaseFacts && mobileContextTab !== "sources"}><h2>{hasPrivateSources || hasSecondarySources ? text("Источники", "Manbalar", "Sources") : text("Основания в Lex.uz", "Lex.uz asoslari", "Lex.uz legal bases")}</h2>{sourceResult?.coverageStatus && <p className={`ai-coverage ai-coverage-${sourceResult.coverageStatus}`}>{coverageLabel(sourceResult.coverageStatus, locale)}</p>}{visibleSources.map((source) => <LegalSourceCard key={`${workspaceId}:${sourceMessageId}:${source.sourceId}:${source.article || "source"}`} source={source} messageId={sourceMessageId} retrievedAt={sourceResult?.sourcesRetrievedAt} sourceAccessMode={sourceResult?.sourceAccessMode} cases={cases} locale={locale} />)}</section> : null}</> : <section className="ai-context-empty"><span><BookOpenCheck aria-hidden="true" /></span><h2>{text("Нет подтверждённых источников", "Tasdiqlangan manbalar yo‘q", "No verified sources")}</h2>{sourceResult?.coverageStatus && <p className={`ai-coverage ai-coverage-${sourceResult.coverageStatus}`}>{coverageLabel(sourceResult.coverageStatus, locale)}</p>}<p>{sourceWasUnavailable ? text("При сохранении этого ответа официальный источник был недоступен. Повторите поиск из ответа.", "Bu javob saqlanganda rasmiy manba mavjud emas edi. Javobdan qidiruvni takrorlang.", "The official source was unavailable when this answer was saved. Retry the source search from the answer.") : text("JURO не показывает статью или ссылку без подтверждённого основания.", "JURO tasdiqlangan asossiz modda yoki havolani ko‘rsatmaydi.", "JURO does not show an article or link without a verified legal basis.")}</p></section>}
      </aside>
    </section>
  );
}

function AiDatePicker({ locale, value, max, onChange }: { locale: PlatformLocale; value: string; max: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState((value || max).slice(0, 7));
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const monthStart = `${visibleMonth}-01`;
  const firstWeekday = (new Date(`${monthStart}T12:00:00.000Z`).getUTCDay() + 6) % 7;
  const nextMonth = shiftCalendarMonth(visibleMonth, 1);
  const daysInMonth = Math.round((Date.parse(`${nextMonth}-01T12:00:00.000Z`) - Date.parse(`${monthStart}T12:00:00.000Z`)) / 86_400_000);
  const weekdays = locale === "en"
    ? ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
    : locale === "uz"
      ? ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"]
      : ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];

  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const displayValue = value ? formatPlatformLongDate(value, locale) : aiText(locale, "Выберите дату", "Sanani tanlang", "Select a date");
  const monthLabel = formatPlatformMonth(monthStart, locale);

  return <div className="ai-date-field">
    <span id="ai-legal-date-label">{aiText(locale, "Дата события — если важна редакция закона", "Voqea sanasi — qonun tahriri muhim bo‘lsa", "Event date — when the version of the law matters")}</span>
    <div className="ai-date-picker" ref={pickerRef}>
      <div className="ai-date-control">
        <button className="ai-date-trigger" type="button" aria-labelledby="ai-legal-date-label ai-legal-date-value" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setVisibleMonth((value || max).slice(0, 7)); setOpen((current) => !current); }}>
          <CalendarDays /><span id="ai-legal-date-value" className={value ? undefined : "is-placeholder"}>{displayValue}</span>
        </button>
        {value && <button className="ai-date-clear" type="button" aria-label={aiText(locale, "Очистить дату события", "Voqea sanasini tozalash", "Clear event date")} onClick={() => onChange("")}><X /></button>}
      </div>
      {open && <div className="ai-date-popover" role="dialog" aria-label={aiText(locale, "Выбор даты события", "Voqea sanasini tanlash", "Select event date")}>
        <header>
          <button type="button" aria-label={aiText(locale, "Предыдущий месяц", "Oldingi oy", "Previous month")} onClick={() => setVisibleMonth((current) => shiftCalendarMonth(current, -1))}><ChevronLeft /></button>
          <strong aria-live="polite">{monthLabel}</strong>
          <button type="button" disabled={visibleMonth >= max.slice(0, 7)} aria-label={aiText(locale, "Следующий месяц", "Keyingi oy", "Next month")} onClick={() => setVisibleMonth((current) => shiftCalendarMonth(current, 1))}><ChevronRight /></button>
        </header>
        <div className="ai-date-grid">
          {weekdays.map((weekday) => <span key={weekday}>{weekday}</span>)}
          {Array.from({ length: firstWeekday }, (_, index) => <i key={`blank-${index}`} aria-hidden="true" />)}
          {Array.from({ length: daysInMonth }, (_, index) => {
            const day = `${visibleMonth}-${String(index + 1).padStart(2, "0")}`;
            const disabled = day > max;
            const fullLabel = formatPlatformDate(day, locale, { dateStyle: "long" });
            return <button type="button" key={day} disabled={disabled} aria-label={fullLabel} aria-current={day === max ? "date" : undefined} aria-pressed={day === value} className={day === value ? "is-selected" : undefined} onClick={() => { onChange(day); setOpen(false); }}>{index + 1}</button>;
          })}
        </div>
        <footer><button type="button" onClick={() => { onChange(max); setOpen(false); }}>{aiText(locale, "Сегодня", "Bugun", "Today")}</button>{value && <button type="button" onClick={() => { onChange(""); setOpen(false); }}>{aiText(locale, "Сбросить", "Tozalash", "Clear")}</button>}</footer>
      </div>}
    </div>
  </div>;
}

function shiftCalendarMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1 + amount, 1, 12));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}`;
}

function HumanMessage({ question, locale }: { question: string; locale: PlatformLocale }) {
  if (!question) return null;
  return <article className="ai-human-message">
    <small>{aiText(locale, "Вы", "Siz", "You")}</small>
    <p>{question}</p>
  </article>;
}

function ConversationTurnPair({ turn, locale, onCitationSelect }: { turn: ConversationTurn; locale: PlatformLocale; onCitationSelect?: (sourceId: string) => void }) {
  return <section className="ai-conversation-turn">
    <HumanMessage question={turn.question} locale={locale} />
    {turn.result?<LegalAnswer result={turn.result} freshness={turn.sourceFreshness} locale={locale} onCitationSelect={onCitationSelect} />:<p className="ai-legacy-answer">{turn.answer}</p>}
  </section>;
}

function PendingConversationTurn({
  question,
  preliminary,
  status,
  failed,
  locale,
}: {
  question: string;
  preliminary: AiPreliminary | null;
  status: string;
  failed: boolean;
  locale: PlatformLocale;
}) {
  return <section className="ai-conversation-turn ai-conversation-turn-pending">
    <HumanMessage question={question} locale={locale} />
    <article className={`ai-assistant-draft ${failed ? "is-failed" : ""}`}>
      <small>JURO · {failed
        ? aiText(locale, "ответ не завершён", "javob yakunlanmadi", "answer incomplete")
        : preliminary
          ? aiText(locale, "проверенный вывод · завершаю ответ", "tekshirilgan xulosa · javob yakunlanmoqda", "verified finding · completing the answer")
          : aiText(locale, "отвечает", "javob bermoqda", "answering")}</small>
      {preliminary
        ? <div className="ai-preliminary" role="status">
          <strong>{preliminary.message}</strong>
          <p className="ai-preliminary-source">
            <span>{preliminary.source.title}{preliminary.source.article ? ` · ${preliminary.source.article}` : ""}</span>
            {safeOfficialUrl(preliminary.source.canonicalUrl)
              ? <a href={preliminary.source.canonicalUrl} target="_blank" rel="noreferrer">Lex.uz</a>
              : null}
          </p>
        </div>
        : <div className="ai-thinking"><LoaderCircle className={failed ? undefined : "spin"} /><span>{failed ? aiText(locale, "Не удалось завершить ответ. Можно безопасно повторить запрос.", "Javobni yakunlab bo‘lmadi. So‘rovni xavfsiz takrorlash mumkin.", "The answer could not be completed. You can safely retry.") : status || aiText(locale, "Проверяю факты и источники…", "Faktlar va manbalarni tekshiryapman…", "Checking facts and sources…")}</span></div>}
    </article>
  </section>;
}

function LegalSourceCard({
  source,
  messageId,
  retrievedAt,
  sourceAccessMode,
  cases,
  locale,
}: {
  source: Source;
  messageId?: string;
  retrievedAt?: string | null;
  sourceAccessMode?: LegalResult["sourceAccessMode"];
  cases: CaseOption[];
  locale: PlatformLocale;
}) {
  const workspaceId=usePlatformWorkspaceId();
  const [open,setOpen]=useState(false),[loading,setLoading]=useState(false),[error,setError]=useState("");
  const [details,setDetails]=useState<ArticleDetails|null>(null);
  const sourceDialogRef=useRef<HTMLElement>(null),closeRef=useRef<HTMLButtonElement>(null);
  const requestRef=useRef<AbortController|null>(null),returnFocus=useRef<HTMLElement|null>(null);
  const privateSource=isTrustedPrivateSource(source),secondarySource=isSafeSecondarySource(source);
  const origin=source.sourceOrigin??(sourceAccessMode==="direct"?"live":"indexed");
  const fallback:ArticleDetails={documentTitle:source.actTitle,documentType:source.documentType??null,documentNumber:source.documentNumber??null,
    adoptingAuthority:source.adoptingAuthority??null,sourceClass:source.sourceClass??"OFFICIAL_LEGISLATION",articleNumber:source.article,
    articleTitle:null,part:null,chapter:null,section:null,text:source.excerpt??null,fullArticle:false,evidenceUnavailable:true,
    truncated:false,language:source.language??locale,status:source.status,validFrom:source.effectiveDate,validTo:null,versionDate:null,
    officialUrl:source.originalUrl,verifiedAt:retrievedAt??source.verifiedAt,availableLanguages:[],versionHistory:[]};
  const display=details??fallback;
  const closeSourceDialog=()=>{requestRef.current?.abort();requestRef.current=null;setOpen(false);returnFocus.current?.focus();};
  useEffect(()=>()=>requestRef.current?.abort(),[]);
  useEffect(()=>{if(!open)return;closeRef.current?.focus();const onKey=(event:globalThis.KeyboardEvent)=>{
    if(event.key === "Escape"){event.preventDefault();closeSourceDialog();}
    if(event.key==="Tab"){
      const controls=sourceDialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,textarea,[tabindex="0"]');
      const first=controls?.[0],last=controls?.[controls.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}
    }
  };document.addEventListener("keydown",onKey);return()=>document.removeEventListener("keydown",onKey);},[open]);
  async function showArticle(){
    returnFocus.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    requestRef.current?.abort();const controller=new AbortController();requestRef.current=controller;
    setOpen(true);setDetails(null);setError("");
    if(!messageId){setError(aiText(locale,"Сохранённая цитата недоступна.","Saqlangan iqtibos mavjud emas.","The saved citation is unavailable."));return;}
    setLoading(true);
    try {
      const query=new URLSearchParams({sourceUrl:source.originalUrl});if(source.article)query.set("article", source.article);
      const response=await fetch(`/api/platform/ai/citations/${encodeURIComponent(messageId)}?${query}`,{headers:{"x-juro-workspace-id":workspaceId},cache:"no-store",signal:controller.signal});
      if(!response.ok)throw new Error("CITATION_UNAVAILABLE");
      const value=await response.json() as ArticleDetails;
      if(typeof value.fullArticle!=="boolean"||typeof value.documentTitle!=="string"||(!privateSource&&!safeOfficialUrl(value.officialUrl)))throw new Error("CITATION_INVALID");
      if(!controller.signal.aborted)setDetails({...fallback,...value,availableLanguages:(value.availableLanguages??[]).filter(item=>safeOfficialUrl(item.officialUrl)),versionHistory:value.versionHistory??[]});
    }catch{if(!controller.signal.aborted)setError(aiText(locale,"Не удалось открыть цитированную редакцию.","Iqtibos keltirilgan tahrirni ochib bo‘lmadi.","The cited revision could not be opened."));}
    finally{if(requestRef.current===controller){requestRef.current=null;setLoading(false);}}
  }
  return <article className="ai-source-card" data-message-id={messageId} id={sourceCardDomId(source.sourceId)} tabIndex={-1}>
    <div className="ai-source-card-body">
      <strong>{source.actTitle}</strong>
      {source.article && <span>{source.article}</span>}
      {(source.documentType || source.documentNumber) && <small>{[source.documentType, source.documentNumber].filter(Boolean).join(" · ")}</small>}
      {source.adoptingAuthority && <small>{source.adoptingAuthority}</small>}
      {source.excerpt && <q>{source.excerpt}</q>}
      <em>{sourceStatusLabel(source.status, locale)}{source.effectiveDate ? ` · ${formatDate(source.effectiveDate, locale)}` : ""}</em>
      <small>{sourceClassLabel(source.sourceClass, locale)} · {languageLabel(source.language ?? (locale === "uz" ? "uz-Latn" : locale === "en" ? "en" : "ru"), locale)} · {privateSource ? aiText(locale, "защищённый индекс", "himoyalangan indeks", "secure index") : secondarySource ? aiText(locale, "открытый интернет", "ochiq internet", "public web") : origin === "live" ? "live Lex.uz" : aiText(locale, "локальный индекс", "lokal indeks", "local index")}</small>
      <small>{privateSource
        ? aiText(locale, "Доступ и целостность файла проверены для текущего пользователя", "Faylga kirish va uning yaxlitligi joriy foydalanuvchi uchun tekshirildi", "File access and integrity were verified for the current user")
        : secondarySource
          ? aiText(locale, "Справочный материал: не заменяет норму Lex.uz", "Ma’lumotnoma materiali: Lex.uz normasini almashtirmaydi", "Reference material: it does not replace a legal rule from Lex.uz")
        : origin === "live"
          ? aiText(locale, "Проверено напрямую по Lex.uz", "Lex.uz orqali bevosita tekshirildi", "Verified directly against Lex.uz")
          : aiText(locale, "Проверено по утверждённому пакету источников", "Tasdiqlangan manbalar paketi bo‘yicha tekshirildi", "Verified against an approved source package")}</small>
    </div>
    <div className="ai-source-actions">
      {!secondarySource && <button type="button" onClick={() => void showArticle()}><BookOpenCheck aria-hidden="true" />{privateSource ? aiText(locale, "Текст документа", "Hujjat matni", "Document text") : aiText(locale, "Текст статьи", "Modda matni", "Article text")}</button>}
      {!privateSource && <a href={source.originalUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{secondarySource ? aiText(locale, "Открыть материал", "Materialni ochish", "Open material") : aiText(locale, "Открыть Lex.uz", "Lex.uz saytini ochish", "Open Lex.uz")}</a>}
    </div>
    {!privateSource && !secondarySource && <SourceBookmarkControl source={source} cases={cases} locale={locale} />}
    {open && <div className="ai-source-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeSourceDialog(); }}>
      <section ref={sourceDialogRef} className="ai-source-modal" role="dialog" aria-modal="true" aria-labelledby="ai-source-modal-title">
        <header>
          <div><small>{privateSource ? "JURO · PRIVATE DOCUMENT" : "JURO · LEX.UZ"}</small><h2 id="ai-source-modal-title">{privateSource ? aiText(locale, "Документ пользователя", "Foydalanuvchi hujjati", "User document") : display.fullArticle ? aiText(locale, "Полный текст статьи", "Moddaning to‘liq matni", "Full article text") : aiText(locale, "Проверенный фрагмент", "Tekshirilgan parcha", "Verified excerpt")}</h2></div>
          <button ref={closeRef} type="button" aria-label={aiText(locale, "Закрыть", "Yopish", "Close")} onClick={closeSourceDialog}><X /></button>
        </header>
        {loading ? <div className="ai-source-modal-state" role="status"><LoaderCircle className="spin" />{aiText(locale, "Загружаем проверенную редакцию…", "Tekshirilgan tahrir yuklanmoqda…", "Loading the verified version…")}</div> : <>
          {error && <p className="ai-source-modal-warning" role="status">{error}</p>}
          {display.evidenceUnavailable && <p className="ai-source-modal-warning" role="status">{aiText(locale,
            "Не удалось открыть полный текст цитированной редакции. Показан сохранённый проверенный фрагмент.",
            "Keltirilgan tahrirning to‘liq matnini ochib bo‘lmadi. Saqlangan tekshirilgan parcha ko‘rsatilmoqda.",
            "The complete cited revision could not be opened. The saved verified excerpt is shown.")}</p>}
          {display.truncated && <p className="ai-source-modal-warning" role="status">{privateSource ? aiText(locale, "Очень длинный документ показан частично.", "Juda uzun hujjat qisman ko‘rsatildi.", "This long document is shown in part.") : aiText(locale, "Очень длинная статья показана частично; полная редакция доступна по официальной ссылке.", "Juda uzun modda qisman ko‘rsatildi; to‘liq tahrir rasmiy havolada mavjud.", "This long article is shown in part; the complete version is available through the official link.")}</p>}
          <div className="ai-source-modal-heading">
            <strong>{display.documentTitle}</strong>
            {(display.articleNumber || display.articleTitle) && <span>{[display.articleNumber, display.articleTitle].filter(Boolean).join(" · ")}</span>}
            {[display.part, display.chapter, display.section].filter(Boolean).length > 0 && <small>{[display.part, display.chapter, display.section].filter(Boolean).join(" · ")}</small>}
          </div>
          <dl>
            {display.documentType && <div><dt>{aiText(locale, "Тип документа", "Hujjat turi", "Document type")}</dt><dd>{display.documentType}</dd></div>}
            {display.documentNumber && <div><dt>{aiText(locale, "Номер документа", "Hujjat raqami", "Document number")}</dt><dd>{display.documentNumber}</dd></div>}
            {display.adoptingAuthority && <div><dt>{aiText(locale, "Принявший орган", "Qabul qilgan organ", "Adopting authority")}</dt><dd>{display.adoptingAuthority}</dd></div>}
            <div><dt>{aiText(locale, "Тип источника", "Manba turi", "Source type")}</dt><dd>{sourceClassLabel(display.sourceClass, locale)}</dd></div>
            <div><dt>{aiText(locale, "Язык", "Til", "Language")}</dt><dd>{display.language}</dd></div>
            <div><dt>{aiText(locale, "Статус", "Holat", "Status")}</dt><dd>{sourceStatusLabel(display.status, locale)}</dd></div>
            <div><dt>{privateSource ? aiText(locale, "Версия документа", "Hujjat versiyasi", "Document version") : aiText(locale, "Редакция", "Tahrir", "Version")}</dt><dd>{display.versionDate ? formatDate(display.versionDate, locale) : "—"}</dd></div>
            {!privateSource && <div><dt>{aiText(locale, "Действует", "Amal qiladi", "Effective period")}</dt><dd>{display.validFrom ? formatDate(display.validFrom, locale) : "—"}{display.validTo ? ` — ${formatDate(display.validTo, locale)}` : ""}</dd></div>}
            <div><dt>{aiText(locale, "Проверено", "Tekshirildi", "Verified")}</dt><dd>{formatDate(display.verifiedAt, locale)}</dd></div>
          </dl>
          {display.availableLanguages.length > 0 && <section className="ai-source-modal-related" aria-label={aiText(locale, "Доступные языки", "Mavjud tillar", "Available languages")}>
            <h3>{aiText(locale, "Доступные языки", "Mavjud tillar", "Available languages")}</h3>
            <div>{display.availableLanguages.map((variant) => <a key={`${variant.language}:${variant.officialUrl}`} href={variant.officialUrl} target="_blank" rel="noreferrer">{languageLabel(variant.language, locale)}{variant.official ? ` · ${aiText(locale, "официальный", "rasmiy", "official")}` : ""}</a>)}</div>
          </section>}
          {display.versionHistory.length > 0 && <details className="ai-source-modal-history">
            <summary>{aiText(locale, `История редакций (${display.versionHistory.length})`, `Tahrirlar tarixi (${display.versionHistory.length})`, `Version history (${display.versionHistory.length})`)}</summary>
            <ol>{display.versionHistory.map((version) => <li key={`${version.versionNumber}:${version.fetchedAt}`}><strong>#{version.versionNumber}</strong><span>{version.versionDate ? formatDate(version.versionDate, locale) : formatDate(version.fetchedAt, locale)} · {sourceStatusLabel(version.status, locale)}{version.validFrom ? ` · ${formatDate(version.validFrom, locale)}` : ""}{version.validTo ? ` — ${formatDate(version.validTo, locale)}` : ""}</span></li>)}</ol>
          </details>}
          <div className="ai-source-modal-text">{display.text || aiText(locale, "Текст статьи не сохранён.", "Modda matni saqlanmagan.", "The article text was not saved.")}</div>
        </>}
        {!privateSource && <footer><a href={display.officialUrl} target="_blank" rel="noreferrer"><ExternalLink aria-hidden="true" />{aiText(locale, "Официальный источник", "Rasmiy manba", "Official source")}</a></footer>}
      </section>
    </div>}
  </article>;
}

function SourceBookmarkControl({ source, cases, locale }: { source: Source; cases: CaseOption[]; locale: PlatformLocale }) {
  const [caseId, setCaseId] = useState("");
  const [comment, setComment] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("");
  const [failed, setFailed] = useState(false);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setFailed(false);
    setStatus("");
    try {
      const response = await fetch("/api/platform/legal-bookmarks", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `legal-bookmark-create-${crypto.randomUUID()}`,
          "x-juro-csrf": "1",
        },
        body: JSON.stringify({ sourceId: source.sourceId, caseId: caseId || null, comment: comment || null }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || aiText(locale, "Источник не сохранён.", "Manba saqlanmadi.", "The source could not be saved."));
      setSaved(true);
      setStatus(caseId
        ? aiText(locale, "Норма сохранена в выбранное дело.", "Norma tanlangan ishga saqlandi.", "The legal provision was saved to the selected matter.")
        : aiText(locale, "Норма сохранена в личные закладки.", "Norma shaxsiy xatcho‘plarga saqlandi.", "The legal provision was saved to your bookmarks."));
    } catch (error) {
      setFailed(true);
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return <details className="ai-source-bookmark">
    <summary><BookmarkPlus aria-hidden="true" />{saved ? aiText(locale, "Сохранено", "Saqlandi", "Saved") : aiText(locale, "Сохранить норму", "Normani saqlash", "Save provision")}</summary>
    <form onSubmit={(event) => void save(event)}>
      <label>{aiText(locale, "Добавить в дело — необязательно", "Ishga qo‘shish — ixtiyoriy", "Add to a matter — optional")}<select value={caseId} disabled={saving || saved} onChange={(event) => setCaseId(event.target.value)}><option value="">{aiText(locale, "Личные закладки", "Shaxsiy xatcho‘plar", "Personal bookmarks")}</option>{cases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label>{aiText(locale, "Комментарий — необязательно", "Izoh — ixtiyoriy", "Comment — optional")}<textarea value={comment} disabled={saving || saved} maxLength={2_000} onChange={(event) => setComment(event.target.value)} placeholder={aiText(locale, "Почему эта норма важна для вашей ситуации", "Bu norma vaziyatingiz uchun nega muhim", "Why this provision matters to your situation")} /></label>
      <button type="submit" disabled={saving || saved}><BookmarkPlus aria-hidden="true" />{saving ? aiText(locale, "Сохраняем…", "Saqlanmoqda…", "Saving…") : saved ? aiText(locale, "Сохранено", "Saqlandi", "Saved") : aiText(locale, "Сохранить проверенную версию", "Tekshirilgan versiyani saqlash", "Save verified version")}</button>
      <output role={failed ? "alert" : "status"} aria-live="polite">{status}</output>
    </form>
  </details>;
}

function VoiceModeStage(props: {
  locale: PlatformLocale;
  configured: boolean;
  answerReady: boolean;
  sending: boolean;
  recorderPhase: VoiceRecorderPhase;
  speechPhase: VoiceSpeechPhase;
}) {
  const state = resolveVoiceModeState(props);
  const labels: Record<VoiceModeState, Record<PlatformLocale, string>> = {
    idle: { ru: "Голосовой режим ожидает", uz: "Ovozli rejim kutmoqda", en: "Voice mode is standing by" },
    ready: { ru: "Готов слушать после вашего нажатия", uz: "Bosganingizdan keyin tinglashga tayyor", en: "Ready to listen when you press the button" },
    listening: { ru: "Слушаю вашу ситуацию", uz: "Vaziyatingizni tinglayapman", en: "Listening to your situation" },
    transcribing: { ru: "Защищённо распознаю речь", uz: "Nutqni himoyalangan tarzda matnga aylantiryapman", en: "Securely transcribing your speech" },
    thinking: { ru: "Проверяю факты и источники", uz: "Faktlar va manbalarni tekshiryapman", en: "Checking facts and sources" },
    speaking: { ru: "Озвучиваю сохранённый AI-ответ", uz: "Saqlangan AI javobini ovozlantiryapman", en: "Reading the saved AI answer aloud" },
    paused: { ru: "Пауза — вы управляете продолжением", uz: "Pauza — davom ettirish sizning nazoratingizda", en: "Paused — you control when to continue" },
    completed: { ru: "Ответ готов — проверьте текст и источники", uz: "Javob tayyor — matn va manbalarni tekshiring", en: "Answer ready — review the text and sources" },
    offline: { ru: "Голосовой провайдер сейчас недоступен", uz: "Ovoz provayderi hozir mavjud emas", en: "The voice provider is currently unavailable" },
    error: { ru: "Голосовой этап не завершён — можно повторить или перейти к тексту", uz: "Ovoz bosqichi yakunlanmadi — qayta urinib ko‘ring yoki matnga o‘ting", en: "The voice step did not finish — retry or switch to text" },
  };
  return <section className="ai-voice-stage" data-state={state} aria-labelledby="ai-voice-stage-title">
    <div className="ai-voice-stage-copy">
      <span><AudioLines aria-hidden="true" />{aiText(props.locale, "Голосовой режим", "Ovozli rejim", "Voice mode")}</span>
      <h2 id="ai-voice-stage-title">{labels[state][props.locale]}</h2>
      <p>{aiText(
        props.locale,
        "Микрофон включается только по вашему нажатию. Перед отправкой вы увидите и сможете исправить расшифровку.",
        "Mikrofon faqat siz bosganda yoqiladi. Yuborishdan oldin matnni ko‘rib, tahrirlashingiz mumkin.",
        "The microphone turns on only when you choose. You can review and correct the transcript before sending it.",
      )}</p>
      <small>{aiText(props.locale, "Это AI-инструмент JURO, а не живой юрист.", "Bu JURO AI vositasi, tirik yurist emas.", "This is a JURO AI tool, not a human lawyer.")}</small>
    </div>
    <output role={state === "error" ? "alert" : "status"} aria-live="polite">{state}</output>
  </section>;
}

function sourceCardDomId(sourceId: string) {
  return `ai-source-${sourceId.replace(/[^A-Za-z0-9_-]/gu, "-")}`;
}

function focusSourceCard(sourceId: string) {
  const card = document.getElementById(sourceCardDomId(sourceId));
  card?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
  card?.focus({ preventScroll: true });
}

function LegalAnswer({
  result,
  freshness,
  locale,
  onQuestionSelect,
  onCitationSelect,
}: {
  result: LegalResult;
  freshness?: SourceFreshness;
  locale: PlatformLocale;
  onQuestionSelect?: (question: string) => void;
  onCitationSelect?: (sourceId: string) => void;
}) {
  return <div className="ai-answer-frame">
    {freshness && freshness.status !== "fresh" && result.sourceAccessMode !== "direct" && <div className={`ai-source-freshness ai-source-freshness-${freshness.status}`} role="status">
      <CircleAlert aria-hidden="true" />
      <p>{freshness.status === "unavailable"
        ? aiText(
          locale,
          "Проверенные официальные источники Lex.uz ещё не опубликованы полностью в индексе JURO. Пока JURO не показывает правовой вывод как подтверждённый.",
          "Lex.uz rasmiy manbalari JURO tasdiqlangan indeksida hali to‘liq nashr qilinmagan. Shu sabab JURO huquqiy xulosani tasdiqlangan deb ko‘rsatmaydi.",
          "Verified official Lex.uz sources are not yet fully available in the JURO index. JURO will not present a legal conclusion as verified in the meantime.",
        )
        : aiText(
          locale,
          `Правовая база старше ${freshness.maxAgeDays} дней. Последняя подтверждённая полная синхронизация: ${formatDate(freshness.asOf, locale)}.`,
          `Huquqiy baza ${freshness.maxAgeDays} kundan eski. Oxirgi tasdiqlangan to‘liq sinxronlash: ${formatDate(freshness.asOf, locale)}.`,
          `The legal database is more than ${freshness.maxAgeDays} days old. Last verified full sync: ${formatDate(freshness.asOf, locale)}.`,
        )}</p>
    </div>}
    <LegalAnswerView
      result={result}
      locale={locale}
      className="ai-answer"
      onQuestionSelect={onQuestionSelect}
      onCitationSelect={onCitationSelect}
    />
  </div>;
}

function formatDate(value: string, locale: PlatformLocale) {
  return formatPlatformDate(value, locale);
}

function coverageLabel(
  status: NonNullable<LegalResult["coverageStatus"]>,
  locale: PlatformLocale,
): string {
  if (status === "good_coverage") return aiText(locale, "Покрытие: подтверждено", "Qamrov: tasdiqlangan", "Coverage: verified");
  if (status === "partial_coverage") return aiText(locale, "Покрытие: частичное — ответ содержит только подтверждённую часть", "Qamrov: qisman — javob faqat tasdiqlangan qismni o‘z ichiga oladi", "Coverage: partial — the answer contains only the verified portion");
  if (status === "weak_coverage") return aiText(locale, "Покрытие: слабое — ближайшая норма не выдается за точный ответ", "Qamrov: zaif — yaqin norma aniq javob sifatida ko‘rsatilmaydi", "Coverage: weak — a related provision is not presented as an exact answer");
  return aiText(locale, "Покрытие отсутствует — достаточная норма не найдена", "Qamrov yo‘q — yetarli norma topilmadi", "No coverage — a sufficient legal provision was not found");
}

function languageLabel(language: string, locale: PlatformLocale): string {
  if (language === "uz-Latn") return aiText(locale, "Узбекский (латиница)", "O‘zbekcha (lotin)", "Uzbek (Latin)");
  if (language === "uz-Cyrl") return aiText(locale, "Узбекский (кириллица)", "Ўзбекча (кирилл)", "Uzbek (Cyrillic)");
  if (language === "en") return "English";
  return aiText(locale, "Русский", "Rus tili", "Russian");
}

function sourceClassLabel(sourceClass: string | undefined, locale: PlatformLocale): string {
  if (sourceClass === "OFFICIAL_GOVERNMENT_GUIDANCE") return aiText(locale, "Официальное разъяснение", "Rasmiy tushuntirish", "Official guidance");
  if (sourceClass === "OWNER_TRUSTED_GLOBAL") return aiText(locale, "Материал JURO", "JURO materiali", "JURO material");
  if (sourceClass === "TENANT_TRUSTED_PRIVATE") return aiText(locale, "Материал организации", "Tashkilot materiali", "Organisation material");
  if (sourceClass === "USER_TRUSTED_PRIVATE") return aiText(locale, "Личный документ", "Shaxsiy hujjat", "Personal document");
  if (sourceClass === "DERIVED_TRANSLATION") return aiText(locale, "Производный перевод", "Hosila tarjima", "Derived translation");
  if (sourceClass === "SECONDARY_REFERENCE") return aiText(locale, "Вторичный источник", "Ikkilamchi manba", "Secondary source");
  return aiText(locale, "Официальное законодательство", "Rasmiy qonunchilik", "Official legislation");
}

function sourceStatusLabel(status: string, locale: PlatformLocale): string {
  if (status === "user_supplied") return aiText(locale, "Предоставлен пользователем", "Foydalanuvchi taqdim etgan", "Provided by the user");
  if (status === "current" || status === "active") return aiText(locale, "Действует", "Amalda", "In force");
  if (status === "historical") return aiText(locale, "Историческая редакция", "Tarixiy tahrir", "Historical version");
  if (status === "repealed") return aiText(locale, "Утратил силу", "O‘z kuchini yo‘qotgan", "Repealed");
  if (status === "pending_effect") return aiText(locale, "Ещё не вступил в силу", "Hali kuchga kirmagan", "Not yet in force");
  return aiText(locale, "Статус не подтверждён", "Holat tasdiqlanmagan", "Status not verified");
}

function isTrustedPrivateSource(source: Source): boolean {
  if (source.sourceClass !== "USER_TRUSTED_PRIVATE") return false;
  try {
    const url = new URL(source.originalUrl);
    return url.protocol === "juro-private:"
      && url.hostname === "document"
      && /^\/ud_[a-f0-9]{61}$/u.test(url.pathname)
      && !url.search
      && !url.hash;
  } catch {
    return false;
  }
}

function isSafeSecondarySource(source: Source): boolean {
  return source.sourceClass === "SECONDARY_REFERENCE" && safeSecondaryUrl(source.originalUrl);
}

function safeSecondaryUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/u, "");
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (!url.port || url.port === "443")
      && hostname.includes(".")
      && !/^(?:\d{1,3}\.){3}\d{1,3}$/u.test(hostname)
      && !hostname.includes(":")
      && !["lex.uz", "www.lex.uz"].includes(hostname)
      && ![".internal", ".invalid", ".local", ".localhost", ".onion", ".test", ".example"].some((suffix) => hostname.endsWith(suffix));
  } catch {
    return false;
  }
}

function safeOfficialUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.port === ""
      && url.username === ""
      && url.password === ""
      && (url.hostname === "lex.uz" || url.hostname === "www.lex.uz");
  } catch {
    return false;
  }
}

function resizeComposer(textarea: HTMLTextAreaElement) {
  textarea.style.height = "0px";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 176)}px`;
}
