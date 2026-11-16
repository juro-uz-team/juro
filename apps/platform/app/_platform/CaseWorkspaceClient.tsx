"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive,
  ArrowUpRight,
  BookOpenCheck,
  CalendarDays,
  CheckCircle2,
  CircleAlert,
  FilePenLine,
  FileSearch2,
  FileText,
  History,
  ListChecks,
  LoaderCircle,
  MessageSquareText,
  RotateCcw,
  Scale,
  ShieldCheck,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { platformApiError } from "../../content/platform-ui";
import { planAreaLabel, planStatusLabel, suggestedMatterTitle } from "../../lib/platform/plan-presentation";
import {
  CASE_SECTIONS,
  type CaseSection,
  type PlatformLocale,
} from "../../lib/platform/routing";
import { usePlatformBasePath } from "./PlatformRouteContext";

type Step = { id: string; title: string; status: string; dueAt?: string | null };
type CaseRecord = { sourceConversationId?: string | null; id: string; title: string; description?: string | null; legalArea: string; status: string; nextDeadlineAt?: string | null; archivedAt?: string | null; completedAt?: string | null; lifecycleRevision?: number; progressPercent?: number; steps?: Step[] };
type TaskComment = { id: string; taskId: string; body: string; createdAt: string; authorName?: string | null };
type Task = { id: string; title: string; description?: string | null; status: string; dueAt?: string | null; safeDueAt?: string | null; comments?: TaskComment[] };
type CaseDocument = { id: string; title: string; status: string; language: string; planStepId?: string | null; updatedAt: string };
type CaseActivity = { eventType: string; createdAt: string; metadata: Record<string, unknown> };
type CaseConversation = { id: string; title: string; status: string; locale: string; updatedAt: string };
type CaseComparison = { id: string; status: string; stage: string; overallRisk?: string | null; errorCode?: string | null; updatedAt: string };
type CaseAnalysis = { id: string; status: string; errorCode?: string | null; fileName: string; mimeType: string; updatedAt: string };
type CaseSource = { id: string; actTitle: string; actIdentifier?: string | null; officialUrl: string; status: string; locale: string; lastCheckedAt: string };
type CaseBookmark = { bookmarkId: string; sourceId: string; versionId: string; comment?: string | null; revision: number; createdAt: string; updatedAt: string; actTitle: string; actIdentifier?: string | null; officialUrl: string; locale: string; lastCheckedAt: string; isCurrentVersion: boolean };
type CaseParticipant = { userId: string; role: string; status: string; joinedAt: string; displayName: string; currentUser: boolean };
type CaseLawyerRequest = { id: string; status: string; updatedAt: string; lawyerName?: string | null; activeGrantId?: string | null; grantedAt?: string | null; expiresAt?: string | null };
type CaseWorkspaceData = {
  documents?: CaseDocument[];
  activity?: CaseActivity[];
  conversations?: CaseConversation[];
  comparisons?: CaseComparison[];
  analyses?: CaseAnalysis[];
  sources?: CaseSource[];
  bookmarks?: CaseBookmark[];
  participants?: CaseParticipant[];
  lawyerRequests?: CaseLawyerRequest[];
  error?: string;
};


function text(locale: PlatformLocale, ru: string, uz: string, en: string) {
  return { ru, uz, en }[locale];
}

