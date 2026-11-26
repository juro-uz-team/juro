import type { RenderedParagraph } from "../document-builder/types";
import type { ComparisonAccessRow } from "./storage";
import type { ComparisonChange, ComparisonLocale, ComparisonSummary } from "./types";

type ReportSource = {
  id: string;
  actTitle?: string;
  actIdentifier?: string | null;
  officialUrl?: string;
  revisionDate?: string | null;
  lastCheckedAt?: string;
};

type ReportCopy = {
  title: string;
  originalVersion: string;
  revisedVersion: string;
  generatedAt: string;
  summary: string;
  totalChanges: string;
  materialChanges: string;
  changeBreakdown: string;
  similarity: string;
  overallRisk: string;
  aiIncomplete: string;
  materialChangesHeading: string;
  noMaterialChanges: string;
  beforeDeleted: string;
  afterAdded: string;
  legalEffect: string;
  impact: string;
  risk: string;
  recommendation: string;
  source: string;
  sourceUnverified: string;
  disclaimerHeading: string;
  disclaimer: string;
};

const reportCopy: Record<ComparisonLocale, ReportCopy> = {
  ru: {
    title: "ОТЧЁТ О СРАВНЕНИИ ДОКУМЕНТОВ",
    originalVersion: "Исходная версия",
    revisedVersion: "Новая редакция",
    generatedAt: "Дата формирования",
    summary: "КРАТКОЕ РЕЗЮМЕ",
    totalChanges: "Всего изменений",
    materialChanges: "Существенных изменений",
    changeBreakdown: "Добавлено / удалено / изменено",
    similarity: "Сходство документов",
    overallRisk: "Общий уровень риска",
    aiIncomplete: "Юридическая AI-оценка не была полностью выполнена. Детерминированный redline сохранён; выводы требуют проверки юриста.",
    materialChangesHeading: "СУЩЕСТВЕННЫЕ ИЗМЕНЕНИЯ",
    noMaterialChanges: "Существенных изменений не обнаружено.",
    beforeDeleted: "Было (удалено)",
    afterAdded: "Стало (добавлено)",
    legalEffect: "Юридическое значение",
    impact: "Влияние",
    risk: "риск",
    recommendation: "Рекомендация",
    source: "Источник",
    sourceUnverified: "Источник временно не проверен.",
    disclaimerHeading: "ДИСКЛЕЙМЕР JURO",
    disclaimer: "Отчёт создан автоматизированно и не заменяет индивидуальную юридическую консультацию. Перед подписанием или изменением существенного документа проверьте выводы и официальные источники.",
  },
  uz: {
    title: "HUJJATLARNI TAQQOSLASH HISOBOTI",
    originalVersion: "Dastlabki versiya",
    revisedVersion: "Yangi tahrir",
    generatedAt: "Yaratilgan sana",
    summary: "QISQA XULOSA",
    totalChanges: "Jami o‘zgarishlar",
    materialChanges: "Muhim o‘zgarishlar",
    changeBreakdown: "Qo‘shilgan / olib tashlangan / o‘zgartirilgan",
    similarity: "Hujjatlar o‘xshashligi",
    overallRisk: "Umumiy xavf darajasi",
    aiIncomplete: "Yuridik AI-baholash to‘liq bajarilmadi. Deterministik redline saqlandi; xulosalar yurist tekshiruvini talab qiladi.",
    materialChangesHeading: "MUHIM O‘ZGARISHLAR",
    noMaterialChanges: "Muhim o‘zgarishlar topilmadi.",
    beforeDeleted: "Oldin (olib tashlangan)",
    afterAdded: "Keyin (qo‘shilgan)",
    legalEffect: "Yuridik ahamiyat",
    impact: "Ta’sir",
    risk: "xavf",
    recommendation: "Tavsiya",
    source: "Manba",
    sourceUnverified: "Manba vaqtincha tekshirilmagan.",
    disclaimerHeading: "JURO OGOHLANTIRISHI",
    disclaimer: "Hisobot avtomatlashtirilgan tarzda yaratilgan va individual yuridik maslahat o‘rnini bosmaydi. Muhim hujjatni imzolash yoki o‘zgartirishdan oldin xulosalar va rasmiy manbalarni tekshiring.",
  },
  en: {
    title: "DOCUMENT COMPARISON REPORT",
    originalVersion: "Original version",
    revisedVersion: "Revised version",
    generatedAt: "Generated",
    summary: "EXECUTIVE SUMMARY",
    totalChanges: "Total changes",
    materialChanges: "Material changes",
    changeBreakdown: "Added / removed / changed",
    similarity: "Document similarity",
    overallRisk: "Overall risk",
    aiIncomplete: "The legal AI assessment was not completed in full. The deterministic redline has been preserved; have a qualified lawyer review the findings.",
    materialChangesHeading: "MATERIAL CHANGES",
    noMaterialChanges: "No material changes were identified.",
    beforeDeleted: "Before (deleted)",
    afterAdded: "After (inserted)",
    legalEffect: "Legal effect",
    impact: "Impact",
    risk: "risk",
    recommendation: "Recommendation",
    source: "Source",
    sourceUnverified: "The source has not yet been verified.",
    disclaimerHeading: "JURO DISCLAIMER",
    disclaimer: "This report was generated automatically and does not replace advice tailored to your circumstances. Before signing or materially amending a document, verify the findings and consult the official sources.",
  },
};

