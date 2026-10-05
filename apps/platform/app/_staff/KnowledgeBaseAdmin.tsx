"use client";

import { ChoiceInput } from "../_components/ProfileControls";
import { Archive, BookOpenCheck, Check, FilePlus2, Plus, RefreshCw, Save, ShieldCheck, Undo2, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import type { PlatformLocale } from "../../lib/platform/routing";

type Locale = PlatformLocale;
type Status = "draft" | "published" | "archived";
type Section = { heading: string; paragraphs: string[] };
type Content = {
  slug: string; category: string; titleRu: string; titleUz: string; titleEn: string; summaryRu: string; summaryUz: string; summaryEn: string;
  bodyRu: Section[]; bodyUz: Section[]; bodyEn: Section[]; relatedSlugs: string[];
};
type Summary = {
  articleId: string; slug: string; category: string; status: Status; titleRu: string; titleUz: string; titleEn: string | null;
  latestVersionNumber: number; draftVersionId: string | null; publishedVersionId: string | null;
  helpfulCount: number; notHelpfulCount: number; updatedAt: string;
};
type Version = Omit<Content, "slug" | "category" | "titleEn" | "summaryEn" | "bodyEn"> & {
  titleEn: string | null; summaryEn: string | null; bodyEn: Section[] | null;
  versionId: string; versionNumber: number; contentSha256: string; createdAt: string; updatedAt: string; publishedAt: string | null;
};
type Article = { articleId: string; slug: string; category: string; status: Status; updatedAt: string; versions: Version[] };
type PendingAction = "publish" | "archive" | "restore" | null;

const blank = (): Content => ({
  slug: "", category: "", titleRu: "", titleUz: "", titleEn: "", summaryRu: "", summaryUz: "", summaryEn: "",
  bodyRu: [{ heading: "", paragraphs: [""] }], bodyUz: [{ heading: "", paragraphs: [""] }], bodyEn: [{ heading: "", paragraphs: [""] }], relatedSlugs: [],
});
const copy = {
  ru: { title: "База знаний", description: "Версионная публикация справочных материалов на русском, узбекском и английском языках.", secure: "LEGAL OPERATIONS", fresh: "Свежая 2FA", refresh: "Обновить", create: "Новая статья", list: "Статьи", empty: "Статей нет", edit: "Открыть", draft: "Черновик", published: "Опубликовано", archived: "Архив", version: "Версия", useful: "Полезно", notUseful: "Не помогло", slug: "Slug", category: "Категория", ru: "Русский", uz: "O‘zbekcha", en: "English (необязательно)", englishUnavailable: "Английская версия не готова", titleField: "Заголовок", summary: "Краткое описание", sections: "Разделы статьи", heading: "Заголовок раздела", paragraphs: "Абзацы — разделяйте пустой строкой", addSection: "Добавить раздел", removeSection: "Удалить раздел", related: "Связанные статьи", save: "Сохранить черновик", publish: "Опубликовать", archive: "Архивировать", restore: "Восстановить", cancel: "Отмена", confirmPublish: "После публикации эта версия станет неизменяемой и сразу появится у пользователей. Английская версия будет доступна только при полном переводе.", confirmArchive: "Статья исчезнет из публичной базы, но версии и оценки сохранятся.", confirmRestore: "Статья снова станет доступной, если у неё есть опубликованная версия.", confirm: "Подтвердить", saved: "Черновик сохранён", publishedDone: "Статья опубликована", statusDone: "Статус статьи изменён", invalid: "Заполните русскую и узбекскую версии и минимум один раздел.", invalidEnglish: "Заполните английский заголовок, описание и все разделы либо оставьте английскую версию пустой.", loading: "Загрузка…" },
  uz: { title: "Bilimlar bazasi", description: "Rus, o‘zbek va ingliz tillaridagi yordam materiallarini versiyali nashr qilish.", secure: "LEGAL OPERATIONS", fresh: "Yaqindagi 2FA", refresh: "Yangilash", create: "Yangi maqola", list: "Maqolalar", empty: "Maqolalar yo‘q", edit: "Ochish", draft: "Qoralama", published: "Nashr etilgan", archived: "Arxiv", version: "Versiya", useful: "Foydali", notUseful: "Yordam bermadi", slug: "Slug", category: "Toifa", ru: "Русский", uz: "O‘zbekcha", en: "English (ixtiyoriy)", englishUnavailable: "Inglizcha versiya tayyor emas", titleField: "Sarlavha", summary: "Qisqa tavsif", sections: "Maqola bo‘limlari", heading: "Bo‘lim sarlavhasi", paragraphs: "Abzatslarni bo‘sh satr bilan ajrating", addSection: "Bo‘lim qo‘shish", removeSection: "Bo‘limni o‘chirish", related: "Bog‘liq maqolalar", save: "Qoralamani saqlash", publish: "Nashr qilish", archive: "Arxivlash", restore: "Tiklash", cancel: "Bekor qilish", confirmPublish: "Nashrdan keyin bu versiya o‘zgarmaydi va darhol foydalanuvchilarga ko‘rinadi. Inglizcha versiya faqat to‘liq tarjima bo‘lsa ochiladi.", confirmArchive: "Maqola ommaviy bazadan yashiriladi, versiyalar va baholar saqlanadi.", confirmRestore: "Nashr qilingan versiya bo‘lsa, maqola yana ochiladi.", confirm: "Tasdiqlash", saved: "Qoralama saqlandi", publishedDone: "Maqola nashr qilindi", statusDone: "Maqola holati o‘zgardi", invalid: "Rus va o‘zbek versiyalarini hamda kamida bitta bo‘limni to‘ldiring.", invalidEnglish: "Inglizcha sarlavha, tavsif va barcha bo‘limlarni to‘ldiring yoki inglizcha versiyani bo‘sh qoldiring.", loading: "Yuklanmoqda…" },
  en: { title: "Knowledge base", description: "Versioned publication of guidance in Russian, Uzbek and English.", secure: "LEGAL OPERATIONS", fresh: "Recent 2FA", refresh: "Refresh", create: "New article", list: "Articles", empty: "No articles", edit: "Open", draft: "Draft", published: "Published", archived: "Archived", version: "Version", useful: "Helpful", notUseful: "Not helpful", slug: "Slug", category: "Category", ru: "Russian", uz: "Uzbek", en: "English (optional)", englishUnavailable: "English version not ready", titleField: "Title", summary: "Summary", sections: "Article sections", heading: "Section heading", paragraphs: "Paragraphs — separate them with a blank line", addSection: "Add section", removeSection: "Remove section", related: "Related articles", save: "Save draft", publish: "Publish", archive: "Archive", restore: "Restore", cancel: "Cancel", confirmPublish: "After publication, this version becomes immutable and is immediately visible to users. English will be available only when its translation is complete.", confirmArchive: "The article will leave the public knowledge base, while its versions and ratings are retained.", confirmRestore: "The article will become available again if it has a published version.", confirm: "Confirm", saved: "Draft saved", publishedDone: "Article published", statusDone: "Article status changed", invalid: "Complete the Russian and Uzbek versions and at least one section.", invalidEnglish: "Complete the English title, summary and every section, or leave the English version empty.", loading: "Loading…" },
} as const;

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string; code?: string };
  if (!response.ok) throw new Error(body.error || body.code || `HTTP ${response.status}`);
  return body;
}

