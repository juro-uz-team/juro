"use client";

import { BrandImage } from "../../_components/BrandImage";

import { X } from "lucide-react";
import type { RenderedReceipt } from "../../../lib/document-builder/types";
import type { PlatformLocale } from "../../../lib/platform/routing";

export function DocumentPreview({ document, locale = "ru", mobileOpen = false, onClose, example = false }: { document: RenderedReceipt; locale?: PlatformLocale; mobileOpen?: boolean; onClose?: () => void; example?: boolean }) {
  const copy = {
    ru: { exampleLabel: "Пример готового документа", previewLabel: "Предварительный просмотр документа", example: "Полный пример", preview: "Предпросмотр", automatic: "A4 · обновляется автоматически", close: "Закрыть предпросмотр", ribbon: "Пример — не документ пользователя", created: "Создано в JURO", page: "Страница" },
    uz: { exampleLabel: "Tayyor hujjat namunasi", previewLabel: "Hujjatni oldindan ko‘rish", example: "To‘liq namuna", preview: "Oldindan ko‘rish", automatic: "A4 · avtomatik yangilanadi", close: "Ko‘rib chiqishni yopish", ribbon: "Namuna — foydalanuvchi hujjati emas", created: "JURO’da yaratilgan", page: "Sahifa" },
    en: { exampleLabel: "Example of a completed document", previewLabel: "Document preview", example: "Full example", preview: "Preview", automatic: "A4 · updates automatically", close: "Close preview", ribbon: "Example — not a user document", created: "Created in JURO", page: "Page" },
  }[locale];
  return <aside className={`dbt-preview ${mobileOpen ? "mobile-open" : ""}`} aria-label={example ? copy.exampleLabel : copy.previewLabel}>
    <div className="dbt-preview-toolbar"><div><strong>{example ? copy.example : copy.preview}</strong><span>{copy.automatic}</span></div>{onClose && <button type="button" onClick={onClose} aria-label={copy.close}><X size={20}/></button>}</div>
    <div className="dbt-preview-scroll">
      <article className="dbt-a4">
        {example && <div className="dbt-example-ribbon">{copy.ribbon}</div>}
        {document.paragraphs.map((paragraph) => paragraph.kind === "spacer"
          ? <div className="dbt-doc-spacer" key={paragraph.id}/>
          : <p id={paragraph.id} className={`dbt-doc-${paragraph.kind}`} key={paragraph.id}>{paragraph.kind === "list" && <span aria-hidden="true">• </span>}{paragraph.text}</p>)}
        <footer><BrandImage mark alt="" width={18} height={18}/><span>{copy.created}</span><span>{copy.page} 1 / ~{Math.max(1, Math.ceil(document.plainText.length / 3_500))}</span></footer>
      </article>
    </div>
  </aside>;
}
