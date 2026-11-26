"use client";

import { DocumentCitationLinks, DocumentCitationList, type DocumentCitation } from "./DocumentCitationList";
import { DocumentReportMetrics, type DocumentReportMetric } from "./DocumentReportMetrics";
import { DocumentTextDiff } from "./DocumentTextDiff";
import { DocumentToolProgress } from "./DocumentToolProgress";

import { WorkspaceTitle } from "./WorkspaceTitle";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated analysis data is hydrated after the first browser render */

import { AlertTriangle, BookOpen, Check, CheckCircle2, CircleAlert, Download, Eye, FileCheck2, FolderOpen, ChevronDown, ClipboardList, FileText, Link2, LoaderCircle, RefreshCw, Scale, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { FormEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { platformApiError } from "../../content/platform-ui";
import { importDocumentUrlForAnalysis, uploadDocumentForAnalysis } from "../../lib/document-analysis/client-upload";
import { defaultDocumentAnalysisLocale, type SupportedDocumentAnalysisLocale } from "../../lib/document-analysis/language";
import type { AnalysisPackageContext, AnalysisPackageMemberRole, AnalysisPackageRelationshipKind } from "../../lib/document-comparison/types";
import type { PlatformLocale } from "../../lib/platform/routing";
import { usePlatformBasePath } from "./PlatformRouteContext";
import { documentTools, useDocumentToolFile } from "./document-tools";
import { documentFollowUpQuestions } from "../../lib/document-analysis/follow-up";
import type { DocumentAnalysisResult } from "../../lib/document-analysis/schema";
import { documentReviewCopy, reviewText } from "./document-review-localization";

type Risk = { id?: string; level: string; title: string; description: string; excerpt: string | null; confidencePercent: number | null; riskType?: "document_internal" | "legal_compliance"; clause?: string | null; page?: number | null; recommendation?: string | null; proposedWording?: string | null; legalBasisSourceIds?: string[] };
type AnalysisExportFormat = "json" | "pdf" | "docx";
type AnalysisExportVariant = "analysis_report" | "corrected_clean" | "corrected_redline";
type AnalysisExport = { id: string; status: string; format: AnalysisExportFormat; variant: AnalysisExportVariant; sourceVersionId: string | null; fileName: string; sizeBytes: number | null; errorCode: string | null; completedAt: string | null; createdAt: string };
type Summary = {
  mode?: string;
  summary?: string; parties?: string[]; dates?: string[]; obligations?: string[]; payments?: string[];
  disputedTerms?: string[]; missingItems?: string[]; questions?: string[]; disclaimer?: string;
  result?: Partial<DocumentAnalysisResult>;
  extraction?: { packageContext?: AnalysisPackageContext | null };
};
type Analysis = {
  id: string; status: string; progressStage?: string | null; errorCode?: string | null; retryExhausted?: boolean; createdAt?: string; updatedAt?: string;
  fileId: string; sourceAvailable?: boolean; fileName: string; mimeType: string; sizeBytes: number; caseId?: string | null; summary?: Summary | null; risks?: Risk[]; exports?: AnalysisExport[];
};
type AnalysisCaseOption = { id: string; title: string; status: string; updatedAt: string };
type RevisionStatus = "pending" | "accepted" | "rejected" | "applied" | "stale" | "ambiguous";
type SuggestedRevision = {
  id: string; analysisId: string; riskId: string; status: RevisionStatus; originalText: string; proposedText: string;
  decidedAt: string | null; appliedVersionId: string | null; riskLevel: string; riskTitle: string;
  riskDescription: string; clause: string | null; page: number | null; recommendation: string | null;
  legalBasisSourceIds: string[];
};
type AnalysisDocumentVersion = {
  id: string; analysisId: string; version: number; sourceKind: "extracted" | "corrected"; fileName: string;
  mimeType: string; sizeBytes: number; sha256: string; createdAt: string;
};
type BuilderAnalysisSource = {
  documentId: string;
  sourceRevision: number;
  currentRevision: number;
};

const activeAnalysisStatuses = new Set([
  "quarantined",
  "ready",
  "processing",
  "persisting",
  "awaiting_ocr",
  "ocr_processing",
  "retrying",
]);

function hasRetryExhausted(analysis: Pick<Analysis, "retryExhausted">): boolean {
  return analysis.retryExhausted === true;
}

export function DocumentReviewClient({ locale, publicUrlImportEnabled }: { locale: PlatformLocale; publicUrlImportEnabled: boolean }) {
  const searchParams = useSearchParams();
  const base = usePlatformBasePath();
  const tools = documentTools[locale];
  return <section className="review-workspace workspace-page">
    <WorkspaceTitle icon={<FileCheck2 />} title={tools.check} description={tools.checkHint}
      actions={<Link href={`${base}/documents`}><FolderOpen />{tools.library}</Link>} />
    <SingleDocumentReview key={searchParams.toString()} locale={locale} source={searchParams.get("source")} initialMode={searchParams.get("mode") === "full" ? "full" : "quick"} initialCaseId={searchParams.get("caseId")} initialAnalysisId={searchParams.get("analysisId")} publicUrlImportEnabled={publicUrlImportEnabled} />
  </section>;
}

function SingleDocumentReview({ locale, source, initialMode, initialCaseId, initialAnalysisId, publicUrlImportEnabled }: { locale: PlatformLocale; source: string | null; initialMode: "quick" | "full"; initialCaseId: string | null; initialAnalysisId: string | null; publicUrlImportEnabled: boolean }) {
  const copy = documentReviewCopy[locale];
  const tools = documentTools[locale];
  const base = usePlatformBasePath();
  const reportRef = useRef<HTMLElement>(null);
  const [inputKind, setInputKind] = useState<"file" | "url">("file");
  const [analysisLocale, setAnalysisLocale] = useState<SupportedDocumentAnalysisLocale>(() => defaultDocumentAnalysisLocale(locale));
  const inputRef = useRef<HTMLInputElement>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [cases, setCases] = useState<AnalysisCaseOption[]>([]);
  const [uploadCaseId, setUploadCaseId] = useState(initialCaseId ?? "");
  const [selected, setSelected] = useState<Analysis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [fromLibrary, setFromLibrary] = useState(false);
  const [mode, setMode] = useState(initialMode);
  const selectLibraryFile = useCallback((file: File) => { setFile(file); setFromLibrary(true); }, []);
  const libraryFile = useDocumentToolFile(source, locale, selectLibraryFile);
  const [publicUrl, setPublicUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ phase: "hashing" | "uploading" | "finalizing"; loaded: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch(initialAnalysisId ? `/api/platform/document-review?analysisId=${encodeURIComponent(initialAnalysisId)}` : "/api/platform/document-review", { cache: "no-store" });
      const body = await response.json() as { analyses?: Analysis[]; cases?: AnalysisCaseOption[]; error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.loadError));
      const nextAnalyses = body.analyses ?? [];
      const nextCases = body.cases ?? [];
      setAnalyses(nextAnalyses);
      setCases(nextCases);
      setUploadCaseId(current => current || (initialCaseId && nextCases.some(item => item.id === initialCaseId) ? initialCaseId : ""));
      setSelected(current => current
        ? nextAnalyses.find(item => item.id === current.id) ?? nextAnalyses[0] ?? null
        : (nextAnalyses.find(item => item.id === initialAnalysisId) ?? nextAnalyses[0] ?? null));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setLoading(false); }
  }, [copy.loadError, initialAnalysisId, initialCaseId, locale]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!loading && initialAnalysisId && window.location.hash === "#review-report") reportRef.current?.scrollIntoView();
    if (source && window.location.hash === "#review-intake") document.getElementById("review-intake")?.scrollIntoView();
  }, [initialAnalysisId, loading, source]);
  const exportPending = analyses.some(item => item.exports?.some(record => ["queued", "processing", "retrying"].includes(record.status)));
  const analysisPending = analyses.some((item) =>
    !hasRetryExhausted(item) && activeAnalysisStatuses.has(item.status)
  );
  useEffect(() => {
    if (!exportPending && !analysisPending) return;
    const timer = window.setInterval(() => { void load(); }, analysisPending ? 1_500 : 5_000);
    return () => window.clearInterval(timer);
  }, [analysisPending, exportPending, load]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !consent || uploading) return;
    setUploading(true);
    setUploadProgress({ phase: "hashing", loaded: 0, total: file.size });
    setError("");
    setNotice("");
    try {
      const body = await uploadDocumentForAnalysis(file, locale, setUploadProgress, uploadCaseId || null, analysisLocale, undefined, { mode,
        sourceDocumentId: fromLibrary && source?.startsWith("doc:") ? source.slice(4) : undefined });
      setNotice(platformApiError(locale, body.message, body.analysis.status === "completed" ? copy.completed : tools.queued));
      setFile(null);
      setConsent(false);
      if (inputRef.current) inputRef.current.value = "";
      setSelected(body.analysis);
      await load();
      if (body.analysis) {
        reportRef.current?.focus({ preventScroll: true });
        reportRef.current?.scrollIntoView({ block: "start" });
      }
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setUploading(false); setUploadProgress(null); }
  }

  async function importUrl(event: FormEvent) {
    event.preventDefault();
    if (!publicUrlImportEnabled || !publicUrl.trim() || !consent || uploading) return;
    setUploading(true);
    setUploadProgress(null);
    setError("");
    setNotice("");
    try {
      const body = await importDocumentUrlForAnalysis(publicUrl, locale, uploadCaseId || null, analysisLocale);
      setNotice(platformApiError(locale, body.message, copy.imported));
      setPublicUrl("");
      setConsent(false);
      setSelected(body.analysis);
      await load();
      if (body.analysis) {
        reportRef.current?.focus({ preventScroll: true });
        reportRef.current?.scrollIntoView({ block: "start" });
      }
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setUploading(false); }
  }

  const uploadPercent = uploadProgress?.phase === "uploading" && uploadProgress.total > 0
    ? Math.round((uploadProgress.loaded / uploadProgress.total) * 100)
    : null;
  const uploadStatus = !uploadProgress ? "" : uploadProgress.phase === "hashing"
    ? copy.hashing
    : uploadProgress.phase === "finalizing"
      ? copy.finalizing
      : uploadPercent === null
        ? copy.uploading
        : copy.uploadPercent(uploadPercent);
  const consentCopy = publicUrlImportEnabled ? copy.consentUrl : copy.consentFile;

  return <>
    {(error || libraryFile.error) && <p className="review-message error" role="alert"><CircleAlert />{error || libraryFile.error}</p>}
    {notice && <p className="review-message success" role="status"><ShieldCheck />{notice}</p>}
    <form id="review-intake" className="review-intake" onSubmit={inputKind === "url" ? importUrl : upload}>
      <header><h2>{tools.intake}</h2>{publicUrlImportEnabled && <div className="review-source-switch">
        <button type="button" disabled={uploading} aria-pressed={inputKind === "file"} onClick={() => setInputKind("file")}><Upload />{tools.file}</button>
        <button type="button" disabled={uploading} aria-pressed={inputKind === "url"} onClick={() => setInputKind("url")}><Link2 />{tools.link}</button>
      </div>}</header>
      <div className="review-intake-body">
        <div className="review-input-source">
          {inputKind === "file" ? <>
            <label className="review-file-target" data-focus-field htmlFor="document-review-file">
              <span className="review-source-icon">{libraryFile.loading ? <LoaderCircle className="spin" /> : file ? <FileCheck2 /> : <Upload />}</span>
              <strong>{libraryFile.loading ? tools.loading : file?.name || tools.chooseFile}</strong>
              <span id="document-review-file-hint">{file ? formatFileSize(file.size, locale) : copy.supportedFiles + " · " + copy.fileHint}</span>
              <input id="document-review-file" ref={inputRef} type="file" aria-label={copy.chooseFileAria} aria-describedby="document-review-file-hint" accept=".pdf,.docx,.jpg,.jpeg,.png,.zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,application/zip" disabled={uploading || libraryFile.loading} onChange={event => { setFromLibrary(false); setFile(event.target.files?.[0] ?? null); }} />
            </label>
            {!uploading && <Link className="review-library-link" href={`${base}/documents?pick=check`}><FolderOpen />{tools.choose}</Link>}
          </> : <label className="review-link-source" htmlFor="review-public-url"><Link2 /><strong>{copy.importTitle}</strong>
            <input id="review-public-url" type="url" required inputMode="url" autoComplete="url" maxLength={2048} placeholder="https://example.uz/document.pdf" value={publicUrl} onChange={event => setPublicUrl(event.target.value)} disabled={uploading} /><small>{copy.importHint}</small>
          </label>}
        </div>
        <div className="review-settings">
          {inputKind === "file" && <label><span>{reviewText(locale, "Глубина проверки", "Tekshiruv darajasi", "Review depth")}</span>
            <Select value={mode} disabled={uploading} onChange={event => setMode(event.target.value === "full" ? "full" : "quick")}>
              <option value="quick">{reviewText(locale, "Быстрая проверка", "Tezkor tekshiruv", "Quick review")}</option>
              <option value="full">{reviewText(locale, "Полная проверка текста", "Matnni to‘liq tekshirish", "Full-text review")}</option>
            </Select></label>}

          <label><span>{copy.addToCase}</span><Select value={uploadCaseId} onChange={event => setUploadCaseId(event.target.value)} disabled={uploading}><option value="">{copy.noCase}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></label>
          {locale === "en" && <label><span>{copy.analysisLanguage}</span><Select value={analysisLocale} onChange={event => setAnalysisLocale(event.target.value as SupportedDocumentAnalysisLocale)} disabled={uploading} aria-describedby="document-review-language-hint"><option value="ru">{copy.russian}</option><option value="uz">{copy.uzbek}</option></Select><small id="document-review-language-hint">{copy.analysisLanguageHint}</small></label>}
          <label className="review-consent"><input type="checkbox" checked={consent} disabled={uploading} onChange={event => setConsent(event.target.checked)} /><span>{consentCopy}</span></label>
          <button className="review-start" disabled={!consent || uploading || (inputKind === "file" ? !file || libraryFile.loading : !publicUrl.trim())}>{uploading ? <LoaderCircle className="spin" /> : <FileCheck2 />}{inputKind === "url" ? copy.importAction : tools.check}</button>
        </div>
      </div>
      {uploading && <DocumentToolProgress title={copy.uploadProgressAria} description={uploadStatus || copy.importAction} steps={tools.stages} current={0} percent={uploadPercent ?? undefined} />}
    </form>
    {loading ? <div className="review-loading" role="status" aria-label={tools.loading}><LoaderCircle className="spin" /></div> :
      <section id="review-report" className="review-result-pane" aria-label={copy.resultAria} ref={reportRef} tabIndex={-1}>
        {analyses.length > 0 && <div className="review-history"><label><FolderOpen />{copy.recentFiles}
          <Select value={selected?.id ?? ""} onChange={event => setSelected(analyses.find(item => item.id === event.target.value) ?? null)}>
            {analyses.map(item => <option key={item.id} value={item.id}>{item.fileName} · {statusLabel(item.status, locale, hasRetryExhausted(item))}{item.createdAt ? " · " + new Date(item.createdAt).toLocaleDateString(locale) : ""}</option>)}
          </Select>
        </label></div>}
        {selected ? <AnalysisView key={selected.id} analysis={selected} cases={cases} locale={locale} onChanged={load} /> :
          <div className="review-history-empty"><FileText /><div><h2>{copy.recentFiles}</h2><p>{tools.emptyHistory}</p></div></div>}
      </section>}
  </>;
}