function date(value: string | null | undefined, locale: PlatformLocale) {
  if (!value) return text(locale, "Не назначен", "Belgilanmagan", "Not set");
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00.000Z` : value);
  if (Number.isNaN(parsed.getTime())) return text(locale, "Не назначен", "Belgilanmagan", "Not set");
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { dateStyle: "medium", timeZone: "Asia/Tashkent" }).format(parsed);
}

export function CaseWorkspaceClient({
  locale,
  caseId,
  section = "overview",
}: {
  locale: PlatformLocale;
  caseId: string;
  section?: CaseSection;
}) {
  const router = useRouter();
  const base = usePlatformBasePath();
  const caseBase = `${base}/cases/${encodeURIComponent(caseId)}`;
  const [item, setItem] = useState<CaseRecord | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [workspaceData, setWorkspaceData] = useState<CaseWorkspaceData>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState("");
  const lifecycleKeys = useRef(new Map<string, string>());

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch(`/api/platform/cases?caseId=${encodeURIComponent(caseId)}`, { cache: "no-store" }).then(async (response) => { const body = await response.json() as { cases?: CaseRecord[]; error?: string }; if (!response.ok) throw new Error(body.error || "CASE_UNAVAILABLE"); return body.cases?.[0] ?? null; }),
      fetch(`/api/platform/cases/${encodeURIComponent(caseId)}/tasks`, { cache: "no-store" }).then(async (response) => { const body = await response.json() as { tasks?: Task[]; error?: string }; if (!response.ok) throw new Error(body.error || "TASKS_UNAVAILABLE"); return body.tasks ?? []; }),
      fetch(`/api/platform/cases/${encodeURIComponent(caseId)}/workspace`, { cache: "no-store" }).then(async (response) => { const body = await response.json() as CaseWorkspaceData; if (!response.ok) throw new Error(body.error || "CASE_WORKSPACE_UNAVAILABLE"); return body; }),
    ]).then(([record, caseTasks, data]) => {
      if (!cancelled) {
        setItem(record);
        setTasks(caseTasks);
        setWorkspaceData(data);
      }
    }).catch((cause: unknown) => {
      if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [caseId]);

  if (loading) return <div className="case-workspace-loading" aria-live="polite"><LoaderCircle />{text(locale, "Загружаем дело…", "Ish yuklanmoqda…", "Loading matter…")}</div>;
  if (error || !item) return <section className="case-workspace-empty"><CircleAlert /><h1>{text(locale, "Дело недоступно", "Ish mavjud emas", "Matter unavailable")}</h1><p>{text(locale, "Оно не найдено в текущем пространстве или доступ к нему изменён.", "U joriy makonda topilmadi yoki unga kirish o‘zgardi.", "It was not found in the current workspace, or your access has changed.")}</p><Link href={`${base}/cases`}>{text(locale, "К списку дел", "Ishlar ro‘yxatiga", "Back to matters")}</Link></section>;

  const complete = item.steps?.filter((step) => step.status === "completed").length ?? 0;

  async function changeLifecycle(action: "complete" | "reopen" | "archive") {
    const unresolvedTasks = tasks.filter((task) => !["completed", "cancelled"].includes(task.status)).length;
    const unresolvedSteps = (item?.steps ?? []).filter((step) => !["completed", "cancelled"].includes(step.status)).length;
    if (action === "complete" && (unresolvedTasks || unresolvedSteps)) {
      const accepted = window.confirm(text(
        locale,
        `Останутся незавершёнными: задач — ${unresolvedTasks}, шагов плана — ${unresolvedSteps}. Завершить дело?`,
        `Yakunlanmaganlari qoladi: vazifalar — ${unresolvedTasks}, reja qadamlari — ${unresolvedSteps}. Ish yakunlansinmi?`,
        `This will leave ${unresolvedTasks} tasks and ${unresolvedSteps} plan steps unfinished. Complete the matter?`,
      ));
      if (!accepted) return;
    }
    const idempotencyKey = lifecycleKeys.current.get(action) ?? `case-${action}-${crypto.randomUUID()}`;
    lifecycleKeys.current.set(action, idempotencyKey);
    setLifecycleBusy(action);
    setLifecycleError("");
    try {
      const response = await fetch(`/api/platform/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "x-juro-csrf": "1" },
        body: JSON.stringify({ action }),
      });
      const body = await response.json() as { status?: string; archivedAt?: string | null; completedAt?: string | null; lifecycleRevision?: number; error?: string; code?: string };
      if (!response.ok) throw new Error(body.code || body.error || "CASE_LIFECYCLE_FAILED");
      lifecycleKeys.current.delete(action);
      if (action === "archive") {
        router.replace(`${base}/archive`);
        return;
      }
      setItem((current) => current ? { ...current, status: body.status ?? current.status, archivedAt: body.archivedAt ?? null, completedAt: body.completedAt ?? null, lifecycleRevision: body.lifecycleRevision ?? current.lifecycleRevision } : current);
    } catch (cause) {
      setLifecycleError(localizedLifecycleError(cause instanceof Error ? cause.message : String(cause), locale));
    } finally {
      setLifecycleBusy("");
    }
  }

  return <section className="case-workspace" aria-labelledby="case-title">
    <nav className="matter-breadcrumbs" aria-label={text(locale,"Навигация по делу","Ish navigatsiyasi","Matter navigation")}><Link href={`${base}/cases`}>{text(locale,"Все дела","Barcha ishlar","All matters")}</Link><span aria-hidden="true">/</span><span>{text(locale,"Дело","Ish","Matter")}</span></nav>
    <header><div className="case-workspace-heading"><p>JURO · {text(locale, "Дело", "Ish", "Matter")}</p><h1 id="case-title">{suggestedMatterTitle(item.title)}</h1>{item.title.length>100 && <details className="matter-full-title"><summary className="juro-disclosure-summary">{text(locale,"Полное название","To‘liq nom","Full title")}</summary><p>{item.title}</p></details>}<span>{legalAreaLabel(item.legalArea, locale)} · {statusLabel(item.status, locale)}</span></div><div className="case-workspace-actions"><Link href={`${base}/action-plan/${encodeURIComponent(caseId)}`}><ListChecks />{text(locale, "План действий", "Harakatlar rejasi", "Action plan")}</Link><Link href={`${caseBase}/calendar`}><CalendarDays />{text(locale, "Сроки", "Muddatlar", "Deadlines")}</Link>{item.status === "completed" ? <><button type="button" disabled={Boolean(lifecycleBusy)} onClick={() => void changeLifecycle("reopen")}><RotateCcw />{text(locale, "Вернуть в работу", "Ishga qaytarish", "Reopen")}</button><button type="button" disabled={Boolean(lifecycleBusy)} onClick={() => void changeLifecycle("archive")}><Archive />{text(locale, "В архив", "Arxivga", "Archive")}</button></> : <button type="button" disabled={Boolean(lifecycleBusy)} onClick={() => void changeLifecycle("complete")}><CheckCircle2 />{text(locale, "Завершить дело", "Ishni yakunlash", "Complete matter")}</button>}</div></header>
    {lifecycleError && <p className="case-lifecycle-error" role="alert"><CircleAlert />{lifecycleError}</p>}
    <div className="case-workspace-summary"><article><small>{text(locale, "Прогресс плана", "Reja jarayoni", "Plan progress")}</small><strong>{item.progressPercent ?? 0}%</strong><span>{complete}/{item.steps?.length ?? 0} {text(locale, "шагов завершено", "qadam yakunlandi", "steps completed")}</span></article><article><small>{text(locale, "Ближайший срок", "Eng yaqin muddat", "Nearest deadline")}</small><strong>{date(item.nextDeadlineAt, locale)}</strong><span>{text(locale, "из активного плана", "faol rejadan", "from the active plan")}</span></article><article><small>{text(locale, "Задачи", "Vazifalar", "Tasks")}</small><strong>{tasks.length}</strong><span>{text(locale, "сохранены в этом деле", "ushbu ishda saqlangan", "saved in this matter")}</span></article></div>
    <nav className="case-workspace-tabs" aria-label={text(locale,"Разделы дела","Ish bo‘limlari","Matter sections")}>
      {(["overview","plan","calendar","documents","chat"] as CaseSection[]).map(name=><Link key={name} href={name==="plan"?`${base}/action-plan/${encodeURIComponent(caseId)}`:name==="overview"?caseBase:`${caseBase}/${name}`} aria-current={section===name?"page":undefined}>{sectionLabel(name,locale)}</Link>)}
      <details className="case-more-sections" open={!["overview","plan","calendar","documents","chat"].includes(section)}><summary className="juro-disclosure-summary">{text(locale,"Ещё","Yana","More")}</summary><div>{CASE_SECTIONS.filter(name=>!["overview","plan","calendar","documents","chat"].includes(name)).map(name=><Link key={name} href={`${caseBase}/${name}`} aria-current={section===name?"page":undefined}>{sectionLabel(name,locale)}</Link>)}</div></details>
    </nav>
    {(item.description || item.sourceConversationId) && <details className="case-context"><summary className="juro-disclosure-summary">{text(locale,"О деле и исходный ответ","Ish haqida va asl javob","Matter background and original answer")}</summary>{item.description && <p>{item.description}</p>}{item.sourceConversationId && <Link href={`${base}/ai-chat?conversationId=${encodeURIComponent(item.sourceConversationId)}`}>{text(locale,"Открыть исходный ответ JURO","JURO asl javobini ochish","Open the original JURO answer")}</Link>}</details>}
    <CaseSectionPanel section={section} locale={locale} base={base} item={item} tasks={tasks} data={workspaceData} />
  </section>;
}

