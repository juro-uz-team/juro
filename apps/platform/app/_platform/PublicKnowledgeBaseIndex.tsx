import { ArrowRight, BookOpenCheck, Search } from "lucide-react";
import Link from "next/link";

import type { KnowledgeBaseArticleSummary } from "../../lib/platform/knowledge-base";
import type { PlatformLocale } from "../../lib/platform/routing";

const indexCopy = {
  ru: {
    title: "База знаний JURO",
    description: "Проверенные инструкции по AI-юристу, документам, делам и безопасности.",
    search: "Поиск по статьям",
    find: "Найти",
    emptyTitle: "Статьи не найдены",
    emptyDescription: "Измените запрос или откройте полный список.",
    reset: "Сбросить поиск",
    version: (value: number) => `Версия ${value}`,
    signIn: "Войти в JURO",
  },
  uz: {
    title: "JURO bilimlar bazasi",
    description: "AI-yurist, hujjatlar, ishlar va xavfsizlik bo‘yicha tekshirilgan yo‘riqnomalar.",
    search: "Maqolalardan qidirish",
    find: "Qidirish",
    emptyTitle: "Maqolalar topilmadi",
    emptyDescription: "So‘rovni o‘zgartiring yoki to‘liq ro‘yxatni oching.",
    reset: "Qidiruvni tozalash",
    version: (value: number) => `${value}-versiya`,
    signIn: "JURO ga kirish",
  },
  en: {
    title: "JURO knowledge base",
    description: "Verified guidance for JURO AI, documents, matters and account security.",
    search: "Search articles",
    find: "Search",
    emptyTitle: "No articles found",
    emptyDescription: "Try a different search or return to the complete list.",
    reset: "Clear search",
    version: (value: number) => `Version ${value}`,
    signIn: "Sign in to JURO",
  },
} as const;

const languageNames = { ru: "Русский", uz: "O‘zbekcha", en: "English" } as const;

export function PublicKnowledgeBaseIndex({ locale, articles, query }: { locale: PlatformLocale; articles: KnowledgeBaseArticleSummary[]; query: string }) {
  const copy = indexCopy[locale];
  const alternateLocales = (["ru", "uz", "en"] as const).filter((value) => value !== locale);
  return <main className="public-knowledge" id="main-content">
    <header><BookOpenCheck aria-hidden="true" /><div><h1>{copy.title}</h1><p>{copy.description}</p></div></header>
    <form role="search" data-focus-field method="get">
      <label className="sr-only" htmlFor="public-knowledge-search">{copy.search}</label>
      <Search aria-hidden="true" /><input id="public-knowledge-search" type="search" name="q" defaultValue={query} maxLength={120} placeholder={copy.search} /><button>{copy.find}</button>
    </form>
    {articles.length === 0 ? <section className="public-knowledge-empty"><h2>{copy.emptyTitle}</h2><p>{copy.emptyDescription}</p>{query && <Link href={`/${locale}/help`}>{copy.reset}</Link>}</section> : <ul>{articles.map((article) => <li key={article.slug}><Link href={`/${locale}/help/${article.slug}`}><span><strong>{article.title}</strong><small>{article.summary}</small></span><span>{copy.version(article.versionNumber)}<ArrowRight aria-hidden="true" /></span></Link></li>)}</ul>}
    <footer><Link href={`/${locale}/auth/login`}>{copy.signIn}</Link>{alternateLocales.map((value) => <Link key={value} href={`/${value}/help`}>{languageNames[value]}</Link>)}</footer>
  </main>;
}
