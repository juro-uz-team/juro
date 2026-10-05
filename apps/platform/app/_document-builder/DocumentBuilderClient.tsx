"use client";

/* eslint-disable react-hooks/set-state-in-effect -- persisted guest drafts and authenticated documents hydrate after mount */

import { lazy, Suspense, type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, ArrowRight, Check, Eye, FileCheck2, LoaderCircle, LockKeyhole, PenLine, Save, Sparkles } from "lucide-react";
import { createDefaultAnswers, EXAMPLE_RU, EXAMPLE_UZ } from "../../lib/document-builder/defaults";
import { amountToWords } from "../../lib/document-builder/money-to-words";
import { paragraphsFromFinalText } from "../../lib/document-builder/generation/paragraphs";
import { renderReceipt, suggestedDocumentTitle } from "../../lib/document-builder/templates/receipt";
import type {
  ContactRecord,
  DocumentLanguage,
  PartyDetails,
  ReceiptAnswers,
  StoredDocument,
  UserProfile,
} from "../../lib/document-builder/types";
import { builderSteps, BuilderQuestionnaire } from "./_components/BuilderQuestionnaire";
import { BuilderHeader, type BuilderUser } from "./_components/BuilderHeader";
import { CollaborationPanel } from "./_components/CollaborationPanel";
import { DocumentPreview } from "./_components/DocumentPreview";
import { FinalSuccess, type GeneratedFile } from "./_components/FinalSuccess";
import { ManualEditor } from "./_components/ManualEditor";
import { apiFetch, downloadAuthenticatedFile } from "./_components/api-client";
import { useDebouncedEffect } from "./_hooks/useDebouncedEffect";
import { useModalFocus } from "./_hooks/useModalFocus";
import { builderNavigationPaths } from "../../lib/platform/builder-paths";
import { builderError, builderUiLocale } from "./builder-localization";

const BuilderVersionHistory = lazy(() => import("./_components/BuilderVersionHistory")
  .then((module) => ({ default: module.BuilderVersionHistory })));
const BuilderAnalysisLauncher = lazy(() => import("./_components/BuilderAnalysisLauncher")
  .then((module) => ({ default: module.BuilderAnalysisLauncher })));
const DocumentAssetsPanel = lazy(() => import("./_components/DocumentAssetsPanel")
  .then((module) => ({ default: module.DocumentAssetsPanel })));

const GUEST_KEY = "juro-document-builder-draft-v1";
const LEGACY_GUEST_KEY = ["juro", "document", "builder", "test", "draft"].join("-");
const DOCUMENT_LANGUAGE_KEY = "juro-builder-language";

type Phase = "intro" | "builder" | "success";
type SaveState = "idle" | "saving" | "saved" | "error";
type ConfirmationDecision =
  | { kind: "leave"; href: string }
  | { kind: "agreement" };

interface GuestDraft {
  phase: Phase;
  step: number;
  title: string;
  answers: ReceiptAnswers;
  finalText: string;
  manuallyEdited: boolean;
}

interface GenerationResult {
  status: string;
  files: { docx: GeneratedFile; pdf: GeneratedFile; zip: GeneratedFile };
}

