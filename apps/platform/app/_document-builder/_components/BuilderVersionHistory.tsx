"use client";

/* eslint-disable react-hooks/set-state-in-effect -- the owner-only remote version list intentionally loads when its document identity changes */

import { Check, Clock3, History, LoaderCircle, RotateCcw, Save } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { formatPlatformDateTime } from "../../../lib/platform/date-time";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderError } from "../builder-localization";
import { apiFetch } from "./api-client";
import { BuilderToolDialog } from "./BuilderToolDialog";

type Version = { id: string; version: number; documentRevision: number; source: string; status: "pending" | "ready"; attemptCount: number; lastErrorCode: string | null; sizeBytes: number; sha256: string; createdAt: string };

const sourceLabels: Record<PlatformLocale, Record<string, string>> = {
  ru: { user_checkpoint: "Сохранено вручную", restore_checkpoint: "После восстановления", analysis_correction: "Правка анализа", suggestion: "Предложение", review: "На проверку", approval: "Согласование", signature: "Подписание", finalize: "Финальная версия" },
  uz: { user_checkpoint: "Qo‘lda saqlandi", restore_checkpoint: "Tiklashdan keyin", analysis_correction: "Tahlil tuzatishi", suggestion: "Taklif", review: "Tekshiruvga", approval: "Kelishuv", signature: "Imzolash", finalize: "Yakuniy versiya" },
  en: { user_checkpoint: "Saved manually", restore_checkpoint: "After restoration", analysis_correction: "Analysis correction", suggestion: "Suggestion", review: "Sent for review", approval: "Approval", signature: "Signature", finalize: "Final version" },
};

const versionCopy = {
  ru: { title: "История версий", description: "Сохраните важное состояние как неизменяемый снимок и восстановите его при необходимости.", save: "Сохранить версию", empty: "Сохранённых версий пока нет.", restore: "Восстановить", confirm: "Восстановить текст и ответы выбранной версии? Текущее состояние останется в журнале ревизий.", confirmTitle: "Восстановить версию", cancel: "Отмена", confirmAction: "Восстановить", saved: "Версия безопасно сохранена.", restored: "Версия восстановлена.", pending: "Сохраняется", loadError: "Не удалось загрузить версии.", saveError: "Не удалось сохранить версию.", restoreError: "Не удалось восстановить версию." },
  uz: { title: "Versiyalar tarixi", description: "Muhim holatni o‘zgarmas nusxa sifatida saqlang va kerak bo‘lsa tiklang.", save: "Versiyani saqlash", empty: "Saqlangan versiyalar hozircha yo‘q.", restore: "Tiklash", confirm: "Tanlangan versiya matni va javoblarini tiklaysizmi? Hozirgi holat reviziyalar jurnalida qoladi.", confirmTitle: "Versiyani tiklash", cancel: "Bekor qilish", confirmAction: "Tiklash", saved: "Versiya xavfsiz saqlandi.", restored: "Versiya tiklandi.", pending: "Saqlanmoqda", loadError: "Versiyalarni yuklab bo‘lmadi.", saveError: "Versiyani saqlab bo‘lmadi.", restoreError: "Versiyani tiklab bo‘lmadi." },
  en: { title: "Version history", description: "Save an important state as an immutable snapshot and restore it when needed.", save: "Save version", empty: "No saved versions yet.", restore: "Restore", confirm: "Restore the text and answers from this version? The current state will remain in the revision log.", confirmTitle: "Restore version", cancel: "Cancel", confirmAction: "Restore", saved: "Version saved securely.", restored: "Version restored.", pending: "Saving", loadError: "We could not load version history.", saveError: "We could not save this version.", restoreError: "We could not restore this version." },
} as const;

type HistoryProps = {
  documentId: string;
  locale: PlatformLocale;
  refreshKey?: number;
  onPrepare: () => Promise<{ documentId: string; revision: number }>;
  onRestored: () => Promise<void>;
};

export function BuilderVersionHistory(props: HistoryProps) {
  return <BuilderToolDialog icon={History} locale={props.locale} label={versionCopy[props.locale].title}>
    {() => <VersionHistoryContent {...props} />}
  </BuilderToolDialog>;
}

