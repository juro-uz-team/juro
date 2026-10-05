"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated lawyer data is loaded after hydration */

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowUpRight, Bot, BriefcaseBusiness, CalendarClock, CheckCircle2, CircleAlert, Clock3, FileText, LoaderCircle, MessageSquareText, Plus, Save, Send, Trash2, UserRound, UsersRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { CASE_SCENARIOS, isCaseScenarioId } from "../../lib/platform/case-create";
import { lawyerDocumentStatus, lawyerIntlLocale, lawyerText } from "../../lib/platform/lawyer-localization";
import type { PlatformLocale } from "../../lib/platform/routing";
import { lawyerWorkspaceOperationError } from "../../lib/platform/lawyer-workspace-operations";
import { usePlatformBasePath } from "./PlatformRouteContext";
import { LawyerRequestsClient } from "./LawyerRequestsClient";

type LawyerProfileSummary = { id: string; displayName: string; status: string; marketplaceStatus: string; availabilityStatus: string; nextAvailableAt: string | null; profileRevision: number };
type RequestItem = { id: string; status: string; anonymizedSummary: string; createdAt: string; updatedAt: string; caseId: string | null; caseTitle: string | null; legalArea: string | null; clientName: string | null; hasAccess: number };
type Matter = { id: string; title: string; description: string | null; status: string; legalArea: string | null; nextDeadlineAt: string | null; updatedAt: string; clientName: string | null; requestId: string };
type Message = { id: string; requestId: string; authorRole: string; body: string; readAt: string | null; createdAt: string; documentId: string | null; documentTitle: string | null; attachmentStatus: string | null };
type DocumentItem = { id: string; title: string; category: string; status: string; updatedAt: string; caseId: string; requestId: string };
type OwnDocumentItem = { id: string; title: string; category: string; status: string; updatedAt: string };
type TaskItem = { id: string; title: string; description: string | null; status: string; dueAt: string | null; caseId: string; updatedAt: string; requestId: string; isEditable: number };
type TaskComment = { id: string; taskId: string; body: string; createdAt: string; authorName: string | null };
type CaseEvent = { id: string; caseId: string; eventType: string; createdAt: string };
type Consultation = { id: string; requestId: string; caseId: string; startsAt: string; endsAt: string; timezone: string; format: string; status: string; internalNote: string | null; resultNote: string | null };
export type LawyerWorkspaceData = { profile: LawyerProfileSummary | null; operational: boolean; unreadMessageCount: number; requests: RequestItem[]; matters: Matter[]; messages: Message[]; documents: DocumentItem[]; ownDocuments: OwnDocumentItem[]; tasks: TaskItem[]; taskComments: TaskComment[]; consultations: Consultation[]; caseEvents: CaseEvent[] };

export function useLawyerWorkspace(locale: PlatformLocale) {
  const [data, setData] = useState<LawyerWorkspaceData | null>(null);
  const [referenceTime, setReferenceTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/platform/lawyer-workspace", { cache: "no-store" });
    const body = await response.json() as LawyerWorkspaceData & { code?: string };
    if (!response.ok) {
      throw new Error(lawyerText(locale, "Не удалось загрузить кабинет юриста.", "Yurist kabinetini yuklab bo‘lmadi.", "We could not load the lawyer workspace."));
    }
    setData(body);
    setReferenceTime(Date.now());
  }, [locale]);
  useEffect(() => { void load().catch((value) => setError(value instanceof Error ? value.message : String(value))).finally(() => setLoading(false)); }, [load]);
  return { data, loading, error, referenceTime, reload: load };
}

function statusCopy(status: string, locale: PlatformLocale) {
  const values: Record<string, [string, string, string]> = {
    profile_incomplete: ["Заполните профиль", "Profilni to‘ldiring", "Complete your profile"],
    pending_review: ["Профиль на проверке JURO", "Profil JURO tekshiruvida", "Profile under JURO review"],
    changes_requested: ["Нужны исправления", "Tuzatishlar kerak", "Changes required"],
    public_approved: ["Профиль опубликован", "Profil e’lon qilingan", "Profile published"],
    rejected: ["Публикация отклонена", "E’lon rad etildi", "Publication declined"],
    suspended: ["Работа приостановлена", "Ish to‘xtatilgan", "Professional access suspended"],
    blocked: ["Доступ заблокирован", "Kirish bloklangan", "Access blocked"],
    archived: ["Профиль в архиве", "Profil arxivda", "Profile archived"],
    unassigned: ["Ожидается назначение", "Tayinlash kutilmoqda", "Awaiting assignment"],
    conflict_check_pending: ["Требуется проверка конфликта", "Manfaatlar to‘qnashuvini tekshirish kerak", "Conflict check required"],
    awaiting_user_consent: ["Ожидается решение владельца", "Ish egasining qarori kutilmoqda", "Awaiting case owner decision"],
    access_granted: ["Доступ к делу предоставлен", "Ishga ruxsat berildi", "Case access granted"],
    access_revoked: ["Доступ отозван", "Ruxsat bekor qilindi", "Access revoked"],
    conflict_declined: ["Конфликт интересов", "Manfaatlar to‘qnashuvi", "Conflict of interest"],
    offer_proposed: ["Предложение отправлено", "Taklif yuborildi", "Offer sent"],
    offer_accepted: ["Предложение принято", "Taklif qabul qilindi", "Offer accepted"],
    offer_declined: ["Предложение отклонено", "Taklif rad etildi", "Offer declined"],
    service_proposal_proposed: ["Сервисное предложение отправлено", "Xizmat taklifi yuborildi", "Service proposal sent"],
    completed: ["Работа завершена", "Ish yakunlandi", "Work completed"],
  };
  const value = values[status];
  return value ? lawyerText(locale, value[0], value[1], value[2]) : status;
}

