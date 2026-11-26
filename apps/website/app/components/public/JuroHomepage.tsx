import Image from "next/image";
import Link from "next/link";
import { ArrowDown, ArrowRight, ArrowUpRight, BookOpen, BriefcaseBusiness, CalendarDays, ChevronDown, FileText, House, Layers, ListChecks, MessageSquareText, PencilLine, Receipt, Wallet } from "lucide-react";
import { homepageCopy } from "../../../content/homepage";
import { subscriptionPlans } from "../../../../platform/config/pricing";
import { workspaceCopy } from "../../../content/homepage-workspace";
import { en } from "../../../content/en";
import { ru } from "../../../content/ru";
import { uz } from "../../../content/uz";
import type { PublicLanguage } from "../../../content/types";
import { HomepageFaq } from "./HomepageFaq";
import { HomepageMotion } from "./HomepageMotion";
import { HomepageWorkspace } from "./HomepageWorkspace";
import { platformPersonalHref, platformToolHref } from "./platform-hrefs";
import { SiteHeader } from "./SiteChrome";
import styles from "./juro-home.module.css";

const contractIcons = { lease: House, supplier: BriefcaseBusiness };
const briefIcons = [FileText, Receipt, MessageSquareText];
const chatIcons = { pay: Wallet, leave: CalendarDays };
const labourCode = {
  ru: { pay: "https://lex.uz/ru/docs/6257291#6263982", leave: "https://lex.uz/ru/docs/6257291#6263232" },
  uz: { pay: "https://lex.uz/docs/-6257288#-6263813", leave: "https://lex.uz/docs/-6257288#-6263022" },
};
const documentTools = ["document-builder", "document-comparison"];
const faqByLanguage = { ru: ru.faq.items, uz: uz.faq.items, en: en.faq.items };