function CaseSectionPanel({ section, locale, base, item, tasks, data }: { section: CaseSection; locale: PlatformLocale; base: string; item: CaseRecord; tasks: Task[]; data: CaseWorkspaceData }) {
  if (section === "overview") return <div className="case-workspace-grid case-workspace-overview"><TaskList tasks={tasks} locale={locale} action={<Link href={`${base}/action-plan/${encodeURIComponent(item.id)}`}>{text(locale,"Изменить статусы и сроки","Holat va muddatlarni o‘zgartirish","Edit statuses and deadlines")}</Link>} /></div>;
  if (section === "plan") return <section className="case-workspace-tab-panel"><PanelHeading icon={ListChecks} title={text(locale, "План и задачи", "Reja va vazifalar", "Plan and tasks")} action={<Link href={`${base}/action-plan/${encodeURIComponent(item.id)}`}>{text(locale, "Редактировать план", "Rejani tahrirlash", "Edit plan")}<ArrowUpRight /></Link>} /><div className="case-workspace-grid case-workspace-grid-inset"><PlanSteps item={item} locale={locale} base={base} embedded /><TaskList tasks={tasks} locale={locale} embedded /></div></section>;
  if (section === "calendar") return <SimpleList icon={CalendarDays} title={text(locale, "Сроки этого дела", "Ushbu ish muddatlari", "Matter deadlines")} empty={text(locale, "В подтверждённых задачах пока нет сроков.", "Tasdiqlangan vazifalarda hozircha muddat yo‘q.", "Confirmed tasks do not have any deadlines yet.")} items={tasks.filter((task) => task.dueAt).map((task) => ({ id: task.id, title: task.title, meta: `${date(task.dueAt, locale)} · ${statusLabel(task.status, locale)}`, trailing: task.safeDueAt ? `${text(locale, "Безопасная дата", "Xavfsiz sana", "Safe date")}: ${date(task.safeDueAt, locale)}` : undefined }))} action={<Link href={`${base}/calendar?caseId=${encodeURIComponent(item.id)}`}>{text(locale, "Открыть календарь", "Kalendarni ochish", "Open calendar")}<ArrowUpRight /></Link>} />;
  if (section === "documents") return <SimpleList icon={FileText} title={text(locale, "Документы дела", "Ish hujjatlari", "Matter documents")} empty={text(locale, "В дело ещё не привязаны документы.", "Ishga hali hujjatlar biriktirilmagan.", "No documents are linked to this matter yet.")} items={(data.documents ?? []).map((document) => ({ id: document.id, title: document.title, meta: `${statusLabel(document.status, locale)} · ${document.language}`, href: `${base}/documents/${encodeURIComponent(document.id)}` }))} action={<Link href={`${base}/document-builder?caseId=${encodeURIComponent(item.id)}`}>{text(locale, "Создать документ", "Hujjat yaratish", "Create document")}<ArrowUpRight /></Link>} />;
  if (section === "chat") return <SimpleList icon={MessageSquareText} title={text(locale, "Диалоги по делу", "Ish suhbatlari", "Matter conversations")} empty={text(locale, "К делу ещё не привязан AI-диалог.", "Ishga hali AI suhbati biriktirilmagan.", "No AI conversation is linked to this matter yet.")} items={(data.conversations ?? []).map((conversation) => ({ id: conversation.id, title: conversation.title, meta: `${statusLabel(conversation.status, locale)} · ${date(conversation.updatedAt, locale)}`, href: `${base}/ai-lawyer/chat/${encodeURIComponent(conversation.id)}` }))} action={<Link href={`${base}/ai-lawyer/new?caseId=${encodeURIComponent(item.id)}`}>{text(locale, "Задать вопрос по делу", "Ish bo‘yicha savol berish", "Ask about this matter")}<ArrowUpRight /></Link>} />;
  if (section === "analyses") return <SimpleList icon={FileSearch2} title={text(locale, "Анализы и сравнения", "Tahlil va taqqoslashlar", "Analyses and comparisons")} empty={text(locale, "К делу ещё не привязаны анализы или сравнения документов.", "Ishga hali hujjat tahlili yoki taqqoslash biriktirilmagan.", "No document analyses or comparisons are linked to this matter yet.")} items={[
    ...(data.analyses ?? []).map((analysis) => ({ id: `analysis:${analysis.id}`, title: analysis.fileName, meta: `${statusLabel(analysis.status, locale)} · ${date(analysis.updatedAt, locale)}`, href: `${base}/document-review?analysisId=${encodeURIComponent(analysis.id)}&caseId=${encodeURIComponent(item.id)}` })),
    ...(data.comparisons ?? []).map((comparison) => ({ id: `comparison:${comparison.id}`, title: text(locale, "Сравнение версий документа", "Hujjat nusxalarini taqqoslash", "Document version comparison"), meta: `${statusLabel(comparison.status, locale)}${comparison.overallRisk ? ` · ${riskLabel(comparison.overallRisk, locale)}` : ""} · ${date(comparison.updatedAt, locale)}`, href: `${base}/documents/comparisons/${encodeURIComponent(comparison.id)}` })),
  ]} action={<Link href={`${base}/document-review?caseId=${encodeURIComponent(item.id)}`}>{text(locale, "Анализировать документ", "Hujjatni tahlil qilish", "Analyze document")}<ArrowUpRight /></Link>} />;
  if (section === "sources") return <CaseSourcesPanel locale={locale} sources={data.sources ?? []} initialBookmarks={data.bookmarks ?? []} />;
  if (section === "participants") return <SimpleList icon={UsersRound} title={text(locale, "Участники пространства", "Makon ishtirokchilari", "Workspace members")} empty={text(locale, "Активных участников нет.", "Faol ishtirokchilar yo‘q.", "No active members.")} note={text(locale, "Сейчас доступ к делу наследуется от активного workspace. Отдельные временные права юриста показаны в разделе «Доступ».", "Hozir ishga kirish faol workspace orqali meros bo‘ladi. Yuristning alohida vaqtinchalik huquqlari «Ruxsat» bo‘limida ko‘rsatiladi.", "Matter access currently inherits from the active workspace. Separate temporary lawyer permissions appear under Access.")} items={(data.participants ?? []).map((participant) => ({ id: participant.userId, title: participant.currentUser ? `${participant.displayName} · ${text(locale, "вы", "siz", "you")}` : participant.displayName, meta: `${roleLabel(participant.role, locale)} · ${date(participant.joinedAt, locale)}` }))} />;
  if (section === "lawyer") return <SimpleList icon={Scale} title={text(locale, "Живой юрист", "Jonli yurist", "Lawyer")} empty={text(locale, "По этому делу ещё нет заявки юристу.", "Bu ish bo‘yicha yuristga so‘rov yo‘q.", "No lawyer request has been made for this matter yet.")} items={(data.lawyerRequests ?? []).map((request) => ({ id: request.id, title: request.lawyerName || text(locale, "Назначение юриста ожидается", "Yurist tayinlanishi kutilmoqda", "Awaiting lawyer assignment"), meta: `${statusLabel(request.status, locale)} · ${date(request.updatedAt, locale)}`, trailing: request.activeGrantId ? text(locale, "Доступ активен", "Ruxsat faol", "Access active") : undefined }))} action={<Link href={`${base}/lawyers?caseId=${encodeURIComponent(item.id)}`}>{text(locale, "Выбрать юриста", "Yurist tanlash", "Choose a lawyer")}<ArrowUpRight /></Link>} />;
  if (section === "access") return <section className="case-workspace-tab-panel"><PanelHeading icon={ShieldCheck} title={text(locale, "Доступ к делу", "Ishga ruxsat", "Matter access")} /><p className="case-workspace-note">{text(locale, "Базовый доступ имеют активные участники текущего workspace. Временный доступ юриста выдаётся только после отдельного подтверждения и может быть отозван.", "Asosiy ruxsat joriy workspace faol ishtirokchilariga beriladi. Yuristga vaqtinchalik ruxsat faqat alohida tasdiqdan keyin beriladi va bekor qilinishi mumkin.", "Active members of the current workspace have standard access. Temporary lawyer access requires separate confirmation and can be revoked.")}</p><div className="case-access-grid"><SimpleListContent items={(data.participants ?? []).map((participant) => ({ id: participant.userId, title: participant.currentUser ? `${participant.displayName} · ${text(locale, "вы", "siz", "you")}` : participant.displayName, meta: `${roleLabel(participant.role, locale)} · ${text(locale, "доступ через workspace", "workspace orqali ruxsat", "access via workspace")}` }))} empty={text(locale, "Активных участников нет.", "Faol ishtirokchilar yo‘q.", "No active members.")} /><SimpleListContent items={(data.lawyerRequests ?? []).filter((request) => request.activeGrantId).map((request) => ({ id: request.id, title: request.lawyerName || text(locale, "Назначенный юрист", "Tayinlangan yurist", "Assigned lawyer"), meta: `${text(locale, "Предоставлен", "Berilgan", "Granted")}: ${date(request.grantedAt, locale)}`, trailing: request.expiresAt ? `${text(locale, "до", "gacha", "until")} ${date(request.expiresAt, locale)}` : text(locale, "до отзыва", "bekor qilinguncha", "until revoked") }))} empty={text(locale, "Активного доступа юриста нет.", "Yuristning faol ruxsati yo‘q.", "No active lawyer access.")} /></div></section>;
  return <SimpleList icon={History} title={text(locale, "Активность дела", "Ish faolligi", "Matter activity")} empty={text(locale, "Событий пока нет.", "Hozircha hodisalar yo‘q.", "No events yet.")} items={(data.activity ?? []).map((event, index) => ({ id: `${event.createdAt}-${index}`, title: activityLabel(event.eventType, locale), meta: date(event.createdAt, locale) }))} />;
}

