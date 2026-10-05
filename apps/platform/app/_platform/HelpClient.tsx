"use client";

import { Select } from "../_components/Select";

import { usePlatformBasePath } from "./PlatformRouteContext";
import Link from "next/link";
import { ArrowRight, BookOpenCheck, Bot, ExternalLink, FilePenLine, HelpCircle, LoaderCircle, Scale, Search, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { platformApiError } from "../../content/platform-ui";
import type { AccountType, PlatformLocale } from "../../lib/platform/routing";

type SupportCategory = "technical" | "ai_error" | "wrong_norm" | "document" | "ocr" | "tariff" | "lawyer" | "privacy" | "security" | "deletion" | "workspace" | "feedback" | "other";
type SupportSeverity = "low" | "normal" | "high" | "critical";
type SupportStatus = "open" | "waiting_user" | "resolved";
type KnowledgeArticle = { slug: string; category: string; versionNumber: number; title: string; summary: string; updatedAt: string };

const supportCopy = {
  ru: { category: "Категория", severity: "Срочность", technical: "Техническая проблема", ai_error: "Ошибка AI", wrong_norm: "Неверная норма", document: "Документ", ocr: "Распознавание", tariff: "Тариф", lawyer: "Юрист", privacy: "Приватность", security: "Безопасность", deletion: "Удаление данных", workspace: "Рабочее пространство", feedback: "Отзыв", other: "Другое", low: "Низкая", normal: "Обычная", high: "Высокая", critical: "Критическая", open: "Открыто", waiting_user: "Ожидается ваш ответ", resolved: "Решено", historyLoading: "Загружаем обращения…", historyUpdated: "Список обращений обновлён", detailsLoaded: "Детали обращения загружены" },
  uz: { category: "Kategoriya", severity: "Muhimlik", technical: "Texnik muammo", ai_error: "AI xatosi", wrong_norm: "Noto‘g‘ri norma", document: "Hujjat", ocr: "Matnni tanish", tariff: "Tarif", lawyer: "Yurist", privacy: "Maxfiylik", security: "Xavfsizlik", deletion: "Ma’lumotlarni o‘chirish", workspace: "Ish maydoni", feedback: "Fikr-mulohaza", other: "Boshqa", low: "Past", normal: "Oddiy", high: "Yuqori", critical: "Muhim", open: "Ochiq", waiting_user: "Javobingiz kutilmoqda", resolved: "Hal qilindi", historyLoading: "Murojaatlar yuklanmoqda…", historyUpdated: "Murojaatlar ro‘yxati yangilandi", detailsLoaded: "Murojaat tafsilotlari yuklandi" },
  en: { category: "Category", severity: "Urgency", technical: "Technical issue", ai_error: "AI issue", wrong_norm: "Incorrect legal reference", document: "Document", ocr: "Text recognition", tariff: "Billing", lawyer: "Lawyer", privacy: "Privacy", security: "Security", deletion: "Data deletion", workspace: "Workspace", feedback: "Feedback", other: "Other", low: "Low", normal: "Standard", high: "High", critical: "Critical", open: "Open", waiting_user: "Waiting for your reply", resolved: "Resolved", historyLoading: "Loading support requests…", historyUpdated: "Support requests updated", detailsLoaded: "Request details loaded" },
} as const;

const pageCopy = {
  ru: {
    knowledgeLoadFailed: "Не удалось загрузить базу знаний. Повторите попытку.", ticketsLoadFailed: "Не удалось загрузить обращения.", ticketOpenFailed: "Не удалось открыть обращение.", requestFailed: "Не удалось выполнить запрос.", sent: "Обращение отправлено.", replySent: "Ответ отправлен в поддержку.", title: "Помощь", description: "Короткие маршруты к рабочим функциям и правилам платформы — без декоративных кнопок и вымышленного статуса поддержки.", knowledgeTitle: "База знаний", knowledgeDescription: "Проверенные инструкции по функциям JURO. У каждой статьи есть версия и дата обновления.", knowledgeSearch: "Поиск по базе знаний", knowledgePlaceholder: "Например, источники или 2FA", find: "Найти", articlesLoading: "Загружаем статьи…", articlesEmpty: "По вашему запросу статей нет.", retry: "Повторить", version: (value: number, date: string) => `Версия ${value} · ${date}`, aiTitle: "Начать с ситуации", aiDescription: "AI-модуль собирает факты и показывает только проверяемые следующие шаги. Если провайдер не настроен, интерфейс честно сообщает об этом.", aiAction: "Открыть AI-юриста", documentTitle: "Создать документ", documentDescription: "Выберите шаблон, заполните вопросы, сохраните черновик и сформируйте DOCX или PDF. Язык итогового документа показывается до экспорта.", documentAction: "Открыть конструктор", specialistTitle: "Передать специалисту", specialistDescription: "В консультации передаётся только выбранный контекст после отдельного согласия. Заявка не считается назначенной до подтверждения специалистом.", specialistAction: "Посмотреть консультации", securityTitle: "Данные и безопасность", securityDescription: "Управляйте активными сессиями, экспортом данных, согласиями и запросом удаления в настройках.", securityAction: "Открыть приватность", supportTitle: "Написать в поддержку", subject: "Тема", message: "Сообщение", send: "Отправить", requestsTitle: "Мои обращения", refresh: "Обновить", requestsEmpty: "Здесь появится статус и ответ поддержки.", staff: "Поддержка JURO", you: "Вы", reply: "Ответить", sendReply: "Отправить ответ", rulesTitle: "Правила и ответы", rulesDescription: "Условия приложения, политика конфиденциальности и правила AI опубликованы отдельно от документов публичного сайта.", terms: "Условия", aiRules: "Правила AI", siteFaq: "FAQ сайта",
  },
  uz: {
    knowledgeLoadFailed: "Bilimlar bazasini yuklab bo‘lmadi. Qayta urinib ko‘ring.", ticketsLoadFailed: "Murojaatlarni yuklab bo‘lmadi.", ticketOpenFailed: "Murojaatni ochib bo‘lmadi.", requestFailed: "So‘rovni bajarib bo‘lmadi.", sent: "Murojaat yuborildi.", replySent: "Javob qo‘llab-quvvatlashga yuborildi.", title: "Yordam", description: "Ish funksiyalari va platforma qoidalariga qisqa yo‘llar — bezak tugmalari va soxta qo‘llab-quvvatlash holatisiz.", knowledgeTitle: "Bilimlar bazasi", knowledgeDescription: "JURO funksiyalari bo‘yicha tekshirilgan yo‘riqnomalar. Har bir maqolada versiya va yangilanish sanasi bor.", knowledgeSearch: "Bilimlar bazasidan qidirish", knowledgePlaceholder: "Masalan, manbalar yoki 2FA", find: "Qidirish", articlesLoading: "Maqolalar yuklanmoqda…", articlesEmpty: "So‘rovingiz bo‘yicha maqola topilmadi.", retry: "Qayta urinish", version: (value: number, date: string) => `${value}-versiya · ${date}`, aiTitle: "Vaziyatdan boshlash", aiDescription: "AI moduli faktlarni yig‘adi va faqat tekshiriladigan keyingi qadamlarni ko‘rsatadi. Provayder sozlanmagan bo‘lsa, interfeys bu haqda ochiq xabar beradi.", aiAction: "AI-yuristni ochish", documentTitle: "Hujjat yaratish", documentDescription: "Shablonni tanlang, savollarga javob bering, qoralamani saqlang va DOCX yoki PDF yarating. Yakuniy hujjat tili eksportdan oldin ko‘rsatiladi.", documentAction: "Konstruktorni ochish", specialistTitle: "Mutaxassisga topshirish", specialistDescription: "Maslahatda faqat alohida rozilik bilan tanlangan kontekst beriladi. Mutaxassis tasdiqlamaguncha so‘rov tayinlangan hisoblanmaydi.", specialistAction: "Maslahatlarni ko‘rish", securityTitle: "Ma’lumot va xavfsizlik", securityDescription: "Sozlamalarda faol sessiyalar, ma’lumot eksporti, roziliklar va o‘chirish so‘rovini boshqaring.", securityAction: "Maxfiylikni ochish", supportTitle: "Qo‘llab-quvvatlashga yozish", subject: "Mavzu", message: "Xabar", send: "Yuborish", requestsTitle: "Mening murojaatlarim", refresh: "Yangilash", requestsEmpty: "Bu yerda qo‘llab-quvvatlash holati va javobi ko‘rinadi.", staff: "JURO qo‘llab-quvvatlash", you: "Siz", reply: "Javob berish", sendReply: "Javobni yuborish", rulesTitle: "Qoidalar va javoblar", rulesDescription: "Ilova shartlari, maxfiylik siyosati va AI qoidalari ommaviy sayt hujjatlaridan alohida e’lon qilingan.", terms: "Shartlar", aiRules: "AI qoidalari", siteFaq: "Sayt FAQ",
  },
  en: {
    knowledgeLoadFailed: "We could not load the knowledge base. Please try again.", ticketsLoadFailed: "We could not load your support requests.", ticketOpenFailed: "We could not open this support request.", requestFailed: "We could not complete the request.", sent: "Your support request has been sent.", replySent: "Your reply has been sent to JURO Support.", title: "Help and support", description: "Direct access to JURO guidance, support and account safeguards — with clear, verifiable service status.", knowledgeTitle: "Knowledge base", knowledgeDescription: "Verified guidance for JURO features. Every article includes its version and last update date.", knowledgeSearch: "Search the knowledge base", knowledgePlaceholder: "For example, sources or 2FA", find: "Search", articlesLoading: "Loading articles…", articlesEmpty: "No articles match your search.", retry: "Try again", version: (value: number, date: string) => `Version ${value} · ${date}`, aiTitle: "Start with your situation", aiDescription: "JURO AI gathers the relevant facts and presents verifiable next steps. If a provider is unavailable, the interface says so clearly.", aiAction: "Open JURO AI", documentTitle: "Create a document", documentDescription: "Choose a template, answer the guided questions, save a draft, then export DOCX or PDF. The document language is shown before export.", documentAction: "Open document builder", specialistTitle: "Ask a lawyer", specialistDescription: "Only the context you select is shared, and only after separate consent. A request is not assigned until a lawyer accepts it.", specialistAction: "View consultations", securityTitle: "Data and security", securityDescription: "Manage active sessions, data exports, consent records and deletion requests in Settings.", securityAction: "Open privacy settings", supportTitle: "Contact support", subject: "Subject", message: "Message", send: "Send request", requestsTitle: "My support requests", refresh: "Refresh", requestsEmpty: "Request status and replies from JURO Support will appear here.", staff: "JURO Support", you: "You", reply: "Reply", sendReply: "Send reply", rulesTitle: "Policies and guidance", rulesDescription: "App terms, the privacy policy and JURO AI rules are published separately from the public website documents.", terms: "Terms", aiRules: "AI rules", siteFaq: "Website FAQ",
  },
} as const;

const supportCategories: SupportCategory[] = ["technical", "ai_error", "wrong_norm", "document", "ocr", "tariff", "lawyer", "privacy", "security", "deletion", "workspace", "feedback", "other"];
const supportSeverities: SupportSeverity[] = ["low", "normal", "high", "critical"];

export function HelpClient({ locale }: { locale: PlatformLocale; accountType: AccountType }) {
  const copy = pageCopy[locale];
  const support = supportCopy[locale];
  const base = usePlatformBasePath();
  const [subject, setSubject] = useState(""); const [message, setMessage] = useState(""); const [category, setCategory] = useState<SupportCategory>("technical"); const [severity, setSeverity] = useState<SupportSeverity>("normal"); const [sending, setSending] = useState(false); const [loadingTickets, setLoadingTickets] = useState(false); const [supportStatus, setSupportStatus] = useState("");
  const [tickets, setTickets] = useState<Array<{ id: string; subject: string; status: SupportStatus }>>([]);
  const [selectedTicket, setSelectedTicket] = useState<{ id: string; subject: string; status: SupportStatus; messages: Array<{ id: string; authorType: "requester" | "staff"; body: string }> } | null>(null);
  const [reply, setReply] = useState(""); const [replying, setReplying] = useState(false);
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [knowledgeArticles, setKnowledgeArticles] = useState<KnowledgeArticle[]>([]);
  const [loadingKnowledge, setLoadingKnowledge] = useState(true);
  const [knowledgeError, setKnowledgeError] = useState("");
  const loadKnowledge = useCallback(async (query = "") => {
    setLoadingKnowledge(true); setKnowledgeError("");
    try {
      const params = new URLSearchParams({ locale });
      if (query.trim()) params.set("q", query.trim());
      const response = await fetch(`/api/help/articles?${params.toString()}`, { cache: "no-store" });
      const body = await response.json() as { articles?: KnowledgeArticle[]; error?: string };
      if (!response.ok) throw new Error(body.error || "Knowledge base unavailable");
      setKnowledgeArticles(body.articles ?? []);
    } catch {
      setKnowledgeError(copy.knowledgeLoadFailed);
    } finally { setLoadingKnowledge(false); }
  }, [copy.knowledgeLoadFailed, locale]);
  const loadTickets = useCallback(async () => { setLoadingTickets(true); try { const response = await fetch("/api/platform/support-tickets", { cache: "no-store", headers: { "x-juro-locale": locale } }); const body = await response.json() as { tickets?: Array<{ id: string; subject: string; status: SupportStatus }> }; if (!response.ok) throw new Error(); setTickets(body.tickets ?? []); setSupportStatus(support.historyUpdated); } catch { setSupportStatus(copy.ticketsLoadFailed); } finally { setLoadingTickets(false); } }, [copy.ticketsLoadFailed, locale, support.historyUpdated]);
  useEffect(() => { const timer = window.setTimeout(() => void loadTickets(), 0); return () => window.clearTimeout(timer); }, [loadTickets]);
  useEffect(() => { const timer = window.setTimeout(() => void loadKnowledge(), 0); return () => window.clearTimeout(timer); }, [loadKnowledge]);
  async function openTicket(ticketId: string) { setLoadingTickets(true); try { const response = await fetch(`/api/platform/support-tickets/${encodeURIComponent(ticketId)}`, { cache: "no-store", headers: { "x-juro-locale": locale } }); const body = await response.json() as { ticket?: { id: string; subject: string; status: SupportStatus }; messages?: Array<{ id: string; authorType: "requester" | "staff"; body: string }> }; if (!response.ok || !body.ticket) throw new Error(); setSelectedTicket({ ...body.ticket, messages: body.messages ?? [] }); setReply(""); setSupportStatus(support.detailsLoaded); } catch { setSupportStatus(copy.ticketOpenFailed); } finally { setLoadingTickets(false); } }

  async function submitSupport(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setSending(true); setSupportStatus(""); try { const response = await fetch("/api/platform/support-tickets", { method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale }, body: JSON.stringify({ category, severity, subject, message, locale }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.requestFailed)); setSubject(""); setMessage(""); setSupportStatus(copy.sent); await loadTickets(); } catch (value) { setSupportStatus(value instanceof Error ? value.message : copy.requestFailed); } finally { setSending(false); } }
  async function submitReply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); if (!selectedTicket || !reply.trim()) return; setReplying(true); try { const response = await fetch(`/api/platform/support-tickets/${encodeURIComponent(selectedTicket.id)}`, { method: "POST", headers: { "content-type": "application/json", "x-juro-csrf": "1", "x-juro-locale": locale }, body: JSON.stringify({ message: reply.trim() }) }); const body = await response.json() as { error?: string }; if (!response.ok) throw new Error(platformApiError(locale, body.error, copy.requestFailed)); setReply(""); await openTicket(selectedTicket.id); await loadTickets(); setSupportStatus(copy.replySent); } catch (value) { setSupportStatus(value instanceof Error ? value.message : copy.requestFailed); } finally { setReplying(false); } }
  return (
    <section className="help-workspace">
      <header>
        <HelpCircle />
        <div>
          <small>JURO · HELP</small>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
        </div>
      </header>
      <section className="help-knowledge" aria-labelledby="knowledge-title">
        <div className="help-knowledge-heading">
          <div>
            <h2 id="knowledge-title">{copy.knowledgeTitle}</h2>
            <p>{copy.knowledgeDescription}</p>
          </div>
          <form role="search" onSubmit={(event) => { event.preventDefault(); void loadKnowledge(knowledgeQuery); }}>
            <label className="sr-only" htmlFor="knowledge-search">{copy.knowledgeSearch}</label>
            <Search aria-hidden="true" />
            <input id="knowledge-search" type="search" value={knowledgeQuery} maxLength={120} onChange={(event) => setKnowledgeQuery(event.target.value)} placeholder={copy.knowledgePlaceholder} />
            <button type="submit" disabled={loadingKnowledge}>{copy.find}</button>
          </form>
        </div>
        <div className="help-knowledge-status" role="status" aria-live="polite">
          {loadingKnowledge ? copy.articlesLoading : knowledgeError || (knowledgeArticles.length === 0 ? copy.articlesEmpty : "")}
        </div>
        {!loadingKnowledge && knowledgeError && <button className="help-retry" type="button" onClick={() => void loadKnowledge(knowledgeQuery)}>{copy.retry}</button>}
        {!loadingKnowledge && !knowledgeError && knowledgeArticles.length > 0 && <ul className="help-knowledge-list">
          {knowledgeArticles.map((article) => <li key={article.slug}>
            <Link href={`${base}/help/${article.slug}`}>
              <span><strong>{article.title}</strong><small>{article.summary}</small></span>
              <span className="help-knowledge-meta">{copy.version(article.versionNumber, formatKnowledgeDate(article.updatedAt, locale))}<ArrowRight aria-hidden="true" /></span>
            </Link>
          </li>)}
        </ul>}
      </section>
      <div className="help-grid">
        <article>
          <Bot />
          <h2>{copy.aiTitle}</h2>
          <p>{copy.aiDescription}</p>
          <Link href={`${base}/ai-chat`}>{copy.aiAction}</Link>
        </article>
        <article>
          <FilePenLine />
          <h2>{copy.documentTitle}</h2>
          <p>{copy.documentDescription}</p>
          <Link href={`${base}/document-builder`}>{copy.documentAction}</Link>
        </article>
        <article>
          <Scale />
          <h2>{copy.specialistTitle}</h2>
          <p>{copy.specialistDescription}</p>
          <Link href={`${base}/consultations`}>{copy.specialistAction}</Link>
        </article>
        <article>
          <ShieldCheck />
          <h2>{copy.securityTitle}</h2>
          <p>{copy.securityDescription}</p>
          <Link href={`${base}/settings/privacy`}>{copy.securityAction}</Link>
        </article>
      </div>
      <form className="help-support" onSubmit={(event) => void submitSupport(event)} aria-busy={sending}>
        <h2>{copy.supportTitle}</h2>
        <div className="help-support-selects"><label>{support.category}<Select value={category} onChange={(event) => setCategory(event.target.value as SupportCategory)}>{supportCategories.map((value) => <option key={value} value={value}>{support[value]}</option>)}</Select></label><label>{support.severity}<Select value={severity} onChange={(event) => setSeverity(event.target.value as SupportSeverity)}>{supportSeverities.map((value) => <option key={value} value={value}>{support[value]}</option>)}</Select></label></div>
        <label>{copy.subject}<input value={subject} minLength={4} maxLength={180} required onChange={(event) => setSubject(event.target.value)} /></label>
        <label>{copy.message}<textarea value={message} minLength={10} maxLength={8000} required onChange={(event) => setMessage(event.target.value)} /></label>
        {supportStatus && <p role="status" aria-live="polite">{supportStatus}</p>}
        <button disabled={sending}>{sending && <LoaderCircle className="spin" />}{copy.send}</button>
      </form>
      <section className="help-ticket-history" aria-labelledby="support-history-title">
        <div className="help-ticket-heading"><h2 id="support-history-title">{copy.requestsTitle}</h2><button type="button" onClick={() => void loadTickets()} disabled={loadingTickets}>{copy.refresh}</button></div>
        {loadingTickets && tickets.length === 0 ? <p role="status">{support.historyLoading}</p> : tickets.length === 0 ? <p>{copy.requestsEmpty}</p> : <ul>{tickets.map((ticket) => <li key={ticket.id}><button type="button" onClick={() => void openTicket(ticket.id)} disabled={loadingTickets} aria-label={`${ticket.subject}: ${support[ticket.status]}`}><strong>{ticket.subject}</strong><span>{support[ticket.status]}</span></button></li>)}</ul>}
        {selectedTicket && <section className="help-ticket-thread" aria-live="polite"><h3>{selectedTicket.subject}</h3><p>{support[selectedTicket.status]}</p>{selectedTicket.messages.map((item) => <article key={item.id} data-author={item.authorType}><strong>{item.authorType === "staff" ? copy.staff : copy.you}</strong><p>{item.body}</p></article>)}{selectedTicket.status !== "resolved" && <form className="help-ticket-reply" onSubmit={(event) => void submitReply(event)} aria-busy={replying}><label>{copy.reply}<textarea required minLength={1} maxLength={8000} value={reply} onChange={(event) => setReply(event.target.value)} /></label><button disabled={replying || !reply.trim()}>{replying && <LoaderCircle className="spin" />}{copy.sendReply}</button></form>}</section>}
      </section>
      <aside className="help-legal">
        <BookOpenCheck />
        <div>
          <h2>{copy.rulesTitle}</h2>
          <p>{copy.rulesDescription}</p>
        </div>
        <span>
          <Link href={`/legal/terms?lang=${locale}`}>{copy.terms}</Link>
          <Link href={`/legal/ai-rules?lang=${locale}`}>{copy.aiRules}</Link>
          <a href={`https://juro.uz/${locale}#faq`} target="_blank" rel="noreferrer">{copy.siteFaq}<ExternalLink /></a>
        </span>
      </aside>
    </section>
  );
}

function formatKnowledgeDate(value: string, locale: PlatformLocale): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat({ ru: "ru-RU", uz: "uz-UZ", en: "en-GB" }[locale], { day: "2-digit", month: "short", year: "numeric" }).format(date);
}