export function LawyerDashboardClient({ locale, userName }: { locale: PlatformLocale; userName: string }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const base = usePlatformBasePath();
  const { data, loading, error, referenceTime } = useLawyerWorkspace(locale);
  const openRequests = data?.requests.filter((item) => !["completed", "conflict_declined", "access_revoked"].includes(item.status)) ?? [];
  const nextConsultation = data?.consultations.filter((item) => new Date(item.endsAt).getTime() >= referenceTime && item.status !== "cancelled")[0];
  const dueTasks = data?.tasks.filter((item) => item.dueAt && new Date(item.dueAt).getTime() <= referenceTime + 86_400_000) ?? [];
  return <section className="lawyer-workspace lawyer-dashboard" aria-labelledby="lawyer-dashboard-title">
    <header className="lawyer-workspace-hero"><div><span>JURO · {text("кабинет юриста", "yurist kabineti", "lawyer workspace")}</span><h1 id="lawyer-dashboard-title">{userName ? text(`Добрый день, ${userName}`, `Xayrli kun, ${userName}`, `Welcome, ${userName}`) : text("Рабочий кабинет юриста", "Yurist ish kabineti", "Lawyer workspace")}</h1><p>{text("Заявки, консультации, клиенты и дела — только из подтверждённых записей JURO.", "So‘rovlar, maslahatlar, mijozlar va ishlar — faqat tasdiqlangan JURO yozuvlaridan.", "Requests, consultations, clients, and cases are shown only from verified JURO records.")}</p></div><BriefcaseBusiness aria-hidden="true" /></header>
    <Link className="lawyer-ai-entry" href={`${base}/ai-chat`}>
      <span className="lawyer-ai-entry-icon"><Bot aria-hidden="true" /></span>
      <span className="lawyer-ai-entry-copy">
        <strong>{text("Спросить Juro", "Juro’dan so‘rash", "Ask Juro")}</strong>
        <span>{text("Разберите правовой вопрос и проверьте источники перед консультацией.", "Maslahatdan oldin huquqiy savolni tahlil qiling va manbalarni tekshiring.", "Explore a legal question and check the sources before your consultation.")}</span>
      </span>
      <span className="lawyer-ai-entry-action">{text("Открыть чат", "Chatni ochish", "Open chat")}<ArrowUpRight aria-hidden="true" /></span>
    </Link>
    {error && <p className="lawyer-workspace-error" role="alert"><CircleAlert />{error}</p>}
    {loading && !data ? <div className="lawyer-workspace-loading"><LoaderCircle className="spin" />{text("Загружаем кабинет", "Kabinet yuklanmoqda", "Loading workspace")}</div> : data && <>
      <section className={`lawyer-status-banner ${data.operational ? "approved" : "pending"}`}><CheckCircle2 /><div><strong>{data.profile ? statusCopy(data.profile.marketplaceStatus, locale) : text("Профессиональный профиль не создан", "Professional profil yaratilmagan", "Professional profile not created")}</strong><p>{data.operational ? text("Новые назначения и доступы к делам отображаются в реальном времени.", "Yangi tayinlovlar va ish ruxsatlari real vaqtda ko‘rinadi.", "New assignments and case access updates appear in real time.") : text("До одобрения нельзя принимать новые заявки или видеть материалы клиентов.", "Tasdiqlangunga qadar yangi so‘rovlarni qabul qilish yoki mijoz materiallarini ko‘rish mumkin emas.", "You cannot accept new requests or view client materials until your profile is approved.")}</p></div><Link href={`${base}/profile`}>{text("Открыть профиль", "Profilni ochish", "Open profile")}</Link></section>
      <div className="lawyer-kpi-grid">
        <article><UsersRound /><span>{text("Активные заявки", "Faol so‘rovlar", "Active requests")}</span><strong>{openRequests.length}</strong></article>
        <article><UserRound /><span>{text("Клиенты с доступом", "Ruxsatli mijozlar", "Clients with access")}</span><strong>{new Set(data.matters.map((item) => item.clientName).filter(Boolean)).size}</strong></article>
        <article><BriefcaseBusiness /><span>{text("Дела в работе", "Ishdagi ishlar", "Active cases")}</span><strong>{data.matters.length}</strong></article>
        <article><MessageSquareText /><span>{text("Непрочитанные", "O‘qilmagan", "Unread")}</span><strong>{data.unreadMessageCount}</strong></article>
      </div>
      <div className="lawyer-dashboard-grid">
        <section><header><h2>{text("Требует внимания", "E’tibor talab qiladi", "Needs attention")}</h2><Link href={`${base}/consultations?view=requests`}>{text("Все заявки", "Barcha so‘rovlar", "All requests")}</Link></header>{openRequests.slice(0, 4).map((item) => <Link className="lawyer-work-row" href={`${base}/consultations?view=requests#request-${item.id}`} key={item.id}><CircleAlert /><span><strong>{statusCopy(item.status, locale)}</strong><small>{item.anonymizedSummary}</small></span></Link>)}{!openRequests.length && <Empty text={text("Нет заявок, требующих действия.", "Amal talab qiladigan so‘rovlar yo‘q.", "No requests require action.")} />}</section>
        <section><header><h2>{text("Сегодня и далее", "Bugun va keyin", "Upcoming")}</h2><Link href={`${base}/calendar`}>{text("Календарь", "Kalendar", "Calendar")}</Link></header>{nextConsultation && <div className="lawyer-work-row"><CalendarClock /><span><strong>{text("Следующая консультация", "Keyingi maslahat", "Next consultation")}</strong><small>{formatDate(nextConsultation.startsAt, locale)} · {consultationFormatLabel(nextConsultation.format, locale)}</small></span></div>}{dueTasks.slice(0, 3).map((item) => <div className="lawyer-work-row" key={item.id}><Clock3 /><span><strong>{item.title}</strong><small>{item.dueAt ? formatDate(item.dueAt, locale) : taskStatusLabel(item.status, locale)}</small></span></div>)}{!nextConsultation && !dueTasks.length && <Empty text={text("На ближайшее время событий нет.", "Yaqin vaqt uchun voqealar yo‘q.", "No upcoming events.")} />}</section>
      </div>
    </>}
  </section>;
}

