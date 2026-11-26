"use client";

import { WorkspaceTitle } from "./WorkspaceTitle";

import { CircleAlert, LoaderCircle, Plus, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useMemo, useState } from "react";

import { platformApiError } from "../../content/platform-ui";
import { subscriptionFeedback } from "../../content/subscription-feedback";
import { caseDirectionsForAccount, caseScenariosForAccount, type CaseDirectionId } from "../../lib/platform/case-create";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";

const caseCreateCopy = {
  ru: { createError: "Не удалось создать дело.", section: "Новое дело", title: "Соберите ситуацию в управляемое дело", description: "После создания JURO добавит проверяемый стартовый план. Никакие задачи не будут назначены без вашего подтверждения.", direction: "1. Выберите направление", situation: "2. Выберите ситуацию", searchLabel: "Поиск ситуации", search: "Поиск в выбранном направлении", lawyerReview: "Рекомендуется проверка юристом", noScenario: "Ситуация не найдена. Опишите её AI-юристу — JURO предложит подходящий план.", matterTitle: "Название дела", titlePlaceholder: "Например: возврат долга по расписке", brief: "Краткое описание", descriptionPlaceholder: "Что произошло, когда и какой результат вам нужен", note: "Дело и первая версия плана сохраняются вместе. При ошибке не будет создана частичная запись.", cancel: "Отмена", creating: "Создаём…", create: "Создать дело" },
  uz: { createError: "Ishni yaratib bo‘lmadi.", section: "Yangi ish", title: "Vaziyatni boshqariladigan ishga aylantiring", description: "Yaratilgandan so‘ng JURO tekshiriladigan boshlang‘ich reja qo‘shadi. Siz tasdiqlamaguningizcha vazifalar tayinlanmaydi.", direction: "1. Yo‘nalishni tanlang", situation: "2. Vaziyatni tanlang", searchLabel: "Vaziyatni qidirish", search: "Tanlangan yo‘nalishda qidirish", lawyerReview: "Yurist tekshiruvi tavsiya etiladi", noScenario: "Vaziyat topilmadi. Uni AI-yuristga yozing — JURO mos reja taklif qiladi.", matterTitle: "Ish nomi", titlePlaceholder: "Masalan: tilxat bo‘yicha qarzni qaytarish", brief: "Qisqa tavsif", descriptionPlaceholder: "Nima bo‘ldi, qachon va qanday natija kerak", note: "Ish va rejaning birinchi versiyasi birga saqlanadi. Xatoda qisman yozuv yaratilmaydi.", cancel: "Bekor qilish", creating: "Yaratilmoqda…", create: "Ish yaratish" },
  en: { createError: "We could not create the matter.", section: "New matter", title: "Turn the situation into a manageable matter", description: "After creation, JURO adds a verifiable starting plan. No tasks are assigned without your confirmation.", direction: "1. Choose an area", situation: "2. Choose a situation", searchLabel: "Search situations", search: "Search within the selected area", lawyerReview: "Lawyer review recommended", noScenario: "No matching situation was found. Describe it to the AI legal assistant and JURO will suggest a suitable plan.", matterTitle: "Matter title", titlePlaceholder: "For example: recovering a documented debt", brief: "Brief description", descriptionPlaceholder: "What happened, when it happened and what outcome you need", note: "The matter and the first plan version are saved together. A failed request will not leave a partial record.", cancel: "Cancel", creating: "Creating…", create: "Create matter" },
} as const;

export function CaseCreateClient({ locale, accountType }: { locale: PlatformLocale; accountType: AccountType }) {
  const copy = caseCreateCopy[locale];
  const base = usePlatformBasePath();
  const workspaceId = usePlatformWorkspaceId();
  const router = useRouter();
  const directions = caseDirectionsForAccount(accountType);
  const [direction, setDirection] = useState<CaseDirectionId>(directions[0]?.id ?? "employment");
  const scenarios = useMemo(() => caseScenariosForAccount(accountType, direction), [accountType, direction]);
  const [selected, setSelected] = useState(() =>
    caseScenariosForAccount(accountType, directions[0]?.id ?? "employment")[0]?.id ?? "unpaid-salary",
  );
  const [scenarioQuery, setScenarioQuery] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const visibleScenarios = scenarios.filter((scenario) => {
    const query = scenarioQuery.trim().toLocaleLowerCase();
    return !query || `${scenario.ru} ${scenario.uz} ${scenario.en}`.toLocaleLowerCase().includes(query);
  });

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/platform/cases", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-workspace-id": workspaceId },
        body: JSON.stringify({ title, description, legalArea: selected, locale, accountType }),
      });
      const body = await response.json() as { caseId?: string; error?: string; code?: string };
      if (!response.ok || !body.caseId) {
        throw new Error(subscriptionFeedback(locale, body.code) ?? platformApiError(locale, body.error, copy.createError));
      }
      router.replace(`${base}/cases/${encodeURIComponent(body.caseId)}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      setSubmitting(false);
    }
  }

  return (
    <section className="case-create workspace-page">
      <WorkspaceTitle icon={<ShieldCheck />} title={copy.title} description={copy.description} />

      <form onSubmit={submit} aria-describedby="case-create-note">
        <fieldset>
          <legend>{copy.direction}</legend>
          <div className="case-create-directions" role="list">
            {directions.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={direction === item.id}
                onClick={() => {
                  setDirection(item.id);
                  setSelected(caseScenariosForAccount(accountType, item.id)[0]?.id ?? "unpaid-salary");
                  setScenarioQuery("");
                }}
              >
                {item[locale]}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend>{copy.situation}</legend>
          <label className="case-create-scenario-search">
            <span className="sr-only">{copy.searchLabel}</span>
            <input
              value={scenarioQuery}
              onChange={(event) => setScenarioQuery(event.target.value)}
              placeholder={copy.search}
            />
          </label>
          <div className="case-create-scenarios">
            {visibleScenarios.map((scenario) => (
              <button
                key={scenario.id}
                type="button"
                aria-pressed={selected === scenario.id}
                onClick={() => setSelected(scenario.id)}
              >
                {scenario[locale]}
                {scenario.requiresLawyerReview && <small>{copy.lawyerReview}</small>}
              </button>
            ))}
          </div>
          {!visibleScenarios.length && <p className="case-create-empty">{copy.noScenario}</p>}
        </fieldset>

        <label>
          <span>{copy.matterTitle}</span>
          <input
            autoFocus
            required
            maxLength={180}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={copy.titlePlaceholder}
          />
        </label>

        <label>
          <span>{copy.brief}</span>
          <textarea
            rows={5}
            maxLength={2_000}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={copy.descriptionPlaceholder}
          />
        </label>

        <p id="case-create-note">{copy.note}</p>
        {error && <p className="case-create-error" role="alert"><CircleAlert />{error}</p>}
        <div className="case-create-actions">
          <button type="button" onClick={() => router.push(`${base}/cases`)}>{copy.cancel}</button>
          <button type="submit" disabled={submitting}>
            {submitting ? <LoaderCircle className="spin" /> : <Plus />}
            {submitting ? copy.creating : copy.create}
          </button>
        </div>
      </form>
    </section>
  );
}
