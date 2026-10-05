"use client";

import { Select } from "../_components/Select";

import Link from "next/link";
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
  holidays: string;
  holidayCalendarVersion: string;
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
    holidays: "",
    holidayCalendarVersion: "",
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
      setOpenCase(data.caseId || null);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setCreating(false);
    }
  }

  function stageStepChange(item: Case, step: Step, patch: Partial<Pick<PendingPlanChange, "status" | "dueAt" | "deadlineCalculation">>) {
    const current = pendingChangesByCase[item.id]?.[step.id];
    const next: PendingPlanChange = {
      id: step.id,
      status: patch.status ?? current?.status ?? step.status,
      dueAt: "dueAt" in patch ? patch.dueAt ?? null : current?.dueAt ?? step.dueAt?.slice(0, 10) ?? null,
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
    const holidays = draft.holidays.split(/[\s,;]+/).map((value) => value.trim()).filter(Boolean);
    const input: DeadlineCalculationInput = {
      sourceDate: draft.sourceDate,
      daysCount: Number(draft.daysCount),
      dayType: draft.dayType,
      includeSourceDate: draft.includeSourceDate,
      rollRule: draft.rollRule,
      holidays,
      holidayCalendarVersion: draft.holidayCalendarVersion.trim() || null,
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
        setError(t("План изменён в другой вкладке. Показаны актуальные данные.", "Reja boshqa oynada o‘zgartirilgan. Amaldagi ma’lumotlar ko‘rsatildi.", "The plan changed in another tab. The latest data is now shown."));
        await load();
        return;
      }
      if (!response.ok) throw new Error(platformApiError(locale, data.error, t("Не удалось применить изменения плана.", "Reja o‘zgarishlarini qo‘llab bo‘lmadi.", "We could not apply the plan changes.")));
      setPendingChangesByCase((all) => ({ ...all, [item.id]: {} }));
      clearDeadlineResultsForCase(item.id);
      setVersionsByCase((all) => ({ ...all, [item.id]: [] }));
      await load();
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

  return <div className="plan-workspace">
    <section className="plan-heading">
      <div>
        <small>JURO · {t("План действий", "Harakatlar rejasi", "Action plan")}</small>
        <h1>{t("Свяжите шаги, сроки и документы в одном деле", "Qadamlar, muddatlar va hujjatlarni bitta ishda bog‘lang", "Connect steps, deadlines and documents in one matter")}</h1>
        <p>{t("Прогресс рассчитывается только по реально завершённым шагам.", "Jarayon faqat haqiqatan bajarilgan qadamlar asosida hisoblanadi.", "Progress reflects only steps that have actually been completed.")}</p>
      </div>
      <CalendarDays />
    </section>
    <div className="plan-layout">
      <section className="plan-main">
        {!initialCaseId && <form className="plan-create" onSubmit={create}>
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
        </form>}
        {error && <p className="plan-error" role="alert"><CircleAlert />{error}</p>}
        <section className="plan-list">
          <div className="plan-section-title">
            <h2>{t("Мои активные планы", "Faol rejalarim", "My active plans")}</h2>
            <button onClick={() => void load()} aria-label={t("Обновить", "Yangilash", "Refresh")}><RotateCcw /></button>
          </div>
          {loading
            ? <div className="plan-loading"><LoaderCircle className="spin" /></div>
            : cases.length === 0
              ? <div className="platform-empty"><CalendarDays /><p>{t("Создайте первый план из проверяемого сценария.", "Tekshiriladigan ssenariydan birinchi rejangizni yarating.", "Create your first plan from a verifiable scenario.")}</p></div>
              : cases.map((item) => {
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
                      <span>{item.legalArea}</span>
                      <h3>{item.title}</h3>
                      <p>{item.progressPercent}% · {item.steps.filter((step) => step.status === "completed").length}/{item.steps.length} {t("шагов", "qadam", "steps")}</p>
                    </div>
                    <div className="plan-progress" aria-label={`${item.progressPercent}%`}><i style={{ width: `${item.progressPercent}%` }} /></div>
                    <ChevronDown className={expanded ? "rotated" : ""} />
                  </button>
                  {expanded && <div className="plan-steps" id={panelId}>
                    <button type="button" className="plan-primary" disabled={creatingTasksFor === item.id} onClick={() => void createTasks(item)}>
                      {creatingTasksFor === item.id ? <LoaderCircle className="spin" /> : <Plus />}
                      {t("Подтвердить и добавить шаги в задачи", "Tasdiqlash va qadamlarni vazifalarga qo‘shish", "Confirm and add steps as tasks")}
                    </button>
                    <section className="plan-history" aria-label={t("История версий плана", "Reja versiyalari tarixi", "Plan version history")}>
                      <button
                        type="button"
                        onClick={() => void loadVersionHistory(item)}
                        disabled={loadingVersionsFor === item.id}
                      >
                        {loadingVersionsFor === item.id ? <LoaderCircle className="spin" /> : <RotateCcw />}
                        {t("Показать историю версий", "Versiyalar tarixini ko‘rsatish", "Show version history")}
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
                          const detail = [before.status !== step.status ? `${before.status} → ${step.status}` : "", before.dueAt !== step.dueAt ? `${before.dueAt || noDeadline} → ${step.dueAt || noDeadline}` : ""].filter(Boolean).join(" · ");
                          return detail ? [`${step.title}: ${detail}`] : [];
                        });
                        previousVersion.snapshot.steps.forEach((step) => { if (!selectedSteps.has(step.id)) changes.push(`${step.title}: ${t("удалён", "olib tashlandi", "removed")}`); });
                        return <section className="plan-history-diff" aria-live="polite"><h4>{t(`Различия: версия ${selectedVersion.version} и ${previousVersion.version}`, `${selectedVersion.version}- va ${previousVersion.version}-versiyalar farqi`, `Differences between versions ${selectedVersion.version} and ${previousVersion.version}`)}</h4>{changes.length ? <ul>{changes.map((change) => <li key={change}>{change}</li>)}</ul> : <p>{t("Содержимое шагов не изменилось.", "Qadamlar mazmuni o‘zgarmagan.", "The step content did not change.")}</p>}</section>;
                      })()}
                    </section>
                    {Object.values(pendingChangesByCase[item.id] || {}).length > 0 && <section className="plan-change-preview" aria-labelledby={`plan-preview-${item.id}`}>
                      <div>
                        <small>{t("Предпросмотр версии", "Versiyani oldindan ko‘rish", "Version preview")}</small>
                        <h3 id={`plan-preview-${item.id}`}>{t("Изменения ещё не применены", "O‘zgarishlar hali qo‘llanmagan", "Changes have not been applied")}</h3>
                        <p>{t("Проверьте изменения: они будут сохранены одной новой версией плана только после подтверждения.", "O‘zgarishlarni tekshiring: ular faqat tasdiqlangandan keyin rejaning bitta yangi versiyasi sifatida saqlanadi.", "Review the changes. They will be saved as one new plan version only after confirmation.")}</p>
                      </div>
                      <ul>
                        {item.steps.filter((step) => pendingChangesByCase[item.id]?.[step.id]).map((step) => {
                          const change = pendingChangesByCase[item.id][step.id];
                          const beforeDate = step.dueAt?.slice(0, 10) || t("не задан", "belgilanmagan", "not set");
                          const afterDate = change.dueAt || t("не задан", "belgilanmagan", "not set");
                          return <li key={step.id}><strong>{step.title}</strong><span>{step.status} → {change.status}{beforeDate !== afterDate ? ` · ${beforeDate} → ${afterDate}` : ""}</span></li>;
                        })}
                      </ul>
                      <div className="plan-change-actions">
                        <button type="button" onClick={() => {
                          setPendingChangesByCase((all) => ({ ...all, [item.id]: {} }));
                          clearDeadlineResultsForCase(item.id);
                        }}>{t("Отменить", "Bekor qilish", "Cancel")}</button>
                        <button type="button" className="plan-primary" disabled={applyingChangesFor === item.id} onClick={() => void applyStagedChanges(item)}>
                          {applyingChangesFor === item.id ? <LoaderCircle className="spin" /> : <Check />}
                          {t("Подтвердить и применить", "Tasdiqlash va qo‘llash", "Confirm and apply")}
                        </button>
                      </div>
                    </section>}
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
                          {step.dueAt && <small>{formatPlatformDate(step.dueAt, locale)}</small>}
                        </div>
                        <label className="plan-step-date">
                          <span>{t("Срок", "Muddat", "Deadline")}</span>
                          <input
                            type="date"
                            value={staged?.dueAt ?? step.dueAt?.slice(0, 10) ?? ""}
                            disabled={saving}
                            onChange={(event) => stageStepChange(item, step, { dueAt: event.target.value || null, deadlineCalculation: null })}
                          />
                        </label>
                        <label className="plan-step-status">
                          <span className="sr-only">{t("Статус шага", "Qadam holati", "Step status")}</span>
                          <Select
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
                        <Link
                          href={`${base}/document-builder?${builderQuery}`}
                          aria-label={t(`Создать документ для шага «${step.title}»`, `«${step.title}» qadami uchun hujjat yaratish`, `Create a document for “${step.title}”`)}
                        ><FilePenLine /></Link>
                        <details className="deadline-calculator">
                          <summary>{t("Рассчитать срок", "Muddatni hisoblash", "Calculate deadline")}</summary>
                          <div className="deadline-calculator-grid">
                            <label>
                              <span>{t("Исходная дата", "Boshlang‘ich sana", "Start date")}</span>
                              <input type="date" required value={deadlineDraft.sourceDate} onChange={(event) => updateDeadlineDraft(item, step, { sourceDate: event.target.value, result: undefined })} />
                            </label>
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
                            <label className="deadline-calculator-wide">
                              <span>{t("Праздничные даты (ГГГГ-ММ-ДД)", "Bayram sanalari (YYYY-MM-DD)", "Public holidays (YYYY-MM-DD)")}</span>
                              <input value={deadlineDraft.holidays} placeholder="2026-09-01, 2026-12-08" onChange={(event) => updateDeadlineDraft(item, step, { holidays: event.target.value, result: undefined })} />
                            </label>
                            <label className="deadline-calculator-wide">
                              <span>{t("Версия календаря, если известна", "Kalendar versiyasi, ma’lum bo‘lsa", "Calendar version, if known")}</span>
                              <input maxLength={120} value={deadlineDraft.holidayCalendarVersion} placeholder={t("Это значение не подтверждает календарь", "Bu qiymat kalendarni tasdiqlamaydi", "This value does not verify the calendar")} onChange={(event) => updateDeadlineDraft(item, step, { holidayCalendarVersion: event.target.value, result: undefined })} />
                            </label>
                            <label className="deadline-calculator-wide">
                              <span>{t("Правовое основание", "Huquqiy asos", "Legal basis")}</span>
                              <textarea rows={2} maxLength={500} value={deadlineDraft.legalBasis} placeholder={t("Укажите норму после проверки источника", "Manba tekshirilgandan keyin normani kiriting", "Add the legal rule after verifying its source")} onChange={(event) => updateDeadlineDraft(item, step, { legalBasis: event.target.value, result: undefined })} />
                            </label>
                            <label className="deadline-calculator-check">
                              <input type="checkbox" checked={deadlineDraft.includeSourceDate} onChange={(event) => updateDeadlineDraft(item, step, { includeSourceDate: event.target.checked, result: undefined })} />
                              <span>{t("Включать исходную дату в отсчёт", "Boshlang‘ich sanani hisobga qo‘shish", "Include the start date in the calculation")}</span>
                            </label>
                          </div>
                          <button type="button" className="deadline-calculate" disabled={deadlineDraft.loading || !deadlineDraft.sourceDate || deadlineDraft.daysCount === ""} onClick={() => void previewDeadline(item, step)}>
                            {deadlineDraft.loading ? <LoaderCircle className="spin" /> : <CalendarDays />}
                            {t("Показать проверяемый расчёт", "Tekshiriladigan hisobni ko‘rsatish", "Show verifiable calculation")}
                          </button>
                          {deadlineDraft.error && <p className="deadline-calculator-error" role="alert">{deadlineDraft.error}</p>}
                          {deadlineDraft.result && <section className="deadline-result" aria-live="polite">
                            <strong>{t("Предварительный расчёт", "Dastlabki hisob", "Preliminary calculation")}</strong>
                            <dl>
                              <div><dt>{t("Расчётная дата", "Hisoblangan sana", "Calculated date")}</dt><dd>{deadlineDraft.result.dueDate}</dd></div>
                              <div><dt>{t("Безопасная дата", "Xavfsiz sana", "Safe date")}</dt><dd>{deadlineDraft.result.safeEarlierDate}</dd></div>
                              <div><dt>{t("Выходных в периоде", "Davrdagi dam olish kunlari", "Weekend days in period")}</dt><dd>{deadlineDraft.result.weekendDates.length}</dd></div>
                              <div><dt>{t("Указанных праздников", "Ko‘rsatilgan bayramlar", "Specified public holidays")}</dt><dd>{deadlineDraft.result.holidayDates.length}</dd></div>
                            </dl>
                            <p>{t("Дата добавлена в предпросмотр плана. Она сохранится только после подтверждения изменений.", "Sana reja oldindan ko‘rishiga qo‘shildi. U faqat o‘zgarishlar tasdiqlangandan keyin saqlanadi.", "The date has been added to the plan preview. It will be saved only after you confirm the changes.")}</p>
                            {deadlineDraft.result.warnings.length > 0 && <ul>
                              {deadlineDraft.result.warnings.map((warning) => <li key={warning}>{warning === "HOLIDAY_CALENDAR_UNVERIFIED"
                                ? t("Календарь праздников не подтверждён.", "Bayramlar kalendari tasdiqlanmagan.", "The public holiday calendar has not been verified.")
                                : warning === "LEGAL_BASIS_UNCONFIRMED"
                                  ? t("Правовое основание не подтверждено.", "Huquqiy asos tasdiqlanmagan.", "The legal basis has not been verified.")
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
                      </div>;
                    })}
                  </div>}
                </article>;
              })}
        </section>
      </section>
      <aside className="plan-calendar">
        <h2>{t("Ближайшие сроки", "Yaqin muddatlar", "Upcoming deadlines")}</h2>
        <div className="today"><CalendarDays /><div><small>{t("Сегодня", "Bugun", "Today")}</small><strong>{formatPlatformDate(new Date(), locale, { dateStyle: "long" })}</strong></div></div>
        {deadlines.length
          ? deadlines.slice(0, 8).map((item) => <div className="deadline" key={`${item.date}-${item.title}`}>
            <time dateTime={item.date}>{formatPlatformDayMonth(item.date, locale)}</time>
            <div><strong>{item.title}</strong><small>{item.caseTitle}</small></div>
          </div>)
          : <p>{t("Сроки появятся после назначения дат конкретным шагам.", "Aniq qadamlar uchun sana belgilangandan keyin muddatlar ko‘rinadi.", "Deadlines will appear after dates are assigned to specific steps.")}</p>}
        <Link className="plan-consult" href={`${base}/consultations`}>{t("Записаться на консультацию", "Maslahatga yozilish", "Request a consultation")}<span>→</span></Link>
      </aside>
    </div>
  </div>;
}
