"use client";

import { DateTimePicker } from "../_components/ProfileControls";
import { Select } from "../_components/Select";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { planAreaLabel, planStatusLabel, suggestedMatterTitle } from "../../lib/platform/plan-presentation";
import {
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  FilePenLine,
  LoaderCircle,
  Plus,
  RotateCcw,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import { caseDirectionsForAccount, caseScenariosForAccount, type CaseDirectionId } from "../../lib/platform/case-create";
import type {
  DeadlineCalculationInput,
  DeadlineCalculationResult,
} from "../../lib/platform/deadline-calculator";
import { formatPlatformDate, formatPlatformDateTime, formatPlatformDayMonth } from "../../lib/platform/date-time";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import { usePlatformBasePath } from "./PlatformRouteContext";

type StepStatus =
  | "not_started"
  | "in_progress"
  | "waiting_user"
  | "waiting_response"
  | "overdue"
  | "completed"
  | "cancelled";

type Step = {
  id: string;
  ordinal: number;
  title: string;
  description?: string;
  status: StepStatus;
  dueAt?: string;
  sourceDate?: string;
  safeDueAt?: string;
  deadlineType?: "calendar_days" | "business_days";
  calculationMethod?: string;
  legalBasis?: string;
  deadlineConfidence?: "unverified" | "preliminary" | "source_verified";
  actionType?: string;
  templateCode?: string;
  revision: number;
};

type Case = {
  sourceConversationId?: string | null;
  unlinkedStepCount?: number;
  id: string;
  title: string;
  description?: string;
  legalArea: string;
  status: string;
  updatedAt: string;
  planId: string;
  planTitle: string;
  planStatus: string;
  progressPercent: number;
  planRevision: number;
  steps: Step[];
};

type PendingPlanChange = {
  id: string;
  status: StepStatus;
  dueAt: string | null;
  revision: number;
  deadlineCalculation?: DeadlineCalculationInput | null;
};

type DeadlineDraft = {
  sourceDate: string;
  daysCount: string;
  dayType: "calendar_days" | "business_days";
  includeSourceDate: boolean;
  rollRule: "none" | "next_business_day" | "previous_business_day";
  safeMarginBusinessDays: string;
  legalBasis: string;
  loading?: boolean;
  error?: string;
  result?: DeadlineCalculationResult;
};

type PlanSnapshot = {
  version: number;
  status: string;
  progressPercent: number;
  steps: Array<{ id: string; title: string; status: string; dueAt: string | null }>;
};

type PlanVersion = {
  id: string;
  version: number;
  reason: string;
  createdAt: string;
  snapshot: PlanSnapshot | null;
};

function initialDeadlineDraft(step: Step): DeadlineDraft {
  return {
    sourceDate: step.sourceDate?.slice(0, 10) ?? "",
    daysCount: "",
    dayType: step.deadlineType ?? "calendar_days",
    includeSourceDate: false,
    rollRule: "none",
    safeMarginBusinessDays: "1",
    legalBasis: step.legalBasis ?? "",
  };
}

function localizedText(locale: PlatformLocale, ru: string, uz: string, en: string) {
  return { ru, uz, en }[locale];
}

export function ActionPlanClient({
  locale,
  accountType,
  initialCaseId,
}: {
  locale: PlatformLocale;
  accountType: AccountType;
  initialCaseId?: string;
}) {
  const t = (ru: string, uz: string, en: string) => localizedText(locale, ru, uz, en);
  const base = usePlatformBasePath();
  const params = useSearchParams();
  const router = useRouter();
  const [notice,setNotice] = useState(params.get("saved")==="1" ? t("План сохранён. Здесь можно менять статусы и назначать сроки.","Reja saqlandi. Bu yerda holat va muddatlarni o‘zgartirishingiz mumkin.","Plan saved. You can update statuses and set deadlines here.") : "");
  const directions = caseDirectionsForAccount(accountType);
  const [direction, setDirection] = useState<CaseDirectionId>(directions[0]?.id ?? "employment");
  const scenarioCatalog = useMemo(() => caseScenariosForAccount(accountType, direction), [accountType, direction]);
  const [cases, setCases] = useState<Case[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(() =>
    caseScenariosForAccount(accountType, directions[0]?.id ?? "employment")[0]?.id ?? "unpaid-salary",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingChangesByCase, setPendingChangesByCase] = useState<Record<string, Record<string, PendingPlanChange>>>({});
  const [applyingChangesFor, setApplyingChangesFor] = useState<string | null>(null);
  const [openCase, setOpenCase] = useState<string | null>(initialCaseId ?? null);
  const [versionsByCase, setVersionsByCase] = useState<Record<string, PlanVersion[]>>({});
  const [selectedHistoryVersionByCase, setSelectedHistoryVersionByCase] = useState<Record<string, string>>({});
  const [loadingVersionsFor, setLoadingVersionsFor] = useState<string | null>(null);
  const [creatingTasksFor, setCreatingTasksFor] = useState<string | null>(null);
  const [deadlineDrafts, setDeadlineDrafts] = useState<Record<string, DeadlineDraft>>({});

  const hasPendingChanges=Object.values(pendingChangesByCase).some(changes=>Object.keys(changes).length>0);
  useEffect(()=>{
    if(!hasPendingChanges)return;
    const warn=(event:BeforeUnloadEvent)=>{event.preventDefault();};
    window.addEventListener("beforeunload",warn);
    return()=>window.removeEventListener("beforeunload",warn);
  },[hasPendingChanges]);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(initialCaseId ? `/api/platform/cases?caseId=${encodeURIComponent(initialCaseId)}` : "/api/platform/cases", { cache: "no-store" });
      const data = await response.json() as { cases?: Case[]; error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, data.error, localizedText(locale, "Ошибка загрузки", "Yuklashda xato yuz berdi", "We could not load the action plans.")));
      setCases(data.cases || []);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [initialCaseId, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  async function loadVersionHistory(item: Case) {
    if (loadingVersionsFor === item.id) return;
    setLoadingVersionsFor(item.id);
    setError("");
    try {
      const response = await fetch("/api/platform/cases/" + item.id + "/plan-versions", { cache: "no-store" });
      const data = await response.json() as { versions?: PlanVersion[]; error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, data.error, t("Не удалось загрузить историю.", "Tarixni yuklab bo‘lmadi.", "We could not load the version history.")));
      setVersionsByCase((current) => ({ ...current, [item.id]: data.versions || [] }));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoadingVersionsFor(null);
    }
  }
  async function create(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setError("");
    try {
      const response = await fetch("/api/platform/cases", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ title, description, legalArea: selected, locale, accountType }),
      });
      const data = await response.json() as { caseId?: string; error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, data.error, t("Не удалось создать дело и план.", "Ish va reja yaratilmadi.", "We could not create the matter and plan.")));
      setTitle("");
      setDescription("");
      if (data.caseId) router.push(`${base}/action-plan/${data.caseId}?saved=1`);
      else await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setCreating(false);
    }
  }

  function stageStepChange(item: Case, step: Step, patch: Partial<Pick<PendingPlanChange, "status" | "dueAt" | "deadlineCalculation">>) {
    setNotice("");
    const current = pendingChangesByCase[item.id]?.[step.id];
    const next: PendingPlanChange = {
      id: step.id,
      status: patch.status ?? current?.status ?? step.status,
      dueAt: "dueAt" in patch ? patch.dueAt ?? null : current ? current.dueAt : step.dueAt?.slice(0, 10) ?? null,
      revision: step.revision,
      deadlineCalculation: "deadlineCalculation" in patch
        ? patch.deadlineCalculation
        : current?.deadlineCalculation,
    };
    const unchanged = next.status === step.status
      && next.dueAt === (step.dueAt?.slice(0, 10) ?? null)
      && next.deadlineCalculation === undefined;
    setPendingChangesByCase((all) => {
      const caseChanges = { ...(all[item.id] || {}) };
      if (unchanged) delete caseChanges[step.id];
      else caseChanges[step.id] = next;
      return { ...all, [item.id]: caseChanges };
    });
  }

  function updateDeadlineDraft(item: Case, step: Step, patch: Partial<DeadlineDraft>) {
    const key = `${item.id}:${step.id}`;
    setDeadlineDrafts((all) => ({
      ...all,
      [key]: { ...(all[key] ?? initialDeadlineDraft(step)), ...patch, error: "" },
    }));
  }

  function clearDeadlineResultsForCase(caseId: string) {
    setDeadlineDrafts((all) => Object.fromEntries(Object.entries(all).map(([key, draft]) => [
      key,
      key.startsWith(`${caseId}:`) ? { ...draft, result: undefined, error: "" } : draft,
    ])));
  }

  async function previewDeadline(item: Case, step: Step) {
    const key = `${item.id}:${step.id}`;
    const draft = deadlineDrafts[key] ?? initialDeadlineDraft(step);
    const input: DeadlineCalculationInput = {
      sourceDate: draft.sourceDate,
      daysCount: Number(draft.daysCount),
      dayType: draft.dayType,
      includeSourceDate: draft.includeSourceDate,
      rollRule: draft.rollRule,
      holidays: [],
      holidayCalendarVersion: null,
      businessCalendar: "uz-five-day",
      safeMarginBusinessDays: Number(draft.safeMarginBusinessDays),
      legalBasis: draft.legalBasis.trim() || null,
    };
    setDeadlineDrafts((all) => ({ ...all, [key]: { ...draft, loading: true, error: "" } }));
    try {
      const response = await fetch(`/api/platform/cases/${item.id}/steps/${step.id}/deadline`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify(input),
      });
      const data = await response.json() as { result?: DeadlineCalculationResult; error?: string };
      if (!response.ok || !data.result) throw new Error(platformApiError(locale, data.error, t("Не удалось рассчитать срок.", "Muddatni hisoblab bo‘lmadi.", "We could not calculate the deadline.")));
      setDeadlineDrafts((all) => ({ ...all, [key]: { ...draft, loading: false, result: data.result } }));
      stageStepChange(item, step, { dueAt: data.result.dueDate, deadlineCalculation: input });
    } catch (value) {
      setDeadlineDrafts((all) => ({
        ...all,
        [key]: { ...draft, loading: false, error: value instanceof Error ? value.message : String(value) },
      }));
    }
  }

  async function applyStagedChanges(item: Case) {
    const changes = Object.values(pendingChangesByCase[item.id] || {});
    if (!changes.length || applyingChangesFor === item.id) return;
    setApplyingChangesFor(item.id);
    setError("");
    try {
      const response = await fetch(`/api/platform/cases/${item.id}/plan`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ revision: item.planRevision, changes }),
      });
      const data = await response.json() as { error?: string };
      if (response.status === 409) {
        setPendingChangesByCase((all) => ({ ...all, [item.id]: {} }));
        clearDeadlineResultsForCase(item.id);
        await load();
        setError(t("План изменён в другой вкладке. Показаны актуальные данные.", "Reja boshqa oynada o‘zgartirilgan. Amaldagi ma’lumotlar ko‘rsatildi.", "The plan changed in another tab. The latest data is now shown."));
        return;
      }
      if (!response.ok) throw new Error(platformApiError(locale, data.error, t("Не удалось применить изменения плана.", "Reja o‘zgarishlarini qo‘llab bo‘lmadi.", "We could not apply the plan changes.")));
      setPendingChangesByCase((all) => ({ ...all, [item.id]: {} }));
      clearDeadlineResultsForCase(item.id);
      setVersionsByCase((all) => ({ ...all, [item.id]: [] }));
      await load();
      setNotice(t("Изменения сохранены. Задачи и сроки обновлены.","O‘zgarishlar saqlandi. Vazifa va muddatlar yangilandi.","Changes saved. Tasks and deadlines are up to date."));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setApplyingChangesFor(null);
    }
  }

  async function createTasks(item: Case) {
    if (creatingTasksFor === item.id) return;
    setCreatingTasksFor(item.id); setError("");
    try {
      const response = await fetch(`/api/platform/cases/${item.id}/tasks`, { method: "POST", headers: { "x-juro-csrf": "1" } });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, data.error, t("Не удалось создать задачи.", "Vazifalarni yaratib bo‘lmadi.", "We could not create the tasks.")));
      await load();
      setNotice(t("Задачи добавлены в дело.","Vazifalar ishga qo‘shildi.","Tasks added to the matter."));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setCreatingTasksFor(null); }
  }

  const deadlines = useMemo(
    () => cases.flatMap((item) => item.steps
      .filter((step) => step.dueAt && !["completed", "cancelled"].includes(step.status))
      .map((step) => ({ date: step.dueAt!, title: step.title, caseTitle: item.title })))
      .sort((a, b) => a.date.localeCompare(b.date)),
    [cases],
  );

  return <div className="plan-workspace" onClickCapture={event=>{
    if(hasPendingChanges&&(event.target as HTMLElement).closest("a[href]")&&!window.confirm(t("Есть несохранённые изменения. Выйти без сохранения?","Saqlanmagan o‘zgarishlar bor. Saqlamasdan chiqilsinmi?","You have unsaved changes. Leave without saving?"))){event.preventDefault();event.stopPropagation();}
  }}>
    {initialCaseId && <nav className="matter-breadcrumbs" aria-label={t("Навигация по плану","Reja navigatsiyasi","Plan navigation")}><Link href={`${base}/action-plan`}>{t("Все планы","Barcha rejalar","All plans")}</Link>{initialCaseId && <><span aria-hidden="true">/</span><Link href={`${base}/cases/${encodeURIComponent(initialCaseId)}`}>{t("Дело","Ish","Matter")}</Link></>}</nav>}
    {notice && <p className="plan-success" role="status"><Check aria-hidden="true" />{notice}</p>}
    <section className="plan-heading">
      <div>
        <small>JURO · {t("План действий", "Harakatlar rejasi", "Action plan")}</small>
        <h1>{initialCaseId ? t("План действий","Harakatlar rejasi","Action plan") : t("Мои планы","Rejalarim","My plans")}</h1>
        <p>{!initialCaseId ? t("Выберите план, чтобы посмотреть шаги и отметить выполненное.","Qadamlarni ko‘rish va bajarilganlarini belgilash uchun rejani tanlang.","Choose a plan to view its steps and mark your progress.") : t("Выполняйте шаги по порядку. Измените статус или срок и сохраните изменения.","Qadamlarni tartib bilan bajaring. Holat yoki muddatni o‘zgartirib, saqlang.","Work through the steps. Update a status or deadline, then save your changes.")}</p>
      </div>
      <CalendarDays />
    </section>
    <div className="plan-layout">
      <section className="plan-main">
        {!initialCaseId && <details className="plan-create-disclosure"><summary><Plus aria-hidden="true" />{t("Создать новый план","Yangi reja yaratish","Create a new plan")}</summary><form className="plan-create" onSubmit={create}>
          <h2>{t("Создать план из сценария", "Ssenariydan reja yaratish", "Create a plan from a scenario")}</h2>
          <p className="plan-create-step">{t("1. Направление", "1. Yo‘nalish", "1. Area")}</p>
          <div className="scenario-pills scenario-directions">
            {directions.map((item) => <button
              type="button"
              className={direction === item.id ? "active" : ""}
              onClick={() => {
                setDirection(item.id);
                setSelected(caseScenariosForAccount(accountType, item.id)[0]?.id ?? "unpaid-salary");
              }}
              key={item.id}
            >{item[locale]}</button>)}
          </div>
          <p className="plan-create-step">{t("2. Ситуация", "2. Vaziyat", "2. Situation")}</p>
          <div className="scenario-pills">
            {scenarioCatalog.map((item) => <button
              type="button"
              className={selected === item.id ? "active" : ""}
              onClick={() => setSelected(item.id)}
              key={item.id}
            >{item[locale]}</button>)}
          </div>
          <label>{t("Название ситуации", "Vaziyat nomi", "Matter title")}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              maxLength={180}
              placeholder={t("Например: задолженность по договору", "Masalan: shartnoma bo‘yicha qarzdorlik", "For example: unpaid amount under a contract")}
            />
          </label>
          <label>{t("Краткое описание", "Qisqa tavsif", "Brief description")}
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={3} maxLength={2000} />
          </label>
          <button className="plan-primary" disabled={creating}>
            {creating ? <LoaderCircle className="spin" /> : <Plus />}
            {t("Создать дело и план", "Ish va reja yaratish", "Create matter and plan")}
          </button>
        </form></details>}
        {error && <p className="plan-error" role="alert"><CircleAlert />{error}</p>}
        <section className="plan-list">
          <div className="plan-section-title">
            <h2>{initialCaseId ? t("Шаги плана","Reja qadamlari","Plan steps") : t("Сохранённые планы","Saqlangan rejalar","Saved plans")}</h2>
            <button disabled={hasPendingChanges} onClick={() => void load()} aria-label={t("Обновить", "Yangilash", "Refresh")}><RotateCcw /></button>
          </div>
          {loading
            ? <div className="plan-loading"><LoaderCircle className="spin" /></div>
            : cases.length === 0
              ? <div className="platform-empty"><CalendarDays /><p>{t("Создайте первый план из проверяемого сценария.", "Tekshiriladigan ssenariydan birinchi rejangizni yarating.", "Create your first plan from a verifiable scenario.")}</p></div>
              : cases.map((item) => {
                if (!initialCaseId) return <Link className="plan-summary" href={`${base}/action-plan/${item.id}`} key={item.id}>
                  <div><h3>{suggestedMatterTitle(item.title)}</h3><p>{item.steps.filter(step => step.status === "completed").length} / {item.steps.length} {t("шагов выполнено", "qadam bajarildi", "steps completed")}</p></div>
                  <span className="plan-summary-progress">{item.progressPercent}%<span className="plan-progress" aria-hidden="true"><i style={{width:`${item.progressPercent}%`}} /></span></span><ChevronDown aria-hidden="true" />
                </Link>;
                const panelId = `plan-${item.id}`;
                const expanded = openCase === item.id;
                return <article className="plan-card" key={item.id}>
                  <button
                    className="plan-card-head"
                    onClick={() => setOpenCase(expanded ? null : item.id)}
                    aria-expanded={expanded}
                    aria-controls={panelId}
                  >
                    <div>
                      <span>{planAreaLabel(item.legalArea,locale)}</span>
                      <h3>{suggestedMatterTitle(item.title)}</h3>
                      <p>{item.progressPercent}% · {item.steps.filter((step) => step.status === "completed").length}/{item.steps.length} {t("шагов", "qadam", "steps")}</p>
                    </div>
                    <div className="plan-progress" aria-label={`${item.progressPercent}%`}><i style={{ width: `${item.progressPercent}%` }} /></div>
                    <ChevronDown className={expanded ? "rotated" : ""} />
                  </button>
                  {expanded && <div className="plan-steps" id={panelId}>
                    {item.title.length>100 && <details className="matter-full-title"><summary>{t("Полное название дела","Ishning to‘liq nomi","Full matter title")}</summary><p>{item.title}</p></details>}
                    <nav className="plan-context-links" aria-label={t("Связанные страницы","Bog‘liq sahifalar","Related pages")}><Link href={`${base}/cases/${encodeURIComponent(item.id)}`}>{t("Открыть дело","Ishni ochish","Open matter")}</Link><Link href={`${base}/calendar?caseId=${encodeURIComponent(item.id)}`}>{t("Сроки в календаре","Kalendardagi muddatlar","Calendar deadlines")}</Link>{item.sourceConversationId && <Link href={`${base}/ai-chat?conversationId=${encodeURIComponent(item.sourceConversationId)}`}>{t("Исходный ответ JURO","JURO asl javobi","Original JURO answer")}</Link>}</nav>
                    {(item.unlinkedStepCount ?? item.steps.length)>0 && <button type="button" className="plan-primary" disabled={creatingTasksFor === item.id} onClick={() => void createTasks(item)}>
                      {creatingTasksFor === item.id ? <LoaderCircle className="spin" /> : <Plus />}
                      {t("Подтвердить и добавить шаги в задачи", "Tasdiqlash va qadamlarni vazifalarga qo‘shish", "Confirm and add steps as tasks")}
                    </button>}
                    {item.steps.map((step) => {
                      const staged = pendingChangesByCase[item.id]?.[step.id];
                      const saving = applyingChangesFor === item.id;
                      const deadlineDraftKey = `${item.id}:${step.id}`;
                      const deadlineDraft = deadlineDrafts[deadlineDraftKey] ?? initialDeadlineDraft(step);
                      const builderQuery = new URLSearchParams({ caseId: item.id, stepId: step.id });
                      if (step.templateCode) builderQuery.set("template", step.templateCode);
                      return <div className={`plan-step ${step.status === "completed" ? "done" : ""}`} key={step.id}>
                        <span>{step.status === "completed" ? <Check /> : step.ordinal}</span>
                        <div>
                          <strong>{step.title}</strong>
                          {step.description && <p className="plan-step-description">{step.description}</p>}
                          {step.dueAt && <small>{formatPlatformDate(step.dueAt, locale)}</small>}
                        </div>
                        <div className="plan-step-date">
                          <DateTimePicker locale={locale} dateOnly pastOnly={false} label={t("Срок", "Muddat", "Deadline")}
                            value={staged ? staged.dueAt ?? "" : step.dueAt?.slice(0, 10) ?? ""}
                            disabled={saving} onChange={value => stageStepChange(item, step, { dueAt: value || null, deadlineCalculation: null })} />
                        </div>
                        <label className="plan-step-status">
                          <span>{t("Статус шага", "Qadam holati", "Step status")}</span>
                          <Select
                            aria-label={t(`Статус: ${step.title}`,`Holat: ${step.title}`,`Status: ${step.title}`)}
                            value={staged?.status ?? step.status}
                            disabled={saving}
                            onChange={(event) => stageStepChange(item, step, { status: event.target.value as StepStatus })}
                          >
                            <option value="not_started">{t("Не начато", "Boshlanmagan", "Not started")}</option>
                            <option value="in_progress">{t("В работе", "Jarayonda", "In progress")}</option>
                            <option value="waiting_user">{t("Ждёт меня", "Meni kutmoqda", "Waiting for me")}</option>
                            <option value="waiting_response">{t("Ожидает ответа", "Javob kutilmoqda", "Awaiting response")}</option>
                            <option value="overdue">{t("Просрочено", "Muddati o‘tgan", "Overdue")}</option>
                            <option value="completed">{t("Завершено", "Bajarilgan", "Completed")}</option>
                            <option value="cancelled">{t("Отменено", "Bekor qilingan", "Cancelled")}</option>
                          </Select>
                        </label>
                        <details className="plan-step-tools"><summary>{t("Документ и расчёт срока","Hujjat va muddat hisobi","Document and deadline calculation")}</summary>
                        <Link
                          href={`${base}/document-builder?${builderQuery}`}
                          aria-label={t(`Создать документ для шага «${step.title}»`, `«${step.title}» qadami uchun hujjat yaratish`, `Create a document for “${step.title}”`)}
                        ><FilePenLine aria-hidden="true" />{t("Создать документ","Hujjat yaratish","Create document")}</Link>
                        <details className="deadline-calculator">
                          <summary>{t("Рассчитать срок", "Muddatni hisoblash", "Calculate deadline")}</summary>
                          <div className="deadline-calculator-grid">
                            <DateTimePicker locale={locale} dateOnly pastOnly={false} label={t("Начальная дата", "Boshlang‘ich sana", "Start date")} value={deadlineDraft.sourceDate} onChange={value => updateDeadlineDraft(item, step, { sourceDate: value, result: undefined })} />
                            <label>
                              <span>{t("Количество дней", "Kunlar soni", "Number of days")}</span>
                              <input type="number" required min="0" max="3650" inputMode="numeric" value={deadlineDraft.daysCount} onChange={(event) => updateDeadlineDraft(item, step, { daysCount: event.target.value, result: undefined })} />
                            </label>
                            <label>
                              <span>{t("Тип дней", "Kun turi", "Day type")}</span>
                              <Select value={deadlineDraft.dayType} onChange={(event) => updateDeadlineDraft(item, step, { dayType: event.target.value as DeadlineDraft["dayType"], result: undefined })}>
                                <option value="calendar_days">{t("Календарные", "Kalendar", "Calendar days")}</option>
                                <option value="business_days">{t("Рабочие", "Ish kunlari", "Business days")}</option>
                              </Select>
                            </label>
                          </div>
                          <p className="deadline-help">{t("Пятидневная неделя · праздники Узбекистана учитываются автоматически. Отсчёт начинается со следующего дня.","Besh kunlik hafta · O‘zbekiston bayramlari avtomatik hisobga olinadi. Hisob keyingi kundan boshlanadi.","Five-day week · Uzbekistan holidays are included automatically. Counting starts the next day.")}</p>
                          <details className="deadline-settings"><summary>{t("Настройки расчёта", "Hisob sozlamalari", "Calculation settings")}</summary><div className="deadline-calculator-grid">
                            <label>
                              <span>{t("Перенос", "Ko‘chirish", "Adjustment")}</span>
                              <Select value={deadlineDraft.rollRule} onChange={(event) => updateDeadlineDraft(item, step, { rollRule: event.target.value as DeadlineDraft["rollRule"], result: undefined })}>
                                <option value="none">{t("Не переносить", "Ko‘chirmaslik", "Do not adjust")}</option>
                                <option value="next_business_day">{t("На следующий рабочий день", "Keyingi ish kuniga", "Next business day")}</option>
                                <option value="previous_business_day">{t("На предыдущий рабочий день", "Oldingi ish kuniga", "Previous business day")}</option>
                              </Select>
                            </label>
                            <label>
                              <span>{t("Безопасный запас, раб. дней", "Xavfsiz zaxira, ish kuni", "Safety margin, business days")}</span>
                              <input type="number" min="0" max="30" inputMode="numeric" value={deadlineDraft.safeMarginBusinessDays} onChange={(event) => updateDeadlineDraft(item, step, { safeMarginBusinessDays: event.target.value, result: undefined })} />
                            </label>
                            <label className="deadline-calculator-check">
                              <input type="checkbox" checked={deadlineDraft.includeSourceDate} onChange={(event) => updateDeadlineDraft(item, step, { includeSourceDate: event.target.checked, result: undefined })} />
                              <span>{t("Включать исходную дату в отсчёт", "Boshlang‘ich sanani hisobga qo‘shish", "Include the start date in the calculation")}</span>
                            </label>
                          </div></details>
                          <button type="button" className="deadline-calculate" disabled={deadlineDraft.loading || !deadlineDraft.sourceDate || deadlineDraft.daysCount === ""} onClick={() => void previewDeadline(item, step)}>
                            {deadlineDraft.loading ? <LoaderCircle className="spin" /> : <CalendarDays />}
                            {t("Рассчитать дату", "Sanani hisoblash", "Calculate date")}
                          </button>
                          {deadlineDraft.error && <p className="deadline-calculator-error" role="alert">{deadlineDraft.error}</p>}
                          {deadlineDraft.result && <section className="deadline-result" aria-live="polite">
                            <strong>{t("Предварительный расчёт", "Dastlabki hisob", "Preliminary calculation")}</strong>
                            <dl>
                              <div><dt>{t("Расчётная дата", "Hisoblangan sana", "Calculated date")}</dt><dd>{formatPlatformDate(deadlineDraft.result.dueDate, locale)}</dd></div>
                              <div><dt>{t("Безопасная дата", "Xavfsiz sana", "Safe date")}</dt><dd>{formatPlatformDate(deadlineDraft.result.safeEarlierDate, locale)}</dd></div>
                            </dl>
                            <p>{t("Дата добавлена в предпросмотр плана. Она сохранится только после подтверждения изменений.", "Sana reja oldindan ko‘rishiga qo‘shildi. U faqat o‘zgarishlar tasdiqlangandan keyin saqlanadi.", "The date has been added to the plan preview. It will be saved only after you confirm the changes.")}</p>
                            {deadlineDraft.result.warnings.length > 0 && <ul>
                              {deadlineDraft.result.warnings.map((warning) => <li key={warning}>{warning === "HOLIDAY_CALENDAR_UNVERIFIED"
                                ? t("Для части периода учтены только постоянные праздники. Дополнительные выходные ещё не подтверждены.", "Davrning bir qismi uchun faqat doimiy bayramlar hisobga olingan. Qo‘shimcha dam olish kunlari tasdiqlanmagan.", "Part of this period includes fixed holidays only. Additional days off are not yet confirmed.")
                                : warning === "LEGAL_BASIS_UNCONFIRMED"
                                  ? t("Это дата для планирования. Срок по закону уточните в исходном ответе или у юриста.", "Bu rejalashtirish sanasi. Qonuniy muddatni asl javob yoki yurist bilan tekshiring.", "This is a planning date. Check the legal deadline in the original answer or with a lawyer.")
                                  : t("Дата приходится на нерабочий день без переноса.", "Sana ko‘chirilmasdan ish bo‘lmagan kunga to‘g‘ri keladi.", "The date falls on a non-working day without adjustment.")}</li>)}
                            </ul>}
                          </section>}
                          {step.deadlineConfidence && step.deadlineConfidence !== "unverified" && <p className="deadline-stored-evidence">
                            {t(
                              `Сохранённый расчёт: ${step.deadlineConfidence === "preliminary" ? "предварительный" : "источник проверен"}.`,
                              `Saqlangan hisob: ${step.deadlineConfidence === "preliminary" ? "dastlabki" : "manba tekshirilgan"}.`,
                              `Saved calculation: ${step.deadlineConfidence === "preliminary" ? "preliminary" : "source verified"}.`,
                            )}
                            {step.safeDueAt ? ` ${t("Безопасная дата", "Xavfsiz sana", "Safe date")}: ${step.safeDueAt.slice(0, 10)}.` : ""}
                          </p>}
                        </details>
                        </details>
                      </div>;
                    })}
                    <details className="plan-history-disclosure"><summary onClick={() => { if (!versionsByCase[item.id]?.length) void loadVersionHistory(item); }}>{t("История изменений", "O‘zgarishlar tarixi", "Change history")}</summary><section className="plan-history" aria-label={t("История версий плана", "Reja versiyalari tarixi", "Plan version history")}>
                      <button
                        type="button"
                        onClick={() => void loadVersionHistory(item)}
                        disabled={loadingVersionsFor === item.id}
                      >
                        {loadingVersionsFor === item.id ? <LoaderCircle className="spin" /> : <RotateCcw />}
                        {t("Обновить историю", "Tarixni yangilash", "Refresh history")}
                      </button>
                      {versionsByCase[item.id]?.length ? <ol>
                        {versionsByCase[item.id].map((entry) => <li key={entry.id}>
                          <button type="button" aria-pressed={selectedHistoryVersionByCase[item.id] === entry.id} onClick={() => setSelectedHistoryVersionByCase((all) => ({ ...all, [item.id]: entry.id }))}>
                            <strong>{t("Версия " + entry.version, entry.version + "-versiya", "Version " + entry.version)}</strong>
                            <span>{formatPlatformDateTime(entry.createdAt, locale)}</span>
                            <small>{entry.snapshot ? entry.snapshot.progressPercent + "% · " + entry.snapshot.steps.filter((step) => step.status === "completed").length + "/" + entry.snapshot.steps.length : t("Снимок недоступен", "Snapshot mavjud emas", "Snapshot unavailable")}</small>
                          </button>
                        </li>)}
                      </ol> : null}
                      {(() => {
                        const versions = versionsByCase[item.id] || [];
                        const selectedId = selectedHistoryVersionByCase[item.id];
                        const index = versions.findIndex((entry) => entry.id === selectedId);
                        const selectedVersion = index >= 0 ? versions[index] : null;
                        const previousVersion = index >= 0 ? versions[index + 1] : null;
                        if (!selectedVersion?.snapshot || !previousVersion?.snapshot) return selectedVersion ? <p className="plan-history-empty">{t("Для первой версии нет предыдущего снимка для сравнения.", "Birinchi versiyani solishtirish uchun oldingi snapshot yo‘q.", "The first version has no earlier snapshot to compare.")}</p> : null;
                        const previousSteps = new Map(previousVersion.snapshot.steps.map((step) => [step.id, step]));
                        const selectedSteps = new Map(selectedVersion.snapshot.steps.map((step) => [step.id, step]));
                        const changes = selectedVersion.snapshot.steps.flatMap((step) => {
                          const before = previousSteps.get(step.id);
                          if (!before) return [`${step.title}: ${t("добавлен", "qo‘shildi", "added")}`];
                          const noDeadline = t("без срока", "muddat yo‘q", "no deadline");
                          const detail = [before.status !== step.status ? `${planStatusLabel(before.status,locale)} → ${planStatusLabel(step.status,locale)}` : "", before.dueAt !== step.dueAt ? `${before.dueAt || noDeadline} → ${step.dueAt || noDeadline}` : ""].filter(Boolean).join(" · ");
                          return detail ? [`${step.title}: ${detail}`] : [];
                        });
                        previousVersion.snapshot.steps.forEach((step) => { if (!selectedSteps.has(step.id)) changes.push(`${step.title}: ${t("удалён", "olib tashlandi", "removed")}`); });
                        return <section className="plan-history-diff" aria-live="polite"><h4>{t(`Различия: версия ${selectedVersion.version} и ${previousVersion.version}`, `${selectedVersion.version}- va ${previousVersion.version}-versiyalar farqi`, `Differences between versions ${selectedVersion.version} and ${previousVersion.version}`)}</h4>{changes.length ? <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul> : <p>{t("Содержимое шагов не изменилось.", "Qadamlar mazmuni o‘zgarmagan.", "The step content did not change.")}</p>}</section>;
                      })()}
                    </section>
                    </details>
                    {Object.values(pendingChangesByCase[item.id] || {}).length > 0 && <section className="plan-change-preview" aria-labelledby={`plan-preview-${item.id}`}>
                      <div>
                        <small>{t("Сохранение", "Saqlash", "Save changes")}</small>
                        <h3 id={`plan-preview-${item.id}`}>{t("Изменения ещё не применены", "O‘zgarishlar hali qo‘llanmagan", "Changes have not been applied")}</h3>
                        <p>{t("Проверьте изменения: они будут сохранены одной новой версией плана только после подтверждения.", "O‘zgarishlarni tekshiring: ular faqat tasdiqlangandan keyin rejaning bitta yangi versiyasi sifatida saqlanadi.", "Review the changes. They will be saved as one new plan version only after confirmation.")}</p>
                      </div>
                      <ul>
                        {item.steps.filter((step) => pendingChangesByCase[item.id]?.[step.id]).map((step) => {
                          const change = pendingChangesByCase[item.id][step.id];
                          const beforeDate = step.dueAt?.slice(0, 10) || t("не задан", "belgilanmagan", "not set");
                          const afterDate = change.dueAt || t("не задан", "belgilanmagan", "not set");
                          return <li key={step.id}><strong>{step.title}</strong><span>{planStatusLabel(step.status,locale)} → {planStatusLabel(change.status,locale)}{beforeDate !== afterDate ? ` · ${beforeDate} → ${afterDate}` : ""}</span></li>;
                        })}
                      </ul>
                      <div className="plan-change-actions">
                        <button type="button" disabled={applyingChangesFor === item.id} onClick={() => {
                          setPendingChangesByCase((all) => ({ ...all, [item.id]: {} }));
                          clearDeadlineResultsForCase(item.id);
                        }}>{t("Отменить", "Bekor qilish", "Cancel")}</button>
                        <button type="button" className="plan-primary" disabled={applyingChangesFor === item.id} onClick={() => void applyStagedChanges(item)}>
                          {applyingChangesFor === item.id ? <LoaderCircle className="spin" /> : <Check />}
                          {t("Сохранить изменения", "O‘zgarishlarni saqlash", "Save changes")}
                        </button>
                      </div>
                    </section>}
                  </div>}
                </article>;
              })}
        </section>
      </section>
      {!initialCaseId && <aside className="plan-calendar">
        <h2>{t("Ближайшие сроки", "Yaqin muddatlar", "Upcoming deadlines")}</h2>
        <div className="today"><CalendarDays /><div><small>{t("Сегодня", "Bugun", "Today")}</small><strong>{formatPlatformDate(new Date(), locale, { dateStyle: "long" })}</strong></div></div>
        {deadlines.length
          ? deadlines.slice(0, 8).map((item) => <div className="deadline" key={`${item.date}-${item.title}`}>
            <time dateTime={item.date}>{formatPlatformDayMonth(item.date, locale)}</time>
            <div><strong>{item.title}</strong><small>{item.caseTitle}</small></div>
          </div>)
          : <p>{t("Сроки появятся после назначения дат конкретным шагам.", "Aniq qadamlar uchun sana belgilangandan keyin muddatlar ko‘rinadi.", "Deadlines will appear after dates are assigned to specific steps.")}</p>}
        <Link className="plan-consult" href={`${base}/consultations`}>{t("Записаться на консультацию", "Maslahatga yozilish", "Request a consultation")}<span>→</span></Link>
      </aside>}
    </div>
  </div>;
}
