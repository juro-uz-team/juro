"use client";

import { Check, X } from "lucide-react";
import { useRef, useState } from "react";
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

export function PreviewEditControl({ field, locale, finish }: {
  field: PreviewEditField;
  locale: PlatformLocale;
  finish: () => void;
}) {
  const labels = {
    ru: { save: "Применить", cancel: "Отмена", invalid: "Проверьте формат и значение поля.", empty: "Не заполнено" },
    uz: { save: "Qo‘llash", cancel: "Bekor qilish", invalid: "Maydon qiymati va formatini tekshiring.", empty: "To‘ldirilmagan" },
    en: { save: "Apply", cancel: "Cancel", invalid: "Check the field’s format and value.", empty: "Not filled in" },
  }[locale];
  const [value, setValue] = useState(field.value);
  const [invalid, setInvalid] = useState(false);
  const control = useRef<HTMLSpanElement>(null);
  const save = () => {
    const next = value.trim();
    const input = control.current?.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>("input, select, textarea");
    if (input?.validity.valid === false || (field.validate && !field.validate(next))) {
      setInvalid(true);
      return;
    }
    field.commit(next);
    finish();
  };
  const props = {
    autoFocus: true,
    "aria-label": field.label,
    "aria-invalid": invalid || undefined,
    value,
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setInvalid(false);
      setValue(event.target.value);
    },
  };
  return <span ref={control} className="dbt-preview-entry" onKeyDown={event => {
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); finish(); }
    if (event.key === "Enter" && event.target instanceof HTMLInputElement) { event.preventDefault(); save(); }
  }}>
    {field.options ? <select {...props}>
      <option value="">{labels.empty}</option>
      {field.options.map(option => <option value={option.value} key={option.value}>{option.label}</option>)}
    </select> : field.type === "multiline" ? <textarea {...props} rows={3} maxLength={field.maxLength} /> :
      <input {...props} type={field.type ?? "text"} step={field.type === "number" ? "any" : undefined} maxLength={field.maxLength} />}
    <button type="button" aria-label={labels.save} title={labels.save} onClick={save}><Check size={16}/></button>
    <button type="button" aria-label={labels.cancel} title={labels.cancel} onClick={finish}><X size={16}/></button>
    {invalid && <span className="dbt-preview-entry-error" role="alert">{labels.invalid}</span>}
  </span>;
}