function PanelHeading({ icon: Icon, title, action }: { icon: typeof FileText; title: string; action?: ReactNode }) {
  return <div className="case-workspace-section-head"><div><Icon aria-hidden="true" /><h2>{title}</h2></div>{action}</div>;
}

type SimpleItem = { id: string; title: string; meta: string; trailing?: string; href?: string; externalHref?: string };

function SimpleList({ icon, title, empty, items, action, note }: { icon: typeof FileText; title: string; empty: string; items: SimpleItem[]; action?: ReactNode; note?: string }) {
  return <section className="case-workspace-tab-panel"><PanelHeading icon={icon} title={title} action={action} />{note && <p className="case-workspace-note">{note}</p>}<SimpleListContent items={items} empty={empty} /></section>;
}

function SimpleListContent({ items, empty }: { items: SimpleItem[]; empty: string }) {
  if (!items.length) return <p className="case-workspace-muted">{empty}</p>;
  return <ul className="case-workspace-records">{items.map((entry) => <li key={entry.id}><div><strong>{entry.title}</strong><span>{entry.meta}</span>{entry.trailing && <em>{entry.trailing}</em>}</div>{entry.href ? <Link href={entry.href}><ArrowUpRight /><span className="sr-only">{entry.title}</span></Link> : entry.externalHref ? <a href={entry.externalHref} target="_blank" rel="noreferrer"><ArrowUpRight /><span className="sr-only">{entry.title}</span></a> : null}</li>)}</ul>;
}

