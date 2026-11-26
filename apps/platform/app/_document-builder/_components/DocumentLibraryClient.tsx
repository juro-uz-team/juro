"use client";

import { WorkspacePagination, useWorkspacePagination } from "../../_platform/WorkspacePagination";
import { WorkspaceTitle } from "../../_platform/WorkspaceTitle";
import { Library } from "lucide-react";

import { DocumentLanguageControl } from "./DocumentLanguageControl";
import { Select } from "../../_components/Select";

/* eslint-disable react-hooks/set-state-in-effect -- document-language preference follows the route and saved browser choice */

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import {
  ArrowRight,
  Bell,
  Clock3,
  FileCheck2,
  FilePenLine,
  Search,
  ShieldCheck,
  Info,
  UsersRound,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { DocumentCategory } from "../../../lib/document-builder/registry";
import type { WorkspaceLibraryItem } from "../../../lib/document-builder/template-access";
import {
  localize,
  type BuilderLanguage,
} from "../../../lib/document-builder/registry/engine";
import {
  builderNavigationPaths,
  type BuilderNavigationPaths,
} from "../../../lib/platform/builder-paths";
import type { PlatformLocale } from "../../../lib/platform/routing";
import {
  builderUiLocale,
  defaultBuilderDocumentLanguage,
} from "../builder-localization";

const LANGUAGE_KEY = "juro-builder-language";
const TEMPLATE_PAGE_SIZE = 6;

const libraryCopy = {
  ru: {
    documentLanguage: "Язык документа",
    languageNote: "Интерфейс остаётся на русском. Названия шаблонов и анкета показаны на выбранном языке документа.",
    library: "Библиотека документов",
    description: "Создавайте документы пошагово на основе законодательства Узбекистана.",
    available: "доступно шаблонов",
    workspace: "Работа с документами",
    receipt: "Конструктор расписки",
    receiptDetail: "Специализированная пошаговая форма",
    myDocuments: "Мои документы",
    signedInDocuments: "Черновики и готовые файлы",
    signInRequired: "Потребуется вход",
    invitations: "Приглашения и действия",
    invitationsDetail: "Документы, ожидающие согласования",
    contacts: "Стороны и контакты",
    contactsDetail: "Повторное использование данных участников",
    categories: "Категории документов",
    templateCount: "шаблонов",
    allCategories: "Все категории",
    search: "Поиск по названию или коду",
    searchLabel: "Поиск документа по названию или коду",
    status: "Статус",
    allStatuses: "Все статусы",
    verified: "Проверены",
    beta: "Бета · на проверке",
    popular: "Популярные документы",
    allDocuments: "Все документы",
    registry: "Реестр",
    empty: "По вашему запросу документы не найдены.",
    verifiedCard: "Проверен",
    betaCard: "Бета · на проверке",
    minutes: "мин",
    reviewRequired: "Перед подачей требуется проверка юристом.",
    create: "Создать документ",
    unavailable: "Временно недоступен",
  },
  uz: {
    documentLanguage: "Hujjat tili",
    languageNote: "Interfeys o‘zbek tilida qoladi. Shablon nomlari va anketa tanlangan hujjat tilida ko‘rsatiladi.",
    library: "Hujjatlar kutubxonasi",
    description: "O‘zbekiston qonunchiligi asosida bosqichma-bosqich hujjat yarating.",
    available: "mavjud andoza",
    workspace: "Hujjatlar bilan ishlash",
    receipt: "Tilxat konstruktori",
    receiptDetail: "Maxsus bosqichma-bosqich shakl",
    myDocuments: "Mening hujjatlarim",
    signedInDocuments: "Qoralamalar va tayyor fayllar",
    signInRequired: "Kirish talab etiladi",
    invitations: "Takliflar va harakatlar",
    invitationsDetail: "Kelishuvni kutayotgan hujjatlar",
    contacts: "Tomonlar va kontaktlar",
    contactsDetail: "Ishtirokchilar ma’lumotlarini qayta ishlatish",
    categories: "Hujjat toifalari",
    templateCount: "shablon",
    allCategories: "Barcha toifalar",
    search: "Nomi yoki kodi bo‘yicha qidirish",
    searchLabel: "Hujjat nomi yoki kodi bo‘yicha qidirish",
    status: "Holat",
    allStatuses: "Barcha holatlar",
    verified: "Tekshirilgan",
    beta: "Beta · tekshiruvda",
    popular: "Mashhur hujjatlar",
    allDocuments: "Barcha hujjatlar",
    registry: "Reyestr",
    empty: "So‘rov bo‘yicha hujjatlar topilmadi.",
    verifiedCard: "Tekshirilgan",
    betaCard: "Beta · tekshiruvda",
    minutes: "daqiqa",
    reviewRequired: "Topshirishdan oldin yurist tekshiruvi talab etiladi.",
    create: "Hujjat yaratish",
    unavailable: "Vaqtincha mavjud emas",
  },
  en: {
    documentLanguage: "Document language",
    languageNote: "The interface remains in English. Template titles, questionnaire fields and generated content use the selected document language.",
    library: "Document library",
    description: "Create documents step by step using templates prepared for Uzbekistan.",
    available: "templates available",
    workspace: "Document workspace",
    receipt: "Loan receipt builder",
    receiptDetail: "A dedicated step-by-step form",
    myDocuments: "My documents",
    signedInDocuments: "Drafts and generated files",
    signInRequired: "Sign-in required",
    invitations: "Invitations and actions",
    invitationsDetail: "Documents awaiting review or approval",
    contacts: "Parties and contacts",
    contactsDetail: "Reuse participant details securely",
    categories: "Document categories",
    templateCount: "templates",
    allCategories: "All categories",
    search: "Search by title or code",
    searchLabel: "Search documents by title or code",
    status: "Status",
    allStatuses: "All statuses",
    verified: "Verified",
    beta: "Beta · under review",
    popular: "Popular documents",
    allDocuments: "All documents",
    registry: "Registry",
    empty: "No documents match your search.",
    verifiedCard: "Verified",
    betaCard: "Beta · under review",
    minutes: "min",
    reviewRequired: "A lawyer review is required before filing or signing.",
    create: "Create document",
    unavailable: "Temporarily unavailable",
  },
} as const;


function TemplateCard({
  document,
  language,
  uiLocale,
  paths,
}: {
  document: WorkspaceLibraryItem;
  language: BuilderLanguage;
  uiLocale: PlatformLocale;
  paths: BuilderNavigationPaths;
}) {
  const copy = libraryCopy[uiLocale];
  const title = language === "uz" && document.titleUz ? document.titleUz : document.titleRu;
  const description = language === "uz" && document.descriptionUz ? document.descriptionUz : document.descriptionRu;
  const available = document.status === "published";
  const verified = document.editorialStatus === "Published";
  return <article className={`dbt-template-card ${available ? "published" : "review"}`}>
    <div className="dbt-template-card-top"><span className={`dbt-template-state ${verified ? "ready" : "pending"}`}>{verified ? copy.verifiedCard : copy.betaCard}</span><small>№ {document.code}</small></div>
    <h3 title={title}>{title}</h3>
    <p>{description}</p>
    <div className="dbt-template-meta"><span><Clock3 size={15}/>{document.estimatedMinutes ?? 10} {copy.minutes}</span><span><FileCheck2 size={15}/>DOCX · PDF</span></div>
    {!verified && <p className="dbt-card-review-note"><Info size={16} aria-hidden="true"/><span>{copy.reviewRequired}</span></p>}
    {available ? <Link href={paths.template(document.categorySlug, document.code)}>{copy.create}<ArrowRight size={17}/></Link> : <span className="dbt-template-disabled"><ShieldCheck size={16}/>{copy.unavailable}</span>}
  </article>;
}

export function DocumentLibraryClient({
  categories,
  documents,
  activeCategory,
  signedIn = false,
}: {
  categories: readonly DocumentCategory[];
  documents: readonly WorkspaceLibraryItem[];
  activeCategory?: DocumentCategory;
  signedIn?: boolean;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const paths = builderNavigationPaths(pathname, {
    caseId: searchParams.get("caseId"),
    planStepId: searchParams.get("stepId"),
  });
  const uiLocale = builderUiLocale(paths.locale);
  const copy = libraryCopy[uiLocale];
  const [language, setLanguage] = useState<BuilderLanguage>(() => defaultBuilderDocumentLanguage(paths.locale));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "verified" | "beta">("all");

  useEffect(() => {
    if (paths.locale === "ru" || paths.locale === "uz") {
      setLanguage(paths.locale);
      return;
    }
    const stored = window.localStorage.getItem(LANGUAGE_KEY);
    setLanguage(stored === "uz" ? "uz" : "ru");
  }, [paths.locale]);

  const changeLanguage = (next: BuilderLanguage) => {
    setLanguage(next);
    window.localStorage.setItem(LANGUAGE_KEY, next);
  };
  const localizedDocuments = useMemo(() => documents.filter(document => document.languages.includes(language)), [documents, language]);
  const filtered = useMemo(() => localizedDocuments.filter((document) => {
    const value = `${document.titleRu} ${document.titleUz} ${document.descriptionRu} ${document.descriptionUz} ${document.code}`.toLocaleLowerCase();
    const statusMatches = status === "all" || (status === "verified" ? document.editorialStatus === "Published" : document.editorialStatus !== "Published");
    return value.includes(search.trim().toLocaleLowerCase()) && statusMatches;
  }), [localizedDocuments, search, status]);
  const pagination = useWorkspacePagination(filtered.length, TEMPLATE_PAGE_SIZE, JSON.stringify([activeCategory?.slug, language, search, status]));
  const visible = filtered.slice(pagination.from, pagination.to);
  const cards = (items: readonly WorkspaceLibraryItem[]) => items.map((document) => (
    <TemplateCard document={document} language={language} uiLocale={uiLocale} paths={paths} key={document.code}/>
  ));

  return <div className="dbt-library-page workspace-page">
    <WorkspaceTitle icon={<Library />} title={activeCategory ? localize(activeCategory.title, language) : copy.library} description={<><p>{activeCategory ? localize(activeCategory.description, language) : copy.description}</p>{uiLocale === "en" && <small className="dbt-translation-note">{copy.languageNote}</small>}</>} actions={ <><div className="dbt-library-summary"><strong>{localizedDocuments.length}</strong><span>{copy.available}</span></div><DocumentLanguageControl language={language} locale={uiLocale} onChange={changeLanguage}/></> } />
    {!activeCategory && <section className="dbt-workspace-links" aria-label={copy.workspace}>
      {localizedDocuments.some(document => document.code === "0602001") && <Link href={paths.template("debt", "0602001")}><FilePenLine size={21}/><span><strong>{copy.receipt}</strong><small>{copy.receiptDetail}</small></span><ArrowRight size={18}/></Link>}
      <Link href={paths.documents}><FileCheck2 size={21}/><span><strong>{copy.myDocuments}</strong><small>{signedIn ? copy.signedInDocuments : copy.signInRequired}</small></span><ArrowRight size={18}/></Link>
      <Link href={paths.notifications}><Bell size={21}/><span><strong>{copy.invitations}</strong><small>{copy.invitationsDetail}</small></span><ArrowRight size={18}/></Link>
      <Link href={paths.contacts}><UsersRound size={21}/><span><strong>{copy.contacts}</strong><small>{copy.contactsDetail}</small></span><ArrowRight size={18}/></Link>
    </section>}
    {!activeCategory && <details className="dbt-library-disclosure"><summary className="juro-disclosure-summary">{copy.categories}</summary><nav className="dbt-category-grid" aria-label={copy.categories}>{categories.map((category) => {
      const count = localizedDocuments.filter((document) => document.categorySlug === category.slug).length;
      if (count === 0) return null;
      return <Link href={paths.category(category.slug)} key={category.slug}><span>{category.code}</span><div><h2>{localize(category.title, language)}</h2><p>{localize(category.description, language)}</p><small>{count} {copy.templateCount}</small></div><ArrowRight size={20}/></Link>;
    })}</nav></details>}
    {activeCategory && <div className="dbt-library-breadcrumb"><Link href={paths.library}>{copy.allCategories}</Link><span>/</span><b>{localize(activeCategory.title, language)}</b></div>}
    <div className="dbt-library-tools"><label><Search size={18}/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder={copy.search} aria-label={copy.searchLabel}/></label><Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label={copy.status}><option value="all">{copy.allStatuses}</option><option value="verified">{copy.verified}</option><option value="beta">{copy.beta}</option></Select></div>
    {activeCategory && filtered.some(document => document.popular) && <details className="dbt-library-disclosure"><summary className="juro-disclosure-summary">{copy.popular}</summary><div className="dbt-template-grid">{cards(filtered.filter((document) => document.popular))}</div></details>}
    <section className="dbt-all-templates"><div className="dbt-section-heading"><h2>{activeCategory ? copy.allDocuments : copy.registry}</h2><p className="dbt-result-count" role="status">{uiLocale === "ru" ? `Всего шаблонов · ${filtered.length}` : uiLocale === "uz" ? `Jami shablonlar · ${filtered.length}` : `Templates · ${filtered.length}`}</p></div><div className="dbt-template-grid">{cards(visible)}</div><WorkspacePagination locale={uiLocale} {...pagination} />{filtered.length === 0 && <div className="dbt-library-empty">{copy.empty}</div>}</section>
  </div>;
}