function AnalysisView({ analysis, cases, locale, onChanged }: { analysis: Analysis; cases: AnalysisCaseOption[]; locale: PlatformLocale; onChanged: () => Promise<void> }) {
  const copy = documentReviewCopy[locale];
  const summary = analysis.summary;
  const tools = documentTools[locale];
  const [exportAttemptKeys, setExportAttemptKeys] = useState<Record<string, string>>({});
  const canOpen = analysis.status === "completed";
  const retryExhausted = hasRetryExhausted(analysis);
  const currentStep = analysis.status === "persisting" ? 4 : analysis.progressStage === "reviewing" ? 3
    : analysis.progressStage === "researching" ? 2 : analysis.status === "quarantined" ? 0 : 1;
  const state = analysisState(analysis.status, analysis.errorCode ?? null, retryExhausted, locale);
  const [exportingFormat, setExportingFormat] = useState<AnalysisExportFormat | null>(null);
  const [deletingExportId, setDeletingExportId] = useState<string | null>(null);
  const [exportError, setExportError] = useState("");
  const [exportNotice, setExportNotice] = useState("");
  const [caseId, setCaseId] = useState(analysis.caseId ?? "");
  const [caseBusy, setCaseBusy] = useState(false);
  const [caseMessage, setCaseMessage] = useState("");
  const [deletingAnalysis, setDeletingAnalysis] = useState(false);
  const [analysisDeleteError, setAnalysisDeleteError] = useState("");
  useEffect(() => { setCaseId(analysis.caseId ?? ""); setCaseMessage(""); }, [analysis.id, analysis.caseId]);
  const formats: AnalysisExportFormat[] = ["json", "pdf", "docx"];
  const exportsByFormat = new Map<AnalysisExportFormat, AnalysisExport>();
  for (const record of [...(analysis.exports ?? [])].filter((item) => item.variant === "analysis_report").sort((left, right) => right.createdAt.localeCompare(left.createdAt))) {
    if (!exportsByFormat.has(record.format)) exportsByFormat.set(record.format, record);
  }
  async function requestExport(format: AnalysisExportFormat) {
    const current = exportsByFormat.get(format);
    setExportingFormat(format); setExportError(""); setExportNotice("");
    const keyName = `${analysis.id}:${format}`;
    const existingKey = current?.status === "failed" ? undefined : exportAttemptKeys[keyName];
    const idempotencyKey = existingKey ?? `analysis-export-${format}-${analysis.id}-${crypto.randomUUID()}`;
    if (!existingKey) setExportAttemptKeys(keys => ({ ...keys, [keyName]: idempotencyKey }));
    try {
      const response = await fetch(`/api/platform/document-analysis/${encodeURIComponent(analysis.id)}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey },
        body: JSON.stringify({ format }),
      });
      const body = await response.json() as { code?: string };
      if (!response.ok) {
        setExportAttemptKeys(keys => withoutKey(keys, keyName));
        throw new Error(exportRequestError(body.code, locale));
      }
      await onChanged();
    } catch (value) { setExportError(value instanceof Error ? value.message : String(value)); }
    finally { setExportingFormat(null); }
  }
  async function removeExport(record: AnalysisExport) {
    if (!window.confirm(reviewText(locale, `Удалить экспорт ${record.format.toUpperCase()}?`, `${record.format.toUpperCase()} eksporti o‘chirilsinmi?`, `Delete the ${record.format.toUpperCase()} export?`))) return;
    setDeletingExportId(record.id); setExportError(""); setExportNotice("");
    try {
      const response = await fetch(`/api/platform/document-analysis/exports/${encodeURIComponent(record.id)}`, {
        method: "DELETE",
      });
      const body = await response.json() as { code?: string };
      if (!response.ok) throw new Error(exportDeleteError(body.code, locale));
      setExportAttemptKeys(keys => withoutKey(keys, `${analysis.id}:${record.format}`));
      await onChanged();
      setExportNotice(reviewText(locale, "Экспорт удалён.", "Eksport o‘chirildi.", "Export deleted."));
    } catch (value) { setExportError(value instanceof Error ? value.message : String(value)); }
    finally { setDeletingExportId(null); }
  }
  async function saveCaseLink() {
    setCaseBusy(true); setCaseMessage("");
    try {
      const response = await fetch(`/api/platform/document-analysis/${encodeURIComponent(analysis.id)}/case`, {
        method: "PUT",
        headers: { "content-type": "application/json", "idempotency-key": `analysis-case-${crypto.randomUUID()}`, "x-juro-csrf": "1" },
        body: JSON.stringify({ caseId: caseId || null }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.caseSaveError));
      await onChanged();
      setCaseMessage(caseId ? copy.caseLinked : copy.caseUnlinked);
    } catch (value) { setCaseMessage(value instanceof Error ? value.message : String(value)); }
    finally { setCaseBusy(false); }
  }
  async function removeAnalysis() {
    if (!window.confirm(copy.deleteAnalysisConfirm)) return;
    setDeletingAnalysis(true);
    setAnalysisDeleteError("");
    try {
      const response = await fetch(`/api/platform/document-analysis/${encodeURIComponent(analysis.id)}`, {
        method: "DELETE",
        headers: { "x-juro-csrf": "1" },
      });
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.deleteAnalysisError));
      await onChanged();
    } catch (value) {
      setAnalysisDeleteError(value instanceof Error ? value.message : String(value));
    } finally {
      setDeletingAnalysis(false);
    }
  }
  return <article className="review-result">
    <div className="review-result-head"><div>
      <small>{statusLabel(analysis.status, locale, retryExhausted)}</small>
      <h2>{analysis.fileName}</h2><span>{[summary?.result?.documentType, formatFileSize(analysis.sizeBytes, locale), analysis.updatedAt && new Date(analysis.updatedAt).toLocaleDateString(locale)].filter(Boolean).join(" · ")}</span>
    </div></div>
    {canOpen && <details className="review-management"><summary className="juro-disclosure-summary"><FileText aria-hidden="true" />{tools.actions}</summary><div className="review-management-body"><div className="review-result-actions" aria-live="polite">{analysis.sourceAvailable && <a className="juro-record-action" href={`/api/platform/document-review/files/${encodeURIComponent(analysis.fileId)}`} target="_blank" rel="noreferrer"><Eye />{copy.openFile}</a>}{formats.map(format => { const record = exportsByFormat.get(format); const pending = ["queued", "processing", "retrying"].includes(record?.status ?? ""); const failed = record?.status === "failed"; const busy = exportingFormat === format || pending; const upperFormat = format.toUpperCase(); return <span className="review-export-action" key={format}>{record?.status === "completed" ? <a className="juro-record-action" href={`/api/platform/document-analysis/exports/${encodeURIComponent(record.id)}/file`}><Download />{upperFormat}</a> : <button type="button" className="juro-record-action" disabled={busy || deletingExportId !== null} aria-busy={busy} onClick={() => void requestExport(format)}>{busy ? <LoaderCircle className="spin" /> : failed ? <RefreshCw /> : <Download />}{busy ? reviewText(locale, `${upperFormat} готовится`, `${upperFormat} tayyorlanmoqda`, `Preparing ${upperFormat}`) : failed ? reviewText(locale, `Повторить ${upperFormat}`, `${upperFormat}ni takrorlash`, `Retry ${upperFormat}`) : reviewText(locale, `Экспорт ${upperFormat}`, `${upperFormat} eksport`, `Export ${upperFormat}`)}</button>}{record && ["completed", "failed"].includes(record.status) && <button type="button" className="juro-record-action" aria-label={reviewText(locale, `Удалить ${upperFormat}`, `${upperFormat}ni o‘chirish`, `Delete ${upperFormat}`)} disabled={deletingExportId !== null || exportingFormat !== null} aria-busy={deletingExportId === record.id} onClick={() => void removeExport(record)}>{deletingExportId === record.id ? <LoaderCircle className="spin" /> : <Trash2 />}</button>}</span>; })}<button type="button" className="juro-record-action danger" disabled={deletingAnalysis || deletingExportId !== null || exportingFormat !== null} aria-busy={deletingAnalysis} onClick={() => void removeAnalysis()}>{deletingAnalysis ? <LoaderCircle className="spin" /> : <Trash2 />}{copy.deleteAnalysis}</button></div>
    <div className="review-case-link"><label><span>{copy.case}</span><Select value={caseId} onChange={event => { setCaseId(event.target.value); setCaseMessage(""); }} disabled={caseBusy}><option value="">{copy.noCase}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></label><button type="button" className="juro-record-action" disabled={caseBusy || caseId === (analysis.caseId ?? "")} aria-busy={caseBusy} onClick={() => void saveCaseLink()}>{caseBusy ? <LoaderCircle className="spin" /> : <FileText />}{copy.saveCaseLink}</button><span role="status" aria-live="polite">{caseMessage}</span></div>
    </div></details>}
    {exportError && <p className="review-message error" role="alert"><CircleAlert />{exportError}</p>}
    {analysisDeleteError && <p className="review-message error" role="alert"><CircleAlert />{analysisDeleteError}</p>}
    {exportNotice && <p className="review-message success" role="status"><ShieldCheck />{exportNotice}</p>}
    {analysis.status === "completed" ? <ReviewFindings analysis={analysis} locale={locale} onChanged={onChanged} /> :
      activeAnalysisStatuses.has(analysis.status) && !retryExhausted ?
        <DocumentToolProgress title={analysis.status === "quarantined" ? tools.stages[0] : state.heading} steps={tools.stages} current={currentStep} /> :
        <div className="review-job">
          <div role="status"><AlertTriangle aria-hidden="true" /><div><h3>{state.heading}</h3><p>{state.message}</p></div></div>
          {(analysis.status === "failed" || retryExhausted) && <div className="review-job-actions">
            <ReviewAgain analysis={analysis} locale={locale} />
            <button className="review-action" type="button" disabled={deletingAnalysis} onClick={() => void removeAnalysis()}>
              {deletingAnalysis ? <LoaderCircle className="spin" aria-hidden="true" /> : <Trash2 aria-hidden="true" />}{copy.deleteAnalysis}
            </button>
          </div>}
        </div>}
  </article>;
}

function formatFileSize(bytes: number, locale: PlatformLocale) {
  const mb = bytes >= 1024 * 1024;
  return new Intl.NumberFormat(locale, { style: "unit", unit: mb ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(bytes / (mb ? 1024 * 1024 : 1024));
}

function ReviewFindings({ analysis, locale, onChanged }: { analysis: Analysis; locale: PlatformLocale; onChanged: () => Promise<void> }) {
  const copy = documentReviewCopy[locale];
  const tools = documentTools[locale];
  const summary = analysis.summary;
  const result = summary?.result;
  const risks = [...(analysis.risks ?? [])];
  const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  risks.sort((a, b) => (rank[a.level] ?? 4) - (rank[b.level] ?? 4));
  const [view, setView] = useState("overview");
  const [selectedCitation, setSelectedCitation] = useState<string | null>(null);
  function openCitation(id: string) {
    setSelectedCitation(id);
    setView("sources");
  }
  const [severity, setSeverity] = useState("");
  const filteredRisks = risks.filter(risk => !severity || risk.level === severity);
  const warnings = reviewWarnings(result?.extractionWarnings ?? [], locale);
  const questions = documentFollowUpQuestions(summary?.questions ?? []);
  const sources = result?.sources ?? [];
  const missing = result?.missingClauses ?? [];
  const citedFindings = [...risks, ...missing].filter(item => item.legalBasisSourceIds?.some(id => sources.some(source => source.sourceId === id)));
  const citations = new Map<string, DocumentCitation>(sources.map(source => [source.sourceId, {
    id: source.sourceId, title: source.actTitle, identifier: source.actIdentifier,
    article: source.article, url: source.originalUrl, excerpt: source.excerpt,
    uses: [...new Set(citedFindings.filter(item => item.legalBasisSourceIds?.includes(source.sourceId)).map(item => item.title))],
  }]));
  const metrics: DocumentReportMetric[] = [
    { label: copy.risks, value: risks.length, tone: "risk" },
    { label: copy.obligations, value: summary?.obligations?.length ?? 0 },
    { label: tools.deadlines, value: result?.deadlines?.length ?? 0, tone: "time" },
    { label: tools.sources, value: citations.size, tone: "sources" },
  ];
  const quality = result?.overallQuality;
  const corpusAvailable = Boolean(result?.legalDatabaseAsOf && Number.isFinite(Date.parse(result.legalDatabaseAsOf)));
  const tabs = [
    ["overview", copy.summary], ["risks", `${copy.risks} · ${risks.length}`],
    ["terms", reviewText(locale, "Условия", "Shartlar", "Terms")], ["sources", sources.length ? `${tools.sources} · ${sources.length}` : tools.sources],
    ...(risks.some(risk => risk.proposedWording || risk.recommendation) || result?.missingClauses?.some(item => item.proposedWording) ? [["edits", copy.revisionsTitle]] : []),
  ];
  return <div className="review-findings">
    <nav className="review-views" aria-label={copy.resultAria}>
      {tabs.map(([id, label]) => <button key={id} type="button" aria-pressed={view === id} aria-controls="review-active-view" onClick={() => { setSelectedCitation(null); setView(id); }}>{label}</button>)}
    </nav>
    <div className="review-view-content" id="review-active-view">
    {view === "overview" && <>
    <DocumentReportMetrics metrics={metrics} />
    {summary?.summary && <div className="review-overview" data-quality={Boolean(quality)}>
      <section className="review-overview-text"><h3>{copy.summary}</h3><ReviewProse text={summary.summary} locale={locale} /></section>
      {quality && <section className="review-quality">
        <h3>{tools.quality}</h3>
        <div className="review-quality-heading"><span>{quality.score}<small> / 100</small></span></div>
        <meter aria-label={tools.quality} min={0} max={100} value={quality.score} />
        <ReviewProse text={quality.explanation} locale={locale} />
      </section>}
    </div>}
    <div className="review-next-steps" data-paired={!!(citedFindings.length && result?.recommendations?.length) || undefined}>
      <ListBlock title={tools.advice} items={result?.recommendations} kind="actions" />
      <ListBlock title={reviewText(locale, "Выводы со ссылками на закон", "Qonunga havola berilgan xulosalar", "Findings with legal sources")}
        items={citedFindings.map(item => <><strong>{item.title}</strong><DocumentCitationLinks ids={item.legalBasisSourceIds} citations={citations} locale={locale} onOpen={openCitation} /></>)} kind="law" />
    </div>
    <ListBlock title={tools.warnings} items={warnings} kind="warnings" />
    <p className="review-disclaimer"><CheckCircle2 />{copy.disclaimer}</p>
    {warnings.length > 0 && <ReviewAgain analysis={analysis} locale={locale} />}
    </>}
    {view === "risks" && <section>
      <label className="review-risk-filter"><span>{copy.risks}</span>
        <Select value={severity} onChange={event => setSeverity(event.target.value)}>
          <option value="">{reviewText(locale, "Все уровни риска", "Barcha xavf darajalari", "All risk levels")}</option>
          {[...new Set(risks.map(risk => risk.level))].map(level => <option key={level} value={level}>{riskLabel(level, locale)}</option>)}
        </Select>
      </label>
      {filteredRisks.length ? <div className="review-risks">{filteredRisks.map((risk, index) => <article key={risk.id || index} data-level={risk.level}>
      <header>
        <div className="review-risk-meta"><span>{riskLabel(risk.level, locale)}</span>
          {(risk.page || risk.clause) && <small>{[risk.page ? `${copy.pageShort} ${risk.page}` : "", risk.clause].filter(Boolean).join(" · ")}</small>}
        </div>
        <h3>{risk.title}</h3>
      </header>
      <ReviewProse text={descriptionWithoutRepeatedAdvice(risk.description, risk.recommendation)} locale={locale} />
      {risk.excerpt && <details className="review-risk-evidence">
        <summary><FileText aria-hidden="true" />{reviewText(locale, "Фрагмент документа", "Hujjat parchasi", "Document excerpt")}<ChevronDown aria-hidden="true" /></summary>
        <blockquote>{risk.excerpt}</blockquote>
      </details>}
      {risk.recommendation && <div className="review-risk-advice"><strong>{tools.advice}</strong><ReviewProse text={risk.recommendation} locale={locale} /></div>}
      <footer className="review-risk-footer">
        {risk.confidencePercent != null && <small>{copy.confidence} · {risk.confidencePercent}%</small>}
        <DocumentCitationLinks ids={risk.legalBasisSourceIds} citations={citations} locale={locale} onOpen={openCitation} />
      </footer>
    </article>)}</div> : <p>{copy.noRisks}</p>}</section>}
    {view === "terms" && <>
    {result?.deadlines?.length ? <section><h3>{tools.deadlines}</h3><dl className="review-deadlines">{result.deadlines.map((item, index) => <div key={index}><dt>{item.value}</dt><dd><strong>{item.title}</strong>{item.clause && <small>{item.clause}</small>}{item.consequence && <p>{item.consequence}</p>}</dd></div>)}</dl></section> : null}
    <div className="review-summary-grid">
      <ListBlock title={copy.parties} items={summary?.parties} /><ListBlock title={copy.dates} items={summary?.dates} />
      <ListBlock title={copy.payments} items={summary?.payments} /><ListBlock title={copy.obligations} items={summary?.obligations} kind="obligations" />
      <ListBlock title={tools.disputes} items={summary?.disputedTerms} />
      <ListBlock title={copy.missing} items={missing.length ? missing.map(item => <>
        <strong>{item.title}</strong><p>{item.reason}</p>
        <DocumentCitationLinks ids={item.legalBasisSourceIds} citations={citations} locale={locale} onOpen={openCitation} />
      </>) : summary?.missingItems} />
      <ListBlock title={reviewText(locale, "Что стоит уточнить", "Aniqlashtirish kerak", "What to verify")} items={questions} kind="questions" />
    </div>
    {summary?.extraction?.packageContext?.members.length ? <PackageContextView context={summary.extraction.packageContext} locale={locale} /> : null}
    </>}
    {view === "sources" && <section className="review-sources">
      <header><BookOpen aria-hidden="true" /><div><h3>{tools.sources}</h3>{corpusAvailable && <small>{reviewText(locale, "Дата среза корпуса", "Korpus holati sanasi", "Corpus snapshot date")} · {result?.legalDatabaseAsOf?.slice(0, 10)}</small>}</div></header>
      {citations.size ? <DocumentCitationList locale={locale} selected={selectedCitation} citations={[...citations.values()]} /> : <div className="review-source-empty">
        <p>{corpusAvailable
          ? reviewText(locale, "В отчёте нет подтверждённых ссылок на применимые нормы.", "Hisobotda qo‘llanadigan normalarga tasdiqlangan havolalar yo‘q.", "This report has no confirmed citations to applicable law.")
          : reviewText(locale, "Во время проверки не удалось получить подтверждённые правовые источники.", "Tekshiruv vaqtida tasdiqlangan huquqiy manbalar olinmadi.", "The check could not retrieve verified legal sources.")}</p>
        <ReviewAgain analysis={analysis} locale={locale} />
      </div>}
    </section>}
    {view === "edits" && <RevisionPanel analysisId={analysis.id} exports={analysis.exports ?? []} risks={risks} result={result} citations={citations} onOpenCitation={openCitation} locale={locale} onAnalysisChanged={onChanged} />}
    </div>
  </div>;
}

function ReviewAgain({ analysis, locale }: { analysis: Analysis; locale: PlatformLocale }) {
  const base = usePlatformBasePath();
  if (!analysis.sourceAvailable || analysis.mimeType.startsWith("text/markdown")) return null;
  const params = new URLSearchParams({
    source: `tool:${analysis.fileId}`,
    mode: analysis.summary?.result?.mode ?? analysis.summary?.mode ?? "quick",
    ...(analysis.caseId ? { caseId: analysis.caseId } : {}),
  });
  return <Link className="review-action review-action-primary" href={`${base}/document-review?${params}#review-intake`}>
    <RefreshCw aria-hidden="true" />{reviewText(locale, "Проверить снова", "Qayta tekshirish", "Check again")}
  </Link>;
}

function reviewWarnings(warnings: string[], locale: PlatformLocale) {
  const copy = {
    DOCUMENT_FINDINGS_WITHOUT_VERIFIED_QUOTES: ["Некоторые замечания исключены, поскольку их цитаты не удалось сверить с документом.", "Ayrim topilmalar chiqarib tashlandi, chunki ularning iqtiboslari hujjat bilan tasdiqlanmadi.", "Some findings were omitted because their quotations could not be verified against the document."],
    DOCUMENT_QUICK_REPRESENTATIVE_SAMPLE: ["Быстрая проверка охватила выбранные фрагменты. Для проверки всего текста выберите полную проверку.", "Tezkor tekshiruv tanlangan qismlarni qamrab oldi. Butun matn uchun to‘liq tekshiruvni tanlang.", "Quick review covered selected passages. Choose full-text review to check the entire text."],
    DOCUMENT_LEGAL_RESEARCH_UNAVAILABLE: ["Поиск правовых норм не завершился. Вы можете повторить проверку.", "Huquqiy izlanish yakunlanmadi. Tekshiruvni takrorlashingiz mumkin.", "Legal research could not finish. You can run the check again."],
    LEGAL_DATABASE_STALE: ["Дата актуальности источников ограничивает правовые выводы.", "Manbalarning dolzarblik sanasi huquqiy xulosalarni cheklaydi.", "The sources’ currency limits the legal findings."],
    LOW_TEXT_DENSITY: ["В файле мало извлекаемого текста. Сверьте выводы с оригиналом.", "Faylda ajratib olinadigan matn kam. Xulosalarni asl nusxa bilan solishtiring.", "The file contains little extractable text. Review findings against the original."],
    AI_OCR_REVIEW_REQUIRED: ["Текст распознан по изображению. Сверьте цитаты с оригиналом.", "Matn rasmdan tanildi. Iqtiboslarni asl nusxa bilan solishtiring.", "Text was recognized from an image. Check quotations against the original."],
  } as const;
  const labels = warnings.flatMap(warning => warning.split(",").map(part => {
    const code = part.trim().split(":", 1)[0];
    if (code === "LEGAL_DATABASE_UNAVAILABLE") return copy.DOCUMENT_LEGAL_RESEARCH_UNAVAILABLE;
    return copy[code as keyof typeof copy];
  }));
  return [...new Set(labels.flatMap(label => label ? [reviewText(locale, label[0], label[1], label[2])] : []))];
}

function RevisionPanel({ analysisId, exports, risks, result, citations, onOpenCitation, locale, onAnalysisChanged }: {
  analysisId: string; exports: AnalysisExport[]; risks: Risk[]; result?: Partial<DocumentAnalysisResult>;
  citations: ReadonlyMap<string, DocumentCitation>; onOpenCitation: (id: string) => void;
  locale: PlatformLocale; onAnalysisChanged: () => Promise<void>;
}) {
  const copy = documentReviewCopy[locale];
  const [revisions, setRevisions] = useState<SuggestedRevision[]>([]);
  const [versions, setVersions] = useState<AnalysisDocumentVersion[]>([]);
  const [builderSource, setBuilderSource] = useState<BuilderAnalysisSource | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [applying, setApplying] = useState<"selected" | "all" | null>(null);
  const [confirmMode, setConfirmMode] = useState<"selected" | "all" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [deletingExportId, setDeletingExportId] = useState<string | null>(null);
  const [applyingBuilderVersionId, setApplyingBuilderVersionId] = useState<string | null>(null);
  const [attemptKeys, setAttemptKeys] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/platform/document-analysis/${encodeURIComponent(analysisId)}/revisions`, { cache: "no-store" });
      const body = await response.json() as { revisions?: SuggestedRevision[]; versions?: AnalysisDocumentVersion[]; builderSource?: BuilderAnalysisSource | null; code?: string; error?: string };
      if (!response.ok) throw new Error(revisionError(body.code, body.error, locale));
      setRevisions(body.revisions ?? []);
      setVersions(body.versions ?? []);
      setBuilderSource(body.builderSource ?? null);
      setSelectedIds((current) => current.filter((id) => (body.revisions ?? []).some((item) => item.id === id && item.status === "accepted")));
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [analysisId, locale]);

  useEffect(() => { setLoading(true); void load(); }, [load]);

  async function decide(revision: SuggestedRevision, decision: "accepted" | "rejected") {
    setBusyId(revision.id); setError(""); setNotice("");
    try {
      const response = await fetch(
        `/api/platform/document-analysis/${encodeURIComponent(analysisId)}/revisions/${encodeURIComponent(revision.id)}`,
        { method: "PATCH", headers: { "content-type": "application/json", "x-juro-csrf": "1" }, body: JSON.stringify({ decision }) },
      );
      const body = await response.json() as { code?: string; error?: string };
      if (!response.ok) throw new Error(revisionError(body.code, body.error, locale));
      setSelectedIds((current) => decision === "accepted"
        ? [...new Set([...current, revision.id])]
        : current.filter((id) => id !== revision.id));
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setBusyId(null);
    }
  }

  async function apply(mode: "selected" | "all") {
    const ids = mode === "selected" ? [...selectedIds].sort() : [];
    const attemptName = `${mode}:${ids.join("|")}`;
    const idempotencyKey = attemptKeys[attemptName] ?? `analysis-revision-${crypto.randomUUID()}`;
    setAttemptKeys((current) => ({ ...current, [attemptName]: idempotencyKey }));
    setApplying(mode); setConfirmMode(null); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/platform/document-analysis/${encodeURIComponent(analysisId)}/revisions`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "x-juro-csrf": "1" },
        body: JSON.stringify({ mode, revisionIds: ids }),
      });
      const body = await response.json() as { code?: string; error?: string; partial?: boolean; version?: AnalysisDocumentVersion };
      if (!response.ok) {
        setAttemptKeys((current) => withoutKey(current, attemptName));
        throw new Error(revisionError(body.code, body.error, locale));
      }
      setSelectedIds([]);
      setNotice(body.partial
        ? reviewText(locale, "Новая версия создана. Неоднозначные или устаревшие фрагменты пропущены.", "Yangi nusxa yaratildi. Noaniq yoki eskirgan parchalar o‘tkazib yuborildi.", "A new version was created. Ambiguous or stale passages were skipped.")
        : reviewText(locale, `Нормализованная версия ${body.version?.version ?? ""} создана.`, `${body.version?.version ?? ""}-normallashtirilgan nusxa yaratildi.`, `Normalized version ${body.version?.version ?? ""} was created.`));
      await load();
      await onAnalysisChanged().catch(() => undefined);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      await load();
    } finally {
      setApplying(null);
    }
  }

  async function requestVersionExport(version: AnalysisDocumentVersion, variant: "corrected_clean" | "corrected_redline", format: "pdf" | "docx") {
    const keyName = `${version.id}:${variant}:${format}`;
    const existing = exports.find((item) => item.sourceVersionId === version.id && item.variant === variant && item.format === format);
    const idempotencyKey = existing?.status === "failed" ? `analysis-version-export-${crypto.randomUUID()}` : attemptKeys[keyName] ?? `analysis-version-export-${crypto.randomUUID()}`;
    setAttemptKeys((current) => ({ ...current, [keyName]: idempotencyKey }));
    setExportingKey(keyName); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/platform/document-analysis/${encodeURIComponent(analysisId)}/exports`, {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "x-juro-csrf": "1" },
        body: JSON.stringify({ format, variant, sourceVersionId: version.id }),
      });
      const body = await response.json() as { code?: string };
      if (!response.ok) { setAttemptKeys((current) => withoutKey(current, keyName)); throw new Error(exportRequestError(body.code, locale)); }
      setNotice(reviewText(locale, "Экспорт поставлен в защищённую очередь.", "Eksport himoyalangan navbatga qo‘yildi.", "The export was added to the secure processing queue."));
      await onAnalysisChanged();
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setExportingKey(null); }
  }

  async function removeVersionExport(record: AnalysisExport) {
    if (!window.confirm(reviewText(locale, "Удалить этот экспорт?", "Bu eksport o‘chirilsinmi?", "Delete this export?"))) return;
    setDeletingExportId(record.id); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/platform/document-analysis/exports/${encodeURIComponent(record.id)}`, { method: "DELETE", headers: { "x-juro-csrf": "1" } });
      const body = await response.json() as { code?: string };
      if (!response.ok) throw new Error(exportDeleteError(body.code, locale));
      await onAnalysisChanged();
      setNotice(reviewText(locale, "Экспорт удалён.", "Eksport o‘chirildi.", "Export deleted."));
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setDeletingExportId(null); }
  }

  async function applyVersionToBuilder(version: AnalysisDocumentVersion) {
    if (!builderSource) return;
    const keyName = `builder:${version.id}:${builderSource.sourceRevision}`;
    const idempotencyKey = attemptKeys[keyName] ?? `builder-analysis-correction-${crypto.randomUUID()}`;
    setAttemptKeys((current) => ({ ...current, [keyName]: idempotencyKey }));
    setApplyingBuilderVersionId(version.id); setError(""); setNotice("");
    try {
      const response = await fetch(
        `/api/platform/document-analysis/${encodeURIComponent(analysisId)}/versions/${encodeURIComponent(version.id)}/apply-builder`,
        {
          method: "POST",
          headers: { "content-type": "application/json", "idempotency-key": idempotencyKey, "x-juro-csrf": "1" },
          body: JSON.stringify({ sourceRevision: builderSource.sourceRevision }),
        },
      );
      const body = await response.json() as { revision?: number; code?: string; error?: string };
      if (!response.ok || !body.revision) {
        if (response.status !== 409) setAttemptKeys((current) => withoutKey(current, keyName));
        throw new Error(platformApiError(locale, body.error, reviewText(locale, "Исправленная версия не применена в конструкторе.", "Tuzatilgan nusxa konstruktorda qo‘llanmadi.", "The corrected version could not be applied in the document builder.")));
      }
      setBuilderSource((current) => current ? { ...current, currentRevision: body.revision as number } : null);
      setNotice(reviewText(locale, `Исправления сохранены в конструкторе как ревизия ${body.revision}.`, `Tuzatishlar konstruktorda ${body.revision}-reviziya sifatida saqlandi.`, `The corrections were saved in the document builder as revision ${body.revision}.`));
      await onAnalysisChanged().catch(() => undefined);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setApplyingBuilderVersionId(null);
    }
  }

  const accepted = revisions.filter((item) => item.status === "accepted");
  const available = revisions.filter((item) => item.status === "pending" || item.status === "accepted");
  const correctedVersions = versions.filter((item) => item.sourceKind === "corrected");
  const editable = new Set(revisions.map(item => item.riskId));
  const manual = [
    ...risks.filter(risk => !editable.has(risk.id ?? "") && (risk.proposedWording || risk.recommendation))
      .map(risk => ({ title: risk.title, wording: risk.proposedWording, note: risk.recommendation, clause: risk.clause, before: risk.excerpt, sourceIds: risk.legalBasisSourceIds })),
    ...(result?.missingClauses ?? []).filter(item => item.proposedWording)
      .map(item => ({ title: item.title, wording: item.proposedWording, note: item.reason, clause: null, before: null, sourceIds: item.legalBasisSourceIds })),
  ];
  const count = revisions.length + manual.length;
  return <section className="review-revisions" aria-labelledby={`revision-title-${analysisId}`}>
    <div className="review-revisions-heading">
      <div><h3 id={`revision-title-${analysisId}`}>{copy.revisionsTitle}</h3><p>{copy.revisionsDescription}</p></div>
      {correctedVersions.length > 0 && <div className="review-version-downloads" aria-label={copy.correctedVersions}>{correctedVersions.map((version) => <div className="review-version-export" key={version.id}><strong>{reviewText(locale, `Версия ${version.version}`, `${version.version}-nusxa`, `Version ${version.version}`)}</strong><a className="juro-record-action" href={`/api/platform/document-analysis/${encodeURIComponent(analysisId)}/versions/${encodeURIComponent(version.id)}/file`}><Download />MD</a>{builderSource && <button type="button" className="juro-record-action" disabled={applyingBuilderVersionId !== null || builderSource.currentRevision !== builderSource.sourceRevision} aria-busy={applyingBuilderVersionId === version.id} title={builderSource.currentRevision !== builderSource.sourceRevision ? copy.builderStale : undefined} onClick={() => void applyVersionToBuilder(version)}>{applyingBuilderVersionId === version.id ? <LoaderCircle className="spin" /> : <FileCheck2 />}{copy.toBuilder}</button>}{(["corrected_clean", "corrected_redline"] as const).flatMap((variant) => (["docx", "pdf"] as const).map((format) => {
        const record = [...exports].filter((item) => item.sourceVersionId === version.id && item.variant === variant && item.format === format).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        const keyName = `${version.id}:${variant}:${format}`;
        const pending = ["queued", "processing", "retrying"].includes(record?.status ?? "");
        const label = `${variant === "corrected_clean" ? copy.clean : copy.redline} ${format.toUpperCase()}`;
        return <span key={`${variant}-${format}`}>{record?.status === "completed" ? <a className="juro-record-action" href={`/api/platform/document-analysis/exports/${encodeURIComponent(record.id)}/file`}><Download />{label}</a> : <button type="button" className="juro-record-action" disabled={pending || exportingKey !== null || deletingExportId !== null} aria-busy={pending || exportingKey === keyName} onClick={() => void requestVersionExport(version, variant, format)}>{pending || exportingKey === keyName ? <LoaderCircle className="spin" /> : record?.status === "failed" ? <RefreshCw /> : <Download />}{label}</button>}{record && ["completed", "failed"].includes(record.status) && <button type="button" className="juro-record-action icon" aria-label={reviewText(locale, `Удалить ${label}`, `${label}ni o‘chirish`, `Delete ${label}`)} disabled={deletingExportId !== null || exportingKey !== null} onClick={() => void removeVersionExport(record)}>{deletingExportId === record.id ? <LoaderCircle className="spin" /> : <Trash2 />}</button>}</span>;
      }))}</div>)}</div>}
    </div>
    {(revisions.length > 0 || correctedVersions.length > 0) && <p className="review-normalized-note"><FileText />{copy.normalizedNote}</p>}
    {error && <p className="review-message error" role="alert"><CircleAlert />{error}<button type="button" onClick={() => void load()}>{copy.retry}</button></p>}
    {notice && <p className="review-message success" role="status"><CheckCircle2 />{notice}</p>}
    {loading ? <div className="review-revision-skeleton" aria-label={copy.loadingRevisions}><i /><i /><i /></div> : count === 0 ? <div className="review-revision-empty"><FileText /><h4>{copy.noRevisions}</h4><p>{copy.noRevisionsHint}</p></div> : <div className="review-revision-list">
      <p className="review-edit-count">{reviewText(locale, `Всего предложений · ${count}`, `Jami takliflar · ${count}`, `Suggestions · ${count}`)}</p>
      {revisions.map((revision) => {
      const terminal = ["applied", "stale", "ambiguous"].includes(revision.status);
      const busy = busyId === revision.id;
      const selected = selectedIds.includes(revision.id);
      return <article key={revision.id} data-status={revision.status}>
        <details open={count === 1 || undefined}>
        <summary className="juro-disclosure-summary review-edit-header">
          <span><strong>{revision.riskTitle}</strong><small>{[riskLabel(revision.riskLevel, locale), revision.clause, revision.page ? `${copy.pageShort} ${revision.page}` : ""].filter(Boolean).join(" · ")}</small></span>
          <span className="review-edit-status">{revisionStatusLabel(revision.status, locale)}</span>
        </summary>
        <div className="review-edit-body">
        <DocumentTextDiff before={revision.originalText} after={revision.proposedText} beforeLabel={copy.originalText} afterLabel={copy.proposedText} />
        {revision.recommendation && <p><b>{copy.rationale}</b> {revision.recommendation}</p>}
        <DocumentCitationLinks ids={revision.legalBasisSourceIds} citations={citations} locale={locale} onOpen={onOpenCitation} />
        {!terminal && <footer><label><input type="checkbox" checked={selected} disabled={revision.status !== "accepted" || busy} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, revision.id])] : current.filter((id) => id !== revision.id))} /><span>{copy.includeSelected}</span></label><div><button type="button" disabled={busy} aria-busy={busy} aria-pressed={revision.status === "rejected"} className={revision.status === "rejected" ? "active" : ""} onClick={() => void decide(revision, "rejected")}>{busy ? <LoaderCircle className="spin" /> : <X />}{copy.reject}</button><button type="button" disabled={busy} aria-busy={busy} aria-pressed={revision.status === "accepted"} className={revision.status === "accepted" ? "active primary" : "primary"} onClick={() => void decide(revision, "accepted")}>{busy ? <LoaderCircle className="spin" /> : <Check />}{copy.accept}</button></div></footer>}
        </div></details>
      </article>;
    })}
    {manual.map((item, index) => <article key={index}>
      <details open={count === 1 || undefined}>
        <summary className="juro-disclosure-summary review-edit-header">
          <span><strong>{item.title}</strong>{item.clause && <small>{item.clause}</small>}</span>
          <span className="review-edit-status">{item.wording
            ? reviewText(locale, "Правка вручную", "Qo‘lda tahrirlash", "Manual edit")
            : reviewText(locale, "Рекомендация", "Tavsiya", "Recommendation")}</span>
        </summary>
        <div className="review-edit-body">
          {item.wording && <DocumentTextDiff before={item.before} after={item.wording} beforeLabel={copy.originalText} afterLabel={copy.proposedText} />}
          {item.note && item.note !== item.wording && <ReviewProse text={item.note} locale={locale} />}
          <DocumentCitationLinks ids={item.sourceIds} citations={citations} locale={locale} onOpen={onOpenCitation} />
        </div>
      </details>
    </article>)}</div>}
    {!loading && revisions.length > 0 && <div className="review-revision-apply">
      <div><strong>{copy.acceptedCount(accepted.length, selectedIds.length)}</strong><span>{copy.immutableVersion}</span></div>
      <div><button type="button" disabled={selectedIds.length === 0 || applying !== null} onClick={() => setConfirmMode("selected")}>{applying === "selected" ? <LoaderCircle className="spin" /> : <Check />}{copy.applySelected}</button><button type="button" className="primary" disabled={available.length === 0 || applying !== null} onClick={() => setConfirmMode("all")}>{applying === "all" ? <LoaderCircle className="spin" /> : <FileCheck2 />}{copy.applyAll}</button></div>
    </div>}
    {confirmMode && <div className="review-revision-confirm" aria-labelledby={`revision-confirm-${analysisId}`}><div><h4 id={`revision-confirm-${analysisId}`}>{copy.confirmTitle}</h4><p>{confirmMode === "all" ? copy.confirmAll(available.length) : copy.confirmSelected(selectedIds.length)}</p></div><div><button type="button" onClick={() => setConfirmMode(null)}>{copy.cancel}</button><button type="button" className="primary" onClick={() => void apply(confirmMode)}>{copy.createVersion}</button></div></div>}
  </section>;
}