export function LawyerHubClient({ locale }: { locale: PlatformLocale }) {
  const view = useSearchParams().get("view") ?? "requests";
  if (view === "requests") return <LawyerRequestsClient locale={locale} />;
  if (view === "schedule") return <LawyerScheduleClient locale={locale} />;
  return <LawyerRecordsClient locale={locale} view={view} />;
}

function LawyerRecordsClient({ locale, view }: { locale: PlatformLocale; view: string }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const base = usePlatformBasePath();
  const { data, loading, error, referenceTime, reload } = useLawyerWorkspace(locale);
  const definitions: Record<string, { title: string; description: string; icon: typeof UserRound }> = {
    clients: { title: text("Клиенты", "Mijozlar", "Clients"), description: text("Только клиенты, которые явно предоставили доступ к делу.", "Faqat ishga aniq ruxsat bergan mijozlar.", "Only clients who explicitly granted access to a case."), icon: UsersRound },
    matters: { title: text("Дела", "Ishlar", "Cases"), description: text("Дела в пределах действующих разрешений клиента.", "Mijozning amaldagi ruxsatlari doirasidagi ishlar.", "Cases available within each client’s active permission."), icon: BriefcaseBusiness },
    messages: { title: text("Сообщения", "Xabarlar", "Messages"), description: text("Переписка по подтверждённым заявкам.", "Tasdiqlangan so‘rovlar bo‘yicha yozishmalar.", "Conversations attached to verified requests."), icon: MessageSquareText },
    documents: { title: text("Документы клиентов", "Mijoz hujjatlari", "Client documents"), description: text("Документы только из дел с активным доступом.", "Faqat faol ruxsatli ishlardagi hujjatlar.", "Documents from cases with active access only."), icon: FileText },
    tasks: { title: text("Задачи", "Vazifalar", "Tasks"), description: text("Сроки и задачи по доступным делам.", "Ruxsatli ishlar bo‘yicha muddat va vazifalar.", "Deadlines and tasks for accessible cases."), icon: CheckCircle2 },
  };
  const definition = definitions[view] ?? definitions.matters;
  const Icon = definition.icon;
  const clients = useMemo(() => Array.from(new Map((data?.matters ?? []).filter((item) => item.clientName).map((item) => [item.clientName, item])).values()), [data?.matters]);
  if (view === "tasks") return <LawyerTaskRecords locale={locale} data={data} loading={loading} error={error} referenceTime={referenceTime} reload={reload} />;
  return <section className="lawyer-workspace lawyer-records"><header className="lawyer-records-header"><Icon /><div><small>JURO · {text("кабинет юриста", "yurist kabineti", "lawyer workspace")}</small><h1>{definition.title}</h1><p>{definition.description}</p></div></header>{error && <p className="lawyer-workspace-error" role="alert">{error}</p>}{loading && !data ? <div className="lawyer-workspace-loading"><LoaderCircle className="spin" /></div> : <div className="lawyer-record-list">
    {view === "clients" && clients.map((item) => <article key={item.clientName}><UserRound /><div><strong>{item.clientName}</strong><small>{item.legalArea || text("Область не указана", "Yo‘nalish ko‘rsatilmagan", "Practice area not specified")}</small></div><span>{text(`${(data?.matters ?? []).filter((matter) => matter.clientName === item.clientName).length} дел`, `${(data?.matters ?? []).filter((matter) => matter.clientName === item.clientName).length} ish`, `${(data?.matters ?? []).filter((matter) => matter.clientName === item.clientName).length} cases`)}</span></article>)}
    {view === "matters" && data?.matters.map((item) => { const messages = data.messages.filter((message) => message.requestId === item.requestId); const documents = data.documents.filter((document) => document.caseId === item.id); const tasks = data.tasks.filter((task) => task.caseId === item.id); const consultations = data.consultations.filter((consultation) => consultation.caseId === item.id); const events = data.caseEvents.filter((event) => event.caseId === item.id).slice(0, 8); return <details className="lawyer-matter-card" key={item.id}><summary><BriefcaseBusiness /><span><strong>{item.title}</strong><small>{item.clientName || "—"} · {item.legalArea ? legalAreaLabel(item.legalArea, locale) : caseStatusLabel(item.status, locale)}</small></span><em>{caseStatusLabel(item.status, locale)}</em></summary><div className="lawyer-matter-details"><p>{item.description || text("Описание дела не заполнено.", "Ish tavsifi kiritilmagan.", "No case description has been added.")}</p><dl><div><dt>{text("Консультации", "Maslahatlar", "Consultations")}</dt><dd>{consultations.length}</dd></div><div><dt>{text("Сообщения", "Xabarlar", "Messages")}</dt><dd>{messages.length}</dd></div><div><dt>{text("Документы", "Hujjatlar", "Documents")}</dt><dd>{documents.length}</dd></div><div><dt>{text("Задачи", "Vazifalar", "Tasks")}</dt><dd>{tasks.length}</dd></div></dl>{item.nextDeadlineAt && <p><strong>{text("Ближайший срок: ", "Yaqin muddat: ", "Next deadline: ")}</strong>{formatDate(item.nextDeadlineAt, locale)}</p>}<section><h2>{text("Последние события", "So‘nggi voqealar", "Recent activity")}</h2>{events.length ? <ol>{events.map((event) => <li key={event.id}><span>{caseEventLabel(event.eventType, locale)}</span><time>{formatDate(event.createdAt, locale)}</time></li>)}</ol> : <p>{text("Событий пока нет.", "Voqealar hozircha yo‘q.", "No activity yet.")}</p>}</section><nav aria-label={text("Следующие действия по делу", "Ish bo‘yicha keyingi harakatlar", "Next case actions")}><Link href={`${base}/consultations?view=requests#request-${item.requestId}`}>{text("Открыть заявку и сообщения", "So‘rov va xabarlarni ochish", "Open request and messages")}</Link><Link href={`${base}/consultations?view=tasks`}>{text("Управлять задачами", "Vazifalarni boshqarish", "Manage tasks")}</Link></nav></div></details>; })}
    {view === "messages" && data?.messages.map((item) => <Link href={`${base}/consultations?view=requests#request-${item.requestId}`} key={item.id}><MessageSquareText /><div><strong>{item.authorRole === "lawyer" ? text("Вы", "Siz", "You") : text("Клиент", "Mijoz", "Client")}</strong><small>{item.body || item.documentTitle || text("Документ", "Hujjat", "Document")}{item.authorRole === "lawyer" ? ` · ${item.readAt ? text("прочитано", "o‘qilgan", "read") : text("отправлено", "yuborilgan", "sent")}` : ""}</small></div><time>{formatDate(item.createdAt, locale)}</time></Link>)}
    {view === "documents" && <Link href={`${base}/document-builder`}><Plus /><div><strong>{text("Создать проект документа", "Hujjat loyihasini yaratish", "Create document draft")}</strong><small>{text("Открыть существующий JURO Builder", "Mavjud JURO Builder-ni ochish", "Open JURO Builder")}</small></div></Link>}
    {view === "documents" && data?.ownDocuments.map((item) => <Link href={`${base}/documents/${encodeURIComponent(item.id)}`} key={`own-${item.id}`}><FileText /><div><strong>{item.title}</strong><small>{text("Ваш проект", "Sizning loyihangiz", "Your draft")} · {lawyerDocumentStatus(item.status, locale)}</small></div><time>{formatDate(item.updatedAt, locale)}</time></Link>)}
    {view === "documents" && data?.documents.map((item) => <Link href={`${base}/documents/${encodeURIComponent(item.id)}`} key={item.id}><FileText /><div><strong>{item.title}</strong><small>{item.category} · {lawyerDocumentStatus(item.status, locale)}</small></div><time>{formatDate(item.updatedAt, locale)}</time></Link>)}
    {data && ((view === "clients" && !clients.length) || (view === "matters" && !data.matters.length) || (view === "messages" && !data.messages.length) || (view === "documents" && !data.documents.length && !data.ownDocuments.length)) && <Empty text={text("Реальных записей пока нет.", "Hozircha haqiqiy yozuvlar yo‘q.", "No records yet.")} />}
  </div>}</section>;
}

