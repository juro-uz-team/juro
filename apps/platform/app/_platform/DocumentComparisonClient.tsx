"use client";

import { DocumentComparisonProgress } from "./DocumentToolProgress";

import { Select } from "../_components/Select";

import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated comparison lists are hydrated after mount */

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CircleAlert,
  FileDiff,
  FileText,
  FolderOpen,
  LoaderCircle,
  RefreshCcw,
  Replace,
  Upload,
  X,
} from "lucide-react";
import { DragEvent, FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { documentTools, useDocumentToolFile } from "./document-tools";
import { WorkspaceTitle } from "./WorkspaceTitle";
import { comparisonText } from "../../content/platform-ui";
import type { PlatformLocale } from "../../lib/platform/routing";

type ReusableFile = {
  id: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string | null;
  createdAt: string;
};

type RecentComparison = {
  id: string;
  status: string;
  stage: string;
  summaryJson: string | null;
  errorCode: string | null;
  similarityPercent: number | null;
  overallRisk: string | null;
  createdAt: string;
  updatedAt: string;
  versionOneName: string;
  versionTwoName: string;
};

type FileSelection =
  | { kind: "upload"; file: File; librarySource?: string }
  | { kind: "stored"; file: ReusableFile }
  | null;

type Progress = {
  id: string;
  status: string;
  stage: string;
  errorCode?: string | null;
};

type ComparisonCopy = (typeof comparisonText)[PlatformLocale];

export function DocumentComparisonClient({ locale }: { locale: PlatformLocale }) {
  const params = useSearchParams();
  const tools = documentTools[locale];
  const base = usePlatformBasePath();
  return <section className="comparison-page workspace-page">
    <WorkspaceTitle icon={<FileDiff />} title={tools.compare} description={tools.compareHint}
      actions={<Link href={`${base}/documents?pick=compare`}><FolderOpen />{tools.choose}</Link>} />
    <ComparisonForm key={params.toString()} locale={locale} firstSource={params.get("first")} secondSource={params.get("second")} />
  </section>;
}

function ComparisonForm({ locale, firstSource, secondSource }: { locale: PlatformLocale; firstSource: string | null; secondSource: string | null }) {
  const copy = comparisonText[locale];
  const workspaceId = usePlatformWorkspaceId();
  const [quote, setQuote] = useState<{ id: string; totals: [number, number]; ranges: [number, number][] } | null>(null);
  const t = (ru: string, uz: string, en: string) => ({ ru, uz, en })[locale];
  const pagesQuoted = quote?.ranges.reduce((sum, [first, last]) => sum + last - first + 1, 0) ?? 0;

  async function process(id: string, pages?: number, pageRange?: string) {
    const response = await fetch(`/api/platform/document-comparisons/${encodeURIComponent(id)}/process`, {
      method: "POST",
      headers: { "x-juro-csrf": "1", "x-juro-locale": locale, "x-juro-workspace-id": workspaceId,
        ...(pages === undefined ? {} : { "x-juro-confirm-pages": String(pages), "x-juro-page-range": pageRange ?? "" }) },
    });
    const body = await response.json() as { totals?: [number, number]; error?: string; code?: string; comparison?: Progress };
    if (body.comparison) setProgress(body.comparison);
    if (response.status === 428 && body.totals) {
      setQuote({ id, totals: body.totals, ranges: body.totals.map(total => [1, total]) });
      return;
    }
    if (!response.ok) throw new Error(body.error || subscriptionError(body.code) || copy.processError);
    setQuote(null);
    router.push(`${base}/documents/comparisons/${id}`);
  }

  function subscriptionError(code?: string) {
    if (code === "PLAN_LIMIT") return t("Сравнение недоступно на текущем тарифе или лимит исчерпан.", "Joriy tarifda taqqoslash mavjud emas yoki limit tugagan.", "Comparison is unavailable on your plan or your allowance is exhausted.");
    if (code === "PAGES_PER_RUN_LIMIT") return t("Лимит страниц превышен. Выберите нужные фрагменты.", "Sahifa limiti oshdi. Kerakli parchalarni tanlang.", "The page limit was exceeded. Upload the portions you want to compare.");
    return "";
  }
  const router = useRouter();
  const base = usePlatformBasePath();
  const [first, setFirst] = useState<FileSelection>(null);
  const [second, setSecond] = useState<FileSelection>(null);
  const chooseFirst = useCallback((file: File) => setFirst({ kind: "upload", file, librarySource: firstSource ?? undefined }), [firstSource]);
  const chooseSecond = useCallback((file: File) => setSecond({ kind: "upload", file, librarySource: secondSource ?? undefined }), [secondSource]);
  const firstLibrary = useDocumentToolFile(firstSource, locale, chooseFirst);
  const secondLibrary = useDocumentToolFile(secondSource, locale, chooseSecond);
  const opening = firstLibrary.loading || secondLibrary.loading;
  const [consent, setConsent] = useState(false);
  const [reusableFiles, setReusableFiles] = useState<ReusableFile[]>([]);
  const [comparisons, setComparisons] = useState<RecentComparison[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/platform/document-comparisons", {
        cache: "no-store",
        headers: { "x-juro-locale": locale },
      });
      const body = await response.json() as {
        comparisons?: RecentComparison[];
        reusableFiles?: ReusableFile[];
        error?: string;
      };
      if (!response.ok) throw new Error(body.error || copy.loadError);
      setComparisons(body.comparisons ?? []);
      setReusableFiles(body.reusableFiles ?? []);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  const processingId = submitting ? progress?.id : null;
  useEffect(() => {
    if (!processingId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/platform/document-comparisons/${encodeURIComponent(processingId!)}`, {
          cache: "no-store", signal: controller.signal, headers: { "x-juro-locale": locale },
        });
        const body = await response.json() as { comparison?: Progress };
        if (response.ok && body.comparison && !controller.signal.aborted) setProgress(body.comparison);
      } catch {
        // The processing request reports terminal errors.
      }
      if (!controller.signal.aborted) timer = setTimeout(poll, 900);
    }
    timer = setTimeout(poll, 900);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [locale, processingId]);

  const sameStoredFile = first?.kind === "stored" && second?.kind === "stored" && first.file.id === second.file.id;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!first || !second || !consent || submitting || opening || sameStoredFile) return;
    setSubmitting(true);
    setProgress({ id: "", status: "uploading", stage: "uploaded" });
    setError("");
    setWarning("");
    try {
      const form = new FormData();
      form.set("locale", locale);
      form.set("consent", "true");
      setFormSelection(form, "versionOne", "versionOneFileId", first);
      setFormSelection(form, "versionTwo", "versionTwoFileId", second);
      const createdResponse = await fetch("/api/platform/document-comparisons", {
        method: "POST",
        headers: { "x-juro-csrf": "1", "x-juro-locale": locale, "x-juro-workspace-id": workspaceId },
        body: form,
      });
      const created = await createdResponse.json() as {
        comparison?: Progress;
        warning?: string | null;
        code?: string;
        error?: string;
      };
      if (!createdResponse.ok || !created.comparison) {
        throw new Error(created.error || subscriptionError(created.code) || copy.createError);
      }
      setProgress(created.comparison);
      if (created.warning) setWarning(created.warning);
      await process(created.comparison.id);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  async function retry(item: { id: string }, pages?: number, pageRange?: string) {
    setError("");
    setWarning("");
    setProgress({ id: item.id, status: "processing", stage: "uploaded" });
    setSubmitting(true);
    try {
      await process(item.id, pages, pageRange);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="comparison-create">
      {(error || firstLibrary.error || secondLibrary.error) && <div className="comparison-message error" role="alert"><CircleAlert /><span>{error || firstLibrary.error || secondLibrary.error}</span></div>}
      {opening && <div className="comparison-message" role="status"><LoaderCircle className="spin" />{documentTools[locale].loading}</div>}
      {warning && <div className="comparison-message warning" role="status"><AlertTriangle /><span>{warning}</span></div>}
      {quote && <div className="comparison-message" role="status">
        <span>{t(`Сравнение использует ${pagesQuoted} стр.`, `Taqqoslash uchun ${pagesQuoted} sahifa sarflanadi.`, `This comparison uses ${pagesQuoted} pages.`)}</span>
        {quote.ranges.map(([first, last], index) => <fieldset key={index}>
          <legend>{t(`Версия ${index + 1}`, `${index + 1}-versiya`, `Version ${index + 1}`)}</legend>
          <label>{t("С учётной страницы", "Hisob sahifasidan", "First accounting page")}
            <input type="number" min={1} max={last} value={first} onChange={event => {
              const value = Number(event.target.value);
              setQuote({ ...quote, ranges: quote.ranges.map((range, i) => i === index ? [value, range[1]] : range) });
            }} />
          </label>
          <label>{t("По учётную страницу", "Hisob sahifasigacha", "Last accounting page")}
            <input type="number" min={first} max={quote.totals[index]} value={last} onChange={event => {
              const value = Number(event.target.value);
              setQuote({ ...quote, ranges: quote.ranges.map((range, i) => i === index ? [range[0], value] : range) });
            }} />
          </label>
        </fieldset>)}
        <button type="button" disabled={submitting || quote.ranges.some(([first, last], index) =>
          first < 1 || first > last || last > quote.totals[index])}
          onClick={() => void retry(quote, pagesQuoted, quote.ranges.map(pair => pair.join("-")).join(","))}>
          {t("Подтвердить сравнение", "Taqqoslashni tasdiqlash", "Confirm comparison")}
        </button>
      </div>}
      <form onSubmit={submit}>
        <div className="comparison-file-grid">
          <ComparisonFileSlot
            disabled={submitting || opening}
            label={copy.versionOne}
            selection={first}
            onChange={setFirst}
            reusableFiles={reusableFiles.filter(item => second?.kind !== "stored" || second.file.id !== item.id)}
            copy={copy}
          />
          <ComparisonFileSlot
            disabled={submitting || opening}
            label={copy.versionTwo}
            selection={second}
            onChange={setSecond}
            reusableFiles={reusableFiles.filter(item => first?.kind !== "stored" || first.file.id !== item.id)}
            copy={copy}
          />
          <button
            className="comparison-swap"
            type="button"
            onClick={() => { setFirst(second); setSecond(first); }}
            disabled={submitting || opening || (!first && !second)}
          >
            <Replace />
            <span>{copy.swap}</span>
          </button>
        </div>
        <p className="comparison-supported"><FileText />{copy.supported}</p>
        <label className="comparison-consent">
          <input type="checkbox" disabled={submitting || opening} checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>{copy.consent}</span>
        </label>
        <button className="comparison-submit" disabled={!first || !second || !consent || submitting || opening || sameStoredFile}>
          {submitting ? <LoaderCircle className="spin" /> : <FileDiff />}
          {submitting ? copy.processing : copy.start}
        </button>
      </form>

      {progress && submitting && (
        <DocumentComparisonProgress stage={progress.stage} locale={locale} />
      )}

      <section className="comparison-recent">
        <header>
          <div><h2>{copy.recent}</h2><p>{copy.savedDescription}</p></div>
          <button onClick={() => void load()} aria-label={copy.refreshAria}><RefreshCcw className={loading ? "spin" : ""} /></button>
        </header>
        {loading ? <div className="comparison-list-loading"><LoaderCircle className="spin" /></div> : comparisons.length ? (
          <div className="comparison-recent-list">
            {comparisons.map((item) => {
              const available = ["completed", "completed_partial"].includes(item.status);
              return (
                <article key={item.id} data-status={item.status}>
                  <FileDiff />
                  <div>
                    <strong>{item.versionOneName}</strong>
                    <span>{copy.comparedWith} {item.versionTwoName}</span>
                    <small>{stageLabel(item.stage, copy)} · {formatDate(item.updatedAt, locale)}</small>
                  </div>
                  {item.status === "failed" ? (
                    <button onClick={() => void retry(item)} disabled={submitting}><RefreshCcw />{copy.retry}</button>
                  ) : available ? (
                    <Link href={`${base}/documents/comparisons/${item.id}`}>{copy.open}<ArrowRight /></Link>
                  ) : <Link href={`${base}/documents/comparisons/${item.id}`}><LoaderCircle className="spin" />{copy.processing}<ArrowRight /></Link>}
                </article>
              );
            })}
          </div>
        ) : <div className="comparison-empty"><FolderOpen /><p>{copy.noComparisons}</p></div>}
      </section>
    </div>
  );
}

function ComparisonFileSlot({
  label,
  disabled,
  selection,
  onChange,
  reusableFiles,
  copy,
}: {
  label: string;
  disabled: boolean;
  selection: FileSelection;
  onChange: (selection: FileSelection) => void;
  reusableFiles: ReusableFile[];
  copy: ComparisonCopy;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const selectedName = selection?.kind === "upload" ? selection.file.name : selection?.file.fileName;
  const selectedSize = selection?.kind === "upload" ? selection.file.size : selection?.file.sizeBytes;

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (disabled) return;
    const file = event.dataTransfer.files?.[0];
    if (file) onChange({ kind: "upload", file });
  }

  return (
    <fieldset className="comparison-file-slot" disabled={disabled}>
      <legend>{label}</legend>
      <div
        className={`comparison-drop ${dragging ? "dragging" : ""} ${selection ? "selected" : ""}`}
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onChange({ kind: "upload", file });
          }}
          hidden
        />
        {selection ? (
          <>
            <span className="comparison-file-icon"><FileText /></span>
            <div><strong>{selectedName}</strong><small>{formatSize(selectedSize || 0)} · {(selection.kind === "stored" || selection.librarySource) ? copy.fromStorage : copy.fromDevice}</small></div>
            <span className="comparison-file-actions">
              <button type="button" onClick={() => inputRef.current?.click()}><Upload /><span>{copy.replace}</span></button>
              <button type="button" onClick={() => onChange(null)} aria-label={copy.remove}><X /></button>
            </span>
          </>
        ) : (
          <button className="comparison-choose" type="button" onClick={() => inputRef.current?.click()}>
            <Upload />
            <strong>{copy.chooseFile}</strong>
            <small>PDF · DOCX</small>
          </button>
        )}
      </div>
      <label className="comparison-stored-select">
        <span><FolderOpen />{copy.chooseStored}</span>
        <Select
          disabled={disabled}
          value={selection?.kind === "stored" ? selection.file.id : ""}
          onChange={(event) => {
            const file = reusableFiles.find((item) => item.id === event.target.value);
            onChange(file ? { kind: "stored", file } : null);
          }}
        >
          <option value="">—</option>
          {reusableFiles.map((file) => <option value={file.id} key={file.id}>{file.fileName} · {formatSize(file.sizeBytes)}</option>)}
        </Select>
      </label>
    </fieldset>
  );
}

function setFormSelection(form: FormData, uploadField: string, storedField: string, selection: Exclude<FileSelection, null>) {
  if (selection.kind === "upload") {
    form.set(uploadField, selection.file);
    if (selection.librarySource?.startsWith("doc:")) {
      form.set(uploadField + "DocumentId", selection.librarySource.slice(4));
    }
  }
  else form.set(storedField, selection.file.id);
}

function stageLabel(stage: string, copy: ComparisonCopy) {
  return copy.stages[stage as keyof typeof copy.stages] || stage;
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function formatDate(value: string, locale: PlatformLocale) {
  const intlLocale = locale === "ru" ? "ru-RU" : locale === "uz" ? "uz-UZ" : "en-GB";
  return new Intl.DateTimeFormat(intlLocale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}
