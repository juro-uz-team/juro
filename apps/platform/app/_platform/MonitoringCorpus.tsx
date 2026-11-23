"use client";

import { BookOpen, ChevronRight, ExternalLink, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PlatformLocale } from "../../lib/platform/routing";

export const monitoringLabels = {
  ru: {
    subtitle: "Новые публикации и правовые акты Узбекистана", settings: "Уведомления",
    updates: "Обновления", corpus: "Законодательство", close: "Закрыть",
    search: "Поиск", change: "Тип обновления", all: "Все", newAct: "Публикация", correction: "Изменение записи",
    updatePlaceholder: "Название или номер акта", noResults: "По этим фильтрам ничего не найдено.",
    previous: "Назад", next: "Далее", back: "К списку", pickUpdate: "Выберите обновление, чтобы открыть его.",
    pickAct: "Выберите акт для чтения.", language: "Язык", category: "Классификатор Lex.uz", edition: "Редакция",
    loading: "Загрузка…", unavailable: "Не удалось загрузить законодательство.", retry: "Повторить",
    source: "Открыть на Lex.uz", pdf: "Открыть оригинал на Lex.uz", more: "Продолжить чтение", gaps: "Некоторые части доступны на Lex.uz.",
    preparing: "Полный текст готовится", observed: "Обнаружено", catalogueCheck: "Сверка каталога",
  },
  uz: {
    subtitle: "O‘zbekistonning yangi e’lonlari va huquqiy hujjatlari", settings: "Bildirishnomalar",
    updates: "Yangilanishlar", corpus: "Qonunchilik", close: "Yopish",
    search: "Qidirish", change: "Yangilanish turi", all: "Barchasi", newAct: "E’lon", correction: "Yozuv o‘zgarishi",
    updatePlaceholder: "Hujjat nomi yoki raqami", noResults: "Bu filtrlar bo‘yicha natija topilmadi.",
    previous: "Oldingi", next: "Keyingi", back: "Ro‘yxatga qaytish", pickUpdate: "Ochish uchun yangilanishni tanlang.",
    pickAct: "O‘qish uchun hujjatni tanlang.", language: "Til", category: "Lex.uz tasnifi", edition: "Tahrir",
    loading: "Yuklanmoqda…", unavailable: "Qonunchilikni yuklab bo‘lmadi.", retry: "Qayta urinish",
    source: "Lex.uz’da ochish", pdf: "Asl hujjatni Lex.uz’da ochish", more: "O‘qishda davom etish", gaps: "Ayrim qismlar faqat Lex.uz’da mavjud.",
    preparing: "To‘liq matn tayyorlanmoqda", observed: "Aniqlangan sana", catalogueCheck: "Katalog tekshiruvi",
  },
  en: {
    subtitle: "New publications and legal acts of Uzbekistan", settings: "Notifications",
    updates: "Updates", corpus: "Corpus", close: "Close",
    search: "Search", change: "Update type", all: "All", newAct: "Publication", correction: "Record change",
    updatePlaceholder: "Act title or number", noResults: "No results match these filters.",
    previous: "Previous", next: "Next", back: "Back to results", pickUpdate: "Select an update to read it.",
    pickAct: "Select an act to read it.", language: "Language", category: "Lex.uz category", edition: "Edition",
    loading: "Loading…", unavailable: "The corpus could not be loaded.", retry: "Try again",
    source: "Open on Lex.uz", pdf: "Open original on Lex.uz", more: "Continue reading", gaps: "Some sections are available on Lex.uz.",
    preparing: "Full text is being prepared", observed: "Observed", catalogueCheck: "Catalogue checked",
  },
} as const;

type Entry = { work: string; title: string; url: string; edition: string | null; language: string };
type Catalogue = { entries: Entry[]; categories: { id: string; label: string }[]; nextPage: string | null };
type Act = { entry: Entry; units: { text: string; locator: string }[]; nextOffset: number | null; extractionGaps: boolean;
  pdfUrl?: string; pdfLinks?: string[] };
const languages = { ru: "Русский", uz: "O‘zbekcha", uzc: "Ўзбекча", en: "English" };

