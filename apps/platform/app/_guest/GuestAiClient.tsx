"use client";

import Link from "next/link";
import { useCallback, useEffect, useId, useState, type FormEvent } from "react";

import { TurnstileWidget } from "../_auth/TurnstileWidget";
import { LegalAnswerView, type LegalAnswerViewResult } from "../_platform/LegalAnswerView";
import { aiText } from "../../lib/ai/localization";
import { answerVerificationFailureText } from "../../lib/ai/legal-answer-failure";
import type { PlatformLocale } from "../../lib/platform/routing";

type GuestResult = LegalAnswerViewResult & {
  sourceAccessMode?: "direct" | "approved_package" | "mixed";
  sourcesRetrievedAt?: string | null;
};

type Bootstrap = {
  enabled: boolean;
  providerConfigured: boolean;
  siteKey: string | null;
  session: null | {
    state: "available" | "reserved" | "consumed";
    requestCount: number;
    answerCount: number;
    expiresAt: string;
  };
  result: GuestResult | null;
  code?: string;
  error?: string;
};

type SubmitResponse = {
  result?: GuestResult;
  session?: Bootstrap["session"];
  code?: string;
  error?: string;
};

export function GuestAiClient({ locale }: { locale: PlatformLocale }) {
  // Presentation bindings are supplied by the replacement chat controller.
  return (
    <main className="guest-ai-page">
      <header className="guest-ai-header">
        <Link className="guest-ai-brand" href="/">JURO</Link>
        <nav aria-label={text("Язык и вход", "Til va kirish", "Language and sign in")}>
          {(["ru", "uz", "en"] as const).map((language) => <Link key={language} href={`/${language}/guest/ai-lawyer`} aria-current={language === locale ? "page" : undefined}>{language.toUpperCase()}</Link>)}
          <Link href={`/${locale}/auth/login`}>{text("Войти", "Kirish", "Sign in")}</Link>
        </nav>
      </header>

      <section className="guest-ai-shell" aria-labelledby={labelId}>
        <div className="guest-ai-intro">
          <p className="guest-ai-eyebrow">{text("Юрист в кармане", "Cho‘ntakdagi yurist", "A lawyer in your pocket")}</p>
          <h1 id={labelId}>{text("Задайте один вопрос AI-юристу JURO", "AI-yurist JUROga bitta savol bering", "Ask JURO AI Lawyer one question")}</h1>
          <p>{text(
            "JURO проверит доступные официальные источники Узбекистана, отделит подтверждённые выводы от предположений и предложит следующий шаг.",
            "JURO O‘zbekistonning mavjud rasmiy manbalarini tekshiradi, tasdiqlangan xulosalarni taxminlardan ajratadi va keyingi qadamni taklif qiladi.",
            "JURO checks available official sources from Uzbekistan, separates verified findings from assumptions and suggests the next step.",
          )}</p>
          <ul>
            <li>{text("Один итоговый ответ без регистрации", "Ro‘yxatdan o‘tmasdan bitta yakuniy javob", "One final answer without registration")}</li>
            <li>{text("Уточняющий вопрос не расходует ответ", "Aniqlashtiruvchi savol javobni sarflamaydi", "A clarification request does not use your answer")}</li>
            <li>{text("Гостевые данные удаляются через 24 часа", "Mehmon ma’lumotlari 24 soatdan keyin o‘chiriladi", "Guest data is deleted after 24 hours")}</li>
          </ul>
        </div>

        <div className="guest-ai-workspace">
          {state === "loading" ? (
            <div className="guest-ai-skeleton" role="status">{text("Загрузка защищённой формы…", "Himoyalangan shakl yuklanmoqda…", "Loading the secure form…")}</div>
          ) : null}

          {bootstrap && !bootstrap.providerConfigured ? (
            <div className="guest-ai-alert" role="alert">{text("AI-провайдер временно недоступен.", "AI-provayder vaqtincha mavjud emas.", "The AI provider is temporarily unavailable.")}</div>
          ) : null}

          {!consumed && bootstrap?.providerConfigured ? (
            <form onSubmit={submit} className="guest-ai-form">
              <label htmlFor="guest-question">{text("Опишите юридическую ситуацию", "Huquqiy vaziyatni yozing", "Describe your legal situation")}</label>
              <textarea
                id="guest-question"
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                maxLength={4_000}
                rows={7}
                placeholder={text("Например: работодатель задерживает зарплату два месяца. Какие действия доступны по законодательству Узбекистана?", "Masalan: ish beruvchi ikki oydan beri ish haqini kechiktirmoqda. O‘zbekiston qonunchiligiga ko‘ra qanday yo‘l tutish mumkin?", "For example: my employer has delayed my salary for two months. What can I do under the law of Uzbekistan?")}
                disabled={state === "submitting"}
              />
              <div className="guest-ai-counter">{question.length}/4000</div>
              {needsTurnstile && bootstrap.siteKey ? (
                <TurnstileWidget
                  siteKey={bootstrap.siteKey}
                  locale={locale}
                  action="guest_ai"
                  resetSignal={turnstileReset}
                  onToken={setTurnstileToken}
                />
              ) : null}
              {needsTurnstile && !bootstrap.siteKey ? (
                <div className="guest-ai-alert" role="alert">{text("Защитная проверка не настроена.", "Himoya tekshiruvi sozlanmagan.", "The security check is not configured.")}</div>
              ) : null}
              <button type="submit" disabled={!canSubmit}>
                {state === "submitting" ? text("Готовим ответ…", "Javob tayyorlanmoqda…", "Preparing answer…") : text("Получить гостевой ответ", "Mehmon javobini olish", "Get guest answer")}
              </button>
            </form>
          ) : null}

          {message ? <p className={state === "error" ? "guest-ai-message is-error" : "guest-ai-message"} role={state === "error" ? "alert" : "status"}>{message}</p> : null}

          {result ? <GuestResultView result={result} locale={locale} /> : null}

          {consumed ? (
            <div className="guest-ai-register">
              <h2>{text("Продолжите в личном кабинете", "Shaxsiy kabinetda davom eting", "Continue in your account")}</h2>
              <p>{text("Сохраняйте историю, документы, дела и планы действий после регистрации.", "Ro‘yxatdan o‘tgach tarix, hujjatlar, ishlar va harakatlar rejasini saqlang.", "Register to save your history, documents, matters and action plans.")}</p>
              <Link href={`/${locale}/auth/register`}>{text("Зарегистрироваться", "Ro‘yxatdan o‘tish", "Create account")}</Link>
            </div>
          ) : null}
        </div>
      </section>
    </main>
  );
}

