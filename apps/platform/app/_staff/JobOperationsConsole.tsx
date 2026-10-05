"use client";

import { Select } from "../_components/Select";

import { Activity, RefreshCw, RotateCcw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type {
  OperationalJobKind,
  OperationalJobRedriveEvent,
  OperationalJobStatus,
  OperationalJobView,
} from "../../lib/operations/job-operations";
import type { OperationalLocale } from "../../lib/operations/operational-feature-flags";

type Dashboard = {
  environment: "development" | "staging" | "production";
  integrity: { valid: boolean; checked: number };
  jobs: OperationalJobView[];
  redrives: OperationalJobRedriveEvent[];
  jobCounts: Array<{ status: string; count: number }>;
  outboxCounts: Array<{ status: string; count: number }>;
  scheduledRuns: Array<{ id: string; scheduleName: string; cron: string; status: string; errorCode: string | null; startedAt: string; finishedAt: string | null }>;
};

const kinds: OperationalJobKind[] = [
  "document.analyze", "document.index", "ocr.process", "document.export",
  "email.send", "legal.sync", "legal.parse", "legal.index", "cleanup.run",
  "notification.dispatch", "malware.scan",
];
const statuses: OperationalJobStatus[] = ["running", "retrying", "completed", "rejected", "dead_lettered"];
const copy = {
  ru: { skip: "К основному содержимому", secure: "Защищённая рабочая зона", fresh: "Недавняя 2FA", eyebrow: "Очереди и фоновые задания", title: "Операционный журнал заданий", environment: "Среда", refresh: "Обновить", apply: "Применить фильтр", allStatuses: "Все статусы", allKinds: "Все типы", status: "Статус", kind: "Тип задания", queue: "Очередь", attempt: "Попытка", updated: "Обновлено", error: "Код ошибки", identifiers: "Технические идентификаторы", subject: "Объект", workspace: "Workspace", correlation: "Correlation", redrive: "Повторить безопасно", reason: "Причина ручного повтора", reasonHint: "Не менее 10 символов. Не включайте пользовательский текст, документы или секреты.", cancel: "Отмена", confirm: "Поставить в outbox", saved: "Запрос повтора записан и поставлен в outbox", integrityOk: "Цепочка ручных повторов подтверждена", integrityBad: "Целостность истории нарушена. Повторы заблокированы.", noJobs: "По выбранному фильтру заданий нет.", counts: "Состояние очередей", runs: "Последние cron-запуски", history: "История ручных повторов", noHistory: "Ручных повторов пока нет.", active: "Открыть", features: "Функции", incidents: "Инциденты", costs: "Расходы" },
  uz: { skip: "Asosiy mazmunga o‘tish", secure: "Himoyalangan ish maydoni", fresh: "Yaqindagi 2FA", eyebrow: "Navbatlar va fon vazifalari", title: "Vazifalar operatsion jurnali", environment: "Muhit", refresh: "Yangilash", apply: "Filtrni qo‘llash", allStatuses: "Barcha holatlar", allKinds: "Barcha turlar", status: "Holat", kind: "Vazifa turi", queue: "Navbat", attempt: "Urinish", updated: "Yangilangan", error: "Xato kodi", identifiers: "Texnik identifikatorlar", subject: "Obyekt", workspace: "Workspace", correlation: "Correlation", redrive: "Xavfsiz takrorlash", reason: "Qo‘lda takrorlash sababi", reasonHint: "Kamida 10 ta belgi. Foydalanuvchi matni, hujjat yoki sirlarni kiritmang.", cancel: "Bekor qilish", confirm: "Outbox’ga qo‘yish", saved: "Takrorlash so‘rovi yozildi va outbox’ga qo‘yildi", integrityOk: "Qo‘lda takrorlash zanjiri tasdiqlandi", integrityBad: "Tarix yaxlitligi buzilgan. Takrorlash bloklandi.", noJobs: "Tanlangan filtr bo‘yicha vazifa yo‘q.", counts: "Navbatlar holati", runs: "So‘nggi cron ishga tushirishlar", history: "Qo‘lda takrorlash tarixi", noHistory: "Hali qo‘lda takrorlash yo‘q.", active: "Ochish", features: "Funksiyalar", incidents: "Hodisalar", costs: "Xarajatlar" },
  en: { skip: "Skip to main content", secure: "Secure workspace", fresh: "Recent 2FA", eyebrow: "Queues and background jobs", title: "Job operations log", environment: "Environment", refresh: "Refresh", apply: "Apply filters", allStatuses: "All statuses", allKinds: "All types", status: "Status", kind: "Job type", queue: "Queue", attempt: "Attempt", updated: "Updated", error: "Error code", identifiers: "Technical identifiers", subject: "Subject", workspace: "Workspace", correlation: "Correlation", redrive: "Retry safely", reason: "Reason for manual retry", reasonHint: "Use at least 10 characters. Do not include user text, documents or secrets.", cancel: "Cancel", confirm: "Queue in outbox", saved: "The retry request was recorded and queued in the outbox", integrityOk: "The manual retry chain is verified", integrityBad: "History integrity verification failed. Retries are blocked.", noJobs: "No jobs match the selected filters.", counts: "Queue state", runs: "Recent cron runs", history: "Manual retry history", noHistory: "No manual retries yet.", active: "Open", features: "Features", incidents: "Incidents", costs: "Costs" },
} as const;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { code?: string };
  if (!response.ok) throw new Error(body.code ?? `HTTP_${response.status}`);
  return body;
}