const receiptBuilderCopy = {
  ru: {
    document: "Документ",
    consultation: {
      title: "Получить консультацию",
      description: "Контекст документа и ответы анкеты будут прикреплены автоматически.",
      aiTitle: "AI-юрист",
      aiDescription: "Создать обращение с полным контекстом",
      lawyerTitle: "Живой юрист",
      lawyerDescription: "Зарегистрировать заявку без повторной загрузки",
      close: "Закрыть",
    },
    confirmation: {
      leave: { title: "Уйти из конструктора?", description: "Последние изменения могут ещё сохраняться. Уйти сейчас?", cancel: "Остаться", confirm: "Уйти" },
      agreement: { title: "Отменить согласование?", description: "После следующего сохранения статус «Согласован» будет отменён, и второй стороне потребуется согласовать новую редакцию.", cancel: "Отмена", confirm: "Продолжить редактирование" },
    },
    autosaveError: "Автосохранение не выполнено.",
    accuracyRequired: "Подтвердите общую обязательную галочку перед созданием файлов.",
    generationError: "Не удалось сформировать файлы.",
    downloadError: "Скачивание не выполнено.",
    consultationError: "Не удалось создать обращение.",
    profileError: "Профиль не обновлён.",
    contactMissing: "Контакт не найден.",
    contactError: "Контакт не обновлён.",
    printPreparing: "Подготовка документа к печати…",
    builderLoading: "Открываем конструктор…",
    eyebrow: "Первый бесплатный документ JURO",
    receiptTitle: "Расписка в получении денежных средств",
    receiptDescription: "Документ подтверждает передачу денежных средств в качестве займа и обязанность их возврата.",
    approximateTime: "≈ 5 минут",
    timeHint: "примерное время заполнения",
    files: "DOCX + PDF",
    filesHint: "настоящие готовые файлы",
    documentLanguage: "Язык документа",
    russian: "Русский",
    russianHint: "Полная русская версия",
    uzbek: "Ўзбекча",
    uzbekHint: "Ўзбек кирилл алифбосида",
    languageNote: "Интерфейс и язык документа выбираются отдельно.",
    create: "Создать документ",
    guestNote: "Начать можно без регистрации. До входа ответы сохраняются только в текущей вкладке.",
    newDocument: "Новый документ",
    guestMode: "Гостевой режим",
    saving: "Сохраняем…",
    saveError: "Ошибка сохранения",
    saved: "Черновик сохранён",
    revision: "Ревизия",
    status: "Статус",
    statusValues: { draft: "Черновик", ready: "Готов", approved: "Согласован", signed: "Подписан", archived: "Архив" },
    historyLoading: "Загружаем историю версий…",
    toolsLoading: "Загружаем инструменты документа…",
    documentTitle: "Название документа",
    category: "Категория: Займы и расписки",
    aiCreated: "Запрос AI-юристу создан",
    lawyerCreated: "Заявка живому юристу создана",
    handoffDetail: "Контекст документа и анкеты прикреплён. Номер обращения:",
    signIn: "Войти",
    closeMessage: "Закрыть сообщение",
    sections: "Разделы анкеты",
    preview: "Предпросмотр",
    back: "Назад",
    continue: "Продолжить",
    generating: "Формируем DOCX, PDF и ZIP…",
    createFiles: "Создать файлы",
    signInCreate: "Войти и создать файлы",
    hideEditor: "Скрыть ручной редактор",
    showEditor: "Открыть ручной редактор",
    afterSignIn: "Доступен после входа",
  },
  uz: {
    document: "Ҳужжат",
    consultation: {
      title: "Maslahat olish",
      description: "Hujjat konteksti va anketa javoblari avtomatik ravishda biriktiriladi.",
      aiTitle: "AI-yurist",
      aiDescription: "To‘liq kontekst bilan murojaat yaratish",
      lawyerTitle: "Jonli yurist",
      lawyerDescription: "Faylni qayta yuklamasdan so‘rovni ro‘yxatdan o‘tkazish",
      close: "Yopish",
    },
    confirmation: {
      leave: { title: "Konstruktordan chiqasizmi?", description: "Oxirgi o‘zgarishlar hali saqlanayotgan bo‘lishi mumkin. Hozir chiqasizmi?", cancel: "Qolish", confirm: "Chiqish" },
      agreement: { title: "Kelishuv bekor qilinsinmi?", description: "Keyingi saqlashdan so‘ng «Kelishilgan» holati bekor qilinadi va ikkinchi tomon yangi tahrirni qayta kelishishi kerak bo‘ladi.", cancel: "Bekor qilish", confirm: "Tahrirlashni davom ettirish" },
    },
    autosaveError: "Avtomatik saqlash bajarilmadi.",
    accuracyRequired: "Fayllarni yaratishdan oldin majburiy tasdiqlash katagini belgilang.",
    generationError: "Fayllarni yaratib bo‘lmadi.",
    downloadError: "Faylni yuklab bo‘lmadi.",
    consultationError: "Murojaat yaratib bo‘lmadi.",
    profileError: "Profil yangilanmadi.",
    contactMissing: "Kontakt topilmadi.",
    contactError: "Kontakt yangilanmadi.",
    printPreparing: "Hujjat chop etishga tayyorlanmoqda…",
    builderLoading: "Konstruktor ochilmoqda…",
    eyebrow: "JURO-dagi birinchi bepul hujjat",
    receiptTitle: "Pul mablag‘lari olinganligi to‘g‘risida tilxat",
    receiptDescription: "Hujjat pul qarz sifatida berilganini va uni qaytarish majburiyatini tasdiqlaydi.",
    approximateTime: "≈ 5 daqiqa",
    timeHint: "taxminiy to‘ldirish vaqti",
    files: "DOCX + PDF",
    filesHint: "yuklab olinadigan tayyor fayllar",
    documentLanguage: "Hujjat tili",
    russian: "Русский",
    russianHint: "To‘liq ruscha nusxa",
    uzbek: "Ўзбекча",
    uzbekHint: "Ўзбек кирилл алифбосида",
    languageNote: "Interfeys tili va hujjat tili alohida tanlanadi.",
    create: "Hujjat yaratish",
    guestNote: "Ro‘yxatdan o‘tmasdan boshlashingiz mumkin. Tizimga kirguncha javoblar faqat shu ichki oynada saqlanadi.",
    newDocument: "Yangi hujjat",
    guestMode: "Mehmon rejimi",
    saving: "Saqlanmoqda…",
    saveError: "Saqlash xatosi",
    saved: "Qoralama saqlandi",
    revision: "Tahrir",
    status: "Holat",
    statusValues: { draft: "Qoralama", ready: "Tayyor", approved: "Kelishilgan", signed: "Imzolangan", archived: "Arxiv" },
    historyLoading: "Versiyalar tarixi yuklanmoqda…",
    toolsLoading: "Hujjat vositalari yuklanmoqda…",
    documentTitle: "Hujjat nomi",
    category: "Toifa: Qarzlar va tilxatlar",
    aiCreated: "AI-yuristga murojaat yaratildi",
    lawyerCreated: "Jonli yuristga ariza yaratildi",
    handoffDetail: "Hujjat va anketa konteksti biriktirildi. Murojaat raqami:",
    signIn: "Kirish",
    closeMessage: "Xabarni yopish",
    sections: "Anketa bo‘limlari",
    preview: "Oldindan ko‘rish",
    back: "Orqaga",
    continue: "Davom etish",
    generating: "DOCX, PDF va ZIP yaratilmoqda…",
    createFiles: "Fayllarni yaratish",
    signInCreate: "Kirish va fayllarni yaratish",
    hideEditor: "Qo‘lda tahrirlashni yashirish",
    showEditor: "Qo‘lda tahrirlashni ochish",
    afterSignIn: "Tizimga kirgandan keyin mavjud",
  },
  en: {
    document: "Document",
    consultation: {
      title: "Get legal guidance",
      description: "The document context and questionnaire answers will be attached automatically.",
      aiTitle: "AI legal assistant",
      aiDescription: "Start a request with the full document context",
      lawyerTitle: "Qualified lawyer",
      lawyerDescription: "Submit a request without uploading the file again",
      close: "Close",
    },
    confirmation: {
      leave: { title: "Leave the document builder?", description: "Your latest changes may still be saving. Do you want to leave now?", cancel: "Stay", confirm: "Leave" },
      agreement: { title: "Withdraw approval?", description: "The next save will withdraw the Approved status. The other party will need to approve the revised document again.", cancel: "Cancel", confirm: "Continue editing" },
    },
    autosaveError: "Your changes could not be saved automatically.",
    accuracyRequired: "Confirm the required declaration before creating the files.",
    generationError: "The files could not be generated.",
    downloadError: "The file could not be downloaded.",
    consultationError: "The legal guidance request could not be created.",
    profileError: "Your profile could not be updated.",
    contactMissing: "The contact could not be found.",
    contactError: "The contact could not be updated.",
    printPreparing: "Preparing the document for printing…",
    builderLoading: "Opening the document builder…",
    eyebrow: "Your first JURO document is free",
    receiptTitle: "Receipt for funds received",
    receiptDescription: "Records the transfer of funds as a loan and the borrower’s obligation to repay them.",
    approximateTime: "About 5 minutes",
    timeHint: "estimated completion time",
    files: "DOCX + PDF",
    filesHint: "downloadable production files",
    documentLanguage: "Document language",
    russian: "Russian",
    russianHint: "Complete Russian document",
    uzbek: "Uzbek",
    uzbekHint: "Uzbek in Cyrillic script",
    languageNote: "The JURO interface remains in English. The generated document uses the language selected here.",
    create: "Create document",
    guestNote: "You can start without registering. Until you sign in, answers are stored only in this browser tab.",
    newDocument: "New document",
    guestMode: "Guest mode",
    saving: "Saving…",
    saveError: "Save failed",
    saved: "Draft saved",
    revision: "Version",
    status: "Status",
    statusValues: { draft: "Draft", ready: "Ready", approved: "Approved", signed: "Signed", archived: "Archived" },
    historyLoading: "Loading version history…",
    toolsLoading: "Loading document tools…",
    documentTitle: "Document title",
    category: "Category: Loans and receipts",
    aiCreated: "AI legal request created",
    lawyerCreated: "Lawyer request created",
    handoffDetail: "The document and questionnaire context is attached. Request number:",
    signIn: "Sign in",
    closeMessage: "Close message",
    sections: "Questionnaire sections",
    preview: "Preview",
    back: "Back",
    continue: "Continue",
    generating: "Generating DOCX, PDF and ZIP…",
    createFiles: "Create files",
    signInCreate: "Sign in and create files",
    hideEditor: "Hide manual editor",
    showEditor: "Open manual editor",
    afterSignIn: "Available after sign-in",
  },
} as const;