function GuestResultView({ result, locale }: { result: GuestResult; locale: PlatformLocale }) {
  const sourceTimestamp = result.sourcesRetrievedAt || result.legalDatabaseAsOf;
  const sourceDate = new Date(sourceTimestamp);
  const hasSourceDate = Number.isFinite(sourceDate.getTime());
  return (
    <article className="guest-ai-result" aria-label={aiText(locale, "Проверенный ответ JURO", "JURO tekshirgan javob", "JURO verified answer")}>
      <div className="guest-ai-result-heading">
        <span>{aiText(locale, "AI-ответ", "AI javobi", "AI answer")}</span>
        {hasSourceDate && <time dateTime={sourceTimestamp}>{result.sourceAccessMode === "direct" ? aiText(locale, "Получено напрямую", "Bevosita olindi", "Retrieved directly") : aiText(locale, "База на", "Baza sanasi", "Database as of")}: {sourceDate.toLocaleDateString(locale === "en" ? "en-GB" : locale === "uz" ? "uz-UZ" : "ru-RU")}</time>}
      </div>
      <LegalAnswerView result={result} locale={locale} className="guest-legal-answer" />
      {result.sources.length > 0 ? <section className="guest-ai-sources" aria-labelledby="guest-ai-sources-title">
        <h2 id="guest-ai-sources-title">{aiText(locale, "Источники ответа", "Javob manbalari", "Answer sources")}</h2>
        <ul>{result.sources.map((source) => <li key={source.sourceId}>
          <a href={source.originalUrl} target="_blank" rel="noreferrer noopener"><strong>{source.article ? `${source.article} · ` : ""}{source.actTitle}</strong><span>{source.sourceClass === "SECONDARY_REFERENCE" ? aiText(locale, "Дополнительный материал", "Qo‘shimcha material", "Additional material") : aiText(locale, "Официальный источник", "Rasmiy manba", "Official source")}</span></a>
        </li>)}</ul>
      </section> : null}
    </article>
  );
}
