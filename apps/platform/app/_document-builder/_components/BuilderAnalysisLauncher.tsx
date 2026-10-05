"use client";

import { Select } from "../../_components/Select";

import { FileSearch, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

import type { BuilderLanguage } from "../../../lib/document-builder/registry/engine";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderError } from "../builder-localization";
import { ApiClientError, apiFetch } from "./api-client";

type Mode = "quick" | "full" | "expert";

const analysisCopy = {
  ru: { failed: "Анализ не запущен.", title: "Проверить текущую версию с AI-юристом JURO", description: "Сохраним неизменяемый снимок этой ревизии и откроем риски, источники и предлагаемые формулировки.", depth: "Глубина", quick: "Быстро — основные риски", full: "Полно — по разделам", expert: "Экспертно — с редакцией", saving: "Сохраняем снимок…", start: "Начать анализ", status: "Сохраняем текущую ревизию и ставим анализ в очередь." },
  uz: { failed: "Tahlil boshlanmadi.", title: "Joriy nusxani JURO AI-yuristi bilan tekshirish", description: "Ushbu tahrirning o‘zgarmas nusxasini saqlab, xavflar, manbalar va tavsiya etilgan matnlarni ochamiz.", depth: "Tahlil darajasi", quick: "Tez — asosiy xavflar", full: "To‘liq — bo‘limlar bo‘yicha", expert: "Ekspert — tahrir bilan", saving: "Nusxa saqlanmoqda…", start: "Tahlilni boshlash", status: "Joriy tahrir saqlanib, tahlil navbatga qo‘yilmoqda." },
  en: { failed: "The analysis could not be started.", title: "Review this version with the JURO AI legal assistant", description: "JURO will preserve an immutable snapshot of this revision before opening risks, sources and suggested wording.", depth: "Review depth", quick: "Quick — key risks", full: "Full — section by section", expert: "Expert — includes suggested edits", saving: "Saving snapshot…", start: "Start analysis", status: "Saving the current revision and adding the analysis to the queue." },
} as const;

export function BuilderAnalysisLauncher({
  documentLocale,
  uiLocale,
  reviewPath,
  onPrepare,
}: {
  documentLocale: BuilderLanguage;
  uiLocale: PlatformLocale;
  reviewPath: string;
  onPrepare: () => Promise<string>;
}) {
  const copy = analysisCopy[uiLocale];
  const [mode, setMode] = useState<Mode>("quick");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const idempotencyKey = useRef<string | null>(null);
  const busyRef = useRef(false);

  async function start() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const documentId = await onPrepare();
      idempotencyKey.current ??= `builder-analysis-${crypto.randomUUID()}`;
      const result = await apiFetch<{ analysisId: string }>(
        `/api/document-builder/documents/${encodeURIComponent(documentId)}/analysis`,
        {
          method: "POST",
          headers: { "idempotency-key": idempotencyKey.current, "x-juro-locale": uiLocale },
          body: JSON.stringify({ mode, locale: documentLocale }),
        },
      );
      idempotencyKey.current = null;
      const separator = reviewPath.includes("?") ? "&" : "?";
      window.location.assign(`${reviewPath}${separator}analysisId=${encodeURIComponent(result.analysisId)}`);
    } catch (caught) {
      if (caught instanceof ApiClientError && caught.code === "BUILDER_ANALYSIS_IDEMPOTENCY_CONFLICT") {
        idempotencyKey.current = null;
      }
      setError(builderError(uiLocale, caught, copy.failed));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return <section className="dbt-builder-analysis" aria-labelledby="builder-analysis-title">
    <div>
      <FileSearch aria-hidden="true" />
      <span><strong id="builder-analysis-title">{copy.title}</strong><small>{copy.description}</small></span>
    </div>
    <label><span>{copy.depth}</span><Select value={mode} onChange={(event) => setMode(event.target.value as Mode)} disabled={busy}><option value="quick">{copy.quick}</option><option value="full">{copy.full}</option><option value="expert">{copy.expert}</option></Select></label>
    <button type="button" onClick={() => void start()} disabled={busy} aria-busy={busy} aria-describedby="builder-analysis-status">{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <FileSearch aria-hidden="true" />}{busy ? copy.saving : copy.start}</button>
    <p id="builder-analysis-status" className={`dbt-builder-analysis-status${error ? " error" : ""}`} aria-live="polite">{error || (busy ? copy.status : "")}</p>
  </section>;
}