function LawyerTaskRecords({ locale, data, loading, error, referenceTime, reload }: { locale: PlatformLocale; data: LawyerWorkspaceData | null; loading: boolean; error: string; referenceTime: number; reload: () => Promise<void> }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const [caseFilter, setCaseFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [comments, setComments] = useState<Record<string, string>>({});
  const [taskDueDates, setTaskDueDates] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState("");
  const [localError, setLocalError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedMatter = data?.matters.find((matter) => matter.id === caseFilter) ?? data?.matters[0] ?? null;
  const visible = (data?.tasks ?? []).filter((task) => (!caseFilter || task.caseId === caseFilter) && (!statusFilter || (statusFilter === "overdue" ? Boolean(task.dueAt && Date.parse(task.dueAt) < referenceTime && !["completed", "cancelled"].includes(task.status)) : task.status === statusFilter)));

  async function mutate(payload: Record<string, unknown>, actionId: string) {
    setBusyId(actionId); setLocalError(""); setNotice("");
    try {
      const response = await fetch("/api/platform/lawyer-tasks", { method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1" }, body: JSON.stringify({ locale, ...payload }) });
      const body = await response.json() as { code?: string };
      if (!response.ok) throw new Error(lawyerWorkspaceOperationError(locale, body.code || "INVALID_INPUT"));
      await reload();
      setNotice(text("Задачи дела обновлены.", "Ish vazifalari yangilandi.", "Case tasks updated."));
    } finally { setBusyId(""); }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!selectedMatter) return;
    try { await mutate({ action: "create", requestId: selectedMatter.requestId, title, description: description.trim() || undefined, dueAt: dueAt ? new Date(dueAt).toISOString() : undefined }, "new"); setTitle(""); setDescription(""); setDueAt(""); }
    catch (value) { setLocalError(value instanceof Error ? value.message : String(value)); }
  }

  return <section className="lawyer-workspace lawyer-records lawyer-task-workspace"><header className="lawyer-records-header"><CheckCircle2 /><div><small>JURO · {text("задачи", "vazifalar", "tasks")}</small><h1>{text("Задачи по делам", "Ish vazifalari", "Case tasks")}</h1><p>{text("Создавайте задачи только в делах с действующим разрешением клиента; изменения и комментарии фиксируются в аудите.", "Faqat mijozning amaldagi ruxsati bor ishlarda vazifa yarating; o‘zgarish va izohlar auditda qayd etiladi.", "Create tasks only for cases with active client permission. Changes and comments are recorded in the audit log.")}</p></div></header>{(error || localError) && <p className="lawyer-workspace-error" role="alert">{error || localError}</p>}{notice && <p className="lawyer-workspace-notice" role="status">{notice}</p>}{loading && !data ? <div className="lawyer-workspace-loading"><LoaderCircle className="spin" /></div> : <>
    <form className="lawyer-task-create" onSubmit={(event) => void create(event)}><header><Plus /><div><h2>{text("Новая задача", "Yangi vazifa", "New task")}</h2><p>{text("Задача будет связана с выбранным клиентом и делом.", "Vazifa tanlangan mijoz va ish bilan bog‘lanadi.", "The task will be linked to the selected client and case.")}</p></div></header><label>{text("Дело", "Ish", "Case")}<Select value={selectedMatter?.id || ""} onChange={(event) => setCaseFilter(event.target.value)} disabled={!data?.matters.length}>{data?.matters.map((matter) => <option value={matter.id} key={matter.id}>{matter.clientName ? `${matter.clientName} · ` : ""}{matter.title}</option>)}</Select></label><label>{text("Название", "Nomi", "Title")}<input required minLength={2} maxLength={240} value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>{text("Описание", "Tavsif", "Description")}<textarea maxLength={2_000} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>{text("Срок", "Muddat", "Due date")}<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label><button disabled={!selectedMatter || busyId === "new" || title.trim().length < 2}>{busyId === "new" ? <LoaderCircle className="spin" /> : <Plus />}{text("Создать задачу", "Vazifa yaratish", "Create task")}</button></form>
    <div className="lawyer-task-filters"><label>{text("Фильтр по делу", "Ish filtri", "Filter by case")}<Select value={caseFilter} onChange={(event) => setCaseFilter(event.target.value)}><option value="">{text("Все разрешённые дела", "Barcha ruxsatli ishlar", "All accessible cases")}</option>{data?.matters.map((matter) => <option value={matter.id} key={matter.id}>{matter.title}</option>)}</Select></label><label>{text("Статус", "Holat", "Status")}<Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">{text("Все", "Barchasi", "All")}</option><option value="planned">{text("Запланировано", "Rejalashtirilgan", "Planned")}</option><option value="in_progress">{text("В работе", "Jarayonda", "In progress")}</option><option value="waiting_information">{text("Ожидает информации", "Ma’lumot kutilmoqda", "Awaiting information")}</option><option value="completed">{text("Завершено", "Yakunlangan", "Completed")}</option><option value="overdue">{text("Просрочено", "Muddati o‘tgan", "Overdue")}</option></Select></label></div>
    <div className="lawyer-task-list">{visible.map((task) => { const matter = data?.matters.find((item) => item.id === task.caseId); const taskComments = data?.taskComments.filter((comment) => comment.taskId === task.id) ?? []; const overdue = Boolean(task.dueAt && Date.parse(task.dueAt) < referenceTime && !["completed", "cancelled"].includes(task.status)); const editableDueAt = taskDueDates[task.id] ?? (task.dueAt ? toLocalDateTime(task.dueAt) : ""); return <article key={task.id} data-overdue={overdue ? "true" : "false"}><header><CheckCircle2 /><div><strong>{task.title}</strong><small>{matter?.clientName || "—"} · {matter?.title || task.caseId}</small></div><span>{overdue ? text("Просрочено", "Muddati o‘tgan", "Overdue") : taskStatusLabel(task.status, locale)}</span></header>{task.description && <p>{task.description}</p>}<div className="lawyer-task-meta">{task.isEditable ? <label>{text("Срок", "Muddat", "Due date")}<input type="datetime-local" value={editableDueAt} disabled={busyId === `due-${task.id}` || ["completed", "cancelled"].includes(task.status)} onChange={(event) => setTaskDueDates((current) => ({ ...current, [task.id]: event.target.value }))} onBlur={(event) => { const nextDueAt = event.target.value; const currentDueAt = task.dueAt ? toLocalDateTime(task.dueAt) : ""; if (nextDueAt === currentDueAt) return; void mutate({ action: "update", requestId: task.requestId, taskId: task.id, status: task.status, dueAt: nextDueAt ? new Date(nextDueAt).toISOString() : null }, `due-${task.id}`).catch((value) => setLocalError(value instanceof Error ? value.message : String(value))); }} /></label> : task.dueAt && <time>{formatDate(task.dueAt, locale)}</time>}{task.isEditable ? <Select aria-label={text("Статус задачи", "Vazifa holati", "Task status")} value={task.status} disabled={busyId === task.id || ["completed", "cancelled"].includes(task.status)} onChange={(event) => void mutate({ action: "update", requestId: task.requestId, taskId: task.id, status: event.target.value }, task.id).catch((value) => setLocalError(value instanceof Error ? value.message : String(value)))}>{task.status === "overdue" && <option value="overdue" disabled>{text("Просрочено", "Muddati o‘tgan", "Overdue")}</option>}<option value="planned">{text("Запланировано", "Rejalashtirilgan", "Planned")}</option><option value="in_progress">{text("В работе", "Jarayonda", "In progress")}</option><option value="waiting_information">{text("Ожидает информации", "Ma’lumot kutilmoqda", "Awaiting information")}</option><option value="waiting_counterparty">{text("Ожидает другую сторону", "Qarshi tomon kutilmoqda", "Awaiting counterparty")}</option><option value="completed">{text("Завершено", "Yakunlangan", "Completed")}</option><option value="cancelled">{text("Отменено", "Bekor qilingan", "Cancelled")}</option></Select> : <small>{text("Задача плана клиента доступна только для комментария.", "Mijoz rejasidagi vazifa faqat izoh uchun ochiq.", "This client plan task is available for comments only.")}</small>}</div>{taskComments.length > 0 && <ol className="lawyer-task-comments">{taskComments.map((comment) => <li key={comment.id}><MessageSquareText /><div><strong>{comment.authorName || text("Юрист", "Yurist", "Lawyer")}</strong><p>{comment.body}</p><time>{formatDate(comment.createdAt, locale)}</time></div></li>)}</ol>}<form className="lawyer-task-comment" onSubmit={(event) => { event.preventDefault(); const body = comments[task.id]?.trim(); if (!body) return; void mutate({ action: "comment", requestId: task.requestId, taskId: task.id, body }, `comment-${task.id}`).then(() => setComments((current) => ({ ...current, [task.id]: "" }))).catch((value) => setLocalError(value instanceof Error ? value.message : String(value))); }}><label className="sr-only" htmlFor={`task-comment-${task.id}`}>{text("Комментарий к задаче", "Vazifa izohi", "Task comment")}</label><textarea id={`task-comment-${task.id}`} maxLength={2_000} value={comments[task.id] || ""} onChange={(event) => setComments((current) => ({ ...current, [task.id]: event.target.value }))} placeholder={text("Добавить комментарий…", "Izoh qo‘shish…", "Add a comment…")} /><button aria-label={text("Отправить комментарий", "Izohni yuborish", "Send comment")} disabled={!comments[task.id]?.trim() || busyId === `comment-${task.id}`} >{busyId === `comment-${task.id}` ? <LoaderCircle className="spin" /> : <Send />}</button></form></article>; })}{data && !visible.length && <Empty text={text("Задач по выбранным фильтрам нет.", "Tanlangan filtrlar bo‘yicha vazifa yo‘q.", "No tasks match the selected filters.")} />}</div>
  </>}</section>;
}

type ScheduleRule = { id?: string; weekday: number; startsAt: string; endsAt: string; status: "active" | "paused" };
type UnavailabilityPeriod = { id?: string; startsAt: string; endsAt: string; reason: string | null };
const weekdays = [[1, "Понедельник", "Dushanba", "Monday"], [2, "Вторник", "Seshanba", "Tuesday"], [3, "Среда", "Chorshanba", "Wednesday"], [4, "Четверг", "Payshanba", "Thursday"], [5, "Пятница", "Juma", "Friday"], [6, "Суббота", "Shanba", "Saturday"], [7, "Воскресенье", "Yakshanba", "Sunday"]] as const;

export function LawyerScheduleClient({ locale }: { locale: PlatformLocale }) {
  const text = (russian: string, uzbek: string, english: string) => lawyerText(locale, russian, uzbek, english);
  const [rules, setRules] = useState<ScheduleRule[]>([]);
  const [unavailability, setUnavailability] = useState<UnavailabilityPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    fetch("/api/platform/lawyer-schedule", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as {
          rules?: ScheduleRule[];
          unavailability?: UnavailabilityPeriod[];
          code?: string;
        };
        if (!response.ok) throw new Error(lawyerText(locale, "Не удалось загрузить расписание.", "Jadvalni yuklab bo‘lmadi.", "We could not load the schedule."));
        setRules(body.rules ?? []);
        setUnavailability((body.unavailability ?? []).map((period) => ({
          ...period,
          startsAt: toLocalDateTime(period.startsAt),
          endsAt: toLocalDateTime(period.endsAt),
        })));
      })
      .catch((value) => setError(value instanceof Error ? value.message : String(value)))
      .finally(() => setLoading(false));
  }, [locale]);
  function toggle(weekday: number, checked: boolean) { setRules((current) => checked ? [...current, { weekday, startsAt: "09:00", endsAt: "18:00", status: "active" }] : current.filter((item) => item.weekday !== weekday)); }
  function change(weekday: number, field: "startsAt" | "endsAt", value: string) { setRules((current) => current.map((item) => item.weekday === weekday ? { ...item, [field]: value } : item)); }
  function addUnavailability() {
    const startsAt = nextLocalHour();
    const endsAt = new Date(new Date(startsAt).getTime() + 60 * 60_000);
    setUnavailability((current) => [...current, {
      startsAt,
      endsAt: toLocalDateTime(endsAt.toISOString()),
      reason: "",
    }]);
  }
  function changeUnavailability(index: number, field: "startsAt" | "endsAt" | "reason", value: string) {
    setUnavailability((current) => current.map((period, periodIndex) => periodIndex === index ? { ...period, [field]: value } : period));
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/platform/lawyer-schedule", {
        method: "PUT",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({
          rules: rules.map(({ weekday, startsAt, endsAt, status }) => ({ weekday, startsAt, endsAt, status })),
          unavailability: unavailability.map(({ startsAt, endsAt, reason }) => ({
            startsAt: new Date(startsAt).toISOString(),
            endsAt: new Date(endsAt).toISOString(),
            reason: reason?.trim() || undefined,
          })),
          locale,
        }),
      });
      if (!response.ok) throw new Error(text("Не удалось сохранить расписание.", "Jadvalni saqlab bo‘lmadi.", "We could not save the schedule."));
      setNotice(text("Рабочие часы и недоступность сохранены.", "Ish vaqti va band davrlar saqlandi.", "Working hours and unavailable periods saved."));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSaving(false);
    }
  }
  return <section className="lawyer-workspace lawyer-schedule">
    <header className="lawyer-records-header"><CalendarClock /><div><small>JURO · {text("доступность", "mavjudlik", "availability")}</small><h1>{text("Расписание консультаций", "Maslahat jadvali", "Consultation schedule")}</h1><p>{text("Укажите реальные рабочие часы, перерывы и периоды недоступности. Запись клиента не создаётся без отдельного подтверждения.", "Haqiqiy ish vaqtini, tanaffus va band davrlarni ko‘rsating. Mijoz yozuvi alohida tasdiqsiz yaratilmaydi.", "Set your actual working hours, breaks, and unavailable periods. A client appointment is never created without separate confirmation.")}</p></div></header>
    {error && <p className="lawyer-workspace-error" role="alert">{error}</p>}
    {notice && <p className="lawyer-workspace-notice" role="status">{notice}</p>}
    {loading ? <div className="lawyer-workspace-loading"><LoaderCircle className="spin" /></div> : <form onSubmit={(event) => void save(event)}>
      <section className="lawyer-schedule-section" aria-labelledby="lawyer-working-hours"><header><div><h2 id="lawyer-working-hours">{text("Рабочие часы", "Ish vaqti", "Working hours")}</h2><p>{text("Повторяющиеся интервалы по дням недели.", "Hafta kunlari bo‘yicha takroriy vaqtlar.", "Recurring availability by weekday.")}</p></div></header>{weekdays.map(([weekday, ruLabel, uzLabel, enLabel]) => { const rule = rules.find((item) => item.weekday === weekday); const weekdayLabel = text(ruLabel, uzLabel, enLabel); return <div className="lawyer-schedule-row" key={weekday}><label><input type="checkbox" checked={Boolean(rule)} onChange={(event) => toggle(weekday, event.target.checked)} />{weekdayLabel}</label><input type="time" disabled={!rule} value={rule?.startsAt ?? "09:00"} onChange={(event) => change(weekday, "startsAt", event.target.value)} aria-label={`${weekdayLabel}: ${text("начало", "boshlanish", "start")}`} /><span>—</span><input type="time" disabled={!rule} value={rule?.endsAt ?? "18:00"} onChange={(event) => change(weekday, "endsAt", event.target.value)} aria-label={`${weekdayLabel}: ${text("окончание", "tugash", "end")}`} /></div>})}</section>
      <section className="lawyer-schedule-section lawyer-unavailability" aria-labelledby="lawyer-unavailability"><header><div><h2 id="lawyer-unavailability">{text("Перерывы и недоступность", "Tanaffus va band vaqt", "Breaks and unavailable periods")}</h2><p>{text("Разовые интервалы исключаются из доступного времени.", "Bir martalik oraliqlar bo‘sh vaqtdan chiqariladi.", "One-off periods are excluded from your available time.")}</p></div><button type="button" onClick={addUnavailability}><Plus />{text("Добавить", "Qo‘shish", "Add period")}</button></header>{unavailability.map((period, index) => <div className="lawyer-unavailability-row" key={period.id || index}><label>{text("Начало", "Boshlanishi", "Starts")}<input type="datetime-local" required value={period.startsAt} onChange={(event) => changeUnavailability(index, "startsAt", event.target.value)} /></label><label>{text("Окончание", "Tugashi", "Ends")}<input type="datetime-local" required value={period.endsAt} onChange={(event) => changeUnavailability(index, "endsAt", event.target.value)} /></label><label>{text("Причина (необязательно)", "Sabab (ixtiyoriy)", "Reason (optional)")}<input maxLength={500} value={period.reason || ""} onChange={(event) => changeUnavailability(index, "reason", event.target.value)} /></label><button className="lawyer-remove-period" type="button" aria-label={text("Удалить период", "Davrni o‘chirish", "Remove period")} onClick={() => setUnavailability((current) => current.filter((_, periodIndex) => periodIndex !== index))}><Trash2 /></button></div>)}{!unavailability.length && <p className="lawyer-unavailability-empty">{text("Периоды недоступности не добавлены.", "Band davrlar qo‘shilmagan.", "No unavailable periods added.")}</p>}</section>
      <button className="lawyer-schedule-save" type="submit" disabled={saving}>{saving ? <LoaderCircle className="spin" /> : <Save />}{text("Сохранить расписание", "Jadvalni saqlash", "Save schedule")}</button>
    </form>}
  </section>;
}

