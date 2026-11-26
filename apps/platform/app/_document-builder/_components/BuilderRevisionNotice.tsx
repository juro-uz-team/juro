"use client";

import { useEffect, useState } from "react";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { apiFetch } from "./api-client";

export function BuilderRevisionNotice({ documentId, revision, conflict, locale, reload }: {
  documentId: string;
  revision: number;
  conflict: boolean;
  locale: PlatformLocale;
  reload: () => Promise<void>;
}) {
  const [remoteRevision, setRemoteRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = {
    ru: { message: "Доступна новая версия. При загрузке несохранённые правки будут заменены.", reload: "Загрузить версию с сервера", failed: "Не удалось загрузить версию." },
    uz: { message: "Yangi versiya bor. Yuklasangiz, saqlanmagan o‘zgarishlar almashtiriladi.", reload: "Serverdagi versiyani yuklash", failed: "Versiyani yuklab bo‘lmadi." },
    en: { message: "A newer version is available. Loading it will replace unsaved edits.", reload: "Load server version", failed: "Could not load the latest version." },
  }[locale];
  useEffect(() => {
    const controller = new AbortController();
    let timer: number;
    const check = async () => {
      if (!document.hidden) {
        const remote = await apiFetch<{ revision: number }>(`/api/document-builder/documents/${documentId}?revisionOnly=1`, { cache: "no-store", signal: controller.signal }).catch(() => null);
        if (remote && !controller.signal.aborted) setRemoteRevision(remote.revision);
      }
      if (!controller.signal.aborted) timer = window.setTimeout(check, 5_000);
    };
    timer = window.setTimeout(check, 5_000);
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [documentId]);

  if (!conflict && remoteRevision <= revision) return null;
  return <div className="dbt-collab-notice">
    <p role="status">{copy.message}</p>
    <button type="button" className="dbt-tool-button" disabled={busy} onClick={async () => {
      setBusy(true); setFailed(false);
      try { await reload(); } catch { setFailed(true); } finally { setBusy(false); }
    }}>{copy.reload}</button>
    {failed && <p role="alert">{copy.failed}</p>}
  </div>;
}
