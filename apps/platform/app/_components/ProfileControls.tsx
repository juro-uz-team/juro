"use client";

import { useState, type InputHTMLAttributes } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, FileUp, X } from "lucide-react";
import { Button, Calendar, CalendarCell, CalendarGrid, ComboBox, DateInput, DatePicker, DateSegment, Dialog, Group, Heading, I18nProvider, Input, Label, ListBox, ListBoxItem, Popover } from "react-aria-components";
import { parseDateTime } from "@internationalized/date";
import type { PlatformLocale } from "../../lib/platform/routing";
import "./profile-controls.css";

const copy = {
  en: { choose: "Choose file", empty: "No file selected", search: "Choose or type your own", add: "Add", remove: "Remove", options: "Show options", hint: "Choose an option or type and press Enter.", clear: "Clear date", calendar: "Open calendar", minutes: "min" },
  ru: { choose: "Выбрать файл", empty: "Файл не выбран", search: "Выберите или введите свой вариант", add: "Добавить", remove: "Удалить", options: "Показать варианты", hint: "Выберите вариант или введите свой и нажмите Enter.", clear: "Очистить дату", calendar: "Открыть календарь", minutes: "мин" },
  uz: { choose: "Fayl tanlash", empty: "Fayl tanlanmagan", search: "Tanlang yoki o‘z variantingizni kiriting", add: "Qo‘shish", remove: "O‘chirish", options: "Variantlarni ko‘rsatish", hint: "Variantni tanlang yoki yozib, Enter bosing.", clear: "Sanani tozalash", calendar: "Kalendarni ochish", minutes: "daq" },
};

