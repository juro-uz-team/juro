"use client";

import { BrandImage } from "../../_components/BrandImage";
import { Select } from "../../_components/Select";

import { MessageSquarePlus, Pencil, RotateCcw, X } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { proposalExcerpt } from "../../../lib/document-builder/generation/proposal-selection";
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

export function DocumentPreview({ document, locale = "ru", mobileOpen = false, onClose, example = false, editing, onPropose }: {
  document: RenderedReceipt; locale?: PlatformLocale; mobileOpen?: boolean; onClose?: () => void; example?: boolean; editing?: PreviewEditing; onPropose?: (text: string) => void;
}) {
  const copy = {
    ru: { exampleLabel: "Пример готового документа", previewLabel: "Предварительный просмотр документа", example: "Полный пример", preview: "Предпросмотр", automatic: "A4 · обновляется автоматически", close: "Закрыть предпросмотр", ribbon: "Пример — не документ пользователя", created: "Создано в JURO", page: "Страница" },
    uz: { exampleLabel: "Tayyor hujjat namunasi", previewLabel: "Hujjatni oldindan ko‘rish", example: "To‘liq namuna", preview: "Oldindan ko‘rish", automatic: "A4 · avtomatik yangilanadi", close: "Ko‘rib chiqishni yopish", ribbon: "Namuna — foydalanuvchi hujjati emas", created: "JURO’da yaratilgan", page: "Sahifa" },
    en: { exampleLabel: "Example of a completed document", previewLabel: "Document preview", example: "Full example", preview: "Preview", automatic: "A4 · updates automatically", close: "Close preview", ribbon: "Example — not a user document", created: "Created in JURO", page: "Page" },
  }[locale];
  const editor = editCopy[locale];
  const scroll = useRef<HTMLDivElement>(null);
  const selectionHint = { ru: "Выделите текст, чтобы предложить изменение.", uz: "O‘zgarish taklif qilish uchun matnni belgilang.", en: "Select text to propose a change." }[locale];
  return <aside className={`dbt-preview ${mobileOpen ? "mobile-open" : ""}${editing ? " dbt-preview-editable" : ""}`} aria-label={example ? copy.exampleLabel : copy.previewLabel}>
    <div className="dbt-preview-toolbar">
      <div><strong>{example ? copy.example : copy.preview}</strong><span>{[editing ? editor.hint : copy.automatic, onPropose ? selectionHint : ""].filter(Boolean).join(" ")}</span></div>
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
    <div className="dbt-preview-scroll" ref={scroll}>
      <DocumentPaper document={document} locale={locale} ribbon={example ? copy.ribbon : undefined} editing={editing}/>
      {onPropose && <PreviewProposalAction scroll={scroll} source={document.plainText} locale={locale} onPropose={onPropose}/>}
    </div>
  </aside>;
}

function PreviewProposalAction({ scroll, source, locale, onPropose }: {
  scroll: RefObject<HTMLDivElement | null>; source: string; locale: PlatformLocale; onPropose: (text: string) => void;
}) {
  const [proposal, setProposal] = useState<{ text: string; top: number; left: number; source: string }>();
  useEffect(() => {
    const viewport = scroll.current;
    if (!viewport) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const selection = window.getSelection();
        const paper = viewport.querySelector(".dbt-a4");
        const inParagraph = (node: Node | null) => {
          const element = node instanceof Element ? node : node?.parentElement;
          const paragraph = element?.closest(".dbt-preview-paragraph p");
          return Boolean(paragraph && paper?.contains(paragraph) && !element?.closest(".dbt-preview-entry"));
        };
        if (!selection || selection.isCollapsed || !selection.rangeCount || !inParagraph(selection.anchorNode) || !inParagraph(selection.focusNode)) {
          setProposal(undefined);
          return;
        }
        const text = proposalExcerpt(source, selection.toString());
        const first = selection.getRangeAt(0).getClientRects()[0];
        const view = viewport.getBoundingClientRect();
        if (!text || !first || first.bottom < view.top || first.top > view.bottom) {
          setProposal(undefined);
          return;
        }
        const left = Math.min(Math.max(8, first.left - view.left), Math.max(8, viewport.clientWidth - 216));
        const top = first.top - view.top >= 48 ? first.top - view.top - 48 : first.bottom - view.top + 6;
        setProposal({ text, left, top: viewport.scrollTop + top, source });
      });
    };
    document.addEventListener("selectionchange", update);
    viewport.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("selectionchange", update);
      viewport.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [scroll, source]);
  if (!proposal || proposal.source !== source) return null;
  const label = { ru: "Предложить изменение", uz: "O‘zgarish taklif qilish", en: "Propose a change" }[locale];
  return <button type="button" className="dbt-preview-propose" style={{ "--excerpt-top": `${proposal.top}px`, "--excerpt-left": `${proposal.left}px` } as CSSProperties}
    onMouseDown={event => event.preventDefault()} onClick={() => {
      onPropose(proposal.text);
      window.getSelection()?.removeAllRanges();
      setProposal(undefined);
    }}><MessageSquarePlus size={16} aria-hidden="true"/>{label}</button>;
}

