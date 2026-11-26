"use client";

import { FilePenLine, FileText, LoaderCircle, Sparkles } from "lucide-react";
import { useEffect, useState } from "react";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { Select } from "../../_components/Select";
import { BuilderToolDialog } from "./BuilderToolDialog";

type DraftHistory = {
  remaining: number;
  readOnly: boolean;
  assignment: { id: string; pages: number; expiry: string; included: number } | null;
  revisions: { id: string; draft: string; createdAt: string }[];
};

type DraftProps = { id: string; locale: PlatformLocale; prepare: () => Promise<number>; apply: (draft: string) => void };

export function BuilderAiDrafts({ id, locale, prepare, apply }: DraftProps) {
  const label = { ru: "Подготовка с ИИ", uz: "AI yordamida tayyorlash", en: "Draft with AI" }[locale];
  return <BuilderToolDialog icon={Sparkles} locale={locale} label={label}>
    {close => <AiDraftContent id={id} locale={locale} prepare={prepare} apply={draft => { apply(draft); close(); }} />}
  </BuilderToolDialog>;
}

function AiDraftContent({ id, locale, prepare, apply }: DraftProps) {
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
    const controller = new AbortController();
    void fetch(endpoint, { cache: "no-store", signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const data = await response.json() as DraftHistory;
      if (!controller.signal.aborted) setHistory(data);
    }).catch(() => {
      if (!controller.signal.aborted) setError(({ ru: "История недоступна.", uz: "Tarixni yuklab bo‘lmadi.", en: "Draft history is unavailable." })[locale]);
    });
    return () => controller.abort();
  }, [endpoint, generation, locale]);

  async function generate() {
    if (!history || instruction.trim().length < 6 || !Number.isInteger(pages) || pages < 1 || pages > 40) return;
    setError("");
    setBusy(true);
    try {
      const revision = assignment ? undefined : await prepare();
      const response = await fetch(endpoint, {
        method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ operationId: crypto.randomUUID(), assignmentId: assignment?.id ?? null, instruction, pages, units, revision }),
      });
      const data = await response.json() as { draft?: string; code?: string };
      if (!response.ok || !data.draft) {
        throw new Error(data.code === "PLAN_LIMIT"
          ? t("Лимит ИИ-подготовки исчерпан.", "AI loyihalari limiti tugadi.", "The AI draft allowance is exhausted.")
          : data.code === "REVISION_CONFLICT"
            ? t("Откройте актуальную версию документа и повторите запрос.", "Hujjatning so‘nggi versiyasini oching va qayta urinib ko‘ring.", "Load the latest document version and try again.")
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

  return <div className="dbt-ai-draft">
    {error && <p className="dbt-form-error" role="alert">{error}</p>}
    {!history ? !error && <p role="status">{t("Загружаем условия подготовки…", "Tayyorlash shartlari yuklanmoqda…", "Loading draft allowance…")}</p> : <>
      <div className="dbt-ai-allowance"><Sparkles size={17} aria-hidden="true" />{t(`Осталось подготовок: ${history.remaining}`, `Qolgan birliklar: ${history.remaining}`, `Draft units remaining: ${history.remaining}`)}</div>
      {history.assignment && <p>{t(
        `Включённых правок осталось: ${history.assignment.included}, до ${date.format(new Date(history.assignment.expiry))}`,
        `Kiritilgan tahrirlar: ${history.assignment.included}, ${date.format(new Date(history.assignment.expiry))} gacha`,
        `Included revisions: ${history.assignment.included}, until ${date.format(new Date(history.assignment.expiry))}`,
      )}</p>}
      {!history.readOnly && <form className="dbt-ai-draft-fields" onSubmit={event => { event.preventDefault(); void generate(); }}>
        {history.assignment && <label className="dbt-field">{t("Основа для подготовки", "Tayyorlash uchun asos", "Draft source")}
          <Select value={newAssignment ? "document" : "previous"} onChange={event => setNewAssignment(event.target.value === "document")} disabled={busy}
            aria-label={t("Основа для подготовки", "Tayyorlash uchun asos", "Draft source")}>
            <option value="previous">{t("Последний проект ИИ", "Oxirgi AI qoralamasi", "Last AI draft")}</option>
            <option value="document">{t("Текущий документ", "Joriy hujjat", "Current document")}</option>
          </Select>
        </label>}
        <div className="dbt-ai-source"><FileText size={20} aria-hidden="true"/><div>
          <strong>{assignment ? t("Последний проект ИИ", "Oxirgi AI qoralamasi", "Last AI draft") : t("Текущий документ", "Joriy hujjat", "Current document")}</strong>
          <p>{assignment ? t(
            "ИИ использует текст последнего проекта из этого задания. Выберите текущий документ, чтобы учесть новые ответы анкеты и ручные правки.",
            "AI ushbu topshiriqdagi oxirgi qoralamadan foydalanadi. Yangi javob va qo‘lda kiritilgan o‘zgarishlarni hisobga olish uchun joriy hujjatni tanlang.",
            "AI uses the latest draft from this assignment. Choose the current document to include new form answers and manual edits.",
          ) : t(
            "ИИ использует текст текущего предпросмотра. В него уже входят данные из анкеты или ваша ручная редакция. Недостающие сведения останутся в виде полей для заполнения.",
            "AI joriy ko‘rib chiqishdagi matndan foydalanadi. Unda anketa javoblari yoki qo‘lda kiritilgan tahrir mavjud. Yetishmagan ma’lumotlar to‘ldirish uchun ochiq qoladi.",
            "AI uses the text in your current preview, including the details from your form or your manual wording. Missing details stay as placeholders.",
          )}</p>
        </div></div>
        <label className="dbt-field">{t("Что нужно изменить?", "Nimani o‘zgartirish kerak?", "What should AI change?")}
          <textarea rows={3} minLength={6} maxLength={8_000} value={instruction} disabled={busy} onChange={event => setInstruction(event.target.value)}
            placeholder={t("Например, упростить формулировки или добавить условие о сроке возврата.", "Masalan, matnni soddalashtiring yoki qaytarish muddati bandini qo‘shing.", "For example, simplify the wording or add a repayment deadline clause.")} />
        </label>
        <details className="dbt-ai-length">
          <summary className="juro-disclosure-summary">{t("Объём проекта", "Qoralama hajmi", "Draft length")}</summary>
          <label className="dbt-field">{t("Лимит страниц текста", "Matn sahifalari chegarasi", "Maximum text pages")}
            <input type="number" min={1} max={40} value={Number.isNaN(pages) ? "" : pages} disabled={busy} onChange={event => setPages(event.target.valueAsNumber)} />
            <small>{t("1 страница считается как 2 500 знаков. Каждые 10 страниц требуют 1 ед. подготовки.", "Har bir sahifa 2 500 belgi. Har 10 sahifa uchun 1 tayyorlash birligi sarflanadi.", "Each text page is 2,500 characters. Every 10 pages cost one draft unit.")}</small>
          </label>
        </details>
        <div className="dbt-ai-submit">
          <button type="submit" className="dbt-tool-button primary" disabled={busy || instruction.trim().length < 6 || !Number.isInteger(pages) || pages < 1 || pages > 40 || units > history.remaining}>
            {busy ? <LoaderCircle size={17} className="spin" aria-hidden="true" /> : <FilePenLine size={17} aria-hidden="true" />}
            {busy ? t("Готовим проект…", "Qoralama tayyorlanmoqda…", "Preparing draft…") : units === 0 ? t("Подготовить включённую правку", "Kiritilgan tahrirni tayyorlash", "Generate included revision") :
              t(`Подготовить · ${units} ед.`, `Tayyorlash · ${units} birlik`, `Generate · ${units} ${units === 1 ? "unit" : "units"}`)}
          </button>
          <small>{t("Сначала вы увидите проект. Изменения появятся в документе после вашего подтверждения.", "Avval qoralamani ko‘rasiz. O‘zgarishlar tasdiqlaganingizdan keyin hujjatga qo‘shiladi.", "Review the draft first, then choose whether to apply it to your document.")}</small>
        </div>
      </form>}
      {history.revisions.length > 0 && <label className="dbt-field">{t("История проектов", "Qoralamalar tarixi", "Draft history")}
        <Select aria-label={t("История проектов", "Qoralamalar tarixi", "Draft history")} defaultValue="" onChange={event => setDraft(history.revisions.find(revision => revision.id === event.target.value)?.draft ?? "")}>
          <option value="">{t("Выберите проект", "Qoralamani tanlang", "Choose a draft")}</option>
          {history.revisions.map((revision, index) => <option key={revision.id} value={revision.id}>
            {date.format(new Date(revision.createdAt))} · {history.revisions.length - index}
          </option>)}
        </Select>
      </label>}
      {draft && <div className="dbt-ai-draft-fields"><label className="dbt-field">{t("Проект", "Qoralama", "Draft")}<textarea rows={10} value={draft} readOnly /></label>
        {!history.readOnly && <button type="button" className="dbt-tool-button primary" onClick={() => apply(draft)}>{t("Вставить в редактор", "Muharrirga joylash", "Apply to editor")}</button>}
      </div>}
    </>}
  </div>;
}
