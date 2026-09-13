import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  LegalAnswerView,
  type LegalAnswerViewResult,
} from "../app/_platform/LegalAnswerView";

function result(overrides: Partial<LegalAnswerViewResult> = {}): LegalAnswerViewResult {
  return {
    responseKind: "answer",
    summary: "Работодатель, как правило, не может прекратить договор в период отпуска.",
    answer: "Работодатель, как правило, не может прекратить договор в период отпуска.",
    clarificationQuestions: [],
    confirmedFindings: [{
      title: "Запрет в период отпуска",
      explanation: "Увольнение по инициативе работодателя запрещено.\n\n- Проверьте основание увольнения.\n- Зафиксируйте даты отпуска.",
      sourceIds: ["labor-code-163"],
    }],
    assumptions: [{ statement: "Инициатива работодателя", impact: "Правило отличается для соглашения сторон." }],
    risks: [{ level: "high", title: "Срок обжалования", explanation: "Не откладывайте проверку срока.", sourceIds: ["labor-code-163"] }],
    sources: [{
      sourceId: "labor-code-163",
      actTitle: "Трудовой кодекс Республики Узбекистан",
      actIdentifier: null,
      article: "163",
      originalUrl: "https://lex.uz/ru/docs/6257288",
      status: "current",
      effectiveDate: null,
      verifiedAt: "2026-08-29T00:00:00.000Z",
      sourceClass: "OFFICIAL_LEGISLATION",
      sourceOrigin: "indexed",
    }],
    requiredDocuments: [{ name: "Приказ об увольнении", reason: "Нужен для проверки основания.", required: true }],
    actionPlan: [{ title: "Получите документы", description: "Запросите заверенную копию приказа.", sourceIds: ["labor-code-163"] }],
    deadlines: [{ title: "Срок обращения", dueDate: null, calculationMethod: "Считается со дня вручения приказа.", confidence: "confirmed", sourceIds: ["labor-code-163"] }],
    urgency: "high",
    suggestedDocument: null,
    legalDatabaseAsOf: "2026-08-29",
    evidenceMode: "official",
    referenceNotes: [{ title: "Практический комментарий", note: "Материал помогает понять контекст.", sourceIds: ["commentary"] }],
    conditionalBranches: [],
    ...overrides,
  };
}

test("Russian Legal Answer uses the product-owned structure and delegates section Markdown", () => {
  const value = result({
    sources: [
      ...result().sources,
      {
        sourceId: "commentary",
        actTitle: "Практический комментарий",
        actIdentifier: null,
        article: null,
        originalUrl: "https://example.org/commentary",
        status: "unconfirmed",
        effectiveDate: null,
        verifiedAt: "2026-08-29T00:00:00.000Z",
        sourceClass: "SECONDARY_REFERENCE",
        sourceOrigin: "web",
      },
    ],
  });
  const html = renderToStaticMarkup(createElement(LegalAnswerView, { result: value, locale: "ru" }));

  const main = html.indexOf(">Главное<");
  const law = html.indexOf(">Что говорит закон<");
  const next = html.indexOf(">Что делать дальше<");
  const mainCitation = html.indexOf("Ст. 163 — Трудовой кодекс РУз", main);
  assert.ok(main >= 0 && law > main && next > law);
  assert.ok(mainCitation > main && mainCitation < law, "the Main Point should carry its supporting citation");
  assert.match(html, /Проверьте основание увольнения/u);
  assert.match(html, /href="https:\/\/lex\.uz\/ru\/docs\/6257288"[^>]*>Ст\. 163 — Трудовой кодекс РУз/u);
  assert.match(html, />Важно учесть</u);
  assert.match(html, />Сроки</u);
  assert.match(html, />Что подготовить</u);
  assert.match(html, />Дополнительные материалы</u);
  assert.doesNotMatch(html, /Подтверждённое правовое основание/u);
});