function CaseSourcesPanel({ locale, sources, initialBookmarks }: { locale: PlatformLocale; sources: CaseSource[]; initialBookmarks: CaseBookmark[] }) {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [busyId, setBusyId] = useState("");
  const [status, setStatus] = useState("");

  async function removeBookmark(bookmark: CaseBookmark) {
    setBusyId(bookmark.bookmarkId);
    setStatus("");
    try {
      const response = await fetch(`/api/platform/legal-bookmarks/${encodeURIComponent(bookmark.bookmarkId)}`, {
        method: "DELETE",
        headers: {
          "content-type": "application/json",
          "idempotency-key": `legal-bookmark-archive-${crypto.randomUUID()}`,
          "x-juro-csrf": "1",
        },
        body: JSON.stringify({ revision: bookmark.revision }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, text(locale, "Закладка не удалена.", "Xatcho‘p olib tashlanmadi.", "The bookmark could not be removed.")));
      setBookmarks((current) => current.filter((item) => item.bookmarkId !== bookmark.bookmarkId));
      setStatus(text(locale, "Закладка удалена из дела.", "Xatcho‘p ishdan olib tashlandi.", "Bookmark removed from the matter."));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusyId("");
    }
  }

  return <section className="case-workspace-tab-panel case-sources-panel">
    <PanelHeading icon={BookOpenCheck} title={text(locale, "Источники дела", "Ish manbalari", "Matter sources")} />
    <p className="case-workspace-note">{text(locale, "Сохранённые нормы закреплены за проверенной версией. JURO не заменяет их новой редакцией без вашего ведома.", "Saqlangan normalar tekshirilgan versiyaga biriktiriladi. JURO ularni siz bilmasdan yangi tahrir bilan almashtirmaydi.", "Saved legal rules remain attached to the verified version. JURO will not replace them with a newer revision without telling you.")}</p>
    <output className="case-bookmark-status" aria-live="polite">{status}</output>
    {bookmarks.length > 0 && <div className="case-bookmark-group"><h3>{text(locale, "Мои закладки", "Mening xatcho‘plarim", "My bookmarks")}</h3><ul className="case-bookmark-list">{bookmarks.map((bookmark) => <li key={bookmark.bookmarkId}>
      <div>
        <strong>{bookmark.actTitle}</strong>
        <span>{bookmark.actIdentifier || text(locale, "Официальный источник", "Rasmiy manba", "Official source")} · {bookmark.isCurrentVersion ? text(locale, "текущая версия", "joriy versiya", "current version") : text(locale, "сохранённая историческая версия", "saqlangan tarixiy versiya", "saved historical version")}</span>
        {bookmark.comment && <p>{bookmark.comment}</p>}
      </div>
      <div className="case-bookmark-actions">
        {safeOfficialUrl(bookmark.officialUrl) && <a href={bookmark.officialUrl} target="_blank" rel="noreferrer"><ArrowUpRight /><span className="sr-only">{text(locale, "Открыть официальный источник", "Rasmiy manbani ochish", "Open official source")}</span></a>}
        <button type="button" disabled={busyId === bookmark.bookmarkId} aria-label={text(locale, `Удалить закладку «${bookmark.actTitle}»`, `«${bookmark.actTitle}» xatcho‘pini olib tashlash`, `Remove bookmark “${bookmark.actTitle}”`)} onClick={() => void removeBookmark(bookmark)}><Trash2 /></button>
      </div>
    </li>)}</ul></div>}
    <div className="case-bookmark-group"><h3>{text(locale, "Источники из AI-диалогов дела", "Ishdagi AI suhbatlari manbalari", "Sources from this matter's AI conversations")}</h3><SimpleListContent items={sources.map((source) => ({ id: source.id, title: source.actTitle, meta: `${source.actIdentifier || text(locale, "Официальный источник", "Rasmiy manba", "Official source")} · ${date(source.lastCheckedAt, locale)}`, externalHref: safeOfficialUrl(source.officialUrl) ? source.officialUrl : undefined }))} empty={text(locale, "Подтверждённых источников в диалогах этого дела пока нет.", "Bu ish suhbatlarida hozircha tasdiqlangan manba yo‘q.", "No verified sources appear in this matter's conversations yet.")} /></div>
  </section>;
}

function PlanSteps({ item, locale, base, embedded = false }: { item: CaseRecord; locale: PlatformLocale; base: string; embedded?: boolean }) {
  return <section className={embedded ? "case-workspace-embedded" : undefined}><PanelHeading icon={FilePenLine} title={text(locale, "Следующие шаги", "Keyingi qadamlar", "Next steps")} action={!embedded ? <Link href={`${base}/action-plan/${encodeURIComponent(item.id)}`}>{text(locale, "Открыть план", "Rejani ochish", "Open plan")}</Link> : undefined} />{item.steps?.length ? <ol className="case-workspace-steps">{item.steps.map((step) => <li key={step.id}><CheckCircle2 className={step.status === "completed" ? "done" : undefined} /><div><strong>{step.title}</strong><span>{date(step.dueAt, locale)} · {statusLabel(step.status, locale)}</span></div></li>)}</ol> : <p className="case-workspace-muted">{text(locale, "В плане пока нет шагов.", "Rejada hozircha qadam yo‘q.", "The plan has no steps yet.")}</p>}</section>;
}

function TaskList({ tasks, locale, embedded = false, action }: { tasks: Task[]; locale: PlatformLocale; embedded?: boolean; action?: ReactNode }) {
  return <section className={embedded ? "case-workspace-embedded" : undefined}><PanelHeading icon={ListChecks} title={text(locale, "Задачи", "Vazifalar", "Tasks")} action={action} />{tasks.length ? <ul className="case-workspace-tasks">{tasks.map((task) => <li key={task.id}><div className="case-workspace-task-copy"><strong>{task.title}</strong>{task.description && <p>{task.description}</p>}<span>{date(task.dueAt, locale)}</span>{Boolean(task.comments?.length) && <ol className="case-workspace-task-comments" aria-label={text(locale, "Комментарии юриста", "Yurist izohlari", "Lawyer comments")}>{task.comments?.map((comment) => <li key={comment.id}><MessageSquareText aria-hidden="true" /><div><strong>{comment.authorName || text(locale, "Юрист", "Yurist", "Lawyer")}</strong><p>{comment.body}</p><time>{date(comment.createdAt, locale)}</time></div></li>)}</ol>}</div><b>{statusLabel(task.status, locale)}</b></li>)}</ul> : <p className="case-workspace-muted">{text(locale, "Подтвердите план, чтобы создать задачи и напоминания.", "Vazifalar va eslatmalar yaratish uchun rejani tasdiqlang.", "Confirm the plan to create tasks and reminders.")}</p>}</section>;
}

function sectionLabel(section: CaseSection, locale: PlatformLocale) {
  const labels: Record<CaseSection, Record<PlatformLocale, string>> = {
    overview: { ru: "Обзор", uz: "Umumiy", en: "Overview" }, chat: { ru: "Чат", uz: "Suhbat", en: "Chat" }, documents: { ru: "Документы", uz: "Hujjatlar", en: "Documents" }, analyses: { ru: "Анализы", uz: "Tahlillar", en: "Analyses" }, plan: { ru: "План", uz: "Reja", en: "Plan" }, calendar: { ru: "Сроки", uz: "Muddatlar", en: "Deadlines" }, sources: { ru: "Источники", uz: "Manbalar", en: "Sources" }, participants: { ru: "Участники", uz: "Ishtirokchilar", en: "Members" }, lawyer: { ru: "Юрист", uz: "Yurist", en: "Lawyer" }, activity: { ru: "Активность", uz: "Faollik", en: "Activity" }, access: { ru: "Доступ", uz: "Ruxsat", en: "Access" },
  };
  return labels[section][locale];
}

function activityLabel(eventType: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    case_created: { ru: "Дело создано", uz: "Ish yaratildi", en: "Matter created" },
    step_updated: { ru: "Шаг плана обновлён", uz: "Reja qadami yangilandi", en: "Plan step updated" },
    plan_changes_confirmed: { ru: "Изменения плана подтверждены", uz: "Reja o‘zgarishlari tasdiqlandi", en: "Plan changes confirmed" },
    tasks_created: { ru: "Задачи из плана подтверждены", uz: "Rejadagi vazifalar tasdiqlandi", en: "Plan tasks confirmed" },
    document_created: { ru: "Документ добавлен", uz: "Hujjat qo‘shildi", en: "Document added" },
    document_linked: { ru: "Документ добавлен в дело", uz: "Hujjat ishga qo‘shildi", en: "Document linked to matter" },
    document_unlinked: { ru: "Документ удалён из дела", uz: "Hujjat ishdan olib tashlandi", en: "Document removed from matter" },
    analysis_linked: { ru: "Анализ добавлен в дело", uz: "Tahlil ishga qo‘shildi", en: "Analysis linked to matter" },
    analysis_unlinked: { ru: "Анализ удалён из дела", uz: "Tahlil ishdan olib tashlandi", en: "Analysis removed from matter" },
    legal_bookmark_saved: { ru: "Правовой источник сохранён", uz: "Huquqiy manba saqlandi", en: "Legal source saved" },
    legal_bookmark_removed: { ru: "Правовая закладка удалена", uz: "Huquqiy xatcho‘p olib tashlandi", en: "Legal bookmark removed" },
    lawyer_task_created: { ru: "Юрист добавил задачу", uz: "Yurist vazifa qo‘shdi", en: "Lawyer added a task" },
    lawyer_task_updated: { ru: "Юрист обновил задачу", uz: "Yurist vazifani yangiladi", en: "Lawyer updated a task" },
    lawyer_task_comment_added: { ru: "Юрист добавил комментарий", uz: "Yurist izoh qo‘shdi", en: "Lawyer added a comment" },
    lawyer_document_requested: { ru: "Юрист запросил документ", uz: "Yurist hujjat so‘radi", en: "Lawyer requested a document" },
    lawyer_document_provided: { ru: "Клиент предоставил документ", uz: "Mijoz hujjat taqdim etdi", en: "Client provided a document" },
    lawyer_document_request_cancelled: { ru: "Запрос документа отменён", uz: "Hujjat so‘rovi bekor qilindi", en: "Document request cancelled" },
  };
  return labels[eventType]?.[locale] || text(locale, "Дело обновлено", "Ish yangilandi", "Matter updated");
}

