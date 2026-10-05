"use client";

import { Select } from "../_components/Select";

import { usePlatformBasePath } from "./PlatformRouteContext";

/* eslint-disable react-hooks/set-state-in-effect -- authenticated comparison state is hydrated and polled after mount */

import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  FileDiff,
  FileText,
  LoaderCircle,
  RefreshCcw,
  RotateCcw,
  Scale,
  ShieldAlert,
  Trash2,
  UserRoundSearch,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Virtuoso } from "react-virtuoso";

import { comparisonResultText, comparisonText } from "../../content/platform-ui";
import type {
  ComparisonChange,
  ComparisonStage,
  ComparisonSummary,
  ExtractedDocument,
  RiskLevel,
} from "../../lib/document-comparison/types";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";

type Source = {
  id: string;
  officialUrl: string;
  actTitle: string;
  actIdentifier: string | null;
  publishedAt: string | null;
  revisionDate: string | null;
  locale: string;
  sourceType: string;
  status: string;
  lastCheckedAt: string;
};

type ComparisonDetail = {
  id: string;
  status: string;
  stage: ComparisonStage;
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  versionOneName: string;
  versionTwoName: string;
  caseId: string | null;
  summary: ComparisonSummary | null;
  versionOne: ExtractedDocument;
  versionTwo: ExtractedDocument;
  changes: ComparisonChange[];
  sources: Source[];
  exports: ComparisonExport[];
};

type ComparisonExport = {
  id: string;
  comparisonId: string;
  format: "pdf" | "docx";
  status: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number | null;
  errorCode: string | null;
  completedAt: string | null;
  createdAt: string;
};

type ComparisonResultCopy = (typeof comparisonResultText)[PlatformLocale];
type Tab = keyof ComparisonResultCopy["tabs"];
type BooleanFilter =
  | "material"
  | "increased"
  | "decreased"
  | "added"
  | "removed"
  | "changed"
  | "moved"
  | "renumbered"
  | "formatting"
  | "hasSource"
  | "lowConfidence";

const emptyFilters: Record<BooleanFilter, boolean> = {
  material: false,
  increased: false,
  decreased: false,
  added: false,
  removed: false,
  changed: false,
  moved: false,
  renumbered: false,
  formatting: false,
  hasSource: false,
  lowConfidence: false,
};

const materialRisk = new Set<RiskLevel>(["high", "medium"]);
const resultTabs: Tab[] = ["summary", "all", "side", "redline", "risks", "sources", "recommendations"];