function VersionHistoryContent({
  documentId,
  locale,
  refreshKey,
  onPrepare,
  onRestored,
}: HistoryProps) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [restoreCandidate, setRestoreCandidate] = useState<Version | null>(null);
  const restoreDialogRef = useRef<HTMLDialogElement>(null);
  const copy = versionCopy[locale];

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<{ versions: Version[] }>(`/api/document-builder/documents/${documentId}/versions`);
      setVersions(result.versions);
      setError("");
    } catch (caught) {
      setError(builderError(locale, caught, copy.loadError));
    } finally {
      setLoading(false);
    }
  }, [copy.loadError, documentId, locale]);

  useEffect(() => { void load(); }, [load, refreshKey]);
  useEffect(() => {
    const dialog = restoreDialogRef.current;
    if (restoreCandidate && dialog && !dialog.open) dialog.showModal();
  }, [restoreCandidate]);

  const saveVersion = async () => {
    setBusy("save"); setMessage(""); setError("");
    try {
      const prepared = await onPrepare();
      await apiFetch(`/api/document-builder/documents/${prepared.documentId}/versions`, { method: "POST", headers: { "idempotency-key": `builder-version-${prepared.documentId}-${crypto.randomUUID()}` }, body: JSON.stringify({ revision: prepared.revision }) });
      setMessage(copy.saved);
      await load();
    } catch (caught) {
      setError(builderError(locale, caught, copy.saveError));
    } finally {
      setBusy(null);
    }
  };
  const restore = async (version: Version) => {
    setBusy(version.id); setMessage(""); setError("");
    try {
      const prepared = await onPrepare();
      await apiFetch(`/api/document-builder/documents/${prepared.documentId}/versions/${version.id}/restore`, { method: "POST", headers: { "idempotency-key": `builder-restore-${prepared.documentId}-${version.id}-${crypto.randomUUID()}` }, body: JSON.stringify({ revision: prepared.revision }) });
      await onRestored();
      setMessage(copy.restored);
      await load();
    } catch (caught) {
      setError(builderError(locale, caught, copy.restoreError));
    } finally {
      setBusy(null);
    }
  };

  return <section className="dbt-versions">
    <header><p>{copy.description}</p><button type="button" onClick={() => void saveVersion()} disabled={Boolean(busy)}>{busy === "save" ? <LoaderCircle className="spin" size={16}/> : <Save size={16}/>}<span>{copy.save}</span></button></header>
    <div className="dbt-version-status" aria-live="polite">{message && <span className="success"><Check size={15}/>{message}</span>}{error && <span className="error" role="alert">{error}</span>}</div>
    {loading ? <div className="dbt-version-loading"><LoaderCircle className="spin" size={18}/></div> : versions.length === 0 ? <p className="dbt-version-empty">{copy.empty}</p> : <ol className="dbt-version-list">{versions.map((version) => <li key={version.id}><div><strong>v{version.version}</strong><span>{sourceLabels[locale][version.source] ?? version.source.replaceAll("_", " ")}</span><small><Clock3 size={13}/>{formatPlatformDateTime(version.createdAt, locale)} · r{version.documentRevision}</small></div>{version.status === "ready" ? <button type="button" onClick={() => setRestoreCandidate(version)} disabled={Boolean(busy)}>{busy === version.id ? <LoaderCircle className="spin" size={15}/> : <RotateCcw size={15}/>} {copy.restore}</button> : <span className="pending"><LoaderCircle className="spin" size={14}/>{copy.pending}</span>}</li>)}</ol>}
    {restoreCandidate && <dialog ref={restoreDialogRef} className="dbt-version-confirm-dialog" aria-labelledby={`restore-version-title-${restoreCandidate.id}`} onCancel={(event) => { event.preventDefault(); restoreDialogRef.current?.close(); setRestoreCandidate(null); }} onClose={() => setRestoreCandidate(null)}><h3 id={`restore-version-title-${restoreCandidate.id}`}>{copy.confirmTitle}</h3><p>{copy.confirm}</p><div><button type="button" onClick={() => { restoreDialogRef.current?.close(); setRestoreCandidate(null); }}>{copy.cancel}</button><button type="button" className="primary" onClick={() => { const selected = restoreCandidate; restoreDialogRef.current?.close(); setRestoreCandidate(null); void restore(selected); }}>{copy.confirmAction}</button></div></dialog>}
  </section>;
}
