import { publicMetadata } from "../../../lib/public-seo";
import { searchPages } from "../../../content/search-pages";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { experience } from "../../../content/experience";
import type { PublicLanguage } from "../../../content/types";
import { SiteFooter, SiteHeader } from "../../components/public/SiteChrome";
import { legalConfig } from "../../legal-config";
import styles from "./trust.module.css";

type Props = { params: Promise<{ locale: string }> };

function parseLocale(value: string): PublicLanguage | null {
  return value === "ru" || value === "uz" || value === "en" ? value : null;
}

export function generateStaticParams() {
  return [{ locale: "ru" }, { locale: "uz" }, { locale: "en" }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
 const locale = parseLocale((await params).locale);
 if (!locale) return {};
 return publicMetadata({ locale, ...searchPages[locale].trust, path: "/trust", image: "trust" });
}

function EnglishTrustPage() {
  const sections = [
    ["Documents and work data", "Personal cases and documents are private work objects and are not included in public pages or the sitemap. This public page does not accept real files; work begins after entering a protected account.", "Confirmed by the public-site structure"],
    ["Employee and participant access", "Users manage invitations and select what they share. Access to private objects must be checked on the server by session, role and participant permissions. An internal list of staff with administrative access requires separate publication by the operator.", "Mechanism confirmed; internal list is being clarified"],
    ["Retention and deletion", "The period depends on the data type, account state and mandatory requirements. A user can initiate a request through an available in-app channel. JURO does not claim one universal retention period before a schedule is approved.", "Process described; exact periods are being clarified"],
    ["Temporary links", "Private files should not be published at permanent public URLs. Temporary links and their lifetime are used where implemented; archiving a separately saved signed PDF makes an active link invalid.", "Confirmed by the product process"],
    ["AI providers and subprocessors", "The final list of production providers, processing regions and subprocessors will be published after the architecture and contractual terms are approved. Until then, JURO does not make unverified claims about data localisation or training models on documents.", "Being clarified before production launch"],
    ["Encryption, logging and standards", "JURO does not claim certifications, specific encryption algorithms or standards compliance without technical evidence. Verified information will be added with its last-checked date.", "Not claimed without confirmation"],
  ] as const;
  return <div className={styles.page} lang="en">
    <SiteHeader languageHref="/ru/trust" locale="en" />
    <main id="main-content">
      <section className={styles.hero}><div className={styles.heroCopy}><div className={styles.breadcrumbs}><Link href="/en">JURO</Link><span>/</span><span>Trust Center</span></div><span className={styles.eyebrow}>TRUST CENTER</span><h1>Security, data and transparency</h1><p>JURO separates verified product facts from information that is still being clarified.</p><small>Last public review: 9 August 2026</small></div><aside className={styles.heroIndex} aria-label="Data-control map"><span>DATA FLOW</span><ol><li><b>01</b><strong>Public website</strong><small>no file upload</small></li><li><b>02</b><strong>Protected account</strong><small>session and permissions</small></li><li><b>03</b><strong>Professional handoff</strong><small>only with confirmation</small></li></ol></aside></section>
      <section className={styles.architecture} aria-labelledby="trust-flow-title"><header><span>HOW DATA MOVES</span><h2 id="trust-flow-title">The user remains in control at every transition</h2><p>The public website does not upload anything. Work on a question or document begins in a protected account, and handing context to a professional requires a separate action.</p></header><ol><li><span>01</span><strong>Public website</strong><p>Explore JURO without real files or personal case data.</p></li><li><span>02</span><strong>Protected account</strong><p>Session, role and permissions determine access.</p></li><li><span>03</span><strong>Work object</strong><p>A question, case and document remain private.</p></li><li><span>04</span><strong>Professional handoff</strong><p>Only selected context, with separate confirmation.</p></li></ol></section>
      <section className={styles.details}><header><span>DETAILS</span><h2>What is confirmed and what is still being clarified</h2></header><div>{sections.map(([title, body, state]) => <article key={title}><span>{state}</span><h3>{title}</h3><p>{body}</p></article>)}</div></section>
      <section className={styles.policies}><h2>Policies and rules</h2><div><Link href="/en/legal">Legal Centre</Link><Link href="/en/terms">Terms of use</Link><Link href="/en/privacy-policy">Privacy policy</Link><Link href="/en/personal-data-processing">Personal data processing</Link><Link href="/en/cookies">Cookies</Link><Link href="/en/ai-rules">AI rules</Link></div></section>
      <section className={styles.contact}><h2>Question about security or data?</h2><p>For privacy and data-processing questions, use JURO’s published contact.</p><a href={`mailto:${legalConfig.contacts.privacyEmail}`}>Contact us about data</a></section>
    </main>
    <SiteFooter locale="en" />
  </div>;
}

export default async function TrustPage({ params }: Props) {
  const { locale: rawLocale } = await params;
  const locale = parseLocale(rawLocale);
  if (!locale) notFound();
  if (locale === "en") return <EnglishTrustPage />;
  const ru = locale === "ru";
  const summary = experience[locale].trust;

  const sections = ru ? [
    {
      title: "Документы и рабочие данные",
      body: "Личные дела и документы относятся к приватным рабочим объектам и не входят в публичные страницы или sitemap. Реальные файлы не принимаются на публичном лендинге: работа с ними начинается после перехода в защищённый аккаунт.",
      state: "Подтверждено структурой публичного сайта",
    },
    {
      title: "Доступ сотрудников и участников",
      body: "Пользователь управляет приглашениями и выбирает материалы для передачи. Доступ к приватным объектам должен проверяться на сервере по сессии, роли и правам участника. Конкретный внутренний перечень сотрудников с административным доступом требует отдельной публикации оператором.",
      state: "Механика подтверждена; внутренний перечень уточняется",
    },
    {
      title: "Хранение и удаление",
      body: "Срок зависит от типа данных, состояния аккаунта и обязательных требований. Пользователь может инициировать запрос через доступный в приложении канал. До утверждения таблицы сроков JURO не заявляет единый универсальный период хранения.",
      state: "Процесс описан; точные сроки уточняются",
    },
    {
      title: "Временные ссылки",
      body: "Приватные файлы не должны публиковаться по постоянным открытым адресам. Временные ссылки и их срок действия применяются там, где это реализовано в продукте; архивирование отдельно сохранённого подписанного PDF делает активную ссылку недействительной.",
      state: "Подтверждено продуктовым процессом",
    },
    {
      title: "AI-провайдеры и subprocessors",
      body: "Финальный перечень production-провайдеров, регионов обработки и subprocessors будет опубликован после утверждения архитектуры и договорных условий. До этого JURO не делает неподтверждённых заявлений о локализации данных или использовании документов для обучения моделей.",
      state: "Уточняется до production-запуска",
    },
    {
      title: "Шифрование, журналирование и стандарты",
      body: "JURO не заявляет сертификаты, конкретные алгоритмы шифрования или соответствие стандартам без технического подтверждения. Проверенные сведения будут добавляться с датой последней проверки.",
      state: "Не заявляется без подтверждения",
    },
  ] : [
    {
      title: "Hujjatlar va ish ma’lumotlari",
      body: "Shaxsiy ishlar va hujjatlar yopiq ish obyektlariga kiradi va ommaviy sahifa yoki sitemapga qo‘shilmaydi. Ommaviy landing haqiqiy fayllarni qabul qilmaydi: ular bilan ishlash himoyalangan akkauntga o‘tgach boshlanadi.",
      state: "Ommaviy sayt tuzilmasi bilan tasdiqlangan",
    },
    {
      title: "Xodim va ishtirokchilar kirishi",
      body: "Foydalanuvchi takliflarni boshqaradi va uzatiladigan materiallarni tanlaydi. Yopiq obyektlarga kirish serverda sessiya, rol va ishtirokchi huquqlari bo‘yicha tekshirilishi kerak. Ma’muriy kirishga ega xodimlarning ichki ro‘yxati operator tomonidan alohida e’lon qilinishi kerak.",
      state: "Mexanizm tasdiqlangan; ichki ro‘yxat aniqlashtirilmoqda",
    },
    {
      title: "Saqlash va o‘chirish",
      body: "Muddat ma’lumot turi, akkaunt holati va majburiy talablarga bog‘liq. Foydalanuvchi ilovadagi mavjud kanal orqali so‘rov boshlashi mumkin. Muddatlar jadvali tasdiqlanmaguncha JURO yagona umumiy saqlash muddatini e’lon qilmaydi.",
      state: "Jarayon bayon qilingan; aniq muddatlar aniqlashtirilmoqda",
    },
    {
      title: "Vaqtinchalik havolalar",
      body: "Yopiq fayllar doimiy ochiq manzillarda e’lon qilinmasligi kerak. Vaqtinchalik havola va uning muddati mahsulotda amalga oshirilgan joylarda qo‘llanadi; alohida saqlangan imzolangan PDF arxivlanganda faol havola bekor bo‘ladi.",
      state: "Mahsulot jarayoni bilan tasdiqlangan",
    },
    {
      title: "AI-provayderlar va subprocessors",
      body: "Production provayderlari, qayta ishlash hududlari va subprocessorsning yakuniy ro‘yxati arxitektura va shartnoma shartlari tasdiqlangach e’lon qilinadi. Ungacha JURO ma’lumotlar lokalizatsiyasi yoki hujjatlarning modelni o‘qitishda ishlatilishi haqida tasdiqlanmagan bayonot bermaydi.",
      state: "Production ishga tushishidan oldin aniqlashtirilmoqda",
    },
    {
      title: "Shifrlash, jurnallash va standartlar",
      body: "JURO texnik tasdiqsiz sertifikatlar, shifrlash algoritmlari yoki standartlarga muvofiqlikni e’lon qilmaydi. Tekshirilgan ma’lumot so‘nggi tekshiruv sanasi bilan qo‘shiladi.",
      state: "Tasdiqsiz e’lon qilinmaydi",
    },
  ];

  return (
    <div className={styles.page} lang={locale}>
      <SiteHeader languageHref={`/${locale === "ru" ? "uz" : "ru"}/trust`} locale={locale} />
      <main id="main-content">
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <div className={styles.breadcrumbs}><Link href={`/${locale}`}>JURO</Link><span>/</span><span>Trust Center</span></div>
            <span className={styles.eyebrow}>TRUST CENTER</span>
            <h1>{ru ? "Безопасность, данные и прозрачность" : "Xavfsizlik, ma’lumotlar va shaffoflik"}</h1>
            <p>{summary.body}</p>
            <small>{summary.checked}</small>
          </div>
          <aside className={styles.heroIndex} aria-label={ru ? "Карта контроля данных" : "Ma’lumotlar nazorati xaritasi"}>
            <span>{ru ? "МАРШРУТ ДАННЫХ" : "MA’LUMOTLAR YO‘LI"}</span>
            <ol>
              <li><b>01</b><strong>{ru ? "Публичный сайт" : "Ommaviy sayt"}</strong><small>{ru ? "без загрузки файлов" : "fayl yuklanmaydi"}</small></li>
              <li><b>02</b><strong>{ru ? "Защищённый аккаунт" : "Himoyalangan akkaunt"}</strong><small>{ru ? "сессия и права" : "sessiya va huquqlar"}</small></li>
              <li><b>03</b><strong>{ru ? "Передача юристу" : "Yuristga topshirish"}</strong><small>{ru ? "только с подтверждением" : "faqat tasdiq bilan"}</small></li>
            </ol>
          </aside>
        </section>

        <section className={styles.summary}>
          {summary.items.map((item) => (
            <article key={item.title}>
              <span>{item.state}</span>
              <h2>{item.title}</h2>
              <p>{item.body}</p>
            </article>
          ))}
        </section>

        <section className={styles.architecture} aria-labelledby="trust-flow-title">
          <header>
            <span>{ru ? "КАК ДВИЖУТСЯ ДАННЫЕ" : "MA’LUMOTLAR QANDAY HARAKATLANADI"}</span>
            <h2 id="trust-flow-title">{ru ? "Контроль остаётся у пользователя на каждом переходе" : "Har bir o‘tishda nazorat foydalanuvchida qoladi"}</h2>
            <p>{ru ? "Публичная страница ничего не загружает. Работа с вопросом или документом начинается в защищённом аккаунте, а передача специалисту требует отдельного действия." : "Ommaviy sahifa hech narsa yuklamaydi. Savol yoki hujjat bilan ishlash himoyalangan akkauntda boshlanadi, mutaxassisga topshirish esa alohida harakat talab qiladi."}</p>
          </header>
          <ol>
            <li><span>01</span><strong>{ru ? "Публичный сайт" : "Ommaviy sayt"}</strong><p>{ru ? "Знакомство без реальных файлов и персональных данных." : "Haqiqiy fayl va shaxsiy ma’lumotsiz tanishish."}</p></li>
            <li><span>02</span><strong>{ru ? "Защищённый аккаунт" : "Himoyalangan akkaunt"}</strong><p>{ru ? "Сессия, роль и права определяют доступ." : "Sessiya, rol va huquqlar kirishni belgilaydi."}</p></li>
            <li><span>03</span><strong>{ru ? "Рабочий объект" : "Ish obyekti"}</strong><p>{ru ? "Вопрос, дело и документ остаются приватными." : "Savol, ish va hujjat yopiq qoladi."}</p></li>
            <li><span>04</span><strong>{ru ? "Передача юристу" : "Yuristga topshirish"}</strong><p>{ru ? "Только выбранный контекст и отдельное подтверждение." : "Faqat tanlangan kontekst va alohida tasdiq."}</p></li>
          </ol>
        </section>

        <section className={styles.details}>
          <header>
            <span>{ru ? "ПОДРОБНО" : "BATAFSIL"}</span>
            <h2>{ru ? "Что подтверждено, а что ещё уточняется" : "Nima tasdiqlangan, nima hali aniqlashtirilmoqda"}</h2>
          </header>
          <div>
            {sections.map((section) => (
              <article key={section.title}>
                <span>{section.state}</span>
                <h3>{section.title}</h3>
                <p>{section.body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className={styles.policies}>
          <h2>{ru ? "Политики и правила" : "Siyosat va qoidalar"}</h2>
          <div>
            <Link href={`/${locale}/terms`}>{ru ? "Условия использования" : "Foydalanish shartlari"}</Link>
            <Link href={`/${locale}/privacy-policy`}>{ru ? "Политика конфиденциальности" : "Maxfiylik siyosati"}</Link>
            <Link href={`/${locale}/personal-data-processing`}>{ru ? "Обработка персональных данных" : "Shaxsiy ma’lumotlarni qayta ishlash"}</Link>
            <Link href={`/${locale}/cookies`}>Cookies</Link>
            <Link href={`/${locale}/ai-rules`}>{ru ? "Правила использования AI" : "AIdan foydalanish qoidalari"}</Link>
          </div>
        </section>

        <section className={styles.contact}>
          <h2>{ru ? "Вопрос по безопасности или данным?" : "Xavfsizlik yoki ma’lumotlar bo‘yicha savol bormi?"}</h2>
          <p>{ru ? "По вопросам конфиденциальности и обработки данных используйте опубликованный контакт JURO." : "Maxfiylik va ma’lumotlarni qayta ishlash bo‘yicha JUROning e’lon qilingan kontaktidan foydalaning."}</p>
          <a href={`mailto:${legalConfig.contacts.privacyEmail}`}>{ru ? "Написать по вопросам данных" : "Ma’lumotlar bo‘yicha yozish"}</a>
        </section>
      </main>
      <SiteFooter locale={locale} />
    </div>
  );
}