export function JuroHomepage({ language }: { language: PublicLanguage }) {
  const copy = homepageCopy[language];
  const { chat } = copy;
  const chatHref = platformToolHref(language, "ai-chat");
  const sources = language === "ru" ? labourCode.ru : labourCode.uz;
  const prices = {
    ru: { title: "Тарифы JURO", period: "сум в месяц", status: "Покупка тарифов пока недоступна.", action: "Открыть тарифы в JURO" },
    uz: { title: "JURO tariflari", period: "so‘m oyiga", status: "Tariflarni sotib olish hozircha mavjud emas.", action: "JURO tariflarini ochish" },
    en: { title: "JURO plans", period: "UZS per month", status: "Plan purchases are currently unavailable.", action: "Open billing in JURO" },
  }[language];

  return (
    <div className={styles.page}>
      <SiteHeader locale={language} home />
      <main id="main-content" tabIndex={-1}>
        <section className={`${styles.wrap} ${styles.hero}`} aria-labelledby="homepage-title">
          <div className={styles.heroCopy}>
            <p className={styles.kicker}><span aria-hidden="true" />{copy.jurisdiction}</p>
            <h1 id="homepage-title">{copy.headline[0]} <em>{copy.headline[1]}</em></h1>
            <p className={styles.intro}>{copy.introduction}</p>
            <div className={styles.heroActions}>
              <a className={styles.primary} href={chatHref}>{chat.ask}<ArrowUpRight aria-hidden="true" size={18} /></a>
              <a className={styles.secondary} href="#ai-playground">{copy.example}<ArrowDown aria-hidden="true" size={16} /></a>
            </div>
          </div>
          <div className={styles.heroDemo} id="ai-playground" tabIndex={-1}>
            <header className={styles.demoHeader}>
              <h2><MessageSquareText aria-hidden="true" size={18} />{chat.name}</h2>
              <span>{chat.label}</span>
            </header>
            <fieldset className={styles.chatChoices}>
              <legend className={styles.visuallyHidden}>{chat.choose}</legend>
              {chat.examples.map((example) => {
                const Icon = chatIcons[example.id];
                return (
                  <label key={example.id}>
                    <input type="radio" name="homepage-chat" value={example.id} defaultChecked={example.id === "pay"} aria-controls={`chat-${example.id}`} />
                    <Icon aria-hidden="true" size={16} />{example.topic}
                  </label>
                );
              })}
            </fieldset>
            <div className={styles.stageBody}>
              <div className={styles.guide}>
                <Image className={styles.jurobek} src="/jurobek-point.webp" alt="Jurobek" width={941} height={1672} fetchPriority="high" unoptimized />
              </div>
              <div className={styles.chatPanels}>
                {chat.examples.map((example) => (
                  <article className={styles.chatPanel} data-chat={example.id} id={`chat-${example.id}`} key={example.id} aria-labelledby={`chat-${example.id}-question`}>
                    <div className={styles.question}>
                      <span>{chat.you}</span>
                      <h3 id={`chat-${example.id}-question`}>{example.question}</h3>
                    </div>
                    <div className={styles.answer}>
                      <details className={styles.followUp}>
                        <summary><MessageSquareText aria-hidden="true" size={16} />{chat.context}<ChevronDown aria-hidden="true" size={15} /></summary>
                        <dl>
                          <div><dt>{chat.name}</dt><dd>{example.followUp}</dd></div>
                          <div><dt>{chat.you}</dt><dd>{example.reply}</dd></div>
                        </dl>
                      </details>
                      <div className={styles.answerBody}>
                        <p className={styles.supported}>{example.supported}</p>
                        <details className={styles.source}>
                          <summary><BookOpen aria-hidden="true" size={16} />{example.article}<ChevronDown aria-hidden="true" size={15} /></summary>
                          <div className={styles.sourceCard}>
                            <strong>{example.sourceTitle}</strong>
                            <p>{example.sourceNote}</p>
                            <a href={sources[example.id]} className={styles.textLink}>{chat.source}<ArrowUpRight aria-hidden="true" size={15} /></a>
                          </div>
                        </details>
                        <p className={styles.next}><strong>{chat.next}</strong>{example.next}</p>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
        <div className={`${styles.wrap} ${styles.quickLinks}`}>
          <a href="#product"><FileText aria-hidden="true" size={19} />{copy.review.heading}<ArrowDown aria-hidden="true" size={15} /></a>
          <a href="#case-flow"><ListChecks aria-hidden="true" size={19} />{copy.plan.label}<ArrowDown aria-hidden="true" size={15} /></a>
          <a href="#lawyer-handoff"><BriefcaseBusiness aria-hidden="true" size={19} />{copy.lawyers.label}<ArrowDown aria-hidden="true" size={15} /></a>
          <a href="#workspace-tools"><Layers aria-hidden="true" size={19} />{workspaceCopy[language].chooseLink}<ArrowDown aria-hidden="true" size={15} /></a>
        </div>

        <section className={styles.product} id="product" aria-labelledby="product-title">
          <div className={`${styles.wrap} ${styles.productLayout}`}>
            <div className={styles.productHeading}>
              <div className={styles.anchors} aria-hidden="true"><span id="analysis" /></div>
              <h2 id="product-title">{copy.review.heading}</h2>
              <p>{copy.review.intro}</p>
              <div className={styles.sectionActions}>
                <a className={styles.primary} href={platformToolHref(language, "document-analysis")}>{copy.review.action}<ArrowUpRight aria-hidden="true" size={17} /></a>
                {copy.review.tools.map((label, index) => <a className={styles.textLink} href={platformToolHref(language, documentTools[index])} key={label}>{label}<ArrowUpRight aria-hidden="true" size={15} /></a>)}
              </div>
            </div>
            <div className={styles.comparison} data-home-reveal="repeat">
              <fieldset className={styles.contractChoices}>
                <legend className={styles.visuallyHidden}>{copy.compare}</legend>
                {copy.contracts.map((contract) => {
                  const Icon = contractIcons[contract.id];
                  return (
                    <label key={contract.id}>
                      <input aria-controls={`${contract.id}-comparison`} type="radio" name="homepage-contract" defaultChecked={contract.id === "lease"} value={contract.id} />
                      <Icon aria-hidden="true" size={18} />{contract.name}
                    </label>
                  );
                })}
              </fieldset>
              <div className={styles.contractPanels}>
                {copy.contracts.map((contract) => (
                  <article className={styles.contractPanel} data-contract={contract.id} id={`${contract.id}-comparison`} key={contract.id} aria-labelledby={`${contract.id}-clause-title`}>
                    <header className={styles.panelHeader}>
                      <h3 id={`${contract.id}-clause-title`}>{contract.clause}</h3><span>{copy.fictional}</span>
                    </header>
                    <div className={styles.versions}>
                      <div className={styles.version}>
                        <h4><FileText aria-hidden="true" size={18} />{copy.review.original}</h4>
                        <p>{contract.original}</p>
                      </div>
                      <div className={`${styles.version} ${styles.suggested}`}>
                        <h4><PencilLine aria-hidden="true" size={18} />{copy.review.revised}</h4>
                        <p>{contract.revised[0]}<mark className={styles.changed}>{contract.revised[1]}</mark>{contract.revised[2]}</p>
                      </div>
                    </div>
                    <div className={styles.why}><strong>{copy.review.why}</strong><p>{contract.finding}</p></div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>

        <div className={`${styles.wrap} ${styles.services}`}>
          <section className={styles.plan} id="case-flow" aria-labelledby="plan-title">
            <div className={styles.sectionCopy}>
              <h2 id="plan-title">{copy.plan.heading}</h2>
              <p>{copy.plan.intro}</p>
            </div>
            <div className={styles.planExample}>
              <div className={styles.planQuestion}>
                <MessageSquareText aria-hidden="true" size={21} />
                <div><span>{copy.fictional}</span><h3>{copy.plan.question}</h3></div>
              </div>
              <ol data-home-reveal="repeat">
                {copy.plan.steps.map((step, index) => <li key={step.title}><span aria-hidden="true">{index + 1}</span><div><strong>{step.title}</strong><p>{step.detail}</p></div></li>)}
              </ol>
            </div>
            <a className={styles.textLink} href={platformToolHref(language, "action-plan")}>{copy.plan.action}<ArrowUpRight aria-hidden="true" size={16} /></a>
          </section>

          <section className={styles.lawyers} id="lawyer-handoff" aria-labelledby="lawyers-title">
            <div className={styles.sectionCopy}>
              <h2 id="lawyers-title">{copy.lawyers.heading}</h2>
              <p>{copy.lawyers.intro}</p>
            </div>
            <div className={styles.consultation} data-home-reveal>
              <header className={styles.briefHeading}>
                <FileText aria-hidden="true" size={21} />
                <div>
                  <span>{copy.lawyers.brief}</span>
                  <h3>{copy.lawyers.topic}</h3>
                  <p>{copy.lawyers.question}</p>
                </div>
              </header>
              <ul>
                {copy.lawyers.documents.map((document, index) => {
                  const Icon = briefIcons[index];
                  return (
                    <li key={document.title}>
                      <span><Icon aria-hidden="true" size={17} /></span>
                      <div><strong>{document.title}</strong><p>{document.detail}</p></div>
                    </li>
                  );
                })}
              </ul>
            </div>
            <a className={styles.textLink} href={platformToolHref(language, "lawyers")}>{copy.lawyers.action}<ArrowRight aria-hidden="true" size={16} /></a>
          </section>
        </div>

        <HomepageWorkspace language={language} />
        <section className={`${styles.wrap} ${styles.planSection}`} id="pricing" aria-labelledby="pricing-title">
          <h2 id="pricing-title">{prices.title}</h2>
          <p>{prices.status}</p>
          <ul className={styles.planGrid}>{subscriptionPlans.map(plan => <li key={plan.code}>
            <h3>{plan.name[language]}</h3>
            <p>{plan.audience[language]}</p>
            <strong>{new Intl.NumberFormat(language).format(plan.priceMinor / 100)}</strong>
            <span>{prices.period}</span>
          </li>)}</ul>
          <a className={styles.textLink} href={platformPersonalHref(language, "billing")}>{prices.action}<ArrowUpRight aria-hidden="true" size={17} /></a>
        </section>
        <section className={`${styles.wrap} ${styles.faq}`} id="faq" aria-labelledby="faq-title" data-home-reveal>
          <div id="trust">
            <h2 id="faq-title">{copy.faqTitle}</h2>
            <Link className={styles.textLink} href={`/${language}/trust`}>{copy.trust}<ArrowUpRight aria-hidden="true" size={17} /></Link>
          </div>
          <HomepageFaq key={language} language={language} initialItems={faqByLanguage[language]} moreLabel={copy.faqMore} />
        </section>
      </main>

      <HomepageMotion />
    </div>
  );
}
