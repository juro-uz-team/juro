"use client";

import { Select } from "../_components/Select";

import { usePlatformBasePath } from "./PlatformRouteContext";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated comparison lists are hydrated after mount */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  Check,
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
import { comparisonText } from "../../content/platform-ui";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";

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
  | { kind: "upload"; file: File }
  | { kind: "stored"; file: ReusableFile }
  | null;

type Progress = {
  id: string;
  status: string;
  stage: string;
  errorCode?: string | null;
};

type ComparisonCopy = (typeof comparisonText)[PlatformLocale];

const stageOrder = [
  "uploaded",
  "extracting_version_one",
  "extracting_version_two",
  "structuring",
  "diffing",
  "legal_analysis",
  "completed",
] as const;

export function DocumentComparisonClient({
  locale,
}: {
  locale: PlatformLocale;
  accountType: AccountType;
}) {
  const copy = comparisonText[locale];
  const router = useRouter();
  const base = usePlatformBasePath();
  const [first, setFirst] = useState<FileSelection>(null);
  const [second, setSecond] = useState<FileSelection>(null);
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

  async function pollComparison(id: string) {
    try {
      const response = await fetch(
        `/api/platform/document-comparisons/${encodeURIComponent(id)}`,
        { cache: "no-store", headers: { "x-juro-locale": locale } },
      );
      const body = await response.json() as { comparison?: Progress; error?: string };
      if (response.ok && body.comparison) setProgress(body.comparison);
    } catch {
      // The processing request remains authoritative. A transient polling failure is retried.
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!first || !second || !consent || submitting) return;
    setSubmitting(true);
    setError("");
    setWarning("");
    let interval: ReturnType<typeof setInterval> | undefined;
    try {
      const form = new FormData();
      form.set("locale", locale);
      form.set("consent", "true");
      setFormSelection(form, "versionOne", "versionOneFileId", first);
      setFormSelection(form, "versionTwo", "versionTwoFileId", second);
      const createdResponse = await fetch("/api/platform/document-comparisons", {
        method: "POST",
        headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
        body: form,
      });
      const created = await createdResponse.json() as {
        comparison?: Progress;
        warning?: string | null;
        error?: string;
      };
      if (!createdResponse.ok || !created.comparison) {
        throw new Error(created.error || copy.createError);
      }
      setProgress(created.comparison);
      if (created.warning) setWarning(created.warning);
      interval = setInterval(() => void pollComparison(created.comparison!.id), 900);
      const processedResponse = await fetch(
        `/api/platform/document-comparisons/${encodeURIComponent(created.comparison.id)}/process`,
        { method: "POST", headers: { "x-juro-csrf": "1", "x-juro-locale": locale } },
      );
      const processed = await processedResponse.json() as {
        comparison?: Progress;
        error?: string;
      };
      if (processed.comparison) setProgress(processed.comparison);
      if (!processedResponse.ok) {
        throw new Error(processed.error || copy.processError);
      }
      router.push(`${base}/documents/comparisons/${created.comparison.id}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      await load();
    } finally {
      if (interval) clearInterval(interval);
      setSubmitting(false);
    }
  }

  async function retry(item: RecentComparison) {
    setError("");
    setProgress({ id: item.id, status: item.status, stage: item.stage, errorCode: item.errorCode });
    setSubmitting(true);
    let interval: ReturnType<typeof setInterval> | undefined;
    try {
      interval = setInterval(() => void pollComparison(item.id), 900);
      const response = await fetch(
        `/api/platform/document-comparisons/${encodeURIComponent(item.id)}/process`,
        { method: "POST", headers: { "x-juro-csrf": "1", "x-juro-locale": locale } },
      );
      const body = await response.json() as { comparison?: Progress; error?: string };
      if (!response.ok) throw new Error(body.error || copy.retryError);
      router.push(`${base}/documents/comparisons/${item.id}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      await load();
    } finally {
      if (interval) clearInterval(interval);
      setSubmitting(false);
    }
  }

  return (
    <div className="comparison-create">
      {error && <div className="comparison-message error" role="alert"><CircleAlert /><span>{error}</span></div>}
      {warning && <div className="comparison-message warning" role="status"><AlertTriangle /><span>{warning}</span></div>}
      <form onSubmit={submit}>
        <div className="comparison-file-grid">
          <ComparisonFileSlot
            label={copy.versionOne}
            selection={first}
            onChange={setFirst}
            reusableFiles={reusableFiles}
            copy={copy}
          />
          <ComparisonFileSlot
            label={copy.versionTwo}
            selection={second}
            onChange={setSecond}
            reusableFiles={reusableFiles}
            copy={copy}
          />
          <button
            className="comparison-swap"
            type="button"
            onClick={() => { setFirst(second); setSecond(first); }}
            disabled={!first && !second}
          >
            <Replace />
            <span>{copy.swap}</span>
          </button>
        </div>
        <p className="comparison-supported"><FileText />{copy.supported}</p>
        <label className="comparison-consent">
          <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
          <span>{copy.consent}</span>
        </label>
        <button className="comparison-submit" disabled={!first || !second || !consent || submitting}>
          {submitting ? <LoaderCircle className="spin" /> : <FileDiff />}
          {copy.start}
        </button>
      </form>

      {progress && submitting && (
        <ProcessingProgress progress={progress} copy={copy} />
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
                  ) : <span className="comparison-processing-label"><LoaderCircle className="spin" />{copy.processing}</span>}
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
  selection,
  onChange,
  reusableFiles,
  copy,
}: {
  label: string;
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
    const file = event.dataTransfer.files?.[0];
    if (file) onChange({ kind: "upload", file });
  }

  return (
    <fieldset className="comparison-file-slot">
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
            <div><strong>{selectedName}</strong><small>{formatSize(selectedSize || 0)} · {selection.kind === "stored" ? copy.fromStorage : copy.fromDevice}</small></div>
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

function ProcessingProgress({
  progress,
  copy,
}: {
  progress: Progress;
  copy: ComparisonCopy;
}) {
  const current = Math.max(stageOrder.indexOf(progress.stage as typeof stageOrder[number]), 0);
  return (
    <section className="comparison-progress" aria-live="polite">
      <header><LoaderCircle className={progress.status === "failed" ? "" : "spin"} /><div><strong>{copy.processing}</strong><small>{stageLabel(progress.stage, copy)}</small></div></header>
      <ol>
        {stageOrder.map((stage, index) => (
          <li key={stage} className={index < current ? "done" : index === current ? "active" : ""}>
            <span>{index < current ? <Check /> : index + 1}</span>
            <strong>{copy.stages[stage]}</strong>
          </li>
        ))}
      </ol>
    </section>
  );
}

function setFormSelection(form: FormData, uploadField: string, storedField: string, selection: Exclude<FileSelection, null>) {
  if (selection.kind === "upload") form.set(uploadField, selection.file);
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