function statusLabel(status: string, locale: PlatformLocale) {
  if (["planned","not_started","in_progress","waiting_user","waiting_response","overdue","completed","cancelled"].includes(status)) return planStatusLabel(status,locale);
  const labels: Record<string, Record<PlatformLocale, string>> = {
    open: { ru: "Открыто", uz: "Ochiq", en: "Open" }, active: { ru: "Активно", uz: "Faol", en: "Active" }, completed: { ru: "Завершено", uz: "Yakunlangan", en: "Completed" }, archived: { ru: "В архиве", uz: "Arxivda", en: "Archived" }, not_started: { ru: "Не начато", uz: "Boshlanmagan", en: "Not started" }, in_progress: { ru: "В работе", uz: "Jarayonda", en: "In progress" }, waiting_information: { ru: "Ожидает данных", uz: "Ma’lumot kutilmoqda", en: "Awaiting information" }, cancelled: { ru: "Отменено", uz: "Bekor qilingan", en: "Cancelled" }, queued: { ru: "В очереди", uz: "Navbatda", en: "Queued" }, processing: { ru: "Обрабатывается", uz: "Qayta ishlanmoqda", en: "Processing" }, failed: { ru: "Ошибка", uz: "Xato", en: "Failed" }, unassigned: { ru: "Ожидает назначения", uz: "Tayinlash kutilmoqda", en: "Awaiting assignment" }, conflict_check_pending: { ru: "Проверка конфликта", uz: "Manfaatlar to‘qnashuvi tekshirilmoqda", en: "Conflict check" }, awaiting_user_consent: { ru: "Ожидает подтверждения", uz: "Tasdiq kutilmoqda", en: "Awaiting confirmation" }, access_granted: { ru: "Доступ предоставлен", uz: "Ruxsat berilgan", en: "Access granted" }, access_revoked: { ru: "Доступ отозван", uz: "Ruxsat bekor qilingan", en: "Access revoked" },
  };
  return labels[status]?.[locale] || status.replaceAll("_", " ");
}