function ReviewProse({ text, locale }: { text: string; locale: PlatformLocale }) {
  const paragraphs = text.trim().split(/\n\s*\n/).flatMap(paragraph => {
    if (paragraph.length <= 260 || typeof Intl.Segmenter !== "function") return [paragraph];
    const blocks: string[] = [];
    let block = "";
    for (const { segment } of new Intl.Segmenter(locale, { granularity: "sentence" }).segment(paragraph)) {
      block += segment;
      if (block.length >= 170) { blocks.push(block.trim()); block = ""; }
    }
    if (block.trim()) blocks.push(block.trim());
    return blocks;
  });
  return <div className="review-prose">{paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}</div>;
}

function descriptionWithoutRepeatedAdvice(description: string, recommendation?: string | null) {
  const text = description.trim();
  const advice = recommendation?.trim();
  return advice && text.endsWith(advice) && text.length > advice.length ? text.slice(0, -advice.length).trimEnd() : text;
}

function ListBlock({ title, items, kind }: { title: string; items?: ReactNode[]; kind?: "actions" | "obligations" | "questions" | "warnings" | "law" }) {
  if (!items?.length) return null;
  const List = kind === "actions" || kind === "questions" ? "ol" : "ul";
  const Icon = kind === "law" ? BookOpen : kind === "warnings" ? AlertTriangle : kind === "questions" ? CircleAlert : kind === "obligations" ? Scale : ClipboardList;
  return <section className="review-list-block" data-kind={kind}>
    <h3><Icon aria-hidden="true" />{title}</h3>
    <List>{items.map((item, index) => <li key={index}>{item}</li>)}</List>
  </section>;
}