export function ComparisonResultClient({
  comparisonId,
  locale,
}: {
  comparisonId: string;
  locale: PlatformLocale;
  accountType: AccountType;
}) {
  const copy = comparisonResultText[locale];
  const stageCopy = comparisonText[locale];
  const router = useRouter();
  const base = usePlatformBasePath();
  const [detail, setDetail] = useState<ComparisonDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("summary");
  const [filters, setFilters] = useState(emptyFilters);
  const [section, setSection] = useState("");
  const [party, setParty] = useState("");
  const [syncScroll, setSyncScroll] = useState(true);
  const [mobileVersion, setMobileVersion] = useState<"one" | "two">("one");
  const [cases, setCases] = useState<Array<{ id: string; title: string }>>([]);
  const [selectedCaseId, setSelectedCaseId] = useState("");
  const [savingCase, setSavingCase] = useState(false);
  const [caseNotice, setCaseNotice] = useState("");
  const [exporting, setExporting] = useState<"pdf" | "docx" | null>(null);
  const [decisionSavingId, setDecisionSavingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(
        `/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}`,
        { cache: "no-store", headers: { "x-juro-locale": locale } },
      );
      const body = await response.json() as { comparison?: ComparisonDetail; error?: string };
      if (!response.ok || !body.comparison) {
        throw new Error(body.error || copy.loadError);
      }
      setDetail(body.comparison);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [comparisonId, copy.loadError, locale]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void fetch("/api/platform/cases", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) return;
        const body = await response.json() as { cases?: Array<{ id: string; title: string }> };
        setCases(body.cases ?? []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!detail || (!["queued", "processing"].includes(detail.status)
      && !detail.exports.some((item) => ["queued", "processing", "retrying"].includes(item.status)))) return;
    const timer = window.setTimeout(() => void load(), 1200);
    return () => window.clearTimeout(timer);
  }, [detail, load]);

  const changedSections = useMemo(
    () => Array.from(new Set((detail?.changes ?? [])
      .map((change) => change.afterHeading || change.beforeHeading)
      .filter((value): value is string => Boolean(value)))),
    [detail],
  );
  const parties = useMemo(
    () => Array.from(new Set((detail?.changes ?? [])
      .map((change) => change.affectedParty)
      .filter((value) => value && !/не определено|aniqlanmagan/i.test(value)))),
    [detail],
  );

  const counts = useMemo(() => {
    const changes = detail?.changes ?? [];
    return {
      material: changes.filter((change) => materialRisk.has(change.riskLevel)).length,
      increased: changes.filter((change) => change.riskEffect === "increased").length,
      decreased: changes.filter((change) => change.riskEffect === "decreased").length,
      added: changes.filter((change) => change.changeType === "added").length,
      removed: changes.filter((change) => change.changeType === "removed").length,
      changed: changes.filter((change) => change.changeType === "changed").length,
      moved: changes.filter((change) => change.changeType === "moved").length,
      renumbered: changes.filter((change) => change.changeType === "renumbered").length,
      formatting: changes.filter((change) => change.changeType === "formatting").length,
      hasSource: changes.filter((change) => change.sourceIds.length > 0).length,
      lowConfidence: changes.filter((change) => change.confidencePercent !== null && change.confidencePercent < 70).length,
    };
  }, [detail]);

  const filteredChanges = useMemo(() => {
    return (detail?.changes ?? []).filter((change) => {
      if (change.changeType === "unchanged" && tab !== "side") return false;
      if (filters.material && !materialRisk.has(change.riskLevel)) return false;
      if (filters.increased && change.riskEffect !== "increased") return false;
      if (filters.decreased && change.riskEffect !== "decreased") return false;
      const typeFilters = (["added", "removed", "changed", "moved", "renumbered", "formatting"] as const)
        .filter((key) => filters[key]);
      if (typeFilters.length && !typeFilters.includes(change.changeType as typeof typeFilters[number])) return false;
      if (filters.hasSource && !change.sourceIds.length) return false;
      if (filters.lowConfidence && !(change.confidencePercent !== null && change.confidencePercent < 70)) return false;
      if (section && (change.afterHeading || change.beforeHeading) !== section) return false;
      if (party && change.affectedParty !== party) return false;
      if (tab === "risks" && change.riskEffect === "neutral") return false;
      if (tab === "recommendations" && !change.recommendation.trim()) return false;
      return true;
    });
  }, [detail, filters, party, section, tab]);

  const sourcesById = useMemo(
    () => new Map((detail?.sources ?? []).map((source) => [source.id, source])),
    [detail],
  );

  async function retry() {
    if (processing) return;
    setProcessing(true);
    setError("");
    try {
      const response = await fetch(
        `/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}/process`,
        {
          method: "POST",
          headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
        },
      );
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || copy.processingError);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      await load();
    } finally {
      setProcessing(false);
    }
  }

  async function markReviewed(change: ComparisonChange) {
    const reviewed = !change.reviewedAt;
    const response = await fetch(
      `/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-juro-csrf": "1",
          "x-juro-locale": locale,
        },
        body: JSON.stringify({ changeId: change.id, reviewed }),
      },
    );
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      setError(body.error || copy.reviewSaveError);
      return;
    }
    setDetail((current) => current ? {
      ...current,
      changes: current.changes.map((item) => item.id === change.id
        ? { ...item, reviewedAt: reviewed ? new Date().toISOString() : null }
        : item),
    } : current);
  }

  async function removeComparison() {
    if (!window.confirm(copy.deleteConfirm)) return;
    const response = await fetch(
      `/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}`,
      {
        method: "DELETE",
        headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
      },
    );
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      setError(body.error || copy.deleteError);
      return;
    }
    router.replace(`${base}/document-review?mode=compare`);
  }

  async function saveToCase() {
    const caseId = selectedCaseId || detail?.caseId || "";
    if (!caseId || savingCase) return;
    setSavingCase(true);
    setCaseNotice("");
    const response = await fetch(
      `/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-juro-csrf": "1",
          "x-juro-locale": locale,
        },
        body: JSON.stringify({ caseId }),
      },
    );
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      setError(body.error || copy.caseLinkError);
    } else {
      setDetail((current) => current ? { ...current, caseId } : current);
      setCaseNotice(copy.caseSaved);
    }
    setSavingCase(false);
  }

  async function decideChange(
    change: ComparisonChange,
    decision: ComparisonChange["reviewDecision"],
  ) {
    if (decisionSavingId) return;
    setDecisionSavingId(change.id);
    setError("");
    try {
      const response = await fetch(
        `/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}/changes/${encodeURIComponent(change.id)}`,
        {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
          },
          body: JSON.stringify({ decision: decision ?? "pending", locale }),
        },
      );
      const body = await response.json() as {
        change?: Pick<ComparisonChange, "id" | "reviewDecision" | "decidedAt" | "reviewedAt" | "reviewDecisionVersion">;
        error?: string;
      };
      if (!response.ok || !body.change) {
        throw new Error(body.error || copy.decisionSaveError);
      }
      setDetail((current) => current ? {
        ...current,
        changes: current.changes.map((item) => item.id === change.id
          ? { ...item, ...body.change }
          : item),
      } : current);
    } catch (value) {
      setError(value instanceof Error ? value.message : copy.decisionSaveError);
    } finally {
      setDecisionSavingId(null);
    }
  }

  async function requestExport(format: "pdf" | "docx") {
    if (exporting) return;
    setExporting(format);
    setError("");
    try {
      const response = await fetch(
        `/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}/export`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-juro-csrf": "1",
            "x-juro-locale": locale,
            "idempotency-key": `comparison-${comparisonId}-${format}-${crypto.randomUUID()}`,
          },
          body: JSON.stringify({ format }),
        },
      );
      const body = await response.json() as { error?: string };
      if (!response.ok) throw new Error(body.error || copy.exportCreateError);
      await load();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setExporting(null);
    }
  }

  async function removeExport(exportId: string) {
    const response = await fetch(
      `/api/platform/document-comparisons/exports/${encodeURIComponent(exportId)}`,
      {
        method: "DELETE",
        headers: { "x-juro-csrf": "1", "x-juro-locale": locale },
      },
    );
    if (!response.ok) {
      const body = await response.json() as { error?: string };
      setError(body.error || copy.exportDeleteError);
      return;
    }
    await load();
  }

  function moveTabFocus(event: React.KeyboardEvent<HTMLButtonElement>, current: Tab) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = resultTabs.indexOf(current);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? resultTabs.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + resultTabs.length) % resultTabs.length;
    const next = resultTabs[nextIndex];
    setTab(next);
    document.getElementById(`comparison-tab-${next}`)?.focus();
  }

  if (loading) {
    return <div className="comparison-result-state" aria-live="polite"><LoaderCircle className="spin" /><p>{copy.processing}</p></div>;
  }
  if (!detail) {
    return (
      <div className="comparison-result-state error" role="alert">
        <ShieldAlert />
        <h1>{error || copy.unavailableTitle}</h1>
        <div><button type="button" onClick={() => void load()}><RefreshCcw />{copy.retry}</button><Link href={`${base}/document-review?mode=compare`}><ArrowLeft />{copy.back}</Link></div>
      </div>
    );
  }

  const complete = ["completed", "completed_partial"].includes(detail.status) && detail.summary;
  if (!complete) {
    return (
      <div className="comparison-result-shell">
        <Link className="comparison-result-back" href={`${base}/document-review?mode=compare`}><ArrowLeft />{copy.back}</Link>
        <section className="comparison-result-state" aria-live="polite">
          {detail.status === "failed" ? <AlertTriangle /> : <LoaderCircle className="spin" />}
          <h1>{detail.status === "failed" ? (error || errorLabel(detail.errorCode, locale)) : copy.processing}</h1>
          <p>{stageCopy.stages[detail.stage]}</p>
          <ProcessingSteps current={detail.stage} locale={locale} />
          <button type="button" onClick={() => void retry()} disabled={processing}>
            {processing ? <LoaderCircle className="spin" /> : <RefreshCcw />}{copy.retry}
          </button>
        </section>
      </div>
    );
  }

  const summary = detail.summary!;
  const latestExports = new Map<"pdf" | "docx", ComparisonExport>();
  for (const item of detail.exports) if (!latestExports.has(item.format)) latestExports.set(item.format, item);
  const safeSources = detail.sources.filter((source) => safeOfficialUrl(source.officialUrl));
  return (
    <div className="comparison-result-shell">
      <header className="comparison-result-hero">
        <Link className="comparison-result-back" href={`${base}/document-review?mode=compare`}><ArrowLeft />{copy.back}</Link>
        <div className="comparison-result-title">
          <span><FileDiff /></span>
          <div>
            <small>{copy.generated} · {formatDate(summary.generatedAt, locale)}</small>
            <h1>{detail.versionOneName} <i>→</i> {detail.versionTwoName}</h1>
            <p>{detail.status === "completed_partial" ? copy.partial : `${summary.totalChanges} ${copy.metrics.changes}`}</p>
          </div>
        </div>
        <div className="comparison-result-actions">
          {(["pdf", "docx"] as const).map((format) => {
            const item = latestExports.get(format);
            const pending = item && ["queued", "processing", "retrying"].includes(item.status);
            const completed = item?.status === "completed";
            const label = completed
              ? (format === "pdf" ? copy.exportPdf : copy.exportDocx)
              : pending
                ? copy.exportPreparing
                : item?.status === "failed"
                  ? copy.exportRetry
                  : (format === "pdf" ? copy.exportCreatePdf : copy.exportCreateDocx);
            return (
              <span className="comparison-export-action" key={format}>
                {completed ? (
                  <a href={`/api/platform/document-comparisons/exports/${encodeURIComponent(item.id)}/file?locale=${locale}`}>
                    {format === "pdf" ? <Download /> : <FileText />}{label}
                  </a>
                ) : (
                  <button type="button" onClick={() => void requestExport(format)} disabled={Boolean(pending) || exporting === format}>
                    {pending || exporting === format ? <LoaderCircle className="spin" /> : format === "pdf" ? <Download /> : <FileText />}{label}
                  </button>
                )}
                {item && ["completed", "failed"].includes(item.status) && (
                  <button type="button" className="comparison-export-delete" aria-label={copy.exportDelete} title={copy.exportDelete} onClick={() => void removeExport(item.id)}>
                    <Trash2 />
                  </button>
                )}
              </span>
            );
          })}
          <Link href={`${base}/consultations?comparisonId=${encodeURIComponent(comparisonId)}`}><UserRoundSearch />{copy.consult}</Link>
          <Link href={`${base}/document-builder`}><FileText />{copy.edit}</Link>
          <button type="button" className="danger" onClick={() => void removeComparison()}><Trash2 /><span>{copy.delete}</span></button>
        </div>
        <section className="comparison-version-metadata" aria-label={copy.versionMetadataAria}>
          {([detail.versionOne, detail.versionTwo] as const).map((version, index) => (
            <article key={index}>
              <FileText />
              <div>
                <strong>{index === 0 ? copy.versionOne : copy.versionTwo}</strong>
                <span>{version.fileName}</span>
              </div>
              <dl>
                <div><dt>{copy.uploaded}</dt><dd>{formatDate(detail.createdAt, locale)}</dd></div>
                <div><dt>{copy.pages}</dt><dd>{version.pageCount ?? "—"}</dd></div>
                <div><dt>{copy.documentLanguage}</dt><dd>{version.detectedLanguage?.toUpperCase() || "—"}</dd></div>
                <div><dt>{copy.recognition}</dt><dd>{version.textQuality === "good" ? copy.qualityGood : version.textQuality === "limited" ? copy.qualityLimited : copy.qualityOcr}</dd></div>
                <div><dt>{copy.size}</dt><dd>{formatSize(version.sizeBytes)}</dd></div>
              </dl>
              <a
                href={`/api/platform/document-comparisons/${encodeURIComponent(comparisonId)}/files/${index === 0 ? "one" : "two"}?locale=${locale}`}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink />{copy.openVersion}
              </a>
            </article>
          ))}
        </section>
      </header>

      {error && <div className="comparison-message error" role="alert"><AlertTriangle /><span>{error}</span></div>}
      {summary.likelyDifferentDocuments && <div className="comparison-message warning" role="status"><AlertTriangle /><span>{copy.likelyDifferent}</span></div>}
      {summary.aiStatus !== "completed" && summary.aiStatus !== "not_required" && (
        <div className="comparison-evidence-warning"><ShieldAlert /><div><strong>{copy.sourceUnavailable}</strong><p>{copy.aiUnavailable}</p></div></div>
      )}
      <section className="comparison-case-link" aria-label={copy.saveToCase}>
        <Scale />
        <div><strong>{copy.saveToCase}</strong>{caseNotice && <span role="status"><CheckCircle2 />{caseNotice}</span>}</div>
        {cases.length ? (
          <>
            <label className="sr-only" htmlFor="comparison-case-select">{copy.chooseCase}</label>
            <Select id="comparison-case-select" value={selectedCaseId || detail.caseId || ""} onChange={(event) => { setSelectedCaseId(event.target.value); setCaseNotice(""); }}>
              <option value="">{copy.chooseCase}</option>
              {cases.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
            </Select>
            <button type="button" disabled={savingCase || !(selectedCaseId || detail.caseId)} onClick={() => void saveToCase()}>
              {savingCase ? <LoaderCircle className="spin" /> : <Check />}{copy.saveToCase}
            </button>
          </>
        ) : <Link href={`${base}/cases`}><ArrowLeft />{copy.createCase}</Link>}
      </section>

      <nav className="comparison-result-tabs" role="tablist" aria-label={copy.resultViewAria}>
        {resultTabs.map((item) => (
          <button
            key={item}
            id={`comparison-tab-${item}`}
            type="button"
            role="tab"
            aria-controls="comparison-result-panel"
            aria-selected={tab === item}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
            onKeyDown={(event) => moveTabFocus(event, item)}
          >
            {copy.tabs[item]}
          </button>
        ))}
      </nav>

      <div id="comparison-result-panel" role="tabpanel" aria-labelledby={`comparison-tab-${tab}`} className="comparison-tab-panel">
        {tab === "summary" ? (
          <SummaryView summary={summary} copy={copy} />
        ) : tab === "sources" ? (
          <SourcesView sources={safeSources} copy={copy} locale={locale} />
        ) : (
          <div className="comparison-result-layout">
          {tab !== "side" && (
            <FilterPanel
              copy={copy}
              counts={counts}
              filters={filters}
              setFilters={setFilters}
              sections={changedSections}
              section={section}
              setSection={setSection}
              parties={parties}
              party={party}
              setParty={setParty}
            />
          )}
          <main className={tab === "side" ? "comparison-view comparison-view-wide" : "comparison-view"}>
            {tab === "side" ? (
              <SideBySide
                changes={detail.changes}
                detail={detail}
                copy={copy}
                syncScroll={syncScroll}
                setSyncScroll={setSyncScroll}
                mobileVersion={mobileVersion}
                setMobileVersion={setMobileVersion}
              />
            ) : filteredChanges.length ? (
              <>
                {tab === "redline" && (
                  <div className="comparison-redline-legend" aria-label={copy.legend}>
                    <strong>{copy.legend}</strong>
                    <span className="added"><b aria-hidden="true">＋</b>{copy.added}</span>
                    <span className="removed"><b aria-hidden="true">−</b>{copy.removed}</span>
                    <span><b aria-hidden="true">○</b>{copy.unchanged}</span>
                  </div>
                )}
                <Virtuoso
                  className="comparison-virtual-list"
                  data={filteredChanges}
                  useWindowScroll
                  increaseViewportBy={500}
                  itemContent={(_index, change) => tab === "redline"
                    ? <RedlineRow change={change} copy={copy} />
                    : (
                      <ChangeCard
                        change={change}
                        copy={copy}
                        source={change.sourceIds.map((id) => sourcesById.get(id)).find(Boolean)}
                        onReviewed={() => void markReviewed(change)}
                        onDecision={(decision) => void decideChange(change, decision)}
                        decisionSaving={decisionSavingId === change.id}
                      />
                    )}
                />
              </>
            ) : <div className="comparison-no-results"><FileDiff /><p>{copy.noResults}</p></div>}
          </main>
          </div>
        )}
      </div>
    </div>
  );
}

