"use client";

import { usePlatformBasePath, usePlatformWorkspaceId } from "./PlatformRouteContext";

/* eslint-disable react-hooks/set-state-in-effect -- private dashboard data is loaded after authentication */

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  FileDiff,
  FilePenLine,
  Files,
  LoaderCircle,
  Mic,
  Paperclip,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { dashboardCopy, platformApiError } from "../../content/platform-ui";
import { uploadDocumentForAnalysis } from "../../lib/document-analysis/client-upload";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";

type DashboardData = {
  serverNow: string;
  counts: {
    activeCases: number;
    documents: number;
    consultations: number;
    unreadNotifications: number;
  };
  cases: Array<{ id: string; title: string; status: string; updatedAt: string; progressPercent: number | null }>;
  documents: Array<{ id: string; title: string; status: string; category: string; updatedAt: string }>;
  deadlines: Array<{ id: string; title: string; dueAt: string; caseId: string; caseTitle: string }>;
  notifications: Array<{ id: string; title: string; body: string; createdAt: string }>;
  analyses: Array<{ id: string; status: string; errorCode: string | null; fileName: string; updatedAt: string }>;
  comparisons: Array<{
    id: string;
    status: string;
    stage: string;
    errorCode: string | null;
    versionOneName: string;
    versionTwoName: string;
    updatedAt: string;
  }>;
};

type DashboardProps = {
  locale: PlatformLocale;
  accountType: AccountType;
  userName: string;
};