export function FilePicker({ locale, onChange, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { locale: PlatformLocale }) {
  const [names, setNames] = useState("");
  const t = copy[locale];
  return <span className="juro-file-picker" data-disabled={props.disabled || undefined}>
    <span className="juro-file-action"><FileUp size={18} aria-hidden="true"/>{t.choose}</span>
    <span className="juro-file-name" aria-live="polite">{names || t.empty}</span>
    <input {...props} type="file" onChange={(event) => { setNames(Array.from(event.currentTarget.files ?? []).map(file => file.name).join(", ")); onChange?.(event); }} ref={(node) => {
      if (!node?.form) return;
      const reset = () => setNames("");
      node.form.addEventListener("reset", reset);
      return () => node.form?.removeEventListener("reset", reset);
    }}/>
  </span>;
}

export function ChoiceInput({ locale, label, value, onChange, options, multiple = false, required = false, disabled = false, maxLength }: { locale: PlatformLocale; label: string; value: string; onChange: (value: string) => void; options: string[]; multiple?: boolean; required?: boolean; disabled?: boolean; maxLength?: number }) {
  const [query, setQuery] = useState("");
  const t = copy[locale];
  const selected = multiple ? value.split(",").map(v => v.trim()).filter(Boolean) : [];
  const input = multiple ? query : value;
  const choices = [...new Set(options)].filter(v => !selected.some(s => s.toLocaleLowerCase() === v.toLocaleLowerCase()) && v.toLocaleLowerCase().includes(input.toLocaleLowerCase()));
  const custom = input.trim();
  const items = [...choices.map(v => ({ id: v, title: v })), ...(custom && !choices.some(v => v.toLocaleLowerCase() === custom.toLocaleLowerCase()) ? [{ id: custom, title: `${t.add}: ${custom}` }] : [])];
  function add(next: string) {
    if (multiple) {
      const merged = [...selected];
      for (const item of next.split(",").map(v => v.trim()).filter(Boolean)) if (!merged.some(v => v.toLocaleLowerCase() === item.toLocaleLowerCase())) merged.push(item);
      onChange(merged.join(", ")); setQuery("");
    } else onChange(next);
  }
  return <I18nProvider locale={locale === "uz" ? "uz-Latn" : locale}><div className="juro-choice">
    <ComboBox onBlur={() => { if (multiple && query.trim()) add(query); }} inputValue={input} onInputChange={multiple ? setQuery : onChange} selectedKey={!multiple && options.includes(value) ? value : null} onSelectionChange={key => { if (key !== null) add(String(key)); }} items={items} allowsCustomValue menuTrigger="input" isDisabled={disabled}>
      <Label>{label}</Label>
      {multiple && selected.length > 0 && <div className="juro-chips" aria-label={label}>{selected.map(item => <span key={item}>{item}<button type="button" disabled={disabled} aria-label={`${t.remove}: ${item}`} onClick={() => onChange(selected.filter(v => v !== item).join(", "))}><X size={14}/></button></span>)}</div>}
      <Group className="juro-choice-input"><Input maxLength={maxLength} placeholder={t.search} required={required && !value.trim()} onKeyDown={event => { if (multiple && (event.key === "," || (event.key === "Enter" && !event.currentTarget.getAttribute("aria-activedescendant"))) && query.trim()) { event.preventDefault(); add(query); } }}/><Button aria-label={t.options}><ChevronDown size={18}/></Button></Group>
      <Popover className="juro-control-popover"><ListBox items={items} className="juro-choice-list">{item => <ListBoxItem id={item.id} textValue={item.id}>{item.title}</ListBoxItem>}</ListBox></Popover>
    </ComboBox>
    <small className="juro-control-hint">{t.hint}</small>
  </div></I18nProvider>;
}

export function DateTimePicker({ locale, label, value, onChange, disabled }: { locale: PlatformLocale; label: string; value: string; onChange: (value: string) => void; disabled?: boolean }) {
  const t = copy[locale];
  return <I18nProvider locale={locale === "uz" ? "uz-Latn" : locale}>
    <DatePicker className="juro-date-picker" granularity="minute" hourCycle={24} value={value ? parseDateTime(value) : null} onChange={next => onChange(next?.toString().slice(0,16) ?? "")} isDisabled={disabled}>
      <Label>{label}</Label>
      <Group className="juro-date-input"><DateInput>{segment => <DateSegment segment={segment}/>}</DateInput><Button aria-label={t.calendar}><CalendarDays size={18}/></Button></Group>
      <Popover className="juro-control-popover"><Dialog><Calendar><header><Button slot="previous" aria-label={locale === "ru" ? "Предыдущий месяц" : locale === "uz" ? "Oldingi oy" : "Previous month"}><ChevronLeft size={18}/></Button><Heading/><Button slot="next" aria-label={locale === "ru" ? "Следующий месяц" : locale === "uz" ? "Keyingi oy" : "Next month"}><ChevronRight size={18}/></Button></header><CalendarGrid>{date => <CalendarCell date={date}/>}</CalendarGrid></Calendar></Dialog></Popover>
    </DatePicker>
    {value && <button className="juro-clear-date" type="button" disabled={disabled} onClick={() => onChange("")}>{t.clear}</button>}
  </I18nProvider>;
}

type NumberPresetProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  min: number;
  max: number;
  step: number;
  presets: number[];
  unit: (value: number) => string;
};

function NumberPresetInput({ label, value, onChange, min, max, step, presets, unit }: NumberPresetProps) {
  return <div className="juro-duration">
    <label>{label}<span className="juro-duration-input">
      <input type="number" inputMode="numeric" required min={min} max={max} step={step} value={value} onChange={event => onChange(event.target.value)}/>
      <span aria-hidden="true">{unit(Number(value))}</span>
    </span></label>
    <div className="juro-duration-presets" aria-label={label}>
      {presets.map(preset => <button type="button" key={preset} aria-pressed={value !== "" && Number(value) === preset} onClick={() => onChange(String(preset))}>{preset} {unit(preset)}</button>)}
    </div>
  </div>;
}

export function DurationInput({ locale, ...props }: { locale: PlatformLocale; label: string; value: string; onChange: (value: string) => void }) {
  return <NumberPresetInput {...props} min={15} max={480} step={15} presets={[30,45,60,90]} unit={() => copy[locale].minutes}/>;
}

export function ExperienceInput({ locale, ...props }: { locale: PlatformLocale; label: string; value: string; onChange: (value: string) => void }) {
  function unit(value: number) {
    if (locale === "uz") return "yil";
    const category = new Intl.PluralRules(locale).select(value);
    return locale === "ru" ? category === "one" ? "год" : category === "few" ? "года" : "лет" : category === "one" ? "year" : "years";
  }
  return <NumberPresetInput {...props} min={0} max={99} step={1} presets={[1,3,5,10]} unit={unit}/>;
}