const dateLocales: Record<ComparisonLocale, string> = { ru: "ru-RU", uz: "uz-UZ", en: "en-GB" };

const riskLabels: Record<ComparisonLocale, Record<string, string>> = {
  ru: { high: "высокий", medium: "средний", low: "низкий", information: "информационный" },
  uz: { high: "yuqori", medium: "o‘rta", low: "past", information: "axborot" },
  en: { high: "high", medium: "medium", low: "low", information: "informational" },
};

function resolvedLocale(value: string): ComparisonLocale {
  if (value === "uz" || value === "en") return value;
  return "ru";
}

function riskLabel(locale: ComparisonLocale, value: string): string {
  return riskLabels[locale][value]
    ?? ({ ru: "не определён", uz: "aniqlanmagan", en: "not determined" } satisfies Record<ComparisonLocale, string>)[locale];
}

export function comparisonReportParagraphs(input: {
  comparison: ComparisonAccessRow;
  summary: ComparisonSummary | null;
  changes: ComparisonChange[];
  sources: ReportSource[];
}): RenderedParagraph[] {
  const locale = resolvedLocale(input.comparison.locale);
  const copy = reportCopy[locale];
  const paragraphs: RenderedParagraph[] = [];
  const push = (
    text: string,
    kind: RenderedParagraph["kind"] = "body",
    keepWithNext = false,
  ) => paragraphs.push({ id: `comparison-report-${paragraphs.length + 1}`, text, kind, keepWithNext });
  const summary = input.summary;
  const sourceMap = new Map(input.sources.map((source) => [source.id, source]));

  push(copy.title, "title");
  push(`${copy.originalVersion}: ${input.comparison.versionOneName}\n${copy.revisedVersion}: ${input.comparison.versionTwoName}`, "subtitle");
  push(`${copy.generatedAt}: ${new Intl.DateTimeFormat(dateLocales[locale], {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date())}`);

  push(copy.summary, "heading", true);
  if (summary) {
    push(`${copy.totalChanges}: ${summary.totalChanges}.`);
    push(`${copy.materialChanges}: ${summary.materialChanges}.`);
    push(`${copy.changeBreakdown}: ${summary.added} / ${summary.removed} / ${summary.changed}.`);
    push(`${copy.similarity}: ${summary.similarityPercent}%.`);
    push(`${copy.overallRisk}: ${riskLabel(locale, summary.overallRisk)}.`);
    if (summary.aiStatus !== "completed" && summary.aiStatus !== "not_required") push(copy.aiIncomplete, "body");
  }

  push(copy.materialChangesHeading, "heading", true);
  const materialChanges = input.changes.filter((change) =>
    change.changeType !== "unchanged" && change.changeType !== "formatting",
  );
  if (!materialChanges.length) push(copy.noMaterialChanges);
  for (const change of materialChanges) {
    const label = change.afterLabel || change.beforeLabel || String(change.ordinal);
    push(`${label}. ${change.summary}`, "heading", true);
    if (change.beforeText) paragraphs.push({
      id: `comparison-report-${paragraphs.length + 1}`,
      text: `${copy.beforeDeleted}: ${change.beforeText}`,
      kind: "body",
      reviewMark: "deleted",
    });
    if (change.afterText) paragraphs.push({
      id: `comparison-report-${paragraphs.length + 1}`,
      text: `${copy.afterAdded}: ${change.afterText}`,
      kind: "body",
      reviewMark: "inserted",
    });
    push(`${copy.legalEffect}: ${change.legalEffect}`);
    push(`${copy.impact}: ${change.affectedParty}; ${copy.risk} — ${riskLabel(locale, change.riskLevel)}.`);
    push(`${copy.recommendation}: ${change.recommendation}`);
    if (change.sourceIds.length) {
      for (const sourceId of change.sourceIds) {
        const source = sourceMap.get(sourceId);
        if (!source) continue;
        push(
          `${copy.source}: ${source.actTitle || sourceId}`
            + `${source.actIdentifier ? ` (${source.actIdentifier})` : ""}`
            + `${source.revisionDate ? ` · ${source.revisionDate}` : ""}`
            + `${source.officialUrl ? ` · ${source.officialUrl}` : ""}`,
          "list",
        );
      }
    } else {
      push(copy.sourceUnverified, "list");
    }
  }

  if (summary?.legalResearchScope === "document" && input.sources.length) {
    push({
      ru: "Правовые источники по документу",
      uz: "Hujjatga oid huquqiy manbalar",
      en: "Legal context for the document",
    }[locale], "heading", true);
    for (const source of input.sources) {
      push([source.actTitle, source.officialUrl].filter(Boolean).join(" · "), "list");
    }
  }

  push(copy.disclaimerHeading, "heading", true);
  push(copy.disclaimer);
  return paragraphs;
}
