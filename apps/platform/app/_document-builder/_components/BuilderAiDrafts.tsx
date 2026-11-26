"use client";

import { FilePenLine, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlatformLocale } from "../../../lib/platform/routing";

type DraftHistory = {
  remaining: number;
  readOnly: boolean;
  assignment: { id: string; pages: number; expiry: string; included: number } | null;
  revisions: { id: string; draft: string; createdAt: string }[];
};

export function BuilderAiDrafts({ id, locale, apply }: { id: string; locale: PlatformLocale; apply: (draft: string) => void }) {
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<DraftHistory>();
  const [instruction, setInstruction] = useState("");
  const [pages, setPages] = useState(10);
  const [newAssignment, setNewAssignment] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [generation, setGeneration] = useState(0);
  const endpoint = `/api/document-builder/documents/${encodeURIComponent(id)}/ai-drafts`;
  const t = (ru: string, uz: string, en: string) => ({ ru, uz, en })[locale];
  const assignment = newAssignment ? null : history?.assignment;
  const units = assignment?.included && pages <= assignment.pages ? 0 : Math.ceil(pages / 10);
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "Asia/Tashkent" });
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as DraftHistory;
      if (!controller.signal.aborted) setHistory(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError(({ ru: "История недоступна.", uz: "Tarixni yuklab bo‘lmadi.", en: "Draft history is unavailable." })[locale]);
    });
    return () => controller.abort();
  }, [endpoint, generation, locale, open]);

  async function generate() {
    if (!history || instruction.trim().length < 6 || !Number.isInteger(pages) || pages < 1 || pages > 40) return;
    setError("");
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ operationId: crypto.randomUUID(), assignmentId: assignment?.id ?? null, instruction, pages, units }),
      });
      const data = await response.json() as { draft?: string; code?: string };
      if (!response.ok || !data.draft) {
        throw new Error(data.code === "PLAN_LIMIT"
          ? t("Лимит ИИ-подготовки исчерпан.", "AI loyihalari limiti tugadi.", "The AI draft allowance is exhausted.")
          : data.code === "DRAFT_QUOTE_CHANGED"
            ? t("Лимит или условия изменились. Проверьте расчёт.", "Limit yoki shartlar o‘zgardi.", "The allowance or revision terms changed. Check the updated quote.")
            : t("Не удалось подготовить проект.", "Qoralama tayyorlanmadi.", "We could not prepare the draft."));
      }
      setDraft(data.draft);
      setInstruction("");
      setNewAssignment(false);
    } catch (value) { setError(value instanceof Error ? value.message : String(value)); }
    finally { setBusy(false); setGeneration(value => value + 1); }
  }

  return <details className="dbt-config-editor" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="juro-disclosure-summary">{t("Подготовка с ИИ", "AI yordamida tayyorlash", "Draft with AI")}</summary>
    {error && <p role="alert">{error}</p>}
    {!history ? <p role="status">{t("Загружаем условия подготовки…", "Tayyorlash shartlari yuklanmoqda…", "Loading draft allowance…")}</p> : <>
      <p>{t(`Осталось подготовок: ${history.remaining}`, `Qolgan birliklar: ${history.remaining}`, `Draft units remaining: ${history.remaining}`)}</p>
      {history.assignment && <p>{t(
        `Включённых правок осталось: ${history.assignment.included}, до ${date.format(new Date(history.assignment.expiry))}`,
        `Kiritilgan tahrirlar: ${history.assignment.included}, ${date.format(new Date(history.assignment.expiry))} gacha`,
        `Included revisions: ${history.assignment.included}, until ${date.format(new Date(history.assignment.expiry))}`,
      )}</p>}
      {!history.readOnly && <div className="dbt-ai-draft-fields">
        {history.assignment && <label><input type="checkbox" checked={newAssignment} onChange={event => setNewAssignment(event.target.checked)} /> {t("Начать новое задание", "Yangi topshiriq boshlash", "Start a new assignment")}</label>}
        <label>{t("Что подготовить или изменить", "Nimani tayyorlash yoki o‘zgartirish kerak", "What to draft or revise")}
          <textarea rows={4} maxLength={8_000} value={instruction} onChange={event => setInstruction(event.target.value)} />
        </label>
        <label>{t("Не более учётных страниц", "Eng ko‘p hisob sahifalari", "Maximum accounting pages")}
          <input type="number" min={1} max={40} value={Number.isNaN(pages) ? "" : pages} onChange={event => setPages(event.target.valueAsNumber)} />
        </label>
        <button type="button" disabled={busy || instruction.trim().length < 6 || !Number.isInteger(pages) || pages < 1 || pages > 40 || units > history.remaining} onClick={() => void generate()}>
          {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <FilePenLine aria-hidden="true" />}
          {units === 0 ? t("Подготовить включённую правку", "Kiritilgan tahrirni tayyorlash", "Generate included revision") :
            t(`Подготовить · ${units} ед.`, `Tayyorlash · ${units} birlik`, `Generate · ${units} units`)}
        </button>
      </div>}
      {history.revisions.length > 0 && <label>{t("История проектов", "Qoralamalar tarixi", "Draft history")}
        <select defaultValue="" onChange={event => setDraft(history.revisions.find(revision => revision.id === event.target.value)?.draft ?? "")}>
          <option value="">{t("Выберите проект", "Qoralamani tanlang", "Choose a draft")}</option>
          {history.revisions.map((revision, index) => <option key={revision.id} value={revision.id}>
            {date.format(new Date(revision.createdAt))} · {history.revisions.length - index}
          </option>)}
        </select>
      </label>}
      {draft && <div className="dbt-ai-draft-fields"><textarea aria-label={t("Проект", "Qoralama", "Draft")} rows={14} value={draft} readOnly />
        {!history.readOnly && <button type="button" onClick={() => apply(draft)}>{t("Вставить в редактор", "Muharrirga joylash", "Apply to editor")}</button>}
      </div>}
    </>}
  </details>;
}