function PackageContextView({ context, locale }: { context: AnalysisPackageContext; locale: PlatformLocale }) {
  const copy = documentReviewCopy[locale];
  const names = new Map(context.members.map((member) => [member.id, member.name]));
  const primary = context.primaryMemberId ? names.get(context.primaryMemberId) : null;
  return <section className="review-package-context" aria-labelledby="review-package-context-heading">
    <div className="review-package-context-head"><div><h3 id="review-package-context-heading">{copy.packageTitle}</h3><p>{copy.packageDescription}</p></div>{primary && <span>{copy.primary}: {primary}</span>}</div>
    <ul className="review-package-members">{context.members.map((member) => <li key={member.id} data-primary={member.id === context.primaryMemberId || undefined}><FileText /><span><strong>{member.name}</strong><small>{packageRoleLabel(member.role, locale)} · {member.detectedLanguage.toUpperCase()}</small></span></li>)}</ul>
    {context.relationships.length ? <ul className="review-package-relationships">{context.relationships.map((relationship, index) => <li key={`${relationship.fromMemberId}:${relationship.toMemberId}:${relationship.kind}:${index}`}><strong>{names.get(relationship.fromMemberId) ?? relationship.fromMemberId} → {names.get(relationship.toMemberId) ?? relationship.toMemberId}</strong><span>{packageRelationshipLabel(relationship.kind, locale)} · {copy.confidenceLower}: {packageConfidenceLabel(relationship.confidence, locale)}</span></li>)}</ul> : <p>{copy.noRelationships}</p>}
  </section>;
}