function SummaryView({
  summary,
  copy,
}: {
  summary: ComparisonSummary;
  copy: ComparisonResultCopy;
}) {
  const metrics = [
    ["changes", summary.totalChanges],
    ["material", summary.materialChanges],
    ["increased", summary.riskIncreased],
    ["decreased", summary.riskDecreased],
    ["similarity", `${summary.similarityPercent}%`],
  ] as const;
  return (
    <div className="comparison-summary">
      <section className="comparison-metrics">
        {metrics.map(([key, value]) => <article key={key} data-metric={key}><strong>{value}</strong><span>{copy.metrics[key]}</span></article>)}
      </section>
      <section className="comparison-summary-grid">
        <article>
          <span className={`comparison-risk risk-${summary.overallRisk}`}><Scale />{copy.overallRisk}: {copy.riskLabels[summary.overallRisk]}</span>
          <h2>{copy.changedSections}</h2>
          {summary.changedSections.length
            ? <ul>{summary.changedSections.map((item) => <li key={item}>{item}</li>)}</ul>
            : <p>{copy.noChangedSections}</p>}
        </article>
        <article className="comparison-change-breakdown">
          {(["added", "removed", "changed", "moved", "renumbered", "formatting"] as const).map((key) => (
            <div key={key}><span>{copy.changeLabels[key]}</span><strong>{summary[key]}</strong></div>
          ))}
        </article>
      </section>
    </div>
  );
}

