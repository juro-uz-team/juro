"use client";

import { Redo2, RotateCcw, Undo2 } from "lucide-react";
import { useState } from "react";
import type { RenderedReceipt } from "../../../lib/document-builder/types";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderText } from "../builder-localization";
import { DocumentPaper } from "./DocumentPreview";

export function ManualEditor({
  value,
  document,
  onChange,
  onUndo,
  onRedo,
  onReset,
  canUndo,
  canRedo,
  locked = false,
  locale = "ru",
}: {
  value: string;
  document: RenderedReceipt;
  onChange: (value: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onReset: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  locked?: boolean;
  locale?: PlatformLocale;
}) {
  const copy = builderText(locale, {
    ru: {
      text: "Текст",
      preview: "Предпросмотр",
      subtitle: "Изменения сохраняются автоматически. Предпросмотр показывает структуру будущего файла.",
      undo: "Отменить",
      redo: "Повторить",
      reset: "Вернуть исходный текст",
      locked: "Ручное редактирование полного текста доступно после входа.",
      editor: "Редактор полного текста документа",
    },
    uz: {
      text: "Matn",
      preview: "Ko‘rib chiqish",
      subtitle: "O‘zgarishlar avtomatik saqlanadi. Ko‘rib chiqishda faylning tuzilishi aks etadi.",
      undo: "Bekor qilish",
      redo: "Qaytarish",
      reset: "Dastlabki matnni tiklash",
      locked: "To‘liq matnni qo‘lda tahrirlash tizimga kirgandan keyin mavjud.",
      editor: "Hujjatning to‘liq matn muharriri",
    },
    en: {
      text: "Text",
      preview: "Preview",
      subtitle: "Edits save automatically. The preview shows the structure of the exported document.",
      undo: "Undo",
      redo: "Redo",
      reset: "Restore original text",
      locked: "Sign in to edit the full document text manually.",
      editor: "Full document text editor",
    },
  });

  const [view, setView] = useState<"text" | "preview">("text");
  if (locked) return <p className="dbt-editor-locked">{copy.locked}</p>;
  return <section className="dbt-paper-editor" data-view={view}>
    <div className="dbt-paper-toolbar">
      <p>{copy.subtitle}</p>
      <div>
        {onUndo && <button className="dbt-tool-button" type="button" onClick={onUndo} disabled={!canUndo} aria-label={copy.undo} title={copy.undo}><Undo2 size={17}/></button>}
        {onRedo && <button className="dbt-tool-button" type="button" onClick={onRedo} disabled={!canRedo} aria-label={copy.redo} title={copy.redo}><Redo2 size={17}/></button>}
        <button className="dbt-tool-button" type="button" onClick={onReset}><RotateCcw size={17}/>{copy.reset}</button>
      </div>
    </div>
    <div className="dbt-paper-views" role="group" aria-label={copy.editor}>
      <button className="dbt-tool-button" type="button" aria-pressed={view === "text"} onClick={() => setView("text")}>{copy.text}</button>
      <button className="dbt-tool-button" type="button" aria-pressed={view === "preview"} onClick={() => setView("preview")}>{copy.preview}</button>
    </div>
    <div className="dbt-paper-panes">
      <label className="dbt-paper-text"><span>{copy.text}</span>
        <textarea aria-label={copy.editor} value={value} onChange={event => onChange(event.target.value)} spellCheck />
      </label>
      <section className="dbt-paper-preview" aria-label={copy.preview}>
        <span aria-hidden="true">{copy.preview}</span>
        <div tabIndex={0} aria-label={copy.preview} role="region"><DocumentPaper document={document} locale={locale} /></div>
      </section>
    </div>
  </section>;
}