function localizedReceiptStatus(
  status: string,
  locale: keyof typeof receiptBuilderCopy,
): string {
  const labels = receiptBuilderCopy[locale].statusValues;
  return ({
    "Черновик": labels.draft,
    "Готов": labels.ready,
    "Согласован": labels.approved,
    "Подписан": labels.signed,
    "Архив": labels.archived,
  } as Record<string, string>)[status] ?? status;
}

function calculateProgress(answers: ReceiptAnswers): number {
  const values = [
    answers.participantMode,
    answers.actingSide,
    answers.documentPlace,
    answers.documentDate,
    answers.lender.fullName,
    answers.lender.idDocumentNumber,
    answers.borrower.fullName,
    answers.borrower.idDocumentNumber,
    answers.loanTransferDate,
    answers.loanAmountNumeric,
    answers.loanAmountWords,
    answers.loanRepaymentDate,
    answers.interest.mode,
    answers.transfer.method,
    answers.repayment.planType,
    answers.earlyRepaymentMode,
    answers.responsibilityMode,
    answers.noticesMode,
  ];
  return Math.round((values.filter((value) => String(value ?? "").trim()).length / values.length) * 100);
}

function toReceiptLanguage(): DocumentLanguage {
  if (typeof window === "undefined") return "ru";
  const saved = window.localStorage.getItem(DOCUMENT_LANGUAGE_KEY);
  return saved === "uz" || window.localStorage.getItem("juro-lang") === "uz" ? "uz-cyrl" : "ru";
}

function printableReceipt(finalText: string, fallbackTitle = "Документ") {
  const paragraphs = paragraphsFromFinalText(finalText);
  return { title: paragraphs[0]?.text || fallbackTitle, paragraphs, plainText: finalText };
}

function scrollToPageTop() {
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  window.scrollTo({ top: 0, behavior: reducedMotion ? "auto" : "smooth" });
}

