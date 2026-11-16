"use client";

import type { BuilderLanguage } from "../../../lib/document-builder/registry/engine";
import type { PlatformLocale } from "../../../lib/platform/routing";

export function DocumentLanguageControl({ language, locale, onChange }: {
  language: BuilderLanguage;
  locale: PlatformLocale;
  onChange: (language: BuilderLanguage) => void;
}) {
  const label = { ru: "Язык документа", uz: "Hujjat tili", en: "Document language" }[locale];
  return <div className="dbt-language-control">
    <span>{label}</span>
    <div className="dbt-language-toggle" role="group" aria-label={label}>
      <button type="button" aria-pressed={language === "ru"} className={language === "ru" ? "active" : ""} onClick={() => onChange("ru")}>Русский</button>
      <button type="button" aria-pressed={language === "uz"} className={language === "uz" ? "active" : ""} onClick={() => onChange("uz")}>O‘zbekcha</button>
    </div>
  </div>;
}
