import { BrandImage } from "../../_components/BrandImage";
import type { RenderedParagraph } from "../../../lib/document-builder/types";
import type { PlatformLocale } from "../../../lib/platform/routing";
import { builderText } from "../builder-localization";

export function PublicDocumentView({ title, paragraphs, locale }: { title: string; paragraphs: RenderedParagraph[]; locale: PlatformLocale }) {
  const copy = builderText(locale, {
    ru: { sharedByOwner: "Документ предоставлен владельцем", created: "Создано в JURO", page: "Страница 1" },
    uz: { sharedByOwner: "Hujjat egasi tomonidan taqdim etilgan", created: "JURO’da yaratildi", page: "1-sahifa" },
    en: { sharedByOwner: "Shared by the document owner", created: "Created in JURO", page: "Page 1" },
  });
  return <main className="dbt-public-document" lang={locale}>
    <header><BrandImage alt="JURO" width={110} height={108}/><div><span>{copy.sharedByOwner}</span><h1>{title}</h1></div></header>
    <article className="dbt-a4 dbt-a4-public" aria-label={title}>
      {paragraphs.map((paragraph) => paragraph.kind === "spacer"
        ? <div className="dbt-doc-spacer" key={paragraph.id}/>
        : <p className={`dbt-doc-${paragraph.kind}`} key={paragraph.id}>{paragraph.kind === "list" && <span aria-hidden="true">• </span>}{paragraph.text}</p>)}
      <footer><BrandImage mark alt="" width={18} height={18}/><span>{copy.created}</span><span>{copy.page}</span></footer>
    </article>
  </main>;
}