function FilterPanel({
  copy,
  counts,
  filters,
  setFilters,
  sections,
  section,
  setSection,
  parties,
  party,
  setParty,
}: {
  copy: ComparisonResultCopy;
  counts: Record<BooleanFilter, number>;
  filters: Record<BooleanFilter, boolean>;
  setFilters: React.Dispatch<React.SetStateAction<Record<BooleanFilter, boolean>>>;
  sections: string[];
  section: string;
  setSection: (value: string) => void;
  parties: string[];
  party: string;
  setParty: (value: string) => void;
}) {
  const options: Array<[BooleanFilter, string]> = [
    ["material", copy.onlyMaterial], ["increased", copy.increased], ["decreased", copy.decreased],
    ["added", copy.added], ["removed", copy.removed], ["changed", copy.changed],
    ["moved", copy.moved], ["renumbered", copy.renumbered], ["formatting", copy.formatting],
    ["hasSource", copy.hasSource], ["lowConfidence", copy.lowConfidence],
  ];
  const hasFilters = Object.values(filters).some(Boolean) || section || party;
  return (
    <aside className="comparison-filters">
      <header><strong>{copy.filters}</strong>{hasFilters && <button type="button" onClick={() => { setFilters(emptyFilters); setSection(""); setParty(""); }}>{copy.clearFilters}</button>}</header>
      <div className="comparison-filter-options">
        {options.map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={filters[key]} onChange={(event) => setFilters((current) => ({ ...current, [key]: event.target.checked }))} />
            <span>{label}</span><b>{counts[key]}</b>
          </label>
        ))}
      </div>
      {sections.length > 0 && <label className="comparison-select-filter"><span>{copy.sectionFilter}</span><Select value={section} onChange={(event) => setSection(event.target.value)}><option value="">{copy.allSections}</option>{sections.map((item) => <option key={item}>{item}</option>)}</Select></label>}
      {parties.length > 0 && <label className="comparison-select-filter"><span>{copy.partyFilter}</span><Select value={party} onChange={(event) => setParty(event.target.value)}><option value="">{copy.allParties}</option>{parties.map((item) => <option key={item}>{item}</option>)}</Select></label>}
    </aside>
  );
}