export function KnowledgeBaseAdmin({ locale, staffName }: { locale: Locale; staffName: string }) {
  const t = copy[locale];
  const [articles, setArticles] = useState<Summary[]>([]);
  const [selected, setSelected] = useState<Article | null>(null);
  const [versionId, setVersionId] = useState<string | undefined>();
  const [content, setContent] = useState<Content>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [announcement, setAnnouncement] = useState("");
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const data = await readJson<{ articles: Summary[] }>(await fetch("/api/platform/admin/knowledge-base", { cache: "no-store" }));
      setArticles(data.articles); setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ERROR"); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);

  const currentSummary = useMemo(() => articles.find((item) => item.articleId === selected?.articleId) ?? null, [articles, selected]);

  async function open(articleId: string) {
    setBusy(true); setPendingAction(null);
    try {
      const data = await readJson<{ article: Article }>(await fetch(`/api/platform/admin/knowledge-base?articleId=${encodeURIComponent(articleId)}`, { cache: "no-store" }));
      const draft = data.article.versions.find((version) => !version.publishedAt);
      const source = draft ?? data.article.versions[0];
      setSelected(data.article); setVersionId(draft?.versionId);
      setContent(source ? { slug: data.article.slug, category: data.article.category, titleRu: source.titleRu, titleUz: source.titleUz, titleEn: source.titleEn ?? "", summaryRu: source.summaryRu, summaryUz: source.summaryUz, summaryEn: source.summaryEn ?? "", bodyRu: source.bodyRu, bodyUz: source.bodyUz, bodyEn: source.bodyEn ?? [{ heading: "", paragraphs: [""] }], relatedSlugs: source.relatedSlugs } : blank());
      setError("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ERROR"); }
    finally { setBusy(false); }
  }

  function startNew() { setSelected(null); setVersionId(undefined); setContent(blank()); setPendingAction(null); setAnnouncement(""); setError(""); }

  function setField<K extends keyof Content>(key: K, value: Content[K]) { setContent((current) => ({ ...current, [key]: value })); }
  function setSection(language: "bodyRu" | "bodyUz" | "bodyEn", index: number, patch: Partial<Section>) {
    setContent((current) => {
      const sections = [...current[language]];
      sections[index] = { ...(sections[index] ?? { heading: "", paragraphs: [""] }), ...patch };
      return { ...current, [language]: sections };
    });
  }
  function addSection() {
    setContent((current) => ({ ...current, bodyRu: [...current.bodyRu, { heading: "", paragraphs: [""] }], bodyUz: [...current.bodyUz, { heading: "", paragraphs: [""] }], bodyEn: [...current.bodyEn, { heading: "", paragraphs: [""] }] }));
  }
  function removeSection(index: number) {
    const sectionCount = Math.max(content.bodyRu.length, content.bodyUz.length, content.bodyEn.length);
    if (sectionCount <= 1) return;
    setContent((current) => ({ ...current, bodyRu: current.bodyRu.filter((_, position) => position !== index), bodyUz: current.bodyUz.filter((_, position) => position !== index), bodyEn: current.bodyEn.filter((_, position) => position !== index) }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const englishStarted = Boolean(
      content.titleEn.trim()
      || content.summaryEn.trim()
      || content.bodyEn.some((section) => section.heading.trim() || section.paragraphs.some((paragraph) => paragraph.trim())),
    );
    const englishComplete = content.titleEn.trim().length >= 3
      && content.summaryEn.trim().length >= 10
      && content.bodyEn.length > 0
      && content.bodyEn.every((section) => section.heading.trim() && section.paragraphs.length > 0 && section.paragraphs.every((paragraph) => paragraph.trim()));
    if (englishStarted && !englishComplete) {
      setError(t.invalidEnglish);
      return;
    }
    const requestContent = {
      ...content,
      titleEn: englishStarted ? content.titleEn : null,
      summaryEn: englishStarted ? content.summaryEn : null,
      bodyEn: englishStarted ? content.bodyEn : null,
    };
    setBusy(true); setAnnouncement("");
    try {
      const result = await readJson<{ articleId: string }>(await fetch("/api/platform/admin/knowledge-base", {
        method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1" },
        body: JSON.stringify({ action: "save_draft", articleId: selected?.articleId, versionId, content: requestContent }),
      }));
      await load(); await open(result.articleId); setAnnouncement(t.saved);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t.invalid); }
    finally { setBusy(false); }
  }

  async function confirmAction() {
    if (!pendingAction || !selected) return;
    setBusy(true); setAnnouncement("");
    try {
      const payload = pendingAction === "publish"
        ? { action: "publish", articleId: selected.articleId, versionId }
        : { action: "set_status", articleId: selected.articleId, status: pendingAction === "archive" ? "archived" : "restored" };
      await readJson(await fetch("/api/platform/admin/knowledge-base", { method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1" }, body: JSON.stringify(payload) }));
      setPendingAction(null); await load(); await open(selected.articleId); setAnnouncement(pendingAction === "publish" ? t.publishedDone : t.statusDone);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "ERROR"); }
    finally { setBusy(false); }
  }

  const actionMessage = pendingAction === "publish" ? t.confirmPublish : pendingAction === "archive" ? t.confirmArchive : t.confirmRestore;
  const nextLocale: Locale = locale === "ru" ? "uz" : locale === "uz" ? "en" : "ru";
  const localizedTitle = (article: Pick<Summary, "titleRu" | "titleUz" | "titleEn">): string => locale === "ru"
    ? article.titleRu
    : locale === "uz"
      ? article.titleUz
      : article.titleEn ?? t.englishUnavailable;
  const sectionCount = Math.max(content.bodyRu.length, content.bodyUz.length, content.bodyEn.length);
  return <div className="staff-console" aria-busy={busy}>
    <a className="staff-skip" href="#knowledge-editor">{t.title}</a>
    <header className="staff-topbar"><div className="staff-brand"><ShieldCheck aria-hidden="true"/><span><b>JURO</b><small>{t.secure}</small></span></div><div className="staff-session"><span>{t.fresh}</span><b>{staffName}</b></div><a href={`/${nextLocale}/admin/knowledge-base`} hrefLang={nextLocale}>{nextLocale.toUpperCase()}</a></header>
    <main id="knowledge-editor" className="staff-main kb-admin-main">
      <section className="staff-heading"><div><span>JURO · KNOWLEDGE OPERATIONS</span><h1>{t.title}</h1><p>{t.description}</p></div><div className="kb-heading-actions"><button type="button" onClick={() => void load()} disabled={busy}><RefreshCw aria-hidden="true"/>{t.refresh}</button><button type="button" onClick={startNew} disabled={busy}><FilePlus2 aria-hidden="true"/>{t.create}</button></div></section>
      <p className="sr-only" role="status" aria-live="polite">{announcement}</p>
      {error && <p className="staff-error" role="alert">{error}<button type="button" onClick={() => setError("")}>{t.cancel}</button></p>}
      <div className="kb-admin-layout">
        <section className="kb-article-list" aria-label={t.list}><header><h2>{t.list}</h2><small>{articles.length}</small></header>{busy && !articles.length ? <p>{t.loading}</p> : articles.length ? articles.map((article) => <button type="button" key={article.articleId} onClick={() => void open(article.articleId)} aria-current={selected?.articleId === article.articleId ? "true" : undefined}><span><b>{localizedTitle(article)}</b><small>{article.slug} · {t.version} {article.latestVersionNumber}</small></span><span className={`staff-status status-${article.status}`}>{t[article.status]}</span><span><small>{t.useful}: {article.helpfulCount}</small><small>{t.notUseful}: {article.notHelpfulCount}</small></span></button>) : <p className="staff-empty">{t.empty}</p>}</section>
        <form className="kb-editor" onSubmit={(event) => void submit(event)}>
          <header><div><BookOpenCheck aria-hidden="true"/><span><b>{selected && currentSummary ? localizedTitle(currentSummary) : t.create}</b><small>{selected ? `${selected.slug} · ${t.version} ${currentSummary?.latestVersionNumber ?? 0}` : t.draft}</small></span></div>{selected && <span className={`staff-status status-${selected.status}`}>{t[selected.status]}</span>}</header>
          <fieldset className="kb-identity"><legend className="sr-only">Identity</legend><label>{t.slug}<input required minLength={3} maxLength={120} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={content.slug} disabled={Boolean(currentSummary?.publishedVersionId)} onChange={(event) => setField("slug", event.target.value)}/></label><label>{t.category}<input required minLength={2} maxLength={60} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={content.category} disabled={Boolean(currentSummary?.publishedVersionId)} onChange={(event) => setField("category", event.target.value)}/></label></fieldset>
          <div className="kb-language-grid"><LanguageFields language="ru" label={t.ru} titleLabel={t.titleField} summaryLabel={t.summary} content={content} setField={setField}/><LanguageFields language="uz" label={t.uz} titleLabel={t.titleField} summaryLabel={t.summary} content={content} setField={setField}/><LanguageFields language="en" label={t.en} titleLabel={t.titleField} summaryLabel={t.summary} content={content} setField={setField}/></div>
          <section className="kb-sections"><header><h2>{t.sections}</h2><button type="button" onClick={addSection}><Plus aria-hidden="true"/>{t.addSection}</button></header>{Array.from({ length: sectionCount }, (_, index) => <fieldset key={index}><legend>{index + 1}</legend><div className="kb-language-grid"><SectionFields required label={t.ru} headingLabel={t.heading} paragraphsLabel={t.paragraphs} section={content.bodyRu[index] ?? { heading: "", paragraphs: [""] }} onChange={(patch) => setSection("bodyRu", index, patch)}/><SectionFields required label={t.uz} headingLabel={t.heading} paragraphsLabel={t.paragraphs} section={content.bodyUz[index] ?? { heading: "", paragraphs: [""] }} onChange={(patch) => setSection("bodyUz", index, patch)}/><SectionFields label={t.en} headingLabel={t.heading} paragraphsLabel={t.paragraphs} section={content.bodyEn[index] ?? { heading: "", paragraphs: [""] }} onChange={(patch) => setSection("bodyEn", index, patch)}/></div><button type="button" onClick={() => removeSection(index)} disabled={sectionCount <= 1}><X aria-hidden="true"/>{t.removeSection}</button></fieldset>)}</section>
          <div className="kb-related"><ChoiceInput locale={locale} label={t.related} multiple options={articles.filter(item => item.slug !== content.slug && item.status === "published").map(item => item.slug)} value={content.relatedSlugs.join(", ")} onChange={value => setField("relatedSlugs", value.split(",").map(item => item.trim()).filter(Boolean))}/></div>
          {pendingAction && <section className="kb-confirm" role="alertdialog" aria-modal="false" aria-labelledby="kb-confirm-title"><h2 id="kb-confirm-title">{pendingAction === "publish" ? t.publish : pendingAction === "archive" ? t.archive : t.restore}</h2><p>{actionMessage}</p><div><button type="button" onClick={() => setPendingAction(null)} disabled={busy}><X aria-hidden="true"/>{t.cancel}</button><button type="button" className={pendingAction === "archive" ? "staff-reject" : "staff-approve"} onClick={() => void confirmAction()} disabled={busy || (pendingAction === "publish" && !versionId)}><Check aria-hidden="true"/>{t.confirm}</button></div></section>}
          <footer><button type="submit" className="staff-approve" disabled={busy || selected?.status === "archived"}><Save aria-hidden="true"/>{t.save}</button>{selected && selected.status !== "archived" && <button type="button" disabled={busy || !versionId} onClick={() => setPendingAction("publish")}><BookOpenCheck aria-hidden="true"/>{t.publish}</button>}{selected && <button type="button" className={selected.status === "archived" ? "" : "staff-reject"} disabled={busy} onClick={() => setPendingAction(selected.status === "archived" ? "restore" : "archive")}>{selected.status === "archived" ? <Undo2 aria-hidden="true"/> : <Archive aria-hidden="true"/>}{selected.status === "archived" ? t.restore : t.archive}</button>}</footer>
        </form>
      </div>
    </main>
  </div>;
}

function LanguageFields({ language, label, titleLabel, summaryLabel, content, setField }: { language: Locale; label: string; titleLabel: string; summaryLabel: string; content: Content; setField: <K extends keyof Content>(key: K, value: Content[K]) => void }) {
  const [titleKey, summaryKey] = language === "ru"
    ? ["titleRu", "summaryRu"] as const
    : language === "uz"
      ? ["titleUz", "summaryUz"] as const
      : ["titleEn", "summaryEn"] as const;
  const required = language !== "en";
  return <fieldset><legend>{label}</legend><label>{titleLabel}<input required={required} minLength={3} maxLength={180} value={content[titleKey]} onChange={(event) => setField(titleKey, event.target.value)}/></label><label>{summaryLabel}<textarea required={required} minLength={10} maxLength={500} rows={3} value={content[summaryKey]} onChange={(event) => setField(summaryKey, event.target.value)}/></label></fieldset>;
}

function SectionFields({ label, headingLabel, paragraphsLabel, section, onChange, required = false }: { label: string; headingLabel: string; paragraphsLabel: string; section: Section; onChange: (patch: Partial<Section>) => void; required?: boolean }) {
  return <div className="kb-section-language"><b>{label}</b><label>{headingLabel}<input required={required} minLength={1} maxLength={180} value={section.heading} onChange={(event) => onChange({ heading: event.target.value })}/></label><label>{paragraphsLabel}<textarea required={required} rows={5} value={section.paragraphs.join("\n\n")} onChange={(event) => onChange({ paragraphs: event.target.value.split(/\n\s*\n/).map((item) => item.trim()).filter(Boolean) })}/></label></div>;
}