async function requestCorpus<T>(workspaceId: string, params: URLSearchParams, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/platform/monitoring/corpus?${params}`, {
    headers: { "x-juro-workspace-id": workspaceId }, signal, cache: "no-store",
  });
  if (!response.ok) throw new Error(response.status === 404 ? "CORPUS_SOURCE_MISSING" : "CORPUS_BROWSE_UNAVAILABLE");
  return await response.json() as T;
}

export function CorpusBrowser({ locale, workspaceId }: { locale: PlatformLocale; workspaceId: string }) {
  const t = monitoringLabels[locale];
  const [filters, setFilters] = useState({ q: "", language: "", category: "", cursor: "" });
  const [previous, setPrevious] = useState<string[]>([]);
  const [selected, setSelected] = useState<Entry | null>(null);
  const [result, setResult] = useState<{ filters: typeof filters; data?: Catalogue }>();
  const [retry, setRetry] = useState(0);
  const activeRow = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const current = result?.filters === filters ? result : undefined;
  useEffect(() => {
    const controller = new AbortController();
    requestCorpus<Catalogue>(workspaceId, new URLSearchParams(filters), controller.signal)
      .then(data => setResult({ filters, data }))
      .catch(() => { if (!controller.signal.aborted) setResult({ filters }); });
    return () => controller.abort();
  }, [filters, retry, workspaceId]);
  useEffect(() => { if (selected) heading.current?.focus({ preventScroll: true }); }, [selected]);

  return <div className="monitoring-split" data-reading={Boolean(selected)}>
    <section className="monitoring-list" aria-label={t.corpus}>
      <form className="monitoring-filter corpus" onSubmit={event => {
        event.preventDefault();
        setSelected(null);
        setPrevious([]);
        setFilters({ ...filters, q: String(new FormData(event.currentTarget).get("search") ?? ""), cursor: "" });
      }}>
        <label><span>{t.search}</span><input type="search" name="search" maxLength={120} placeholder={t.updatePlaceholder} /></label>
        <label><span>{t.language}</span><select value={filters.language} onChange={event => {
          setSelected(null);
          setPrevious([]);
          setFilters({ ...filters, language: event.target.value, cursor: "" });
        }}><option value="">{t.all}</option>{Object.entries(languages).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label>
        <label><span>{t.category}</span><select value={filters.category} onChange={event => {
          setSelected(null);
          setPrevious([]);
          setFilters({ ...filters, category: event.target.value, cursor: "" });
        }}><option value="">{t.all}</option>{result?.data?.categories.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <button className="monitoring-button" type="submit">{t.search}</button>
      </form>
      {!current ? <p className="monitoring-loading" role="status"><LoaderCircle className="spin" aria-hidden="true" />{t.loading}</p>
        : !current.data ? <p className="monitoring-message error" role="alert">{t.unavailable}<button type="button" onClick={() => {
          setResult(undefined);
          setRetry(retry + 1);
        }}>{t.retry}</button></p>
          : current.data.entries.length ? current.data.entries.map(item => <button key={item.work} type="button"
            className="monitoring-result" aria-pressed={selected?.work === item.work} onClick={event => {
              activeRow.current = event.currentTarget;
              setSelected(item);
            }}><span><small>{languages[item.language as keyof typeof languages] ?? item.language}{item.edition && ` · ${t.edition} ${item.edition}`}</small>
              <strong>{item.title}</strong></span><ChevronRight aria-hidden="true" /></button>)
            : <p className="monitoring-empty">{t.noResults}</p>}
      <div className="monitoring-pagination">
        {previous.length > 0 && <button className="monitoring-button" type="button" onClick={() => {
          setSelected(null);
          setFilters({ ...filters, cursor: previous.at(-1)! });
          setPrevious(previous.slice(0, -1));
        }}>{t.previous}</button>}
        {current?.data?.nextPage && <button className="monitoring-button" type="button" onClick={() => {
          setSelected(null);
          setPrevious([...previous, filters.cursor]);
          setFilters({ ...filters, cursor: current.data!.nextPage! });
        }}>{t.next}</button>}
      </div>
    </section>
    {selected ? <section className="monitoring-reader" aria-label={selected.title}>
      <button className="monitoring-button" type="button" onClick={() => {
        setSelected(null);
        requestAnimationFrame(() => activeRow.current?.focus());
      }}>{t.back}</button>
      <h2 ref={heading} tabIndex={-1}>{selected.title}</h2>
      <CorpusText key={selected.work} entry={selected} locale={locale} workspaceId={workspaceId} />
    </section> : <div className="monitoring-reader-placeholder"><BookOpen aria-hidden="true" /><p>{t.pickAct}</p></div>}
  </div>;
}

export function CorpusText({ entry, locale, workspaceId, fromUpdate = false }: {
  entry: Pick<Entry, "work" | "url">; locale: PlatformLocale; workspaceId: string; fromUpdate?: boolean;
}) {
  const t = monitoringLabels[locale];
  const [offset, setOffset] = useState(0);
  const [act, setAct] = useState<Act>();
  const [failed, setFailed] = useState(false);
  const [missing, setMissing] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    requestCorpus<Act>(workspaceId, new URLSearchParams({ work: entry.work, offset: String(offset) }), controller.signal)
      .then(result => setAct(previous => offset === 0 || !previous ? result
        : { ...result, units: [...previous.units, ...result.units] }))
      .catch(error => {
        if (controller.signal.aborted) return;
        setMissing(error instanceof Error && error.message === "CORPUS_SOURCE_MISSING");
        setFailed(true);
      });
    return () => controller.abort();
  }, [entry.work, offset, retry, workspaceId]);
  const loading = !failed && (!act || act.nextOffset === offset);
  return <>
    {act?.pdfUrl && <a className="monitoring-source" href={act.pdfUrl} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{t.pdf}</a>}
    {!act?.pdfUrl && (!fromUpdate || act || failed) && <a className="monitoring-source" href={entry.url} target="_blank" rel="noopener noreferrer"><ExternalLink aria-hidden="true" />{t.source}</a>}
    {!act?.pdfUrl && act?.extractionGaps && <p className="monitoring-feed-note">{t.gaps}</p>}
    {act?.pdfLinks?.map((url, index, files) => <a key={url} className="monitoring-source" href={url} target="_blank" rel="noopener noreferrer">
      <ExternalLink aria-hidden="true" />{t.pdf}{files.length > 1 ? ` · ${index + 1}` : ""}</a>)}
    {!act?.pdfUrl && <div className="monitoring-act-text">{act?.units.map((unit, index) => <p key={index}>{unit.text}</p>)}</div>}
    {loading && <p className="monitoring-loading" role="status">{t.loading}</p>}
    {failed && <p className={missing && fromUpdate ? "monitoring-message monitoring-feed-note" : "monitoring-message error"}
      role={missing && fromUpdate ? "status" : "alert"}>{missing && fromUpdate ? t.preparing : t.unavailable}
      <button type="button" onClick={() => {
      setFailed(false);
      setRetry(retry + 1);
    }}>{t.retry}</button></p>}
    {!act?.pdfUrl && !loading && !failed && act?.nextOffset !== null && act?.nextOffset !== undefined
      && <button className="monitoring-button" type="button" onClick={() => setOffset(act.nextOffset!)}>{t.more}</button>}
  </>;
}