test("Uzbek Legal Answer uses the approved localized section labels", () => {
  const html = renderToStaticMarkup(createElement(LegalAnswerView, {
    result: result({ assumptions: [], risks: [], deadlines: [], requiredDocuments: [], referenceNotes: [], urgency: "normal" }),
    locale: "uz",
  }));

  assert.match(html, />Asosiysi</u);
  assert.match(html, />Qonunda nima deyilgan</u);
  assert.match(html, />Keyingi qadamlar</u);
  assert.match(html, />163-modda — Mehnat kodeksi O‘zR|>163-modda — Трудовой кодекс O‘zR/u);
  assert.doesNotMatch(html, />Muhim jihatlar</u);
});

test("Conditional Answer renders supported branches with their own citations", () => {
  const html = renderToStaticMarkup(createElement(LegalAnswerView, {
    result: result({
      conditionalBranches: [{
        condition: "Если инициатор — работодатель",
        outcome: "Действует запрет на увольнение в период отпуска.",
        sourceIds: ["labor-code-163"],
      }],
    }),
    locale: "ru",
  }));

  assert.match(html, />Как меняется ответ</u);
  assert.match(html, />Если инициатор — работодатель</u);
  assert.match(html, /Ст\. 163 — Трудовой кодекс РУз/u);
});

test("Main Point exposes sources from all supported findings in the synthesized conclusion", () => {
  const secondSource = {
    ...result().sources[0]!,
    sourceId: "civil-code-10",
    actTitle: "Гражданский кодекс Республики Узбекистан",
    article: "10",
  };
  const html = renderToStaticMarkup(createElement(LegalAnswerView, {
    result: result({
      sources: [...result().sources, secondSource],
      confirmedFindings: [
        ...result().confirmedFindings,
        { title: "Иной вопрос", explanation: "Применяется отдельная норма.", sourceIds: [secondSource.sourceId] },
      ],
    }),
    locale: "ru",
  }));
  const main = html.indexOf(">Главное<");
  const law = html.indexOf(">Что говорит закон<");
  const mainMarkup = html.slice(main, law);
  assert.match(mainMarkup, /Ст\. 163 — Трудовой кодекс РУз/u);
  assert.match(mainMarkup, /Ст\. 10 — Гражданский кодекс РУз/u);
});

test("branch-only Conditional Answer cites the branch that grounds its Main Point", () => {
  const html = renderToStaticMarkup(createElement(LegalAnswerView, {
    result: result({
      confirmedFindings: [],
      conditionalBranches: [{
        condition: "Если инициатор — работодатель",
        outcome: "Действует запрет на увольнение в период отпуска.",
        sourceIds: ["labor-code-163"],
      }],
    }),
    locale: "ru",
  }));
  const main = html.indexOf(">Главное<");
  const branches = html.indexOf(">Как меняется ответ<");
  assert.match(html.slice(main, branches), /Ст\. 163 — Трудовой кодекс РУз/u);
});

test("unsupported conclusions render an Insufficient-Evidence Result instead of empty legal sections", () => {
  const html = renderToStaticMarkup(createElement(LegalAnswerView, {
    result: result({
      responseKind: "clarification_required",
      summary: "Для ответа недостаточно подтверждённых источников.",
      answer: "JURO не сформировал правовой вывод.",
      confirmedFindings: [],
      assumptions: [],
      risks: [],
      sources: [],
      requiredDocuments: [],
      actionPlan: [],
      deadlines: [],
      urgency: "normal",
      evidenceMode: "none",
      referenceNotes: [],
      clarificationQuestions: ["Когда произошло событие?"],
    }),
    locale: "ru",
  }));

  assert.match(html, />Пока нельзя подтвердить ответ</u);
  assert.match(html, />Что удалось проверить</u);
  assert.match(html, />Что нужно уточнить</u);
  assert.doesNotMatch(html, />Что говорит закон</u);
  assert.doesNotMatch(html, />Что делать дальше</u);
  assert.doesNotMatch(html, /проверил доступный индекс/u);
});

