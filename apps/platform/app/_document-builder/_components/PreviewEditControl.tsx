"use client";

import { Check, X } from "lucide-react";
import { useId, useRef, useState } from "react";
import type { PlatformLocale } from "../../../lib/platform/routing";

export type PreviewEditField = {
  label: string;
  value: string;
  type?: "text" | "date" | "email" | "tel" | "number" | "multiline";
  options?: { value: string; label: string }[];
  validate?: (value: string) => boolean;
  maxLength?: number;
  commit: (value: string) => void;
};

export function PreviewEditControl({ field, locale, finish, anchor }: {
  field: PreviewEditField;
  locale: PlatformLocale;
  finish: (restoreFocus?: boolean) => void;
  anchor?: { text: string; width: number };
}) {
  const labels = {
    ru: { save: "Применить", cancel: "Отмена", invalid: "Проверьте формат и значение поля." },
    uz: { save: "Qo‘llash", cancel: "Bekor qilish", invalid: "Maydon qiymati va formatini tekshiring." },
    en: { save: "Apply", cancel: "Cancel", invalid: "Check the field’s format and value." },
  }[locale];
  const [value, setValue] = useState(field.value);
  const [invalid, setInvalid] = useState(false);
  const control = useRef<HTMLSpanElement>(null);
  const completed = useRef(false);
  const errorId = useId();
  const inline = anchor && field.type !== "date" && field.type !== "multiline";
  const save = (restoreFocus = false) => {
    if (completed.current) return;
    const next = value.trim();
    const input = control.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
    if (input?.validity.valid === false || (field.validate && !field.validate(next))) {
      setInvalid(true);
      return;
    }
    completed.current = true;
    if (next !== field.value) field.commit(next);
    finish(restoreFocus);
  };
  const props = {
    autoFocus: true,
    "aria-label": field.label,
    "aria-invalid": invalid || undefined,
    "aria-describedby": invalid ? errorId : undefined,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setInvalid(false);
      setValue(event.target.value);
    },
  };
  const input = field.type === "multiline" ? <textarea {...props} rows={3} maxLength={field.maxLength} /> :
    <input {...props} type={field.type ?? "text"} step={field.type === "number" ? "any" : undefined} maxLength={field.maxLength}
      onBlur={inline ? () => save() : undefined}/>;
  const error = invalid && <span id={errorId} className="dbt-preview-entry-error" role="alert">{labels.invalid}</span>;
  return <span ref={control} className={anchor ? `dbt-preview-field-editor ${inline ? "inline" : "popup"}` : "dbt-preview-entry"} onKeyDown={event => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopPropagation();
      completed.current = true;
      finish(true);
    }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); save(true); }
  }}>
    {anchor && <span className="dbt-preview-field-anchor" style={{ width: anchor.width }} aria-hidden="true">{anchor.text}</span>}
    {inline ? <>{input}{error}</> : <span className={anchor ? "dbt-preview-entry" : "dbt-preview-entry-controls"}>
      {anchor && <strong>{field.label}</strong>}
      {input}
      <button type="button" aria-label={labels.save} title={labels.save} onClick={() => save(true)}><Check size={16} aria-hidden="true"/></button>
      <button type="button" aria-label={labels.cancel} title={labels.cancel} onClick={() => finish(true)}><X size={16} aria-hidden="true"/></button>
      {error}
    </span>}
  </span>;
}