function timestamp(value: string | null): string {
  return value ? `${value.replace("T", " ").slice(0, 19)} UTC` : "—";
}

export function JobOperationsConsole({ locale, staffName, initial }: { locale: OperationalLocale; staffName: string; initial: Dashboard }) {
  const t = copy[locale];
  const nextLocale: OperationalLocale = locale === "ru" ? "uz" : locale === "uz" ? "en" : "ru";
  const [dashboard, setDashboard] = useState(initial);
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedJob, setSelectedJob] = useState<OperationalJobView | null>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (selectedJob) reasonRef.current?.focus(); }, [selectedJob]);

  const refresh = useCallback(async () => {
    setBusy(true);
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    if (kind) query.set("kind", kind);
    try {
      setDashboard(await readJson<Dashboard>(await fetch(`/api/platform/admin/jobs?${query}`, { cache: "no-store" })));
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OPERATIONAL_JOBS_LOAD_FAILED");
    } finally { setBusy(false); }
  }, [kind, status]);

  async function redrive(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedJob || !dashboard.integrity.valid) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    try {
      await readJson(await fetch("/api/platform/admin/jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ jobId: selectedJob.id, reason: form.get("reason") }),
      }));
      setSelectedJob(null);
      setNotice(t.saved);
      setError("");
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OPERATIONAL_JOB_REDRIVE_FAILED");
    } finally { setBusy(false); }
  }

  return <div className="staff-console" aria-busy={busy}>
    <a className="staff-skip" href="#jobs-main">{t.skip}</a>
    <header className="staff-topbar"><div className="staff-brand"><ShieldCheck aria-hidden="true"/><span><b>JURO</b><small>{t.secure}</small></span></div><div className="staff-session"><span>{t.fresh}</span><b>{staffName}</b></div><a href={`/${nextLocale}/admin/jobs`} hrefLang={nextLocale}>{nextLocale.toUpperCase()}</a></header>
    <main id="jobs-main" className="staff-main jobs-main">
      <section className="staff-heading"><div><span>{t.eyebrow} · {t.environment}: {dashboard.environment}</span><h1>{t.title}</h1><p className={dashboard.integrity.valid ? "feature-integrity-ok" : "feature-integrity-error"}>{dashboard.integrity.valid ? t.integrityOk : t.integrityBad} ({dashboard.integrity.checked})</p></div><div className="jobs-heading-actions"><a href={`/${locale}/admin/feature-flags`}>{t.features}</a><a href={`/${locale}/admin/system-status`}>{t.incidents}</a><a href={`/${locale}/admin/costs`}>{t.costs}</a><button type="button" onClick={() => void refresh()} disabled={busy}><RefreshCw aria-hidden="true"/>{t.refresh}</button></div></section>
      <p className="sr-only" aria-live="polite">{notice}</p>{error ? <p className="staff-error" role="alert">{error}</p> : null}
      <section className="jobs-summary" aria-labelledby="jobs-counts-title"><h2 id="jobs-counts-title">{t.counts}</h2><div>{dashboard.jobCounts.map((item) => <article key={`job-${item.status}`}><span>jobs · {item.status}</span><b>{item.count}</b></article>)}{dashboard.outboxCounts.map((item) => <article key={`outbox-${item.status}`}><span>outbox · {item.status}</span><b>{item.count}</b></article>)}</div></section>
      <form className="jobs-filters" onSubmit={(event) => { event.preventDefault(); void refresh(); }}><label>{t.status}<Select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">{t.allStatuses}</option>{statuses.map((value) => <option value={value} key={value}>{value}</option>)}</Select></label><label>{t.kind}<Select value={kind} onChange={(event) => setKind(event.target.value)}><option value="">{t.allKinds}</option>{kinds.map((value) => <option value={value} key={value}>{value}</option>)}</Select></label><button disabled={busy}>{t.apply}</button></form>
      <section className="jobs-table-wrap" aria-label={t.title}>{dashboard.jobs.length ? <div className="jobs-table" role="table"><div className="jobs-table-head" role="row"><span role="columnheader">ID</span><span role="columnheader">{t.kind}</span><span role="columnheader">{t.status}</span><span role="columnheader">{t.error}</span><span role="columnheader">{t.updated}</span><span role="columnheader"></span></div>{dashboard.jobs.map((job) => <div className="jobs-table-row" role="row" key={job.id}><code role="cell">{job.id}</code><span role="cell"><b>{job.jobType}</b><small>{job.queueName}</small></span><span role="cell"><b>{job.status}</b><small>{t.attempt}: {job.attempt} · outbox: {job.outboxStatus ?? "—"}</small></span><code role="cell">{job.errorCode ?? "—"}</code><time role="cell" dateTime={job.updatedAt}>{timestamp(job.updatedAt)}</time><span role="cell" className="jobs-row-actions"><details><summary>{t.identifiers}</summary><dl><div><dt>{t.subject}</dt><dd>{job.subjectId}</dd></div><div><dt>{t.workspace}</dt><dd>{job.workspaceId ?? "—"}</dd></div><div><dt>{t.correlation}</dt><dd>{job.correlationId}</dd></div></dl></details>{job.canRedrive ? <button type="button" onClick={() => { setNotice(""); setSelectedJob(job); }} disabled={busy || !dashboard.integrity.valid}><RotateCcw aria-hidden="true"/>{t.redrive}</button> : null}</span></div>)}</div> : <p className="staff-empty">{t.noJobs}</p>}</section>
      {selectedJob ? <form className="staff-decision job-redrive-form" onSubmit={(event) => void redrive(event)}><h2><RotateCcw aria-hidden="true"/>{t.redrive}: {selectedJob.jobType}</h2><p><code>{selectedJob.id}</code> · {selectedJob.errorCode}</p><label>{t.reason}<textarea ref={reasonRef} name="reason" required minLength={10} maxLength={500} aria-describedby="job-redrive-reason-hint"/></label><small id="job-redrive-reason-hint">{t.reasonHint}</small><div><button type="button" className="staff-reject" onClick={() => setSelectedJob(null)} disabled={busy}>{t.cancel}</button><button className="staff-approve" disabled={busy || !dashboard.integrity.valid}><RotateCcw aria-hidden="true"/>{t.confirm}</button></div></form> : null}
      <section className="jobs-secondary-grid"><div><h2>{t.runs}</h2>{dashboard.scheduledRuns.length ? dashboard.scheduledRuns.map((run) => <article key={run.id}><Activity aria-hidden="true"/><span><b>{run.scheduleName}</b><small>{run.cron} · {run.status}{run.errorCode ? ` · ${run.errorCode}` : ""}</small></span><time dateTime={run.startedAt}>{timestamp(run.startedAt)}</time></article>) : <p className="staff-empty">—</p>}</div><div><h2>{t.history}</h2>{dashboard.redrives.length ? dashboard.redrives.map((item) => <article key={item.id}><RotateCcw aria-hidden="true"/><span><b>{item.sourceJobId}</b><small>{item.reason} · {item.actorUserId}</small></span><time dateTime={item.createdAt}>{timestamp(item.createdAt)}</time></article>) : <p className="staff-empty">{t.noHistory}</p>}</div></section>
    </main>
  </div>;
}