function packageRoleLabel(role: AnalysisPackageMemberRole, locale: PlatformLocale) {
  const labels: Record<AnalysisPackageMemberRole, Record<PlatformLocale, string>> = {
    primary: { ru: "Основной документ", uz: "Asosiy hujjat", en: "Primary document" },
    annex: { ru: "Приложение", uz: "Ilova", en: "Annex" },
    amendment: { ru: "Дополнительное соглашение", uz: "Qo‘shimcha kelishuv", en: "Amendment" },
    acceptance_act: { ru: "Акт", uz: "Dalolatnoma", en: "Acceptance certificate" },
    correspondence: { ru: "Переписка или уведомление", uz: "Xat yoki bildirishnoma", en: "Correspondence or notice" },
    evidence: { ru: "Подтверждающий документ", uz: "Tasdiqlovchi hujjat", en: "Supporting document" },
    unknown: { ru: "Роль требует проверки", uz: "Rolni tekshirish kerak", en: "Role requires review" },
  };
  return labels[role][locale];
}

function packageRelationshipLabel(kind: AnalysisPackageRelationshipKind, locale: PlatformLocale) {
  const labels: Record<AnalysisPackageRelationshipKind, Record<PlatformLocale, string>> = {
    annex_to: { ru: "приложение к документу", uz: "hujjatga ilova", en: "annex to document" },
    amends: { ru: "изменяет документ", uz: "hujjatni o‘zgartiradi", en: "amends document" },
    acceptance_for: { ru: "подтверждает исполнение", uz: "ijroni tasdiqlaydi", en: "confirms performance" },
    supports: { ru: "подтверждает обстоятельства", uz: "holatlarni tasdiqlaydi", en: "supports the circumstances" },
    references: { ru: "ссылается на документ", uz: "hujjatga havola qiladi", en: "references document" },
    possible_duplicate: { ru: "возможная копия", uz: "ehtimoliy nusxa", en: "possible duplicate" },
  };
  return labels[kind][locale];
}

