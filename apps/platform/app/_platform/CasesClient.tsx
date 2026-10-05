"use client";

import { Select } from "../_components/Select";

import { usePlatformBasePath } from "./PlatformRouteContext";
import Link from "next/link";
import { BriefcaseBusiness, CalendarClock, CircleAlert, LoaderCircle, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import { CASE_SCENARIOS, isCaseScenarioId } from "../../lib/platform/case-create";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";

type CaseItem = {
  id: string;
  title: string;
  description?: string;
  legalArea: string;
  status: string;
  nextDeadlineAt?: string;
  updatedAt: string;
  progressPercent?: number;
  steps?: Array<{ id: string; status: string }>;
};

const casesCopy = {
  ru: { loadError: "Не удалось загрузить дела.", section: "Дела", title: "Единая история юридической работы", description: "Дело связывает подтверждённые факты, документы, план, сроки и консультацию.", create: "Создать дело", searchLabel: "Поиск дел", search: "Найти дело", filter: "Фильтр статуса", active: "Активные", all: "Все", open: "Открытые", completed: "Завершённые", noDescription: "Описание пока не добавлено.", steps: "шагов", noDeadline: "Срок не назначен", openMatter: "Открыть дело", noResults: "Ничего не найдено", noMatters: "Дел пока нет", empty: "Начните с ситуации — JURO создаст дело и связанный план.", createFirst: "Создать первое дело", statuses: { open: "Открыто", completed: "Завершено", archived: "В архиве", cancelled: "Отменено" } },
  uz: { loadError: "Ishlarni yuklab bo‘lmadi.", section: "Ishlar", title: "Yuridik ishlarning yagona tarixi", description: "Ish tasdiqlangan faktlar, hujjatlar, reja, muddatlar va maslahatni bog‘laydi.", create: "Ish yaratish", searchLabel: "Ishlarni qidirish", search: "Ishni topish", filter: "Holat filtri", active: "Faol", all: "Barchasi", open: "Ochiq", completed: "Yakunlangan", noDescription: "Tavsif hali qo‘shilmagan.", steps: "qadam", noDeadline: "Muddat belgilanmagan", openMatter: "Ishni ochish", noResults: "Hech narsa topilmadi", noMatters: "Hozircha ishlar yo‘q", empty: "Vaziyatdan boshlang — JURO ish va bog‘langan rejani yaratadi.", createFirst: "Birinchi ishni yaratish", statuses: { open: "Ochiq", completed: "Yakunlangan", archived: "Arxivda", cancelled: "Bekor qilingan" } },
  en: { loadError: "We could not load your matters.", section: "Matters", title: "One record of your legal work", description: "A matter connects verified facts, documents, an action plan, deadlines and consultations.", create: "Create matter", searchLabel: "Search matters", search: "Find a matter", filter: "Filter by status", active: "Active", all: "All", open: "Open", completed: "Completed", noDescription: "No description has been added yet.", steps: "steps", noDeadline: "No deadline set", openMatter: "Open matter", noResults: "No results found", noMatters: "No matters yet", empty: "Start with a situation and JURO will create a matter with a connected plan.", createFirst: "Create your first matter", statuses: { open: "Open", completed: "Completed", archived: "Archived", cancelled: "Cancelled" } },
} as const;

export function CasesClient({ locale }: { locale: PlatformLocale; accountType: AccountType }) {
  const [items, setItems] = useState<CaseItem[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("active");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const copy = casesCopy[locale];
  const base = usePlatformBasePath();

  useEffect(() => {
    let cancelled = false;
    fetch("/api/platform/cases", { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as { cases?: CaseItem[]; error?: string };
        if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.loadError));
        if (!cancelled) setItems(body.cases ?? []);
      })
      .catch((value) => { if (!cancelled) setError(value instanceof Error ? value.message : String(value)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [copy.loadError, locale]);

  const filtered = useMemo(() => items.filter((item) => {
    const matchesSearch = !query || `${item.title} ${item.description ?? ""} ${item.legalArea}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    const matchesStatus = status === "all" || (status === "active" ? !["completed", "cancelled", "archived"].includes(item.status) : item.status === status);
    return matchesSearch && matchesStatus;
  }), [items, query, status]);

  return (
    <section className="cases-live">
      <header>
        <div><small>JURO · {copy.section}</small><h1>{copy.title}</h1><p>{copy.description}</p></div>
        <Link href={`${base}/cases/new`}><Plus />{copy.create}</Link>
      </header>
      <div className="cases-live-tools">
        <label><Search /><span className="sr-only">{copy.searchLabel}</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={copy.search} /></label>
        <Select value={status} onChange={(event) => setStatus(event.target.value)} aria-label={copy.filter}>
          <option value="active">{copy.active}</option>
          <option value="all">{copy.all}</option>
          <option value="open">{copy.open}</option>
          <option value="completed">{copy.completed}</option>
        </Select>
      </div>
      {error && <p className="cases-live-error" role="alert"><CircleAlert />{error}</p>}
      {loading ? <div className="cases-live-loading"><LoaderCircle className="spin" /></div> : filtered.length ? (
        <div className="cases-live-list">
          {filtered.map((item) => {
            const complete = item.steps?.filter((step) => step.status === "completed").length ?? 0;
            const total = item.steps?.length ?? 0;
            const legalArea = isCaseScenarioId(item.legalArea)
              ? CASE_SCENARIOS[item.legalArea].label[locale]
              : item.legalArea;
            const caseStatus = copy.statuses[item.status as keyof typeof copy.statuses] ?? item.status;
            return (
              <article key={item.id}>
                <div className="cases-live-icon"><BriefcaseBusiness /></div>
                <div className="cases-live-body"><span>{legalArea} · {caseStatus}</span><h2>{item.title}</h2><p>{item.description || copy.noDescription}</p></div>
                <div className="cases-live-progress"><strong>{item.progressPercent ?? 0}%</strong><span>{complete}/{total} {copy.steps}</span></div>
                <div className="cases-live-meta"><CalendarClock /><span>{item.nextDeadlineAt ? formatDate(item.nextDeadlineAt, locale) : copy.noDeadline}</span></div>
                <Link href={`${base}/cases/${item.id}`}>{copy.openMatter} →</Link>
              </article>
            );
          })}
        </div>
      ) : (
        <div className="cases-live-empty"><BriefcaseBusiness /><h2>{query ? copy.noResults : copy.noMatters}</h2><p>{copy.empty}</p>{!query && <Link href={`${base}/cases/new`}>{copy.createFirst}</Link>}</div>
      )}
    </section>
  );
}

function formatDate(value: string, locale: PlatformLocale) {
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { dateStyle: "medium", timeZone: "Asia/Tashkent" }).format(new Date(value));
}