export function DocumentBuilderClient({ initialUser, signInPath, initialDocumentId, printMode = false, initialConsultation = null }: {
  initialUser: BuilderUser | null;
  signInPath: string;
  initialDocumentId?: string;
  printMode?: boolean;
  initialConsultation?: { type: "ai" | "lawyer"; requestId: string } | null;
}) {
  const paths = builderNavigationPaths(usePathname());
  const uiLocale = builderUiLocale(paths.locale);
  const copy = receiptBuilderCopy[uiLocale];
  const consultationCopy = copy.consultation;
  const confirmationCopy = copy.confirmation;
  const [user] = useState(initialUser);
  const [phase, setPhase] = useState<Phase>(initialDocumentId ? "builder" : "intro");
  const [answers, setAnswers] = useState<ReceiptAnswers>(() => createDefaultAnswers("ru"));
  const [step, setStep] = useState(0);
  const [title, setTitle] = useState("");
  const [documentId, setDocumentId] = useState(initialDocumentId ?? "");
  const [revision, setRevision] = useState(1);
  const revisionRef = useRef(1);
  const [status, setStatus] = useState("Черновик");
  const [signedFileId, setSignedFileId] = useState<string | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [contacts, setContacts] = useState<ContactRecord[]>([]);
  const [finalText, setFinalText] = useState("");
  const [manuallyEdited, setManuallyEdited] = useState(false);
  const [undoStack, setUndoStack] = useState<string[]>([]);
  const [redoStack, setRedoStack] = useState<string[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState("");
  const [mobilePreview, setMobilePreview] = useState(false);
  const [editorOpen, setEditorOpen] = useState(Boolean(initialUser));
  const [generating, setGenerating] = useState(false);
  const [files, setFiles] = useState<GenerationResult["files"] | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [accessRole, setAccessRole] = useState<"owner" | "collaborator">("owner");
  const [consultationOpen, setConsultationOpen] = useState(false);
  const closeConsultation = useCallback(() => setConsultationOpen(false), []);
  const consultationDialogRef = useModalFocus<HTMLElement>(consultationOpen, closeConsultation);
  const pendingAgreementAction = useRef<(() => void) | null>(null);
  const allowNavigationRef = useRef(false);
  const [confirmationDecision, setConfirmationDecision] = useState<ConfirmationDecision | null>(null);
  const closeConfirmation = useCallback(() => {
    pendingAgreementAction.current = null;
    setConfirmationDecision(null);
  }, []);
  const confirmationDialogRef = useModalFocus<HTMLElement>(Boolean(confirmationDecision), closeConfirmation);
  const createPromise = useRef<Promise<string> | null>(null);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const agreementWarningShown = useRef(false);
  const skipNextAutosave = useRef(false);

  const rendered = useMemo(() => renderReceipt(answers), [answers]);
  const autoText = rendered.plainText;
  const visibleReceipt = useMemo(() => manuallyEdited ? printableReceipt(finalText, copy.document) : rendered, [copy.document, manuallyEdited, finalText, rendered]);
  const example = useMemo(() => renderReceipt(answers.language === "ru" ? EXAMPLE_RU : EXAMPLE_UZ), [answers.language]);
  const progress = calculateProgress(answers);

  const hydrateDocument = useCallback((stored: StoredDocument) => {
    setAnswers(stored.answers);
    setTitle(stored.title);
    setFinalText(stored.finalContent);
    setManuallyEdited(stored.manuallyEdited);
    setRevision(stored.revision);
    revisionRef.current = stored.revision;
    setStatus(stored.status);
    setSignedFileId(stored.signedFileId);
    setAccessRole(stored.accessRole ?? "owner");
    setPhase("builder");
    setEditorOpen(true);
  }, []);

  const syncDocumentMetadata = useCallback((stored: StoredDocument) => {
    setStatus(stored.status);
    setSignedFileId(stored.signedFileId);
    setRevision(stored.revision);
    revisionRef.current = stored.revision;
  }, []);

  useEffect(() => {
    if (initialDocumentId && user) {
      apiFetch<{ document: StoredDocument }>(`/api/document-builder/documents/${initialDocumentId}`)
        .then(({ document }) => hydrateDocument(document))
        .catch((caught: unknown) => setError(builderError(uiLocale, caught, copy.autosaveError)))
        .finally(() => setHydrated(true));
      return;
    }
    const language = toReceiptLanguage();
    const base = createDefaultAnswers(language);
    if (!user) {
      try {
        const raw = sessionStorage.getItem(GUEST_KEY) ?? sessionStorage.getItem(LEGACY_GUEST_KEY);
        if (raw) {
          sessionStorage.setItem(GUEST_KEY, raw);
          sessionStorage.removeItem(LEGACY_GUEST_KEY);
          const guest = JSON.parse(raw) as GuestDraft;
          setPhase(guest.phase === "success" ? "builder" : guest.phase);
          setStep(guest.step);
          setAnswers(guest.answers);
          setTitle(guest.title);
          setFinalText(guest.finalText);
          setManuallyEdited(false);
          setHydrated(true);
          return;
        }
      } catch {
        sessionStorage.removeItem(GUEST_KEY);
      }
    } else {
      try {
        const raw = sessionStorage.getItem(GUEST_KEY) ?? sessionStorage.getItem(LEGACY_GUEST_KEY);
        if (raw) {
          sessionStorage.setItem(GUEST_KEY, raw);
          sessionStorage.removeItem(LEGACY_GUEST_KEY);
          const guest = JSON.parse(raw) as GuestDraft;
          setPhase(guest.phase === "intro" ? "intro" : "builder");
          setStep(guest.step);
          setAnswers(guest.answers);
          setTitle(guest.title);
          setFinalText(guest.finalText || renderReceipt(guest.answers).plainText);
          setManuallyEdited(guest.manuallyEdited);
          setEditorOpen(true);
          setHydrated(true);
          return;
        }
      } catch {
        sessionStorage.removeItem(GUEST_KEY);
      }
    }
    setAnswers(base);
    setFinalText(renderReceipt(base).plainText);
    setTitle(suggestedDocumentTitle(base));
    setHydrated(true);
  }, [copy.autosaveError, initialDocumentId, uiLocale, user, hydrateDocument]);

  useEffect(() => {
    if (!user) return;
    apiFetch<{ user: UserProfile | null }>("/api/document-builder/bootstrap").then((result) => setProfile(result.user)).catch(() => undefined);
    apiFetch<{ contacts: ContactRecord[] }>("/api/document-builder/contacts").then((result) => setContacts(result.contacts)).catch(() => undefined);
  }, [user]);

  const createDraft = useCallback(async (): Promise<string> => {
    if (documentId) return documentId;
    if (!user) throw new Error("AUTH_REQUIRED");
    if (createPromise.current) return createPromise.current;
    createPromise.current = apiFetch<{ document: StoredDocument }>("/api/document-builder/drafts", {
      method: "POST",
      body: JSON.stringify({ answers, title: title || suggestedDocumentTitle(answers), autoContent: autoText, finalContent: finalText || autoText, manuallyEdited }),
    }).then(({ document }) => {
      setDocumentId(document.id);
      setRevision(document.revision);
      revisionRef.current = document.revision;
      setStatus(document.status);
      sessionStorage.removeItem(GUEST_KEY);
      return document.id;
    }).finally(() => { createPromise.current = null; });
    return createPromise.current;
  }, [documentId, user, answers, title, autoText, finalText, manuallyEdited]);

  useEffect(() => {
    if (hydrated && user && phase === "builder" && !documentId && !initialDocumentId) {
      void createDraft().catch((caught: unknown) => setError(builderError(uiLocale, caught, copy.autosaveError)));
    }
  }, [copy.autosaveError, hydrated, uiLocale, user, phase, documentId, initialDocumentId, createDraft]);

  useDebouncedEffect(() => {
    if (!hydrated || user || phase !== "builder") return;
    const guest: GuestDraft = { phase, step, title, answers, finalText: finalText || autoText, manuallyEdited: false };
    sessionStorage.setItem(GUEST_KEY, JSON.stringify(guest));
  }, [hydrated, user, phase, step, title, answers, finalText, autoText], 250);

  const persist = useCallback((id: string): Promise<void> => {
    const snapshot = { title: title || suggestedDocumentTitle(answers), answers, autoContent: autoText, finalContent: finalText || autoText, manuallyEdited };
    const run = async () => {
      setSaveState("saving");
      try {
        const result = await apiFetch<{ revision: number; status: string }>(`/api/document-builder/documents/${id}`, {
          method: "PUT",
          body: JSON.stringify({ ...snapshot, revision: revisionRef.current }),
        });
        revisionRef.current = result.revision;
        setRevision(result.revision);
        setStatus(result.status);
        setSaveState("saved");
      } catch (caught) {
        setSaveState("error");
        setError(builderError(uiLocale, caught, copy.autosaveError));
        throw caught;
      }
    };
    saveQueue.current = saveQueue.current.catch(() => undefined).then(run);
    return saveQueue.current;
  }, [answers, autoText, copy.autosaveError, finalText, manuallyEdited, title, uiLocale]);

  useDebouncedEffect(() => {
    if (!hydrated || !user || !documentId || accessRole !== "owner" || phase !== "builder") return;
    if (skipNextAutosave.current) { skipNextAutosave.current = false; return; }
    void persist(documentId);
  }, [hydrated, user, documentId, accessRole, phase, title, answers, autoText, finalText, manuallyEdited], 900);

  useEffect(() => {
    if (phase !== "builder" || accessRole === "collaborator") return;
    const handler = (event: BeforeUnloadEvent) => {
      if (allowNavigationRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [accessRole, phase]);

  useEffect(() => {
    if (phase !== "builder" || accessRole === "collaborator") return;
    const guardNavigation = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!target || target.target === "_blank" || target.hasAttribute("download")) return;
      const destination = new URL(target.href, window.location.href);
      if (destination.href === window.location.href) return;
      event.preventDefault();
      event.stopPropagation();
      setConfirmationDecision({ kind: "leave", href: destination.href });
    };
    document.addEventListener("click", guardNavigation, true);
    return () => document.removeEventListener("click", guardNavigation, true);
  }, [accessRole, phase]);

  useEffect(() => {
    if (printMode && hydrated && finalText) {
      const timer = window.setTimeout(() => window.print(), 700);
      return () => window.clearTimeout(timer);
    }
  }, [printMode, hydrated, finalText]);

  const runWithAgreementGuard = (action: () => void) => {
    if (status !== "Согласован" || agreementWarningShown.current) {
      action();
      return;
    }
    pendingAgreementAction.current = action;
    setConfirmationDecision({ kind: "agreement" });
  };

  const changeAnswers = (next: ReceiptAnswers) => {
    runWithAgreementGuard(() => {
      const expectedWords = amountToWords(next.loanAmountNumeric, next.language, next.currency, next.includeCents);
      const normalized = !next.loanAmountWordsManuallyEdited ? { ...next, loanAmountWords: expectedWords } : next;
      setAnswers(normalized);
      if (!manuallyEdited) setFinalText(renderReceipt(normalized).plainText);
    });
  };

  const changeTitle = (next: string) => runWithAgreementGuard(() => setTitle(next));

  const start = () => {
    const next = { ...answers, loanAmountWords: amountToWords(answers.loanAmountNumeric, answers.language, answers.currency, answers.includeCents) };
    setAnswers(next);
    setTitle(suggestedDocumentTitle(next));
    setFinalText(renderReceipt(next).plainText);
    setPhase("builder");
    setStep(0);
    scrollToPageTop();
  };

  const changeLanguage = (language: DocumentLanguage) => {
    if (phase !== "intro") return;
    window.localStorage.setItem(DOCUMENT_LANGUAGE_KEY, language === "uz-cyrl" ? "uz" : "ru");
    const next = createDefaultAnswers(language);
    setAnswers(next);
    setTitle(suggestedDocumentTitle(next));
    setFinalText(renderReceipt(next).plainText);
  };

  const editFinalText = (value: string) => {
    runWithAgreementGuard(() => {
      setUndoStack((stack) => [...stack.slice(-49), finalText]);
      setRedoStack([]);
      setFinalText(value);
      setManuallyEdited(value !== autoText);
    });
  };
  const undo = () => {
    runWithAgreementGuard(() => {
      const previous = undoStack.at(-1); if (previous === undefined) return;
      setRedoStack((stack) => [...stack, finalText]); setUndoStack((stack) => stack.slice(0, -1)); setFinalText(previous); setManuallyEdited(previous !== autoText);
    });
  };
  const redo = () => {
    runWithAgreementGuard(() => {
      const next = redoStack.at(-1); if (next === undefined) return;
      setUndoStack((stack) => [...stack, finalText]); setRedoStack((stack) => stack.slice(0, -1)); setFinalText(next); setManuallyEdited(next !== autoText);
    });
  };
  const resetText = () => runWithAgreementGuard(() => { setUndoStack((stack) => [...stack, finalText]); setRedoStack([]); setFinalText(autoText); setManuallyEdited(false); });

  const confirmDecision = () => {
    const decision = confirmationDecision;
    if (!decision) return;
    if (decision.kind === "leave") {
      allowNavigationRef.current = true;
      setConfirmationDecision(null);
      window.location.assign(decision.href);
      return;
    }
    const pending = pendingAgreementAction.current;
    pendingAgreementAction.current = null;
    agreementWarningShown.current = true;
    setConfirmationDecision(null);
    pending?.();
  };

  const signIn = () => {
    const guest: GuestDraft = { phase: "builder", step, title, answers, finalText: finalText || autoText, manuallyEdited };
    sessionStorage.setItem(GUEST_KEY, JSON.stringify(guest));
    allowNavigationRef.current = true;
    window.location.assign(signInPath);
  };

  const generate = async () => {
    if (!user) { signIn(); return; }
    if (!answers.accuracyConfirmed) { setError(copy.accuracyRequired); setStep(4); return; }
    setGenerating(true); setError("");
    try {
      const id = await createDraft();
      await persist(id);
      const result = await apiFetch<GenerationResult>(`/api/document-builder/documents/${id}/generate`, { method: "POST", body: "{}" });
      setFiles(result.files); setStatus(result.status); setPhase("success"); scrollToPageTop();
    } catch (caught) { setError(builderError(uiLocale, caught, copy.generationError)); }
    finally { setGenerating(false); }
  };

  const download = async (file: GeneratedFile) => {
    try {
      await downloadAuthenticatedFile(file.url, file.name);
      allowNavigationRef.current = true;
      window.location.assign(paths.documents);
    } catch (caught) { setError(builderError(uiLocale, caught, copy.downloadError)); }
  };

  const requestConsultation = async (type: "ai" | "lawyer") => {
    if (!documentId) return;
    try {
      const result = await apiFetch<{ handoffUrl: string }>("/api/document-builder/consultations", { method: "POST", body: JSON.stringify({ documentId, type }) });
      allowNavigationRef.current = true;
      window.location.assign(result.handoffUrl);
    } catch (caught) { setError(builderError(uiLocale, caught, copy.consultationError)); }
  };

  const saveProfile = async (party: PartyDetails) => {
    try {
      const result = await apiFetch<{ user: UserProfile }>("/api/document-builder/bootstrap", {
        method: "PATCH",
        body: JSON.stringify(party),
      });
      setProfile(result.user);
      setSaveState("saved");
    } catch (caught) {
      setError(builderError(uiLocale, caught, copy.profileError));
      throw caught;
    }
  };

  const updateContact = async (contactId: string, party: PartyDetails) => {
    const contact = contacts.find((item) => item.id === contactId);
    if (!contact) throw new Error(copy.contactMissing);
    try {
      await apiFetch(`/api/document-builder/contacts/${contactId}`, {
        method: "PUT",
        body: JSON.stringify({
          label: contact.label,
          fullName: party.fullName,
          birthDate: party.birthDate,
          idDocumentType: party.idDocumentType,
          idDocumentNumber: party.idDocumentNumber,
          idIssuedBy: party.idIssuedBy,
          idIssueDate: party.idIssueDate,
          pinfl: party.pinfl,
          registeredAddress: party.registeredAddress,
          phone: party.phone,
        }),
      });
      setContacts((items) => items.map((item) => item.id === contactId ? {
        ...item,
        fullName: party.fullName,
        birthDate: party.birthDate || null,
        idDocumentType: party.idDocumentType || null,
        idDocumentNumber: party.idDocumentNumber || null,
        idIssuedBy: party.idIssuedBy || null,
        idIssueDate: party.idIssueDate || null,
        pinfl: party.pinfl || null,
        registeredAddress: party.registeredAddress || null,
        phone: party.phone || null,
        updatedAt: new Date().toISOString(),
      } : item));
    } catch (caught) {
      setError(builderError(uiLocale, caught, copy.contactError));
      throw caught;
    }
  };

  if (printMode) {
    return <div className="dbt-print-only">{hydrated ? <DocumentPreview document={printableReceipt(finalText, copy.document)} locale={uiLocale} mobileOpen/> : <p>{copy.printPreparing}</p>}</div>;
  }

  if (!hydrated) return <div className="dbt-loading" role="status"><Image src="/brand/JURO_logo_transparent.png" alt="JURO" width={140} height={137} priority unoptimized/><LoaderCircle size={28}/><p>{copy.builderLoading}</p></div>;

  if (phase === "intro") return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath}/><div className="dbt-intro"><section className="dbt-intro-copy"><span className="dbt-eyebrow"><FileCheck2 size={16}/>{copy.eyebrow}</span><h1>{copy.receiptTitle}</h1><p>{copy.receiptDescription}</p><div className="dbt-intro-meta"><span><strong>{copy.approximateTime}</strong><small>{copy.timeHint}</small></span><span><strong>{copy.files}</strong><small>{copy.filesHint}</small></span></div><fieldset className="dbt-language"><legend>{copy.documentLanguage}</legend><label className={answers.language === "ru" ? "selected" : ""}><input type="radio" checked={answers.language === "ru"} onChange={() => changeLanguage("ru")}/><span><strong>{copy.russian}</strong><small>{copy.russianHint}</small></span></label><label className={answers.language === "uz-cyrl" ? "selected" : ""}><input type="radio" checked={answers.language === "uz-cyrl"} onChange={() => changeLanguage("uz-cyrl")}/><span><strong>{copy.uzbek}</strong><small>{copy.uzbekHint}</small></span></label></fieldset><p className="dbt-inline-note">{copy.languageNote}</p><button type="button" className="dbt-start" onClick={start}>{copy.create}<ArrowRight size={19}/></button><p className="dbt-intro-note">{copy.guestNote}</p></section><DocumentPreview document={example} locale={uiLocale} example/></div></div>;

  if (phase === "success" && files) return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath}/><div className="dbt-success-wrap">{error && <div className="dbt-global-error" role="alert">{error}</div>}<FinalSuccess files={files} libraryPath={paths.library} onDownload={(file) => void download(file)} onPrint={() => window.open(`${paths.document(documentId)}?print=1`, "_blank", "noopener,noreferrer")} onConsultation={() => setConsultationOpen(true)} locale={uiLocale}/>{consultationOpen && <div className="dbt-modal-backdrop" role="presentation" onMouseDown={closeConsultation}><section ref={consultationDialogRef} className="dbt-consultation-modal" role="dialog" aria-modal="true" aria-labelledby="consultation-title" aria-describedby="consultation-description" onMouseDown={(event) => event.stopPropagation()}><h2 id="consultation-title">{consultationCopy.title}</h2><p id="consultation-description">{consultationCopy.description}</p><button type="button" onClick={() => void requestConsultation("ai")}><Sparkles size={20}/><span><strong>{consultationCopy.aiTitle}</strong><small>{consultationCopy.aiDescription}</small></span></button><button type="button" onClick={() => void requestConsultation("lawyer")}><PenLine size={20}/><span><strong>{consultationCopy.lawyerTitle}</strong><small>{consultationCopy.lawyerDescription}</small></span></button><button type="button" className="dbt-modal-close" onClick={closeConsultation}>{consultationCopy.close}</button></section></div>}</div></div>;

  if (accessRole === "collaborator") return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath}/><div className="dbt-collaborator-page">{error && <div className="dbt-global-error" role="alert">{error}</div>}<div className="dbt-collaborator-document"><DocumentPreview document={printableReceipt(finalText, copy.document)} locale={uiLocale} mobileOpen/></div>{documentId && <CollaborationPanel documentId={documentId} accessRole="collaborator" finalText={finalText} currentUserEmail={user?.email} signedFileId={signedFileId} locale={uiLocale} onApplied={() => window.location.reload()}/>}</div></div>;

  return <div className="dbt-root"><BuilderHeader user={user} signInPath={signInPath}/><div className="dbt-builder">
    <div className="dbt-builder-top"><div><Link href={paths.builder} className="dbt-back"><ArrowLeft size={16}/>{copy.newDocument}</Link><h1>{copy.receiptTitle}</h1><div className="dbt-status-line"><span className={`dbt-save-state ${saveState}`}>{!user ? <><LockKeyhole size={14}/>{copy.guestMode}</> : saveState === "saving" ? <><LoaderCircle size={14}/>{copy.saving}</> : saveState === "error" ? copy.saveError : <><Save size={14}/>{copy.saved}</>}</span>{documentId && <span>ID: {documentId.slice(0, 8)}</span>}<span>{copy.revision}: {revision}</span><span>{copy.status}: {localizedReceiptStatus(status, uiLocale)}</span></div></div><div className="dbt-title-edit"><label><span>{copy.documentTitle}</span><input value={title} onChange={(event) => changeTitle(event.target.value)} placeholder={suggestedDocumentTitle(answers)}/></label><small>{copy.category}</small></div></div>
    {initialConsultation && <div className="dbt-handoff-banner" role="status"><Sparkles size={18}/><span><strong>{initialConsultation.type === "ai" ? copy.aiCreated : copy.lawyerCreated}</strong><small>{copy.handoffDetail} {initialConsultation.requestId.slice(0, 8)}</small></span></div>}
    {error && <div className="dbt-global-error" role="alert"><span>{error}</span>{!user && <button type="button" onClick={signIn}>{copy.signIn}</button>}<button type="button" aria-label={copy.closeMessage} onClick={() => setError("")}>×</button></div>}
    <div className="dbt-progress"><div><span style={{ "--progress": progress / 100 } as CSSProperties}/></div><strong>{progress}%</strong></div>
    <nav className="dbt-steps" aria-label={copy.sections}>{builderSteps(uiLocale).map((label, index) => <button type="button" className={step === index ? "active" : index < step ? "visited" : ""} onClick={() => setStep(index)} key={label}><span>{index < step ? <Check size={15}/> : index + 1}</span><small>{label}</small></button>)}</nav>
    <button type="button" className="dbt-mobile-preview-button" onClick={() => setMobilePreview(true)}><Eye size={18}/>{copy.preview}</button>
    <div className="dbt-workspace"><div className="dbt-form-column"><BuilderQuestionnaire answers={answers} onChange={changeAnswers} step={step} profile={profile} contacts={contacts} onSaveProfile={saveProfile} onUpdateContact={updateContact} locale={uiLocale}/><div className="dbt-form-nav"><button type="button" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}><ArrowLeft size={17}/>{copy.back}</button>{step < 4 ? <button type="button" className="primary" onClick={() => setStep(Math.min(4, step + 1))}>{copy.continue}<ArrowRight size={17}/></button> : <button type="button" className="primary" onClick={() => void generate()} disabled={generating}>{generating ? <><LoaderCircle className="spin" size={18}/>{copy.generating}</> : user ? <>{copy.createFiles}<FileCheck2 size={18}/></> : <>{copy.signInCreate}<LockKeyhole size={18}/></>}</button>}</div>{user && step === 4 && <Suspense fallback={<section className="dbt-builder-analysis" aria-busy="true"><p className="dbt-version-loading">{copy.toolsLoading}</p></section>}><BuilderAnalysisLauncher documentLocale={answers.language === "ru" ? "ru" : "uz"} uiLocale={uiLocale} reviewPath={paths.documentReview} onPrepare={async () => { const id = await createDraft(); await persist(id); return id; }}/></Suspense>}</div><DocumentPreview document={visibleReceipt} locale={uiLocale} mobileOpen={mobilePreview} onClose={() => setMobilePreview(false)}/></div>
    <div className="dbt-editor-wrap"><div className="dbt-editor-heading"><button type="button" onClick={() => setEditorOpen(!editorOpen)}><PenLine size={17}/>{editorOpen ? copy.hideEditor : copy.showEditor}</button>{!user && <span>{copy.afterSignIn}</span>}</div>{editorOpen && <ManualEditor value={finalText || autoText} onChange={editFinalText} onUndo={undo} onRedo={redo} onReset={resetText} canUndo={undoStack.length > 0} canRedo={redoStack.length > 0} locked={!user} locale={uiLocale}/>}</div>
    {documentId && user && <><Suspense fallback={<section className="dbt-versions" aria-busy="true"><p className="dbt-version-loading">{copy.historyLoading}</p></section>}><BuilderVersionHistory documentId={documentId} locale={uiLocale} refreshKey={revision} onPrepare={async () => { await persist(documentId); return { documentId, revision: revisionRef.current }; }} onRestored={async () => { const result = await apiFetch<{ document: StoredDocument }>(`/api/document-builder/documents/${documentId}`); skipNextAutosave.current = true; hydrateDocument(result.document); }}/></Suspense><Suspense fallback={<section className="dbt-assets" aria-busy="true"><p className="dbt-version-loading">{copy.toolsLoading}</p></section>}><DocumentAssetsPanel documentId={documentId} onDocumentChange={syncDocumentMetadata} locale={uiLocale}/></Suspense><CollaborationPanel documentId={documentId} accessRole="owner" finalText={finalText || autoText} currentUserEmail={user.email} signedFileId={signedFileId} locale={uiLocale} onApplied={() => window.location.reload()}/></>}
    {confirmationDecision && <div className="dbt-modal-backdrop" role="presentation" onMouseDown={closeConfirmation}><section ref={confirmationDialogRef} className="dbt-delete-choice dbt-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="builder-confirmation-title" aria-describedby="builder-confirmation-description" onMouseDown={(event) => event.stopPropagation()}><h2 id="builder-confirmation-title">{confirmationCopy[confirmationDecision.kind].title}</h2><p id="builder-confirmation-description">{confirmationCopy[confirmationDecision.kind].description}</p><button type="button" className="cancel" data-dialog-initial-focus onClick={closeConfirmation}>{confirmationCopy[confirmationDecision.kind].cancel}</button><button type="button" className="confirm" onClick={confirmDecision}>{confirmationCopy[confirmationDecision.kind].confirm}</button></section></div>}
  </div></div>;
}