function packageConfidenceLabel(confidence: "high" | "medium" | "low", locale: PlatformLocale) {
  const labels: Record<typeof confidence, Record<PlatformLocale, string>> = {
    high: { ru: "высокая", uz: "yuqori", en: "high" },
    medium: { ru: "средняя", uz: "o‘rta", en: "medium" },
    low: { ru: "низкая", uz: "past", en: "low" },
  };
  return labels[confidence][locale];
}

function statusLabel(status: string, locale: PlatformLocale, retryExhausted = false) {
  const labels: Record<PlatformLocale, Record<string, string>> = {
    ru: { completed: "Анализ завершён", retry_exhausted: "Требует повтора", uploaded: "Проверка файла", initiated: "Ожидает загрузки", ready: "Готов к анализу", processing: "Анализируется", persisting: "Сохраняет результат", awaiting_ocr: "Ожидает OCR", ocr_processing: "Распознаёт текст", retrying: "Повторяет анализ", awaiting_external_extraction: "Ожидает безопасного извлечения", awaiting_chunked_analysis: "Ожидает пакетного анализа", awaiting_ai_configuration: "Ожидает подключения AI", failed: "Ошибка обработки", fallback: "Файл сохранён" },
    uz: { completed: "Tahlil yakunlandi", retry_exhausted: "Qayta ishga tushirish kerak", uploaded: "Fayl tekshirilmoqda", initiated: "Yuklashni kutmoqda", ready: "Tahlilga tayyor", processing: "Tahlil qilinmoqda", persisting: "Natija saqlanmoqda", awaiting_ocr: "OCR kutilmoqda", ocr_processing: "Matn tanilmoqda", retrying: "Tahlil qayta urinmoqda", awaiting_external_extraction: "Xavfsiz ajratish kutilmoqda", awaiting_chunked_analysis: "Bo‘lib tahlil qilish kutilmoqda", awaiting_ai_configuration: "AI ulanishini kutmoqda", failed: "Qayta ishlash xatosi", fallback: "Fayl saqlandi" },
    en: { completed: "Analysis complete", retry_exhausted: "Retry required", uploaded: "Checking file", initiated: "Waiting for upload", ready: "Ready for analysis", processing: "Analysing", persisting: "Saving result", awaiting_ocr: "Waiting for OCR", ocr_processing: "Recognising text", retrying: "Retrying analysis", awaiting_external_extraction: "Waiting for secure extraction", awaiting_chunked_analysis: "Waiting for chunked analysis", awaiting_ai_configuration: "Waiting for AI configuration", failed: "Processing failed", fallback: "File saved" },
  };
  const copy = labels[locale];
  if (status === "completed") return copy.completed;
  if (retryExhausted) return copy.retry_exhausted;
  return copy[status] ?? copy.fallback;
}