function ChangeCard({
  change,
  copy,
  source,
  onReviewed,
  onDecision,
  decisionSaving,
}: {
  change: ComparisonChange;
  copy: ComparisonResultCopy;
  source?: Source;
  onReviewed: () => void;
  onDecision: (decision: ComparisonChange["reviewDecision"]) => void;
  decisionSaving: boolean;
}) {
  const label = change.afterLabel || change.beforeLabel || `#${change.ordinal}`;
  const decisionStatus = change.reviewDecision === "accepted"
    ? copy.decisionAccepted
    : change.reviewDecision === "rejected"
      ? copy.decisionRejected
      : copy.decisionPending;
  return (
    <article
      className="comparison-change-card"
      data-risk={change.riskLevel}
      data-decision={change.reviewDecision ?? "pending"}
    >
      <header>
        <div><span className={`change-type type-${change.changeType}`}>{copy.changeLabels[change.changeType]}</span><h2>{label}{(change.afterHeading || change.beforeHeading) ? ` · ${change.afterHeading || change.beforeHeading}` : ""}</h2></div>
        <span className={`comparison-risk risk-${change.riskLevel}`}>{copy.riskLabels[change.riskLevel]}</span>
      </header>
      <p className="comparison-change-summary">{change.summary}</p>
      <div className="comparison-before-after">
        <section><strong>{copy.before}</strong><p>{change.beforeText || "—"}</p></section>
        <section><strong>{copy.after}</strong><p>{change.afterText || "—"}</p></section>
      </div>
      <dl className="comparison-legal-details">
        <div><dt>{copy.legalEffect}</dt><dd>{change.legalEffect}</dd></div>
        <div><dt>{copy.affectedParty}</dt><dd>{change.affectedParty}</dd></div>
        <div><dt>{copy.recommendation}</dt><dd>{change.recommendation}</dd></div>
      </dl>
      {change.extractionWarning && <p className="comparison-extraction-warning"><AlertTriangle />{copy.extractionWarning}</p>}
      <footer>
        <div className="comparison-confidence">
          <span>{copy.confidence}</span>
          <div aria-hidden="true"><i style={{ width: `${change.confidencePercent ?? 0}%` }} /></div>
          <strong>{change.confidencePercent === null ? "—" : `${change.confidencePercent}%`}</strong>
        </div>
        {source && safeOfficialUrl(source.officialUrl) ? (
          <a href={source.officialUrl} target="_blank" rel="noreferrer"><ExternalLink />{source.actTitle}</a>
        ) : <span className="comparison-unverified"><ShieldAlert />{copy.sourceUnavailable}</span>}
        <div className="comparison-decision">
          <span aria-live="polite">
            {decisionSaving ? copy.decisionSaving : decisionStatus}
          </span>
          <div role="group" aria-label={copy.decisionLabel}>
            <button
              type="button"
              className={change.reviewDecision === "accepted" ? "accepted" : ""}
              aria-pressed={change.reviewDecision === "accepted"}
              disabled={decisionSaving}
              onClick={() => onDecision("accepted")}
            >
              <CheckCircle2 />{copy.acceptChange}
            </button>
            <button
              type="button"
              className={change.reviewDecision === "rejected" ? "rejected" : ""}
              aria-pressed={change.reviewDecision === "rejected"}
              disabled={decisionSaving}
              onClick={() => onDecision("rejected")}
            >
              <XCircle />{copy.rejectChange}
            </button>
            {change.reviewDecision && (
              <button
                type="button"
                className="clear"
                disabled={decisionSaving}
                onClick={() => onDecision(null)}
              >
                <RotateCcw />{copy.clearDecision}
              </button>
            )}
          </div>
        </div>
        <button type="button" className={change.reviewedAt ? "reviewed" : ""} onClick={onReviewed}>
          {change.reviewedAt ? <CheckCircle2 /> : <Check />}{change.reviewedAt ? copy.reviewed : copy.markReviewed}
        </button>
      </footer>
    </article>
  );
}