function DocumentPaper({ document, locale, ribbon, editing }: {
  document: RenderedReceipt; locale: PlatformLocale; ribbon?: string; editing?: PreviewEditing;
}) {
  const labels = {
    ru: { created: "Создано в JURO", page: "Страница" },
    uz: { created: "JURO’da yaratilgan", page: "Sahifa" },
    en: { created: "Created in JURO", page: "Page" },
  }[locale];
  const [selection, setSelection] = useState<{ paragraph: number; part?: number; text: string; width?: number }>();
  const paper = useRef<HTMLElement>(null);
  const labelsEditing = editCopy[locale];
  const clearField = { ru: "Очистить поле", uz: "Maydonni tozalash", en: "Clear field" }[locale];
  const close = (restoreFocus?: boolean) => {
    setSelection(undefined);
    if (!selection || !restoreFocus) return;
    const target = selection.part === undefined ? `[data-preview-wording="${selection.paragraph}"]` : `[data-preview-field="${selection.paragraph}:${selection.part}"]`;
    requestAnimationFrame(() => paper.current?.querySelector<HTMLElement>(target)?.focus({ preventScroll: true }));
  };
  const current = selection?.text === document.plainText ? selection : undefined;
  return <article className="dbt-a4" ref={paper}>
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
              if (field.options) return <Select className="dbt-preview-choice" key={partIndex} aria-label={field.label} value={field.value}
                displayValue={part.text} onChange={event => field.commit(event.target.value)}>
                <option value="">{clearField}</option>
                {field.options.filter(option => option.value !== "").map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
              </Select>;
              return current?.paragraph === paragraphIndex && current.part === partIndex
                ? <PreviewEditControl key={partIndex} field={field} locale={locale} finish={close} anchor={{ text: part.text, width: current.width ?? 0 }}/>
                : <button type="button" key={partIndex} className="dbt-preview-slot" data-empty={!field.value}
                    data-preview-field={`${paragraphIndex}:${partIndex}`}
                    title={field.label} aria-label={`${field.label}${field.value ? ` · ${part.text}` : ""}`}
                    onClick={event => setSelection({ paragraph: paragraphIndex, part: partIndex, text: document.plainText, width: event.currentTarget.getBoundingClientRect().width })}>{part.text}</button>;
            }) : paragraph.text}
          </p>}
        {editing?.wording && current?.paragraph !== paragraphIndex && <button type="button" className="dbt-preview-wording" data-preview-wording={paragraphIndex} aria-label={labelsEditing.wording} title={labelsEditing.wording}
          onClick={() => setSelection({ paragraph: paragraphIndex, text: document.plainText })}><Pencil size={13}/></button>}
      </div>)}
    <footer><BrandImage mark tone="light" alt="" width={18} height={18}/><span>{labels.created}</span><span>{labels.page} 1 / ~{Math.max(1, Math.ceil(document.plainText.length / 3_500))}</span></footer>
  </article>;
}