test("planning failures explain that source search did not start, including after serialization", () => {
  const value = result({ responseKind: "clarification_required", failureReason: "question_interpretation_unavailable",
    answer: "An obsolete explanation", sources: [], confirmedFindings: [] });
  for (const locale of ["ru", "uz", "en"] as const) {
    const html = renderToStaticMarkup(createElement(LegalAnswerView, {
      result: JSON.parse(JSON.stringify(value)), locale,
    }));
    assert.doesNotMatch(html, /An obsolete explanation|configured search tiers|проверил доступный индекс/u);
    assert.match(html, {ru: /Поиск правовых источников не начался/u,
      uz: /Huquqiy manbalarni qidirish boshlanmadi/u, en: /Legal source search did not start/u}[locale]);
  }
});

test("official research failures explain unavailability without claiming that no law exists", () => {
  const value = result({responseKind: "clarification_required", failureReason: "official_research_unavailable",
    answer: "An obsolete explanation", sources: [], confirmedFindings: []});
  for (const locale of ["ru", "uz", "en"] as const) {
    const html = renderToStaticMarkup(createElement(LegalAnswerView, {result: JSON.parse(JSON.stringify(value)), locale}));
    assert.doesNotMatch(html, /An obsolete explanation/u);
    assert.match(html, {ru: /не означает отсутствия применимых норм/u,
      uz: /tegishli normalar mavjud emasligini anglatmaydi/u,
      en: /does not mean that no applicable law exists/u}[locale]);
  }
});

test("a completed answer does not display earlier research failure diagnostics as an unavailable answer", () => {
  const value = result({responseKind: "answer", failureReason: "official_research_unavailable"});
  for (const locale of ["ru", "uz", "en"] as const) {
    const html = renderToStaticMarkup(createElement(LegalAnswerView, {result: JSON.parse(JSON.stringify(value)), locale}));
    assert.doesNotMatch(html, /data-answer-kind="insufficient-evidence"/u);
    assert.doesNotMatch(html, /не означает отсутствия применимых норм|tegishli normalar mavjud emasligini anglatmaydi|does not mean that no applicable law exists/u);
  }
});

test("incomplete evidence displays found provisions and focused questions without a verified-answer badge", () => {
  const html = renderToStaticMarkup(createElement(LegalAnswerView, {
    result: result({ responseKind: "clarification_required", clarificationQuestions: ["Какой отпуск оформлен?"] }),
    locale: "ru",
  }));
  assert.match(html, /data-answer-kind="insufficient-evidence"/u);
  assert.match(html, /Ст\. 163 — Трудовой кодекс РУз/u);
  assert.match(html, /Какой отпуск оформлен/u);
  assert.doesNotMatch(html, />Подтверждено официальными источниками</u);
});

test("internet provenance is visibly marked above answers using live or secondary sources", () => {
  for (const sourceOrigin of ["live", "web"] as const) {
    const html = renderToStaticMarkup(createElement(LegalAnswerView, {
      result: result({ sources: result().sources.map((source) => ({ ...source, sourceOrigin })) }), locale: "ru",
    }));
    assert.ok(html.indexOf("Ответ использует интернет-источники") < html.indexOf(">Главное<"));
    assert.match(html, /data-source-notice="internet"/u);
  }
});

test("authenticated and guest chat use the same Legal Answer presentation contract", async () => {
  const [authenticated, guest] = await Promise.all([
    readFile(new URL("../app/_platform/AiLawyerClient.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/_guest/GuestAiClient.tsx", import.meta.url), "utf8"),
  ]);

  assert.match(authenticated, /<LegalAnswerView[\s\S]*?result=\{result\}[\s\S]*?locale=\{locale\}/u);
  assert.match(guest, /<LegalAnswerView result=\{result\} locale=\{locale\}/u);
  assert.doesNotMatch(authenticated, /function uniqueAnswerDetail/u);
  assert.doesNotMatch(guest, /function paragraphs/u);
});