function SideBySide({
  changes,
  detail,
  copy,
  syncScroll,
  setSyncScroll,
  mobileVersion,
  setMobileVersion,
}: {
  changes: ComparisonChange[];
  detail: ComparisonDetail;
  copy: ComparisonResultCopy;
  syncScroll: boolean;
  setSyncScroll: (value: boolean) => void;
  mobileVersion: "one" | "two";
  setMobileVersion: (value: "one" | "two") => void;
}) {
  const row = (change: ComparisonChange, version: "one" | "two") => (
    <article className={`comparison-document-row type-${change.changeType}`} data-version={version}>
      <span>{version === "one" ? (change.beforeLabel || "—") : (change.afterLabel || "—")}</span>
      <p>{version === "one" ? (change.beforeText || "—") : (change.afterText || "—")}</p>
      <small>{copy.changeLabels[change.changeType]}</small>
    </article>
  );
  return (
    <section className="comparison-side">
      <header>
        <label><input type="checkbox" checked={syncScroll} onChange={(event) => setSyncScroll(event.target.checked)} />{copy.syncScroll}</label>
        <div className="comparison-mobile-version" role="group" aria-label={copy.showVersion}>
          <button type="button" className={mobileVersion === "one" ? "active" : ""} onClick={() => setMobileVersion("one")}>{copy.versionOne}</button>
          <button type="button" className={mobileVersion === "two" ? "active" : ""} onClick={() => setMobileVersion("two")}>{copy.versionTwo}</button>
        </div>
      </header>
      <div className={`comparison-version-heads mobile-${mobileVersion}`}>
        <strong>{copy.versionOne}<span>{detail.versionOne.fileName}</span></strong>
        <strong>{copy.versionTwo}<span>{detail.versionTwo.fileName}</span></strong>
      </div>
      {syncScroll ? (
        <Virtuoso
          className={`comparison-side-virtual mobile-${mobileVersion}`}
          data={changes}
          increaseViewportBy={600}
          itemContent={(_index, change) => <div className="comparison-aligned-row">{row(change, "one")}{row(change, "two")}</div>}
        />
      ) : (
        <div className={`comparison-independent mobile-${mobileVersion}`}>
          <Virtuoso data={changes} itemContent={(_index, change) => row(change, "one")} />
          <Virtuoso data={changes} itemContent={(_index, change) => row(change, "two")} />
        </div>
      )}
    </section>
  );
}

