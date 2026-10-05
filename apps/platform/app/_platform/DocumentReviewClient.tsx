"use client";

import { Select } from "../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated analysis data is hydrated after the first browser render */

import { AlertTriangle, Check, CheckCircle2, CircleAlert, Download, Eye, FileCheck2, FileDiff, FileText, Link2, LoaderCircle, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { comparisonText, platformApiError } from "../../content/platform-ui";
import { importDocumentUrlForAnalysis, uploadDocumentForAnalysis } from "../../lib/document-analysis/client-upload";
import { defaultDocumentAnalysisLocale, type SupportedDocumentAnalysisLocale } from "../../lib/document-analysis/language";
import type { AnalysisPackageContext, AnalysisPackageMemberRole, AnalysisPackageRelationshipKind } from "../../lib/document-comparison/types";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";
import { DocumentComparisonClient } from "./DocumentComparisonClient";
import { documentReviewCopy, reviewText } from "./document-review-localization";

type Risk = { id?: string; level: string; title: string; description: string; excerpt: string | null; confidencePercent: number | null; riskType?: "document_internal" | "legal_compliance"; clause?: string | null; page?: number | null; recommendation?: string | null; proposedWording?: string | null; legalBasisSourceIds?: string[] };
type AnalysisExportFormat = "json" | "pdf" | "docx";
type AnalysisExportVariant = "analysis_report" | "corrected_clean" | "corrected_redline";
type AnalysisExport = { id: string; status: string; format: AnalysisExportFormat; variant: AnalysisExportVariant; sourceVersionId: string | null; fileName: string; sizeBytes: number | null; errorCode: string | null; completedAt: string | null; createdAt: string };
type Summary = {
  summary?: string; parties?: string[]; dates?: string[]; obligations?: string[]; payments?: string[];
  disputedTerms?: string[]; missingItems?: string[]; questions?: string[]; disclaimer?: string;
  extraction?: { packageContext?: AnalysisPackageContext | null };
};
type Analysis = {
  id: string; status: string; errorCode?: string | null; retryExhausted?: boolean; createdAt?: string; updatedAt?: string;
  fileId: string; fileName: string; mimeType: string; sizeBytes: number; caseId?: string | null; summary?: Summary | null; risks?: Risk[]; exports?: AnalysisExport[];
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

export function DocumentReviewClient({ locale, accountType, publicUrlImportEnabled }: { locale: PlatformLocale; accountType: AccountType; publicUrlImportEnabled: boolean }) {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const [mode, setMode] = useState<"review" | "compare">(() => searchParams.get("mode") === "compare" ? "compare" : "review");
  const copy = comparisonText[locale];
  const reviewCopy = documentReviewCopy[locale];
  function selectMode(next: "review" | "compare") {
    setMode(next);
    const params = new URLSearchParams(searchParams.toString());
    if (next === "compare") params.set("mode", "compare");
    else params.delete("mode");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  function moveModeFocus(event: React.KeyboardEvent<HTMLButtonElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "ArrowRight" || event.key === "End" ? "compare" : "review";
    selectMode(next);
    document.getElementById(`review-mode-${next}`)?.focus();
  }
  return (
    <section className="review-workspace">
      <header>
        {mode === "compare" ? <FileDiff /> : <FileCheck2 />}
        <div><small>JURO · {copy.tool}</small><h1>{copy.title}</h1><p>{copy.description}</p></div>
      </header>
      <div className="review-mode-tabs" role="tablist" aria-label={reviewCopy.modeAria}>
        <button id="review-mode-review" role="tab" aria-controls="review-mode-panel" aria-selected={mode === "review"} tabIndex={mode === "review" ? 0 : -1} className={mode === "review" ? "active" : ""} onKeyDown={moveModeFocus} onClick={() => selectMode("review")}><FileCheck2 />{copy.singleMode}</button>
        <button id="review-mode-compare" role="tab" aria-controls="review-mode-panel" aria-selected={mode === "compare"} tabIndex={mode === "compare" ? 0 : -1} className={mode === "compare" ? "active" : ""} onKeyDown={moveModeFocus} onClick={() => selectMode("compare")}><FileDiff />{copy.compareMode}</button>
      </div>
      <div id="review-mode-panel" role="tabpanel" aria-labelledby={`review-mode-${mode}`}>
        {mode === "review"
          ? <SingleDocumentReview locale={locale} initialCaseId={searchParams.get("caseId")} initialAnalysisId={searchParams.get("analysisId")} publicUrlImportEnabled={publicUrlImportEnabled} />
          : <DocumentComparisonClient locale={locale} accountType={accountType} />}
      </div>
    </section>
  );
}

function SingleDocumentReview({ locale, initialCaseId, initialAnalysisId, publicUrlImportEnabled }: { locale: PlatformLocale; initialCaseId: string | null; initialAnalysisId: string | null; publicUrlImportEnabled: boolean }) {
  const copy = documentReviewCopy[locale];
  const [analysisLocale, setAnalysisLocale] = useState<SupportedDocumentAnalysisLocale>(() => defaultDocumentAnalysisLocale(locale));
  const inputRef = useRef<HTMLInputElement>(null);
  const [analyses, setAnalyses] = useState<Analysis[]>([]);
  const [cases, setCases] = useState<AnalysisCaseOption[]>([]);
  const [uploadCaseId, setUploadCaseId] = useState(initialCaseId ?? "");
  const [selected, setSelected] = useState<Analysis | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [publicUrl, setPublicUrl] = useState("");
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ phase: "hashing" | "uploading" | "finalizing"; loaded: number; total: number } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/platform/document-review", { cache: "no-store" });
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
  const exportPending = analyses.some(item => item.exports?.some(record => ["queued", "processing", "retrying"].includes(record.status)));
  const analysisPending = analyses.some((item) =>
    !hasRetryExhausted(item) && activeAnalysisStatuses.has(item.status)
  );
  useEffect(() => {
    if (!exportPending && !analysisPending) return;
    const timer = window.setInterval(() => { void load(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [analysisPending, exportPending, load]);

  async function upload(event: FormEvent) {
    event.preventDefault();
    if (!file || !consent) return;
    setUploading(true);
    setUploadProgress({ phase: "hashing", loaded: 0, total: file.size });
    setError("");
    setNotice("");
    try {
      const body = await uploadDocumentForAnalysis(file, locale, setUploadProgress, uploadCaseId || null, analysisLocale);
      setNotice(platformApiError(locale, body.message, copy.completed));
      setFile(null);
      setConsent(false);
      if (inputRef.current) inputRef.current.value = "";
      await load();
      if (body.analysis) setSelected(body.analysis);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setUploading(false); setUploadProgress(null); }
  }

  async function importUrl(event: FormEvent) {
    event.preventDefault();
    if (!publicUrlImportEnabled || !publicUrl.trim() || !consent) return;
    setUploading(true);
    setUploadProgress(null);
    setError("");
    setNotice("");
    try {
      const body = await importDocumentUrlForAnalysis(publicUrl, locale, uploadCaseId || null, analysisLocale);
      setNotice(platformApiError(locale, body.message, copy.imported));
      setPublicUrl("");
      setConsent(false);
      await load();
      if (body.analysis) setSelected(body.analysis);
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
    {error && <p className="review-message error" role="alert"><CircleAlert />{error}</p>}
    {notice && <p className="review-message success" role="status"><ShieldCheck />{notice}</p>}
    <form className="review-upload" onSubmit={upload}>
      <label className="review-drop" htmlFor="document-review-file">
        <Upload />
        <div>
          <strong>{file?.name || copy.supportedFiles}</strong>
          <span id="document-review-file-hint">{file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : copy.fileHint}</span>
        </div>
        <input id="document-review-file" ref={inputRef} type="file" aria-label={copy.chooseFileAria} aria-describedby="document-review-file-hint" accept=".pdf,.docx,.jpg,.jpeg,.png,.zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,application/zip" disabled={uploading} onChange={event => setFile(event.target.files?.[0] ?? null)} />
      </label>
      {locale === "en" && <label className="review-upload-case review-analysis-language"><span>{copy.analysisLanguage}</span><Select value={analysisLocale} onChange={event => setAnalysisLocale(event.target.value as SupportedDocumentAnalysisLocale)} disabled={uploading} aria-describedby="document-review-language-hint"><option value="ru">{copy.russian}</option><option value="uz">{copy.uzbek}</option></Select><small id="document-review-language-hint">{copy.analysisLanguageHint}</small></label>}
      <label className="review-upload-case"><span>{copy.addToCase}</span><Select value={uploadCaseId} onChange={event => setUploadCaseId(event.target.value)} disabled={uploading}><option value="">{copy.noCase}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></label>{uploadProgress && <div className="review-upload-progress" role="progressbar" aria-label={copy.uploadProgressAria} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadPercent ?? undefined} aria-valuetext={uploadStatus}><span style={{ transform: `scaleX(${uploadPercent === null ? .08 : Math.max(.08, uploadPercent / 100)})` }} /></div>}<p className="review-upload-status" aria-live="polite">{uploadStatus}</p><label><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>{consentCopy}</span></label><button disabled={!file || !consent || uploading}>{uploading ? <LoaderCircle className="spin" /> : <FileCheck2 />}{copy.uploadAndReview}</button>
    </form>
    {publicUrlImportEnabled ? <form className="review-url-import" onSubmit={importUrl}>
      <div><Link2 /><label htmlFor="review-public-url"><strong>{copy.importTitle}</strong><span>{copy.importHint}</span></label></div>
      <input id="review-public-url" type="url" inputMode="url" autoComplete="url" maxLength={2048} placeholder="https://example.uz/document.pdf" value={publicUrl} onChange={event => setPublicUrl(event.target.value)} disabled={uploading} />
      <button type="submit" disabled={!publicUrl.trim() || !consent || uploading}>{uploading ? <LoaderCircle className="spin" /> : <Link2 />}{copy.importAction}</button>
    </form> : <aside className="review-url-import-disabled" aria-label={copy.importUnavailableAria}>
      <Link2 aria-hidden="true" />
      <div><strong>{copy.importUnavailable}</strong><span>{copy.importUnavailableHint}</span></div>
    </aside>}
    {locale === "en" && <p className="review-normalized-note"><FileText />{copy.outputLanguageNote}</p>}
    {loading ? <div className="review-loading"><LoaderCircle className="spin" /></div> : <div className="review-layout"><aside><h2>{copy.recentFiles}</h2>{analyses.length ? analyses.map(item => <button className={selected?.id === item.id ? "active" : ""} key={item.id} onClick={() => setSelected(item)}><FileCheck2 /><span><strong>{item.fileName}</strong><small>{statusLabel(item.status, locale, hasRetryExhausted(item))}</small></span></button>) : <p>{copy.noFiles}</p>}</aside><section className="review-result-pane" aria-label={copy.resultAria}>{selected ? <AnalysisView analysis={selected} cases={cases} locale={locale} onChanged={load} /> : <div className="review-empty"><FileCheck2 /><h2>{copy.selectFile}</h2></div>}</section></div>}
  </>;
}

function AnalysisView({ analysis, cases, locale, onChanged }: { analysis: Analysis; cases: AnalysisCaseOption[]; locale: PlatformLocale; onChanged: () => Promise<void> }) {
  const copy = documentReviewCopy[locale];
  const summary = analysis.summary;
  const [exportAttemptKeys, setExportAttemptKeys] = useState<Record<string, string>>({});
  const canOpen = analysis.status === "completed";
  const retryExhausted = hasRetryExhausted(analysis);
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
    <div className="review-result-head"><div><small>{statusLabel(analysis.status, locale, retryExhausted)}</small><h2>{analysis.fileName}</h2><span>{(analysis.sizeBytes / 1024 / 1024).toFixed(2)} MB · {analysis.mimeType}</span></div><div className="review-result-actions" aria-live="polite">{canOpen && <a href={`/api/platform/document-review/files/${encodeURIComponent(analysis.fileId)}`} target="_blank" rel="noreferrer"><Eye />{copy.openFile}</a>}{canOpen && formats.map(format => { const record = exportsByFormat.get(format); const pending = ["queued", "processing", "retrying"].includes(record?.status ?? ""); const failed = record?.status === "failed"; const busy = exportingFormat === format || pending; const upperFormat = format.toUpperCase(); return <span className="review-export-action" key={format}>{record?.status === "completed" ? <a href={`/api/platform/document-analysis/exports/${encodeURIComponent(record.id)}/file`}><Download />{upperFormat}</a> : <button type="button" disabled={busy || deletingExportId !== null} aria-busy={busy} onClick={() => void requestExport(format)}>{busy ? <LoaderCircle className="spin" /> : failed ? <RefreshCw /> : <Download />}{busy ? reviewText(locale, `${upperFormat} готовится`, `${upperFormat} tayyorlanmoqda`, `Preparing ${upperFormat}`) : failed ? reviewText(locale, `Повторить ${upperFormat}`, `${upperFormat}ni takrorlash`, `Retry ${upperFormat}`) : reviewText(locale, `Экспорт ${upperFormat}`, `${upperFormat} eksport`, `Export ${upperFormat}`)}</button>}{record && ["completed", "failed"].includes(record.status) && <button type="button" aria-label={reviewText(locale, `Удалить ${upperFormat}`, `${upperFormat}ni o‘chirish`, `Delete ${upperFormat}`)} disabled={deletingExportId !== null || exportingFormat !== null} aria-busy={deletingExportId === record.id} onClick={() => void removeExport(record)}>{deletingExportId === record.id ? <LoaderCircle className="spin" /> : <Trash2 />}</button>}</span>; })}<button type="button" className="danger" disabled={deletingAnalysis || deletingExportId !== null || exportingFormat !== null} aria-busy={deletingAnalysis} onClick={() => void removeAnalysis()}>{deletingAnalysis ? <LoaderCircle className="spin" /> : <Trash2 />}{copy.deleteAnalysis}</button></div></div>
    <div className="review-case-link"><label><span>{copy.case}</span><Select value={caseId} onChange={event => { setCaseId(event.target.value); setCaseMessage(""); }} disabled={caseBusy}><option value="">{copy.noCase}</option>{cases.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</Select></label><button type="button" disabled={caseBusy || caseId === (analysis.caseId ?? "")} aria-busy={caseBusy} onClick={() => void saveCaseLink()}>{caseBusy ? <LoaderCircle className="spin" /> : <FileText />}{copy.saveCaseLink}</button><span role="status" aria-live="polite">{caseMessage}</span></div>
    {exportError && <p className="review-message error" role="alert"><CircleAlert />{exportError}</p>}
    {analysisDeleteError && <p className="review-message error" role="alert"><CircleAlert />{analysisDeleteError}</p>}
    {exportNotice && <p className="review-message success" role="status"><ShieldCheck />{exportNotice}</p>}
    {analysis.status !== "completed" ? <div className="review-awaiting" aria-live="polite"><AlertTriangle /><div><h3>{state.heading}</h3><p>{state.message}</p></div></div> : <><section><h3>{copy.summary}</h3><p>{summary?.summary}</p></section>{summary?.extraction?.packageContext?.members.length ? <PackageContextView context={summary.extraction.packageContext} locale={locale} /> : null}<div className="review-summary-grid"><ListBlock title={copy.parties} items={summary?.parties} /><ListBlock title={copy.dates} items={summary?.dates} /><ListBlock title={copy.obligations} items={summary?.obligations} /><ListBlock title={copy.payments} items={summary?.payments} /></div><section><h3>{copy.risks}</h3>{analysis.risks?.length ? <div className="review-risks">{analysis.risks.map((risk, index) => <article key={risk.id || `${risk.title}-${index}`} data-level={risk.level}><span>{riskLabel(risk.level, locale)}</span><h4>{risk.title}</h4><p>{risk.description}</p>{risk.excerpt && <blockquote>{risk.excerpt}</blockquote>}{risk.confidencePercent !== null && <small>{copy.confidence}: {risk.confidencePercent}%</small>}</article>)}</div> : <p>{copy.noRisks}</p>}</section><div className="review-summary-grid"><ListBlock title={copy.missing} items={summary?.missingItems} /><ListBlock title={copy.questions} items={summary?.questions} /></div><p className="review-disclaimer"><CheckCircle2 />{summary?.disclaimer || copy.disclaimer}</p></>}
    {analysis.status === "completed" && analysis.risks?.some((risk) => risk.proposedWording) ? <RevisionPanel analysisId={analysis.id} exports={analysis.exports ?? []} locale={locale} onAnalysisChanged={onChanged} /> : null}
  </article>;
}

function RevisionPanel({ analysisId, exports, locale, onAnalysisChanged }: { analysisId: string; exports: AnalysisExport[]; locale: PlatformLocale; onAnalysisChanged: () => Promise<void> }) {
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
  return <section className="review-revisions" aria-labelledby={`revision-title-${analysisId}`}>
    <div className="review-revisions-heading">
      <div><h3 id={`revision-title-${analysisId}`}>{copy.revisionsTitle}</h3><p>{copy.revisionsDescription}</p></div>
      {correctedVersions.length > 0 && <div className="review-version-downloads" aria-label={copy.correctedVersions}>{correctedVersions.map((version) => <div className="review-version-export" key={version.id}><strong>{reviewText(locale, `Версия ${version.version}`, `${version.version}-nusxa`, `Version ${version.version}`)}</strong><a href={`/api/platform/document-analysis/${encodeURIComponent(analysisId)}/versions/${encodeURIComponent(version.id)}/file`}><Download />MD</a>{builderSource && <button type="button" disabled={applyingBuilderVersionId !== null || builderSource.currentRevision !== builderSource.sourceRevision} aria-busy={applyingBuilderVersionId === version.id} title={builderSource.currentRevision !== builderSource.sourceRevision ? copy.builderStale : undefined} onClick={() => void applyVersionToBuilder(version)}>{applyingBuilderVersionId === version.id ? <LoaderCircle className="spin" /> : <FileCheck2 />}{copy.toBuilder}</button>}{(["corrected_clean", "corrected_redline"] as const).flatMap((variant) => (["docx", "pdf"] as const).map((format) => {
        const record = [...exports].filter((item) => item.sourceVersionId === version.id && item.variant === variant && item.format === format).sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
        const keyName = `${version.id}:${variant}:${format}`;
        const pending = ["queued", "processing", "retrying"].includes(record?.status ?? "");
        const label = `${variant === "corrected_clean" ? copy.clean : copy.redline} ${format.toUpperCase()}`;
        return <span key={`${variant}-${format}`}>{record?.status === "completed" ? <a href={`/api/platform/document-analysis/exports/${encodeURIComponent(record.id)}/file`}><Download />{label}</a> : <button type="button" disabled={pending || exportingKey !== null || deletingExportId !== null} aria-busy={pending || exportingKey === keyName} onClick={() => void requestVersionExport(version, variant, format)}>{pending || exportingKey === keyName ? <LoaderCircle className="spin" /> : record?.status === "failed" ? <RefreshCw /> : <Download />}{label}</button>}{record && ["completed", "failed"].includes(record.status) && <button type="button" className="icon" aria-label={reviewText(locale, `Удалить ${label}`, `${label}ni o‘chirish`, `Delete ${label}`)} disabled={deletingExportId !== null || exportingKey !== null} onClick={() => void removeVersionExport(record)}>{deletingExportId === record.id ? <LoaderCircle className="spin" /> : <Trash2 />}</button>}</span>;
      }))}</div>)}</div>}
    </div>
    <p className="review-normalized-note"><FileText />{copy.normalizedNote}</p>
    {error && <p className="review-message error" role="alert"><CircleAlert />{error}<button type="button" onClick={() => void load()}>{copy.retry}</button></p>}
    {notice && <p className="review-message success" role="status"><CheckCircle2 />{notice}</p>}
    {loading ? <div className="review-revision-skeleton" aria-label={copy.loadingRevisions}><i /><i /><i /></div> : revisions.length === 0 ? <div className="review-revision-empty"><FileText /><h4>{copy.noRevisions}</h4><p>{copy.noRevisionsHint}</p></div> : <div className="review-revision-list">{revisions.map((revision) => {
      const terminal = ["applied", "stale", "ambiguous"].includes(revision.status);
      const busy = busyId === revision.id;
      const selected = selectedIds.includes(revision.id);
      return <article key={revision.id} data-status={revision.status}>
        <header><div><span>{riskLabel(revision.riskLevel, locale)}</span><h4>{revision.riskTitle}</h4>{revision.clause && <small>{revision.clause}{revision.page ? ` · ${copy.pageShort} ${revision.page}` : ""}</small>}</div><strong>{revisionStatusLabel(revision.status, locale)}</strong></header>
        <div className="review-revision-diff"><div><small>{copy.originalText}</small><p>{revision.originalText}</p></div><div><small>{copy.proposedText}</small><p>{revision.proposedText}</p></div></div>
        {revision.recommendation && <p><b>{copy.rationale}</b> {revision.recommendation}</p>}
        {revision.legalBasisSourceIds.length > 0 && <p className="review-revision-sources"><b>{copy.relatedSources}</b> {revision.legalBasisSourceIds.join(", ")}</p>}
        {!terminal && <footer><label><input type="checkbox" checked={selected} disabled={revision.status !== "accepted" || busy} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, revision.id])] : current.filter((id) => id !== revision.id))} /><span>{copy.includeSelected}</span></label><div><button type="button" disabled={busy} aria-busy={busy} className={revision.status === "rejected" ? "active" : ""} onClick={() => void decide(revision, "rejected")}>{busy ? <LoaderCircle className="spin" /> : <X />}{copy.reject}</button><button type="button" disabled={busy} aria-busy={busy} className={revision.status === "accepted" ? "active primary" : "primary"} onClick={() => void decide(revision, "accepted")}>{busy ? <LoaderCircle className="spin" /> : <Check />}{copy.accept}</button></div></footer>}
      </article>;
    })}</div>}
    {!loading && revisions.length > 0 && <div className="review-revision-apply">
      <div><strong>{copy.acceptedCount(accepted.length, selectedIds.length)}</strong><span>{copy.immutableVersion}</span></div>
      <div><button type="button" disabled={selectedIds.length === 0 || applying !== null} onClick={() => setConfirmMode("selected")}>{applying === "selected" ? <LoaderCircle className="spin" /> : <Check />}{copy.applySelected}</button><button type="button" className="primary" disabled={available.length === 0 || applying !== null} onClick={() => setConfirmMode("all")}>{applying === "all" ? <LoaderCircle className="spin" /> : <FileCheck2 />}{copy.applyAll}</button></div>
    </div>}
    {confirmMode && <div className="review-revision-confirm" aria-labelledby={`revision-confirm-${analysisId}`}><div><h4 id={`revision-confirm-${analysisId}`}>{copy.confirmTitle}</h4><p>{confirmMode === "all" ? copy.confirmAll(available.length) : copy.confirmSelected(selectedIds.length)}</p></div><div><button type="button" onClick={() => setConfirmMode(null)}>{copy.cancel}</button><button type="button" className="primary" onClick={() => void apply(confirmMode)}>{copy.createVersion}</button></div></div>}
  </section>;
}

function ListBlock({ title, items }: { title: string; items?: string[] }) {
  return <section><h3>{title}</h3>{items?.length ? <ul>{items.map(item => <li key={item}>{item}</li>)}</ul> : <p>—</p>}</section>;
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