function Empty({ text }: { text: string }) { return <div className="lawyer-record-empty"><CheckCircle2 /><p>{text}</p></div>; }
function taskStatusLabel(status: string, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    planned: ["Запланировано", "Rejalashtirilgan", "Planned"],
    in_progress: ["В работе", "Jarayonda", "In progress"],
    waiting_information: ["Ожидает информации", "Ma’lumot kutilmoqda", "Awaiting information"],
    waiting_counterparty: ["Ожидает другую сторону", "Qarshi tomon kutilmoqda", "Awaiting counterparty"],
    completed: ["Завершено", "Yakunlangan", "Completed"],
    cancelled: ["Отменено", "Bekor qilingan", "Cancelled"],
  };
  const value = labels[status];
  return value
    ? lawyerText(locale, value[0], value[1], value[2])
    : lawyerText(locale, "Статус задачи", "Vazifa holati", "Task status");
}
function caseEventLabel(eventType: string, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    case_created: ["Дело создано", "Ish yaratildi", "Case created"],
    action_plan_created: ["Создан план действий", "Harakatlar rejasi yaratildi", "Action plan created"],
    tasks_created: ["Задачи добавлены из плана", "Rejadan vazifalar qo‘shildi", "Tasks added from action plan"],
    lawyer_access_granted: ["Юристу предоставлен доступ", "Yuristga ruxsat berildi", "Lawyer access granted"],
    lawyer_access_revoked: ["Доступ юриста отозван", "Yurist ruxsati bekor qilindi", "Lawyer access revoked"],
    lawyer_task_created: ["Юрист добавил задачу", "Yurist vazifa qo‘shdi", "Lawyer added a task"],
    lawyer_task_updated: ["Юрист обновил задачу", "Yurist vazifani yangiladi", "Lawyer updated a task"],
    lawyer_task_comment_added: ["Юрист добавил комментарий", "Yurist izoh qo‘shdi", "Lawyer added a comment"],
    lawyer_document_requested: ["Юрист запросил документ", "Yurist hujjat so‘radi", "Lawyer requested a document"],
    lawyer_document_provided: ["Клиент предоставил документ", "Mijoz hujjat taqdim etdi", "Client shared a document"],
    lawyer_document_request_cancelled: ["Запрос документа отменён", "Hujjat so‘rovi bekor qilindi", "Document request cancelled"],
    lawyer_request_message_sent: ["Отправлено сообщение по делу", "Ish bo‘yicha xabar yuborildi", "Case message sent"],
    lawyer_consultation_proposed: ["Предложено время консультации", "Maslahat vaqti taklif qilindi", "Consultation time proposed"],
    lawyer_consultation_confirmed: ["Консультация подтверждена", "Maslahat tasdiqlandi", "Consultation confirmed"],
    lawyer_consultation_in_progress: ["Консультация началась", "Maslahat boshlandi", "Consultation started"],
    lawyer_consultation_completed: ["Консультация завершена", "Maslahat yakunlandi", "Consultation completed"],
    lawyer_consultation_cancelled: ["Консультация отменена", "Maslahat bekor qilindi", "Consultation cancelled"],
  };
  const value = labels[eventType];
  return value
    ? lawyerText(locale, value[0], value[1], value[2])
    : lawyerText(locale, "Обновление дела", "Ish yangilanishi", "Case updated");
}
function consultationFormatLabel(format: string, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    video: ["Видео", "Video", "Video"],
    phone: ["Телефон", "Telefon", "Phone"],
    office: ["Очно", "Ofisda", "In person"],
    chat: ["Чат", "Chat", "Chat"],
  };
  const value = labels[format];
  return value
    ? lawyerText(locale, value[0], value[1], value[2])
    : lawyerText(locale, "Консультация", "Maslahat", "Consultation");
}
function caseStatusLabel(status: string, locale: PlatformLocale) {
  const labels: Record<string, [string, string, string]> = {
    open: ["Открыто", "Ochiq", "Open"],
    completed: ["Завершено", "Yakunlangan", "Completed"],
    archived: ["В архиве", "Arxivda", "Archived"],
  };
  const value = labels[status];
  return value
    ? lawyerText(locale, value[0], value[1], value[2])
    : lawyerText(locale, "Дело", "Ish", "Case");
}
function legalAreaLabel(value: string, locale: PlatformLocale) {
  if (!isCaseScenarioId(value)) return lawyerText(locale, "Юридический вопрос", "Yuridik masala", "Legal matter");
  return CASE_SCENARIOS[value].label[locale];
}
function formatDate(value: string, locale: PlatformLocale) { return new Intl.DateTimeFormat(lawyerIntlLocale(locale), { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(value)); }
function toLocalDateTime(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
function nextLocalHour() { const date = new Date(Date.now() + 60 * 60_000); date.setMinutes(0, 0, 0); return toLocalDateTime(date.toISOString()); }
