import { diffArrays } from "diff";
import {
  type ComparisonChange,
  type ComparisonLocale,
  type ComparisonResult,
  type ComparisonSummary,
  type ExtractedDocument,
  type ExtractedSection,
  type RiskLevel,
  type WordDiffPart,
} from "./types";

const AMOUNT_RE = /\d[\d\s.,]*\s*(?:сум|so['‘’ʻʼ]?m|uzs|usd|eur|руб(?:лей)?|доллар(?:ов)?|%)(?=$|[^\p{L}\p{N}_])/giu;
const TERM_RE = /\d+\s*(?:(?:календарн[\p{L}\p{N}_]*|рабоч[\p{L}\p{N}_]*)\s+)?(?:день|дня|дней|месяц[\p{L}\p{N}_]*|лет|год[\p{L}\p{N}_]*|kun|oy|yil)(?=$|[^\p{L}\p{N}_])/giu;
const DATE_RE = /\b(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/gu;
export const MAX_FUZZY_SECTION_COMPARISONS = 50_000;

function comparisonText(locale: ComparisonLocale, ru: string, uz: string, en: string): string {
  return { ru, uz, en }[locale];
}

function tokenSet(value: string): Set<string> {
  return new Set(value.toLocaleLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);
}

function similarity(left: string, right: string): number {
  if (left === right) return 1;
  return tokenSetSimilarity(tokenSet(left), tokenSet(right));
}

function tokenSetSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let overlap = 0;
  for (const token of a) if (b.has(token)) overlap += 1;
  return (2 * overlap) / (a.size + b.size);
}

function indexesBy(
  sections: ExtractedSection[],
  value: (section: ExtractedSection) => string | null,
): Map<string, number[]> {
  const result = new Map<string, number[]>();
  for (const section of sections) {
    const key = value(section);
    if (!key) continue;
    const indexes = result.get(key);
    if (indexes) indexes.push(section.index);
    else result.set(key, [section.index]);
  }
  return result;
}

function takeUnusedIndex(
  candidates: Map<string, number[]>,
  cursors: Map<string, number>,
  used: Set<number>,
  key: string,
): number | null {
  const indexes = candidates.get(key);
  if (!indexes) return null;
  let cursor = cursors.get(key) ?? 0;
  while (cursor < indexes.length && used.has(indexes[cursor])) cursor += 1;
  cursors.set(key, cursor + 1);
  return cursor < indexes.length ? indexes[cursor] : null;
}

function compact(values: RegExpMatchArray | null): string[] {
  return values ? Array.from(new Set(Array.from(values, (value) => value.replace(/\s+/g, " ").trim()))) : [];
}

function describeChange(before: string, after: string, locale: ComparisonLocale): {
  summary: string;
  legalEffect: string;
  recommendation: string;
  riskLevel: RiskLevel;
  confidencePercent: number;
} {
  const beforeAmounts = compact(before.match(AMOUNT_RE));
  const afterAmounts = compact(after.match(AMOUNT_RE));
  const beforeTerms = compact(before.match(TERM_RE));
  const afterTerms = compact(after.match(TERM_RE));
  const beforeDates = compact(before.match(DATE_RE));
  const afterDates = compact(after.match(DATE_RE));
  if (beforeAmounts.join("|") !== afterAmounts.join("|") && (beforeAmounts.length || afterAmounts.length)) {
    return {
      summary: comparisonText(locale, `Изменено денежное значение: ${beforeAmounts.join(", ") || "не указано"} → ${afterAmounts.join(", ") || "не указано"}.`, `Pul qiymati o‘zgartirilgan: ${beforeAmounts.join(", ") || "ko‘rsatilmagan"} → ${afterAmounts.join(", ") || "ko‘rsatilmagan"}.`, `Monetary value changed: ${beforeAmounts.join(", ") || "not specified"} → ${afterAmounts.join(", ") || "not specified"}.`),
      legalEffect: comparisonText(locale, "Изменение суммы или процента может повлиять на объём обязательства.", "Summa yoki foizning o‘zgarishi majburiyat hajmiga ta’sir qilishi mumkin.", "A change in an amount or percentage may affect the scope of the obligation."),
      recommendation: comparisonText(locale, "Проверьте расчёт, валюту, налоги и порядок оплаты.", "Hisob-kitob, valyuta, soliqlar va to‘lov tartibini tekshiring.", "Review the calculation, currency, tax treatment and payment procedure."),
      riskLevel: "high",
      confidencePercent: 94,
    };
  }
  if (beforeTerms.join("|") !== afterTerms.join("|") && (beforeTerms.length || afterTerms.length)) {
    return {
      summary: comparisonText(locale, `Изменён срок: ${beforeTerms.join(", ") || "не указан"} → ${afterTerms.join(", ") || "не указан"}.`, `Muddat o‘zgartirilgan: ${beforeTerms.join(", ") || "ko‘rsatilmagan"} → ${afterTerms.join(", ") || "ko‘rsatilmagan"}.`, `Time period changed: ${beforeTerms.join(", ") || "not specified"} → ${afterTerms.join(", ") || "not specified"}.`),
      legalEffect: comparisonText(locale, "Изменение срока может сократить время на исполнение, уведомление или защиту права.", "Muddat o‘zgarishi bajarish, xabardor qilish yoki huquqni himoya qilish vaqtini qisqartirishi mumkin.", "A changed time period may reduce the time available for performance, notice or enforcement of rights."),
      recommendation: comparisonText(locale, "Сопоставьте новый срок с обязанностями обеих сторон и календарём исполнения.", "Yangi muddatni tomonlarning majburiyatlari va bajarish taqvimi bilan solishtiring.", "Check the new period against both parties' obligations and the performance schedule."),
      riskLevel: "high",
      confidencePercent: 92,
    };
  }
  if (beforeDates.join("|") !== afterDates.join("|") && (beforeDates.length || afterDates.length)) {
    return {
      summary: comparisonText(locale, "Изменена календарная дата.", "Kalendar sanasi o‘zgartirilgan.", "A calendar date changed."),
      legalEffect: comparisonText(locale, "Дата может влиять на начало, окончание или просрочку обязательства.", "Sana majburiyatning boshlanishi, tugashi yoki kechikishiga ta’sir qilishi mumkin.", "The date may affect when an obligation starts, ends or becomes overdue."),
      recommendation: comparisonText(locale, "Проверьте связанные сроки и переходные условия.", "Bog‘liq muddatlar va o‘tish shartlarini tekshiring.", "Review related deadlines and transitional provisions."),
      riskLevel: "medium",
      confidencePercent: 90,
    };
  }
  return {
    summary: comparisonText(locale, "Текст условия изменён.", "Shart matni o‘zgartirilgan.", "The clause wording changed."),
    legalEffect: comparisonText(locale, "Юридическое значение требует проверки в контексте всего документа.", "Yuridik ahamiyat butun hujjat kontekstida tekshirilishi kerak.", "Its legal effect must be reviewed in the context of the entire document."),
    recommendation: comparisonText(locale, "Сопоставьте изменение с предметом, ответственностью и правами сторон.", "O‘zgarishni predmet, javobgarlik va tomonlar huquqlari bilan solishtiring.", "Assess the change against the subject matter, liability provisions and each party's rights."),
    riskLevel: "medium",
    confidencePercent: 68,
  };
}

export function wordDiff(before: string | null, after: string | null): WordDiffPart[] {
  if (before === null) return after ? [{ value: after, kind: "added" }] : [];
  if (after === null) return [{ value: before, kind: "removed" }];
  const tokenize = (value: string) => value.match(/\s+|[\p{L}\p{N}]+|[^\s\p{L}\p{N}]+/gu) ?? [];
  return diffArrays(tokenize(before), tokenize(after))
    .map((part) => ({
      value: part.value.join(""),
      kind: part.added ? "added" as const : part.removed ? "removed" as const : "same" as const,
    }))
    .filter((part) => part.value.length > 0);
}

function baseChange(
  before: ExtractedSection | null,
  after: ExtractedSection | null,
  ordinal: number,
  locale: ComparisonLocale,
): ComparisonChange {
  const id = `change-${ordinal}`;
  if (!before && after) {
    return {
      id, ordinal, changeType: "added", beforeSectionId: null, afterSectionId: after.id,
      beforeLabel: null, afterLabel: after.label, beforeHeading: null, afterHeading: after.heading,
      beforeText: null, afterText: after.text, wordDiff: wordDiff(null, after.text),
      summary: comparisonText(locale, "Добавлено новое условие.", "Yangi shart qo‘shilgan.", "A new clause was added."),
      legalEffect: comparisonText(locale, "Последствия нового условия требуют проверки.", "Yangi shart oqibatlari tekshirilishi kerak.", "The consequences of the new clause require review."),
      affectedParty: comparisonText(locale, "Не определено", "Aniqlanmagan", "Not determined"), riskEffect: "requires_review",
      riskLevel: "medium", recommendation: comparisonText(locale, "Проверьте новое условие в контексте прав и обязанностей сторон.", "Yangi shartni tomonlarning huquq va majburiyatlari kontekstida tekshiring.", "Review the new clause in the context of each party's rights and obligations."),
      sourceIds: [], confidencePercent: 96, reviewedAt: null, reviewDecision: null, decidedAt: null, reviewDecisionVersion: 0, extractionWarning: false,
    };
  }
  if (before && !after) {
    return {
      id, ordinal, changeType: "removed", beforeSectionId: before.id, afterSectionId: null,
      beforeLabel: before.label, afterLabel: null, beforeHeading: before.heading, afterHeading: null,
      beforeText: before.text, afterText: null, wordDiff: wordDiff(before.text, null),
      summary: comparisonText(locale, "Условие удалено.", "Shart olib tashlangan.", "A clause was removed."),
      legalEffect: comparisonText(locale, "Удаление может прекратить право, обязанность или защитный механизм.", "Olib tashlash huquq, majburiyat yoki himoya mexanizmini bekor qilishi mumkin.", "Removing the clause may end a right, obligation or protective mechanism."),
      affectedParty: comparisonText(locale, "Не определено", "Aniqlanmagan", "Not determined"), riskEffect: "requires_review",
      riskLevel: "high", recommendation: comparisonText(locale, "Убедитесь, что удалённое условие не было существенной защитой.", "Olib tashlangan shart muhim himoya bo‘lmaganini tekshiring.", "Confirm that the removed clause was not a material protection."),
      sourceIds: [], confidencePercent: 96, reviewedAt: null, reviewDecision: null, decidedAt: null, reviewDecisionVersion: 0, extractionWarning: false,
    };
  }
  if (!before || !after) throw new Error("INVALID_CHANGE_PAIR");

  const sameSemantic = before.semanticText === after.semanticText;
  const sameNormalized = before.normalizedText === after.normalizedText;
  const labelChanged = before.label !== after.label;
  const moved = Math.abs(before.index - after.index) > 1;
  if (sameSemantic && labelChanged) {
    return {
      id, ordinal, changeType: "renumbered", beforeSectionId: before.id, afterSectionId: after.id,
      beforeLabel: before.label, afterLabel: after.label, beforeHeading: before.heading, afterHeading: after.heading,
      beforeText: before.text, afterText: after.text, wordDiff: wordDiff(before.text, after.text),
      summary: comparisonText(locale, `Пункт перенумерован: ${before.label ?? "—"} → ${after.label ?? "—"}.`, `Band qayta raqamlangan: ${before.label ?? "—"} → ${after.label ?? "—"}.`, `Clause renumbered: ${before.label ?? "—"} → ${after.label ?? "—"}.`),
      legalEffect: comparisonText(locale, "Смысл текста не изменился.", "Matn mazmuni o‘zgarmagan.", "The meaning of the text did not change."),
      affectedParty: comparisonText(locale, "Не влияет", "Ta’sir qilmaydi", "No direct impact"), riskEffect: "neutral", riskLevel: "information",
      recommendation: comparisonText(locale, "Проверьте внутренние ссылки на номер пункта.", "Band raqamiga ichki havolalarni tekshiring.", "Review internal references to the clause number."),
      sourceIds: [], confidencePercent: 98, reviewedAt: null, reviewDecision: null, decidedAt: null, reviewDecisionVersion: 0, extractionWarning: false,
    };
  }
  if (sameNormalized && moved) {
    return {
      id, ordinal, changeType: "moved", beforeSectionId: before.id, afterSectionId: after.id,
      beforeLabel: before.label, afterLabel: after.label, beforeHeading: before.heading, afterHeading: after.heading,
      beforeText: before.text, afterText: after.text, wordDiff: wordDiff(before.text, after.text),
      summary: comparisonText(locale, "Пункт перемещён без изменения текста.", "Band matni o‘zgarmasdan ko‘chirilgan.", "The clause was moved without changing its text."),
      legalEffect: comparisonText(locale, "Прямого изменения смысла не обнаружено; проверьте контекст нового раздела.", "Bevosita ma’no o‘zgarishi topilmadi; yangi bo‘lim kontekstini tekshiring.", "No direct change in meaning was detected; review the context of the new section."),
      affectedParty: comparisonText(locale, "Не определено", "Aniqlanmagan", "Not determined"), riskEffect: "neutral", riskLevel: "information",
      recommendation: comparisonText(locale, "Проверьте связи пункта с соседними условиями.", "Bandning qo‘shni shartlar bilan aloqasini tekshiring.", "Review how the clause interacts with neighbouring provisions."),
      sourceIds: [], confidencePercent: 95, reviewedAt: null, reviewDecision: null, decidedAt: null, reviewDecisionVersion: 0, extractionWarning: false,
    };
  }
  if (sameSemantic && !sameNormalized) {
    return {
      id, ordinal, changeType: "formatting", beforeSectionId: before.id, afterSectionId: after.id,
      beforeLabel: before.label, afterLabel: after.label, beforeHeading: before.heading, afterHeading: after.heading,
      beforeText: before.text, afterText: after.text, wordDiff: wordDiff(before.text, after.text),
      summary: comparisonText(locale, "Изменено форматирование без обнаруженного изменения смысла.", "Aniqlangan ma’no o‘zgarishisiz format o‘zgartirilgan.", "Formatting changed with no detected change in meaning."),
      legalEffect: comparisonText(locale, "Юридически значимое изменение не обнаружено.", "Yuridik ahamiyatli o‘zgarish topilmadi.", "No legally material change was detected."),
      affectedParty: comparisonText(locale, "Не влияет", "Ta’sir qilmaydi", "No direct impact"), riskEffect: "neutral", riskLevel: "information",
      recommendation: comparisonText(locale, "Дополнительное действие не требуется.", "Qo‘shimcha harakat talab qilinmaydi.", "No further action is required."),
      sourceIds: [], confidencePercent: 94, reviewedAt: null, reviewDecision: null, decidedAt: null, reviewDecisionVersion: 0, extractionWarning: false,
    };
  }
  if (sameNormalized) {
    return {
      id, ordinal, changeType: "unchanged", beforeSectionId: before.id, afterSectionId: after.id,
      beforeLabel: before.label, afterLabel: after.label, beforeHeading: before.heading, afterHeading: after.heading,
      beforeText: before.text, afterText: after.text, wordDiff: [{ value: after.text, kind: "same" }],
      summary: comparisonText(locale, "Без изменений.", "O‘zgarishsiz.", "No change."),
      legalEffect: comparisonText(locale, "Изменений не обнаружено.", "O‘zgarish topilmadi.", "No change was detected."),
      affectedParty: comparisonText(locale, "Не влияет", "Ta’sir qilmaydi", "No direct impact"), riskEffect: "neutral", riskLevel: "information",
      recommendation: comparisonText(locale, "Действие не требуется.", "Harakat talab qilinmaydi.", "No action is required."),
      sourceIds: [], confidencePercent: 100, reviewedAt: null, reviewDecision: null, decidedAt: null, reviewDecisionVersion: 0, extractionWarning: false,
    };
  }
  const description = describeChange(before.text, after.text, locale);
  return {
    id, ordinal, changeType: "changed", beforeSectionId: before.id, afterSectionId: after.id,
    beforeLabel: before.label, afterLabel: after.label, beforeHeading: before.heading, afterHeading: after.heading,
    beforeText: before.text, afterText: after.text, wordDiff: wordDiff(before.text, after.text),
    summary: description.summary, legalEffect: description.legalEffect,
    affectedParty: comparisonText(locale, "Не определено", "Aniqlanmagan", "Not determined"), riskEffect: "requires_review",
    riskLevel: description.riskLevel, recommendation: description.recommendation,
    sourceIds: [], confidencePercent: description.confidencePercent, reviewedAt: null, reviewDecision: null, decidedAt: null, reviewDecisionVersion: 0, extractionWarning: false,
  };
}

function findMatches(before: ExtractedSection[], after: ExtractedSection[]): Map<number, number> {
  const matches = new Map<number, number>();
  const usedAfter = new Set<number>();
  const labels = indexesBy(after, (section) => section.label);
  const labelCursors = new Map<string, number>();

  for (const left of before) {
    if (!left.label) continue;
    const exactIndex = takeUnusedIndex(labels, labelCursors, usedAfter, left.label);
    if (exactIndex !== null) {
      matches.set(left.index, exactIndex);
      usedAfter.add(exactIndex);
    }
  }
  const semanticTexts = indexesBy(after, (section) => section.semanticText || null);
  const semanticCursors = new Map<string, number>();
  for (const left of before) {
    if (matches.has(left.index)) continue;
    if (!left.semanticText) continue;
    const exactIndex = takeUnusedIndex(semanticTexts, semanticCursors, usedAfter, left.semanticText);
    if (exactIndex !== null) {
      matches.set(left.index, exactIndex);
      usedAfter.add(exactIndex);
    }
  }
  const unmatchedBefore = before.filter((section) => !matches.has(section.index));
  const unmatchedAfter = after.filter((section) => !usedAfter.has(section.index));
  if (unmatchedBefore.length * unmatchedAfter.length > MAX_FUZZY_SECTION_COMPARISONS) {
    return matches;
  }
  const afterTokens = new Map(unmatchedAfter.map((section) => [section.index, tokenSet(section.semanticText)]));
  for (const left of unmatchedBefore) {
    let best: { index: number; score: number } | null = null;
    const leftTokens = tokenSet(left.semanticText);
    for (const right of unmatchedAfter) {
      if (usedAfter.has(right.index)) continue;
      const score = tokenSetSimilarity(leftTokens, afterTokens.get(right.index) ?? new Set());
      const positionPenalty = Math.min(Math.abs(left.index - right.index) / Math.max(before.length, after.length, 1), 0.2);
      const adjusted = score - positionPenalty;
      if (adjusted >= 0.46 && (!best || adjusted > best.score)) best = { index: right.index, score: adjusted };
    }
    if (best) {
      matches.set(left.index, best.index);
      usedAfter.add(best.index);
    }
  }
  return matches;
}

export function summarizeChanges(changes: ComparisonChange[], similarityPercent: number, generatedAt: string): ComparisonSummary {
  const count = (type: ComparisonChange["changeType"]) => changes.filter((change) => change.changeType === type).length;
  const material = changes.filter((change) => change.riskLevel === "high" || change.riskLevel === "medium").length;
  const maxRisk: RiskLevel = changes.some((change) => change.riskLevel === "high")
    ? "high"
    : changes.some((change) => change.riskLevel === "medium")
      ? "medium"
      : changes.some((change) => change.riskLevel === "low")
        ? "low"
        : "information";
  return {
    totalChanges: changes.filter((change) => change.changeType !== "unchanged").length,
    materialChanges: material,
    riskIncreased: changes.filter((change) => change.riskEffect === "increased").length,
    riskDecreased: changes.filter((change) => change.riskEffect === "decreased").length,
    added: count("added"), removed: count("removed"), changed: count("changed"), moved: count("moved"),
    renumbered: count("renumbered"), formatting: count("formatting"), unchanged: count("unchanged"),
    changedSections: Array.from(new Set(changes
      .filter((change) => !["unchanged", "formatting"].includes(change.changeType))
      .map((change) => change.afterHeading || change.beforeHeading)
      .filter((value): value is string => Boolean(value)))).slice(0, 30),
    similarityPercent,
    likelyDifferentDocuments: similarityPercent < 35,
    overallRisk: maxRisk,
    aiStatus: "unavailable",
    sourceStatus: "unverified",
    model: null,
    generatedAt,
  };
}

export function compareDocuments(
  versionOne: ExtractedDocument,
  versionTwo: ExtractedDocument,
  locale: ComparisonLocale,
  generatedAt = new Date().toISOString(),
): ComparisonResult {
  const matches = findMatches(versionOne.sections, versionTwo.sections);
  const usedAfter = new Set(matches.values());
  const pairs: Array<{ before: ExtractedSection | null; after: ExtractedSection | null; order: number }> = [];
  for (const left of versionOne.sections) {
    const rightIndex = matches.get(left.index);
    pairs.push({ before: left, after: rightIndex === undefined ? null : versionTwo.sections[rightIndex], order: rightIndex ?? left.index });
  }
  for (const right of versionTwo.sections) {
    if (!usedAfter.has(right.index)) pairs.push({ before: null, after: right, order: right.index });
  }
  pairs.sort((a, b) => a.order - b.order);
  const changes = pairs.map((pair, index) => baseChange(pair.before, pair.after, index + 1, locale));
  const matchedWeight = changes.reduce((total, change) => {
    if (change.changeType === "unchanged" || change.changeType === "renumbered" || change.changeType === "moved" || change.changeType === "formatting") return total + 1;
    if (change.beforeText && change.afterText) return total + similarity(change.beforeText, change.afterText);
    return total;
  }, 0);
  const similarityPercent = Math.round((matchedWeight / Math.max(versionOne.sections.length, versionTwo.sections.length, 1)) * 100);
  return { versionOne, versionTwo, changes, summary: summarizeChanges(changes, similarityPercent, generatedAt) };
}