function RedlineRow({
  change,
  copy,
}: {
  change: ComparisonChange;
  copy: ComparisonResultCopy;
}) {
  return (
    <article className="comparison-redline-row">
      <header><strong>{change.afterLabel || change.beforeLabel || `#${change.ordinal}`}</strong><span>{copy.changeLabels[change.changeType]}</span></header>
      <p>
        {change.wordDiff.map((part, index) => (
          <mark key={`${part.kind}-${index}`} className={`diff-${part.kind}`} aria-label={part.kind === "added" ? copy.added : part.kind === "removed" ? copy.removed : undefined}>
            {part.kind === "added" && <span aria-hidden="true">＋</span>}
            {part.kind === "removed" && <span aria-hidden="true">−</span>}
            {part.value}
          </mark>
        ))}
      </p>
    </article>
  );
}

function SourcesView({
  sources,
  copy,
  locale,
}: {
  sources: Source[];
  copy: ComparisonResultCopy;
  locale: PlatformLocale;
}) {
  if (!sources.length) {
    return <div className="comparison-no-sources"><ShieldAlert /><h2>{copy.noSources}</h2><p>{copy.sourceUnavailableDetail}</p></div>;
  }
  return (
    <div className="comparison-sources">
      {sources.map((source) => (
        <article key={source.id}>
          <header><span><CheckCircle2 />{copy.verified}</span><small>{source.actIdentifier || copy.officialSource}</small></header>
          <h2>{source.actTitle}</h2>
          <dl>
            <div><dt>{copy.currentAsOf}</dt><dd>{formatDate(source.revisionDate || source.lastCheckedAt, locale)}</dd></div>
            <div><dt>{copy.originalLanguage}</dt><dd>{source.locale.toUpperCase()}</dd></div>
            <div><dt>{copy.status}</dt><dd>{source.status}</dd></div>
          </dl>
          <a href={source.officialUrl} target="_blank" rel="noreferrer"><ExternalLink />{copy.officialSource}</a>
        </article>
      ))}
    </div>
  );
}