export function DashboardClient({ locale, accountType, userName }: DashboardProps) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const copy = dashboardCopy(locale);
  const base = usePlatformBasePath();
  const workspaceId = usePlatformWorkspaceId();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [prompt, setPrompt] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ phase: "hashing" | "uploading" | "finalizing"; loaded: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch("/api/platform/dashboard", {
        cache: "no-store",
        headers: { "x-juro-workspace-id": workspaceId },
      });
      const body = await response.json() as DashboardData & { error?: string };
      if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.loadError));
      setData(body);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, locale, workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function startTask(event: FormEvent) {
    event.preventDefault();
    if (!prompt.trim() && !file) return;
    if (file) {
      if (!consent) return;
      setSubmitting(true);
      setUploadProgress({ phase: "hashing", loaded: 0, total: file.size });
      setError("");
      try {
        const body = await uploadDocumentForAnalysis(file, locale, setUploadProgress);
        const search = body.analysis?.id ? `?analysis=${encodeURIComponent(body.analysis.id)}` : "";
        router.push(`${base}/document-review${search}`);
      } catch (value) {
        setError(value instanceof Error ? value.message : String(value));
      } finally {
        setSubmitting(false);
        setUploadProgress(null);
      }
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/platform/ai/intake", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-juro-csrf": "1",
          "x-juro-locale": locale,
        },
        body: JSON.stringify({ question: prompt.trim(), workspaceId }),
      });
      const body = await response.json() as { handle?: string; error?: string };
      if (!response.ok || !body.handle) {
        throw new Error(platformApiError(locale, body.error, copy.intakeError));
      }
      setPrompt("");
      router.push(`${base}/ai-chat?intake=${encodeURIComponent(body.handle)}`);
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    } finally {
      setSubmitting(false);
    }
  }

  function chooseFile(next: File | null) {
    if (next && next.size > 50 * 1024 * 1024) {
      setError(copy.fileTooLarge50);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }
    setFile(next);
    setConsent(false);
    setError("");
  }

  const quickActions = [
    { href: `${base}/document-builder`, icon: FilePenLine, copy: copy.actions.create },
    { href: `${base}/document-review`, icon: ShieldCheck, copy: copy.actions.review },
    { href: `${base}/lawyers`, icon: BriefcaseBusiness, copy: {
      title: locale === "ru" ? "Найти юриста" : locale === "uz" ? "Yurist topish" : "Find a lawyer",
      description: locale === "ru" ? "Обсудите вопрос со специалистом" : locale === "uz" ? "Mutaxassis bilan maslahatlashing" : "Talk it through with a specialist",
    } },
  ];
  const uploadPercent = uploadProgress?.phase === "uploading" && uploadProgress.total > 0
    ? Math.round((uploadProgress.loaded / uploadProgress.total) * 100)
    : null;
  const uploadStatus = !uploadProgress ? "" : uploadProgress.phase === "hashing"
    ? copy.hashing
    : uploadProgress.phase === "finalizing"
      ? copy.finalizing
      : uploadPercent === null
        ? copy.uploading
        : `${copy.uploadingPercent}: ${uploadPercent}%`;
  const attention = data ? [
    ...data.comparisons
      .filter((item) => !["completed", "completed_partial"].includes(item.status))
      .map((item) => ({
        id: `comparison-${item.id}`,
        href: `${base}/documents/comparisons/${item.id}`,
        icon: FileDiff,
        title: `${item.versionOneName} ↔ ${item.versionTwoName}`,
        detail: item.status === "failed"
          ? copy.comparisonFailed
          : copy.comparisonProcessing,
        time: item.updatedAt,
        importance: item.status === "failed" ? "high" : "medium",
      })),
    ...data.analyses
      .filter((item) => item.status !== "completed")
      .map((item) => ({
        id: `analysis-${item.id}`,
        href: `${base}/document-review?analysis=${encodeURIComponent(item.id)}`,
        icon: Upload,
        title: item.fileName,
        detail: item.status === "awaiting_ai_configuration"
          ? copy.analysisAwaiting
          : copy.analysisIncomplete,
        time: item.updatedAt,
        importance: item.errorCode ? "high" : "medium",
      })),
    ...data.deadlines.map((item) => ({
      id: `deadline-${item.id}`,
      href: `${base}/action-plan/${item.caseId}`,
      icon: CalendarClock,
      title: item.title,
      detail: item.caseTitle,
      time: item.dueAt,
      importance: new Date(item.dueAt).getTime() < new Date(data.serverNow).getTime() + 3 * 86_400_000 ? "high" : "medium",
    })),
    ...data.notifications.slice(0, 3).map((item) => ({
      id: `notification-${item.id}`,
      href: `${base}/notifications`,
      icon: Bell,
      title: item.title,
      detail: item.body,
      time: item.createdAt,
      importance: "low",
    })),
  ].slice(0, 7) : [];
  const recent = data ? [
    ...data.cases.map((item) => ({
      id: `case-${item.id}`,
      href: `${base}/cases/${item.id}`,
      icon: BriefcaseBusiness,
      title: item.title,
      detail: `${item.status} · ${item.progressPercent ?? 0}%`,
      time: item.updatedAt,
    })),
    ...data.documents.map((item) => ({
      id: `document-${item.id}`,
      href: `${base}/documents/${item.id}`,
      icon: Files,
      title: item.title,
      detail: `${item.category} · ${item.status}`,
      time: item.updatedAt,
    })),
  ].sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 7) : [];
  return (
    <div className="dashboard-command">
      <section className="dashboard-command-hero">
        <div className="dashboard-command-intro">
          <div className="dashboard-command-context">
            {accountType === "business" ? <BriefcaseBusiness /> : <ShieldCheck />}
            <span>{accountType === "business" ? copy.contextBusiness : copy.contextPersonal}</span>
          </div>
          <p>{userName ? `${copy.greeting}, ${userName}` : copy.greeting}</p>
          <h1>{copy.question}</h1>
          <form className="dashboard-command-form" onSubmit={startTask}>
            <label className="sr-only" htmlFor="dashboard-legal-task">{copy.prompt}</label>
            <Sparkles aria-hidden="true" />
            <textarea
              id="dashboard-legal-task"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              disabled={submitting}
              placeholder={copy.prompt}
              rows={2}
              maxLength={4_000}
            />
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,.docx,.jpg,.jpeg,.png,.zip,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,application/zip"
              onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
              hidden
            />
            <button
              type="button"
              className="dashboard-attach"
              disabled={submitting}
              onClick={() => fileInputRef.current?.click()}
              aria-label={copy.attach}
            >
              <Paperclip />
            </button>
            <Link className="dashboard-voice-action" href={`${base}/ai-lawyer/voice`} aria-label={copy.voiceMode}>
              <Mic aria-hidden="true" />
            </Link>
            <button className="dashboard-start" disabled={submitting || (!prompt.trim() && !file) || Boolean(file && !consent)}>
              {submitting ? <LoaderCircle className="spin" /> : <Send />}
              <span>{copy.send}</span>
            </button>
            {file && (
              <div className="dashboard-file-chip">
                <Files />
                <span><strong>{file.name}</strong><small>{(file.size / 1024 / 1024).toFixed(2)} MB</small></span>
                <button type="button" disabled={submitting} onClick={() => { chooseFile(null); if (fileInputRef.current) fileInputRef.current.value = ""; }} aria-label={copy.removeFile}><X /></button>
              </div>
            )}
            {file && (
              <label className="dashboard-upload-consent">
                <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
                <span>{copy.consent}</span>
              </label>
            )}
            {uploadProgress && <><div className="dashboard-upload-progress" role="progressbar" aria-label={copy.uploadProgress} aria-valuemin={0} aria-valuemax={100} aria-valuenow={uploadPercent ?? undefined} aria-valuetext={uploadStatus}><span style={{ transform: `scaleX(${uploadPercent === null ? .08 : Math.max(.08, uploadPercent / 100)})` }} /></div><p className="dashboard-upload-status" role="status" aria-live="polite">{uploadStatus}</p></>}
          </form>
        </div>
      </section>

      {error && (
        <div className="dashboard-command-error" role="alert">
          <CircleAlert />
          <span>{error}</span>
          <button onClick={() => { setLoading(true); void load(); }}>{copy.retry}</button>
        </div>
      )}

      <section className="dashboard-quick">
        <div className="dashboard-section-heading"><h2>{copy.quickTitle}</h2></div>
        <div className="dashboard-quick-grid">
          {quickActions.map(({ href, icon: Icon, copy: item }) => (
            <Link
              href={href}
              key={href}
              onFocus={(event) => event.currentTarget.scrollIntoView({
                block: "nearest",
                inline: "nearest",
              })}
            >
              <span className="dashboard-action-icon"><Icon /></span>
              <span><strong>{item.title}</strong><small>{item.description}</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          ))}
        </div>
      </section>

      <section className="dashboard-continuation">
        <div className="dashboard-section-heading">
          <div className="dashboard-section-title-row">
            <h2>{copy.continueTitle}</h2>
            <button type="button" onClick={() => { setLoading(true); void load(); }} disabled={loading} aria-label={copy.refresh}>
              <RotateCcw className={loading ? "spin" : ""} />
              <span>{copy.refresh}</span>
            </button>
          </div>
        </div>
        {loading && !data ? (
          <div className="dashboard-command-loading" role="status"><LoaderCircle className="spin" /><span>{copy.loadingContext}</span></div>
        ) : data ? (
          <div className="dashboard-continuation-grid">
            <section className="dashboard-work-list">
              <header><span><Files /></span><div><h3>{copy.recentTitle}</h3><p>{copy.recentDescription}</p></div></header>
              {recent.length ? recent.map((item) => (
                <Link href={item.href} key={item.id}>
                  <item.icon />
                  <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                  <time>{formatDateTime(item.time, locale)}</time>
                  <ArrowRight />
                </Link>
              )) : <DashboardEmpty text={copy.emptyRecent} />}
            </section>
            <section className="dashboard-work-list">
              <header><span><CircleAlert /></span><div><h3>{copy.attentionTitle}</h3><p>{copy.attentionDescription}</p></div></header>
              {attention.length ? attention.map((item) => (
                <Link href={item.href} key={item.id} data-importance={item.importance}>
                  <item.icon />
                  <span><strong>{item.title}</strong><small>{item.detail}</small></span>
                  <time>{formatDateTime(item.time, locale)}</time>
                  <ArrowRight />
                </Link>
              )) : <DashboardEmpty text={copy.emptyAttention} />}
            </section>
          </div>
        ) : null}
      </section>


    </div>
  );
}

function DashboardEmpty({ text }: { text: string }) {
  return <div className="dashboard-list-empty"><CheckCircle2 /><p>{text}</p></div>;
}

function formatDateTime(value: string, locale: PlatformLocale) {
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
}