function analysisState(status: string, errorCode: string | null, retryExhausted: boolean, locale: PlatformLocale) {
  if (retryExhausted) {
    return {
      heading: reviewText(locale, "Автоматические попытки остановлены", "Avtomatik urinishlar to‘xtatildi", "Automatic retries have stopped"),
      message: reviewText(locale, "Результат не создан после ограниченных повторов. Файл сохранён; сотрудник JURO может безопасно повторить задачу.", "Cheklangan qayta urinishlardan keyin natija yaratilmagan. Fayl saqlangan; JURO xodimi vazifani xavfsiz qayta ishga tushirishi mumkin.", "No result was created after the limited retry sequence. The file is safe, and JURO support can retry the task securely."),
    };
  }
  type StateCopy = { heading: string; message: string };
  const pdfFailures: Record<string, Record<PlatformLocale, StateCopy>> = {
    DOCUMENT_ANALYSIS_INVALID_OUTPUT: {
      ru: { heading: "Не удалось подтвердить результат проверки", message: "Запустите проверку заново с сохранённым файлом." },
      uz: { heading: "Tekshiruv natijasini tasdiqlab bo‘lmadi", message: "Saqlangan fayl bilan tekshiruvni qayta boshlang." },
      en: { heading: "The review result could not be verified", message: "Run the check again using the saved file." },
    },
    OCR_PAGE_LIMIT_EXCEEDED: {
      ru: { heading: "Слишком много страниц", message: "Документ или пакет содержит более 500 известных страниц. Файл не передан AI; разделите его на части." },
      uz: { heading: "Sahifalar soni limitdan oshdi", message: "Hujjat yoki paketda 500 dan ortiq aniqlangan sahifa bor. Fayl AI ga yuborilmadi; uni qismlarga ajrating." },
      en: { heading: "Page limit exceeded", message: "The document or package contains more than 500 detected pages. It was not sent to the AI service; split it into smaller files." },
    },
    OCR_PDF_PASSWORD_PROTECTED: {
      ru: { heading: "PDF защищён паролем", message: "Снимите пароль с копии документа и загрузите её повторно. JURO не пытался обойти защиту." },
      uz: { heading: "PDF parol bilan himoyalangan", message: "Hujjat nusxasidan parolni olib tashlang va qayta yuklang. JURO himoyani chetlab o‘tishga urinmadi." },
      en: { heading: "Password-protected PDF", message: "Remove the password from a copy and upload it again. JURO did not attempt to bypass the protection." },
    },
    OCR_PDF_CORRUPT: {
      ru: { heading: "PDF повреждён", message: "Структура PDF не прошла проверку до распознавания. Создайте новую копию файла и повторите загрузку." },
      uz: { heading: "PDF buzilgan", message: "PDF tuzilishi matnni tanishdan oldingi tekshiruvdan o‘tmadi. Yangi nusxa yarating va qayta yuklang." },
      en: { heading: "The PDF is damaged", message: "The PDF structure failed validation before text recognition. Create a new copy and upload it again." },
    },
    OCR_PDF_PREFLIGHT_TIMEOUT: {
      ru: { heading: "Проверка PDF не завершилась", message: "Проверка структуры превысила безопасное время. Файл не передан AI; повторите попытку позже или разделите документ." },
      uz: { heading: "PDF tekshiruvi tugamadi", message: "Tuzilma tekshiruvi xavfsiz vaqt chegarasidan oshdi. Fayl AI ga yuborilmadi; keyinroq takrorlang yoki hujjatni bo‘ling." },
      en: { heading: "PDF validation timed out", message: "Structural validation exceeded the safe time limit. The file was not sent to the AI service; try again later or split the document." },
    },
  };
  const pdfFailure = errorCode ? pdfFailures[errorCode] : undefined;
  if (pdfFailure) return pdfFailure[locale];
  if (errorCode === "DOCUMENT_ANALYSIS_CAPACITY_REQUIRED") {
    return {
      heading: reviewText(locale, "Документ превышает доступный лимит", "Hujjat mavjud limitdan katta", "Document exceeds the current processing limit"),
      message: reviewText(locale, "JURO не отправил файл в AI: для него ещё не подключён безопасный потоковый или пакетный обработчик. Разделите материал на меньшие части и загрузите их отдельно.", "JURO faylni AI ga yubormadi: buning uchun xavfsiz oqimli yoki bo‘lib qayta ishlovchi hali ulanmagan. Materialni kichik qismlarga ajrating va ularni alohida yuklang.", "JURO did not send this file to the AI service because a secure streaming or chunked processor is not available for it yet. Split the material into smaller files and upload them separately."),
    };
  }
  if (errorCode === "DOCUMENT_ANALYSIS_PACKAGE_OCR_REQUIRED") {
    return {
      heading: reviewText(locale, "В пакете найден скан", "Paketda skan topildi", "A scanned file was found in the package"),
      message: reviewText(locale, "Пакет поставлен в очередь распознавания по отдельным файлам. Юридический анализ начнётся только после успешного OCR всего пакета.", "Paket fayllar bo‘yicha matnni tanish navbatiga qo‘yildi. Yuridik tahlil faqat butun paket OCR’dan muvaffaqiyatli o‘tgach boshlanadi.", "Each file in the package has been queued for text recognition. Legal analysis will begin only after OCR completes successfully for the entire package."),
    };
  }
  const states: Record<string, Record<PlatformLocale, StateCopy>> = {
    processing: {
      ru: { heading: "Идёт анализ", message: "JURO извлекает структуру документа и проверяет выводы. Можно покинуть страницу и вернуться позже." },
      uz: { heading: "Tahlil ketmoqda", message: "JURO hujjat tuzilishini ajratmoqda va xulosalarni tekshirmoqda. Sahifadan chiqib, keyin qaytish mumkin." },
      en: { heading: "Analysis in progress", message: "JURO is extracting the document structure and validating its findings. You may leave this page and return later." },
    },
    persisting: {
      ru: { heading: "Результат сохраняется", message: "Анализ завершён у провайдера; JURO атомарно сохраняет нормализованный результат." },
      uz: { heading: "Natija saqlanmoqda", message: "Provayder tahlilni yakunladi; JURO normallashtirilgan natijani atomar saqlamoqda." },
      en: { heading: "Saving result", message: "The provider has completed the analysis. JURO is saving the normalized result atomically." },
    },
    awaiting_ocr: {
      ru: { heading: "Идёт подготовка OCR", message: "Текст не извлечён напрямую. Файл поставлен в защищённую очередь распознавания; юридический AI получит только проверенный результат." },
      uz: { heading: "OCR tayyorlanmoqda", message: "Matn to‘g‘ridan-to‘g‘ri ajratilmadi. Fayl himoyalangan OCR navbatiga qo‘yildi; yuridik AI faqat tekshirilgan natijani oladi." },
      en: { heading: "Preparing OCR", message: "Text could not be extracted directly. The file is in the secure recognition queue; the legal AI will receive only validated text." },
    },
    ocr_processing: {
      ru: { heading: "Распознаём текст", message: "JURO распознаёт страницы документа в защищённом процессе. Юридический AI получит только проверенный текст." },
      uz: { heading: "Matn tanilmoqda", message: "JURO hujjat sahifalarini himoyalangan jarayonda tanimoqda. Yuridik AI faqat tekshirilgan matnni oladi." },
      en: { heading: "Recognising text", message: "JURO is recognising the document pages in a secure process. The legal AI will receive only validated text." },
    },
    retrying: {
      ru: { heading: "Повторяем анализ", message: "Временная ошибка не создала результат. JURO выполняет ограниченный безопасный повтор в фоне; можно вернуться позже." },
      uz: { heading: "Tahlil qayta urinmoqda", message: "Vaqtinchalik xato natija yaratmadi. JURO fonda cheklangan xavfsiz qayta urinishni bajarmoqda; keyinroq qaytishingiz mumkin." },
      en: { heading: "Retrying analysis", message: "A temporary error did not create a result. JURO is running a limited secure retry in the background; you may return later." },
    },
    awaiting_external_extraction: {
      ru: { heading: "Нужен безопасный обработчик", message: "Файл превышает лимит встроенного извлечения и не отправлен AI. Требуется потоковый обработчик." },
      uz: { heading: "Xavfsiz qayta ishlovchi kerak", message: "Fayl ichki ajratish limitidan katta va AI ga yuborilmadi. Oqimli qayta ishlovchi kerak." },
      en: { heading: "Secure processor required", message: "The file exceeds the built-in extraction limit and was not sent to the AI service. A streaming processor is required." },
    },
    awaiting_chunked_analysis: {
      ru: { heading: "Нужен пакетный анализ", message: "Извлечённый текст превышает безопасный контекст одного запроса. JURO ожидает разбивку с итоговой проверкой." },
      uz: { heading: "Bo‘lib tahlil qilish kerak", message: "Ajratilgan matn bitta so‘rov uchun xavfsiz kontekstdan katta. JURO bo‘lib tahlil qilishni kutmoqda." },
      en: { heading: "Chunked analysis required", message: "The extracted text exceeds the safe context for one request. JURO is waiting for a chunked workflow with final validation." },
    },
    awaiting_ai_configuration: {
      ru: { heading: "AI пока не подключён", message: "Безопасно извлечённый документ сохранён, но не отправлен провайдеру: server-side AI secret не настроен." },
      uz: { heading: "AI hali ulanmagan", message: "Xavfsiz ajratilgan hujjat saqlandi, ammo provayderga yuborilmadi: server-side AI siri sozlanmagan." },
      en: { heading: "AI is not configured", message: "The securely extracted document was saved but not sent to a provider because the server-side AI credential is not configured." },
    },
    failed: {
      ru: { heading: "Обработка остановлена", message: "Результат не создан. JURO сохранил диагностический код без содержимого документа; задачу можно безопасно повторить." },
      uz: { heading: "Qayta ishlash to‘xtadi", message: "Natija yaratilmadi. JURO hujjat matnisiz diagnostika kodini saqladi; vazifani xavfsiz qayta boshlash mumkin." },
      en: { heading: "Processing stopped", message: "No result was created. JURO stored a diagnostic code without the document content, and the task can be retried safely." },
    },
  };
  const fallback: Record<PlatformLocale, StateCopy> = {
    ru: { heading: "Подготовка анализа", message: "Файл готовится к анализу. Можно покинуть страницу и вернуться позже." },
    uz: { heading: "Tahlil tayyorlanmoqda", message: "Fayl tahlilga tayyorlanmoqda. Sahifadan chiqib, keyinroq qaytishingiz mumkin." },
    en: { heading: "Preparing analysis", message: "The file is being prepared for analysis. You may leave this page and return later." },
  };
  return (states[status] ?? fallback)[locale];
}