function ProcessingSteps({ current, locale }: { current: ComparisonStage; locale: PlatformLocale }) {
  const copy = comparisonText[locale];
  const stages = [
    "uploaded", "extracting_version_one", "extracting_version_two", "structuring", "diffing", "legal_analysis", "completed",
  ] as const;
  const active = Math.max(stages.indexOf(current as typeof stages[number]), 0);
  return (
    <ol className="comparison-result-progress">
      {stages.map((stage, index) => <li key={stage} className={index < active ? "done" : index === active ? "active" : ""}><span>{index < active ? <Check /> : index + 1}</span><strong>{copy.stages[stage]}</strong></li>)}
    </ol>
  );
}

function safeOfficialUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function formatDate(value: string, locale: PlatformLocale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(
      { ru: "ru-UZ", uz: "uz-UZ", en: "en-GB" }[locale],
      { dateStyle: "medium", timeStyle: "short" },
    ).format(date);
}

function formatSize(bytes: number) {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function errorLabel(code: string | null, locale: PlatformLocale) {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    CORRUPT_FILE: {
      ru: "Файл повреждён или был удалён во время обработки.",
      uz: "Fayl shikastlangan yoki qayta ishlash vaqtida o‘chirilgan.",
      en: "The file is corrupted or was deleted during processing.",
    },
    FILE_SCAN_REQUIRED: {
      ru: "Файл нужно повторно загрузить для проверки безопасности.",
      uz: "Xavfsizlik tekshiruvi uchun faylni qayta yuklang.",
      en: "Upload the file again so it can be checked for security.",
    },
    PASSWORD_PROTECTED: {
      ru: "PDF защищён паролем. Снимите защиту и замените версию.",
      uz: "PDF parol bilan himoyalangan. Himoyani olib tashlab, versiyani almashtiring.",
      en: "The PDF is password-protected. Remove the protection and replace this version.",
    },
    NO_READABLE_TEXT: {
      ru: "В документе нет читаемого текста.",
      uz: "Hujjatda o‘qiladigan matn yo‘q.",
      en: "The document contains no readable text.",
    },
    OCR_REQUIRED: {
      ru: "Это скан. Для сравнения требуется подключённый OCR.",
      uz: "Bu skan. Taqqoslash uchun OCR ulanishi kerak.",
      en: "This document is a scan. A connected OCR service is required for comparison.",
    },
    PAGE_LIMIT_EXCEEDED: {
      ru: "Документ превышает безопасный лимит страниц.",
      uz: "Hujjat xavfsiz sahifa limitidan oshgan.",
      en: "The document exceeds the safe page limit.",
    },
    PROCESSING_TIMEOUT: {
      ru: "Обработка превысила лимит времени. Уже выполненные этапы сохранены.",
      uz: "Qayta ishlash vaqt limitidan oshdi. Bajarilgan bosqichlar saqlandi.",
      en: "Processing exceeded the time limit. Completed stages have been preserved.",
    },
  };
  return labels[code || ""]?.[locale] || comparisonResultText[locale].processingError;
}