function legalAreaLabel(legalArea: string, locale: PlatformLocale) {
  return planAreaLabel(legalArea,locale);
}

function localizedLifecycleError(code: string, locale: PlatformLocale) {
  if (code.includes("CASE_LIFECYCLE_INVALID")) return text(locale, "Это действие недоступно в текущем состоянии дела.", "Bu amal ishning joriy holatida mavjud emas.", "This action is unavailable in the matter's current state.");
  if (code.includes("CASE_LIFECYCLE_CONFLICT")) return text(locale, "Дело уже изменилось. Обновите страницу и повторите.", "Ish allaqachon o‘zgargan. Sahifani yangilab, qayta urinib ko‘ring.", "The matter has already changed. Refresh the page and try again.");
  if (code.includes("CASE_UNAVAILABLE")) return text(locale, "Дело не найдено в текущем пространстве.", "Ish joriy makonda topilmadi.", "The matter was not found in the current workspace.");
  return text(locale, "Не удалось изменить состояние дела.", "Ish holatini o‘zgartirib bo‘lmadi.", "We could not change the matter status.");
}

function roleLabel(role: string, locale: PlatformLocale) {
  if (role === "owner") return text(locale, "Владелец", "Egasi", "Owner");
  return text(locale, "Участник", "Ishtirokchi", "Member");
}

function riskLabel(risk: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = { critical: { ru: "Критический риск", uz: "Kritik xavf", en: "Critical risk" }, high: { ru: "Высокий риск", uz: "Yuqori xavf", en: "High risk" }, medium: { ru: "Средний риск", uz: "O‘rta xavf", en: "Medium risk" }, low: { ru: "Низкий риск", uz: "Past xavf", en: "Low risk" } };
  return labels[risk]?.[locale] || risk;
}

function safeOfficialUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (url.hostname === "lex.uz" || url.hostname.endsWith(".lex.uz"));
  } catch {
    return false;
  }
}