function riskLabel(level: string, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    critical: { ru: "Критический", uz: "Jiddiy", en: "Critical" },
    informational: { ru: "Информация", uz: "Ma’lumot", en: "Information" },
    high: { ru: "Высокий", uz: "Yuqori", en: "High" },
    medium: { ru: "Средний", uz: "O‘rta", en: "Medium" },
    low: { ru: "Низкий", uz: "Past", en: "Low" },
    information: { ru: "Информация", uz: "Ma’lumot", en: "Information" },
  };
  return labels[level]?.[locale] ?? level;
}

function revisionStatusLabel(status: RevisionStatus, locale: PlatformLocale) {
  const labels: Record<RevisionStatus, Record<PlatformLocale, string>> = {
    pending: { ru: "Ожидает решения", uz: "Qaror kutilmoqda", en: "Awaiting decision" },
    accepted: { ru: "Принято", uz: "Qabul qilindi", en: "Accepted" },
    rejected: { ru: "Отклонено", uz: "Rad etildi", en: "Rejected" },
    applied: { ru: "Применено", uz: "Qo‘llandi", en: "Applied" },
    stale: { ru: "Фрагмент изменился", uz: "Parcha o‘zgargan", en: "Passage changed" },
    ambiguous: { ru: "Нужно выбрать вручную", uz: "Qo‘lda tanlash kerak", en: "Manual selection required" },
  };
  return labels[status][locale];
}

function revisionError(code: string | undefined, fallback: string | undefined, locale: PlatformLocale) {
  const messages: Record<string, Record<PlatformLocale, string>> = {
    ANALYSIS_REVISION_NOT_FOUND: { ru: "Исправления не найдены.", uz: "Tuzatishlar topilmadi.", en: "Suggested revisions were not found." },
    ANALYSIS_REVISION_NOT_READY: { ru: "Исправления доступны после завершения анализа.", uz: "Tuzatishlar tahlil yakunlangandan keyin mavjud.", en: "Suggested revisions are available after analysis is complete." },
    ANALYSIS_REVISION_INVALID_DECISION: { ru: "Это исправление уже нельзя изменить.", uz: "Bu tuzatishni endi o‘zgartirib bo‘lmaydi.", en: "This revision decision can no longer be changed." },
    ANALYSIS_REVISION_INVALID_SELECTION: { ru: "Выбранные исправления недоступны для применения.", uz: "Tanlangan tuzatishlarni qo‘llab bo‘lmaydi.", en: "The selected revisions are not available to apply." },
    ANALYSIS_REVISION_IDEMPOTENCY_CONFLICT: { ru: "Запрос устарел. Обновите страницу и повторите действие.", uz: "So‘rov eskirgan. Sahifani yangilang va amalni takrorlang.", en: "This request is out of date. Refresh the page and try again." },
    ANALYSIS_REVISION_SOURCE_INVALID: { ru: "Нормализованный текст недоступен или повреждён.", uz: "Normallashtirilgan matn mavjud emas yoki buzilgan.", en: "The normalized text is unavailable or damaged." },
    ANALYSIS_REVISION_NO_APPLICABLE_CHANGES: { ru: "Фрагменты изменились или встречаются несколько раз. Автоматическое применение остановлено.", uz: "Parchalar o‘zgargan yoki bir necha marta uchraydi. Avtomatik qo‘llash to‘xtatildi.", en: "Some passages changed or appear more than once, so automatic application was stopped." },
    ANALYSIS_REVISION_CONFLICT: { ru: "Версия изменилась. Обновите страницу и повторите действие.", uz: "Nusxa o‘zgardi. Sahifani yangilang va amalni takrorlang.", en: "The version changed. Refresh the page and try again." },
    ANALYSIS_REVISION_STORAGE_FAILED: { ru: "Версия не сохранена. Исходный документ не изменён.", uz: "Nusxa saqlanmadi. Asl hujjat o‘zgarmadi.", en: "The version was not saved. The source document remains unchanged." },
  };
  const message = code ? messages[code] : undefined;
  const localFallback = reviewText(locale, "Действие не выполнено.", "Amal bajarilmadi.", "The action could not be completed.");
  return message?.[locale] ?? platformApiError(locale, fallback, localFallback);
}

function exportRequestError(code: string | undefined, locale: PlatformLocale) {
  if (code === "ANALYSIS_EXPORT_NOT_READY") return reviewText(locale, "Экспорт доступен после завершения анализа.", "Eksport tahlil yakunlangandan keyin mavjud.", "Exports are available after analysis is complete.");
  if (code === "ANALYSIS_EXPORT_IDEMPOTENCY_CONFLICT") return reviewText(locale, "Запрос экспорта уже использован. Повторите действие.", "Eksport so‘rovi allaqachon ishlatilgan. Amalni takrorlang.", "This export request has already been used. Try the action again.");
  return reviewText(locale, "Экспорт не создан.", "Eksport yaratilmadi.", "The export could not be created.");
}

function withoutKey(values: Record<string, string>, key: string): Record<string, string> {
  if (!(key in values)) return values;
  const next = { ...values };
  delete next[key];
  return next;
}

function exportDeleteError(code: string | undefined, locale: PlatformLocale) {
  if (code === "ANALYSIS_EXPORT_NOT_TERMINAL") return reviewText(locale, "Дождитесь завершения экспорта.", "Eksport yakunlanishini kuting.", "Wait for the export to finish before deleting it.");
  if (code === "ANALYSIS_EXPORT_DELETE_FAILED") return reviewText(locale, "Экспорт не удалён. Повторите действие.", "Eksport o‘chirilmadi. Amalni takrorlang.", "The export could not be deleted. Try again.");
  return reviewText(locale, "Экспорт не найден.", "Eksport topilmadi.", "The export was not found.");
}
