"use client";

import { BrandImage } from "../../_components/BrandImage";

import { Pencil, RotateCcw, X } from "lucide-react";
import { useState } from "react";
import type { PreviewFieldRef, RenderedReceipt } from "../../../lib/document-builder/types";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { BuilderToolDialog } from "./BuilderToolDialog";
import { PreviewEditControl, type PreviewEditField } from "./PreviewEditControl";

export type PreviewEditing = {
  field: (ref: PreviewFieldRef) => PreviewEditField | undefined;
  wording?: (index: number, text: string) => void;
  reset: () => void;
};

const editCopy = {
  ru: { hint: "Нажмите выделенное поле, чтобы заполнить его. Данные обновятся и в анкете.", wording: "Изменить формулировку", reset: "Сбросить анкету и текст", confirm: "Вернуть шаблон к исходному состоянию? Введённые ответы и ручные правки в этом черновике будут сброшены.", cancel: "Отмена", resetAction: "Сбросить" },
  uz: { hint: "Ajratilgan maydonni bosing. Kiritilgan ma’lumot anketada ham yangilanadi.", wording: "Matnni tahrirlash", reset: "Anketa va matnni tiklash", confirm: "Andozaning dastlabki holatini tiklaysizmi? Ushbu qoralamadagi javoblar va qo‘lda kiritilgan tahrirlar o‘chiriladi.", cancel: "Bekor qilish", resetAction: "Tiklash" },
  en: { hint: "Select a highlighted field to update it here and in the form.", wording: "Edit paragraph wording", reset: "Reset form and text", confirm: "Restore the template defaults? The answers and wording changes in this draft will be cleared.", cancel: "Cancel", resetAction: "Reset" },
} as const;

export function DocumentPreview({ document, locale = "ru", mobileOpen = false, onClose, example = false, editing }: {
  document: RenderedReceipt; locale?: PlatformLocale; mobileOpen?: boolean; onClose?: () => void; example?: boolean; editing?: PreviewEditing;
}) {
  const copy = {
    ru: { exampleLabel: "Пример готового документа", previewLabel: "Предварительный просмотр документа", example: "Полный пример", preview: "Предпросмотр", automatic: "A4 · обновляется автоматически", close: "Закрыть предпросмотр", ribbon: "Пример — не документ пользователя", created: "Создано в JURO", page: "Страница" },
    uz: { exampleLabel: "Tayyor hujjat namunasi", previewLabel: "Hujjatni oldindan ko‘rish", example: "To‘liq namuna", preview: "Oldindan ko‘rish", automatic: "A4 · avtomatik yangilanadi", close: "Ko‘rib chiqishni yopish", ribbon: "Namuna — foydalanuvchi hujjati emas", created: "JURO’da yaratilgan", page: "Sahifa" },
    en: { exampleLabel: "Example of a completed document", previewLabel: "Document preview", example: "Full example", preview: "Preview", automatic: "A4 · updates automatically", close: "Close preview", ribbon: "Example — not a user document", created: "Created in JURO", page: "Page" },
  }[locale];
  const editor = editCopy[locale];
  return <aside className={`dbt-preview ${mobileOpen ? "mobile-open" : ""}${editing ? " dbt-preview-editable" : ""}`} aria-label={example ? copy.exampleLabel : copy.previewLabel}>
    <div className="dbt-preview-toolbar">
      <div><strong>{example ? copy.example : copy.preview}</strong><span>{editing ? editor.hint : copy.automatic}</span></div>
      <div className="dbt-preview-actions">
        {editing && <BuilderToolDialog icon={RotateCcw} label={editor.reset} locale={locale}>
          {close => <div className="dbt-preview-reset">
            <p>{editor.confirm}</p>
            <div>
              <button type="button" className="dbt-tool-button" onClick={close}>{editor.cancel}</button>
              <button type="button" className="dbt-tool-button primary" onClick={() => { close(); editing.reset(); }}>{editor.resetAction}</button>
            </div>
          </div>}
        </BuilderToolDialog>}
        {onClose && <button type="button" className="dbt-preview-close" onClick={onClose} aria-label={copy.close}><X size={20}/></button>}
      </div>
    </div>
    <div className="dbt-preview-scroll">
      <DocumentPaper document={document} locale={locale} ribbon={example ? copy.ribbon : undefined} editing={editing}/>
    </div>
  </aside>;
}

function DocumentPaper({ document, locale, ribbon, editing }: {
  document: RenderedReceipt; locale: PlatformLocale; ribbon?: string; editing?: PreviewEditing;
}) {
  const labels = {
    ru: { created: "Создано в JURO", page: "Страница" },
    uz: { created: "JURO’da yaratilgan", page: "Sahifa" },
    en: { created: "Created in JURO", page: "Page" },
  }[locale];
  const [selection, setSelection] = useState<{ paragraph: number; part?: number; text: string }>();
  const labelsEditing = editCopy[locale];
  const close = () => setSelection(undefined);
  const current = selection?.text === document.plainText ? selection : undefined;
  return <article className="dbt-a4">
    {ribbon && <div className="dbt-example-ribbon">{ribbon}</div>}
    {document.paragraphs.map((paragraph, paragraphIndex) => paragraph.kind === "spacer"
      ? <div className="dbt-doc-spacer" key={paragraph.id}/>
      : <div className="dbt-preview-paragraph" key={paragraph.id}>
        {current?.paragraph === paragraphIndex && current.part === undefined && editing?.wording
          ? <PreviewEditControl field={{ label: labelsEditing.wording, type: "multiline", value: paragraph.text, maxLength: 500_000, validate: text => document.plainText.length - paragraph.text.length + text.length <= 500_000, commit: text => editing.wording?.(paragraphIndex, text) }} locale={locale} finish={close}/>
          : <p id={paragraph.id} className={`dbt-doc-${paragraph.kind}`}>
            {paragraph.kind === "list" && <span aria-hidden="true">• </span>}
            {editing && paragraph.parts ? paragraph.parts.map((part, partIndex) => {
              const field = part.field && editing.field(part.field);
              if (!field) return part.text;
              return current?.paragraph === paragraphIndex && current.part === partIndex
                ? <PreviewEditControl key={partIndex} field={field} locale={locale} finish={close}/>
                : <button type="button" key={partIndex} className="dbt-preview-slot" data-empty={!field.value}
                    title={field.label} aria-label={`${field.label}${field.value ? ` · ${part.text}` : ""}`}
                    onClick={() => setSelection({ paragraph: paragraphIndex, part: partIndex, text: document.plainText })}>{part.text}</button>;
            }) : paragraph.text}
          </p>}
        {editing?.wording && current?.paragraph !== paragraphIndex && <button type="button" className="dbt-preview-wording" aria-label={labelsEditing.wording} title={labelsEditing.wording}
          onClick={() => setSelection({ paragraph: paragraphIndex, text: document.plainText })}><Pencil size={13}/></button>}
      </div>)}
    <footer><BrandImage mark tone="light" alt="" width={18} height={18}/><span>{labels.created}</span><span>{labels.page} 1 / ~{Math.max(1, Math.ceil(document.plainText.length / 3_500))}</span></footer>
  </article>;
}
