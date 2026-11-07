import type {PlatformLocale} from "../platform/routing";
import type {LegalAnswerFailureReason} from "./legal-answer-failure";

export type LegalAnswerViewSource = {
  sourceId: string;
  actTitle: string;
  actIdentifier?: string | null;
  article?: string | null;
  originalUrl: string;
  status: string;
  effectiveDate?: string | null;
  verifiedAt?: string;
  documentNumber?: string | null;
  sourceClass?: string;
  sourceOrigin?: "indexed" | "live" | "web";
};

export type LegalAnswerViewResult = {
  responseKind: "answer" | "clarification_required";
  presentationKind?: "conversation" | "legal_answer";
  summary: string;
  summarySourceIds?: string[];
  answer: string;
  clarificationQuestions: string[];
  confirmedFindings: Array<{ title: string; explanation: string; sourceIds?: string[] }>;
  issues?: Array<{findingIndex:number;actionIndices:number[]}>;
  assumptions: Array<{ statement: string; impact: string }>;
  risks: Array<{ level: "low" | "medium" | "high" | "critical"; title: string; explanation: string; sourceIds?: string[] }>;
  sources: LegalAnswerViewSource[];
  requiredDocuments: Array<{ name: string; reason: string; required: boolean }>;
  actionPlan: Array<{ title: string; description: string; sourceIds?: string[] }>;
  deadlines: Array<{ title: string; dueDate: string | null; calculationMethod: string; confidence: string; sourceIds?: string[] }>;
  urgency: "normal" | "high" | "critical";
  suggestedDocument: { templateCode?: string | null; title: string; reason: string } | null;
  legalDatabaseAsOf: string;
  evidenceMode?: "official" | "mixed" | "secondary_only" | "private_only" | "none";
  referenceNotes?: Array<{ title: string; note: string; sourceIds: string[] }>;
  conditionalBranches?: Array<{ condition: string; outcome: string; sourceIds: string[] }>;
  coverageGaps?: string[];
  validationMethod?: "programmatic";
  coverageStatus?: "good_coverage" | "partial_coverage" | "weak_coverage" | "no_coverage";
  failureReason?: LegalAnswerFailureReason;
};

type AnswerCopy = {
  main: string;
  law: string;
  branches: string;
  next: string;
  important: string;
  deadlines: string;
  prepare: string;
  additional: string;
  clarify: string;
  insufficient: string;
  checked: string;
  checkedBody: string;
  partial: string;
  missing: string;
  authority: Record<NonNullable<LegalAnswerViewResult["evidenceMode"]>, string>;
  citationLabel: string;
  openSource: string;
  criticalUrgency: string;
  priorityUrgency: string;
  secondaryNote: string;
};

export const legalAnswerCopy: Record<PlatformLocale, AnswerCopy> = {
  ru: {
    main: "Главное",
    law: "Что говорит закон",
    branches: "Как меняется ответ",
    next: "Что делать дальше",
    important: "Важно учесть",
    deadlines: "Сроки",
    prepare: "Что подготовить",
    additional: "Дополнительные материалы",
    clarify: "Что нужно уточнить",
    insufficient: "Пока нельзя подтвердить ответ",
    checked: "Что удалось проверить",
    checkedBody: "Доступных подтверждений недостаточно для полного правового вывода.",
    partial: "Ответ неполный: остаются неподтверждённые вопросы",
    missing: "Нужны дополнительные факты или подтверждённая применимая норма. JURO не заменяет их предположением из общих знаний модели.",
    authority: {
      official: "Подтверждено официальными источниками",
      mixed: "Официальные и контекстные источники",
      secondary_only: "Только справочные материалы",
      private_only: "Факты из ваших документов",
      none: "Правовое основание не подтверждено",
    },
    citationLabel: "Правовые основания",
    openSource: "Открыть источник",
    criticalUrgency: "Критическая срочность: проверьте ближайший срок и возможность немедленной помощи.",
    priorityUrgency: "Вопрос требует приоритетного внимания.",
    secondaryNote: "Эти материалы поясняют контекст, но не устанавливают правовые нормы, сроки, расчёты или обязательные действия.",
  },
  uz: {
    main: "Asosiysi",
    law: "Qonunda nima deyilgan",
    branches: "Javob qachon o‘zgaradi",
    next: "Keyingi qadamlar",
    important: "Muhim jihatlar",
    deadlines: "Muddatlar",
    prepare: "Nimalarni tayyorlash kerak",
    additional: "Qo‘shimcha materiallar",
    clarify: "Nimani aniqlashtirish kerak",
    insufficient: "Javobni hozircha tasdiqlab bo‘lmaydi",
    checked: "Nimalar tekshirildi",
    checkedBody: "Mavjud tasdiqlar to‘liq huquqiy xulosa uchun yetarli emas.",
    partial: "Javob to‘liq emas: tasdiqlanmagan masalalar qolmoqda",
    missing: "Qo‘shimcha faktlar yoki tasdiqlangan amaldagi norma kerak. JURO ularning o‘rniga modelning umumiy bilimiga asoslangan taxmin bermaydi.",
    authority: {
      official: "Rasmiy manbalar bilan tasdiqlangan",
      mixed: "Rasmiy va kontekst manbalari",
      secondary_only: "Faqat ma’lumotnoma materiallari",
      private_only: "Hujjatlaringizdagi faktlar",
      none: "Huquqiy asos tasdiqlanmagan",
    },
    citationLabel: "Huquqiy asoslar",
    openSource: "Manbani ochish",
    criticalUrgency: "Juda shoshilinch: yaqin muddat va zudlik bilan yordam olish imkonini tekshiring.",
    priorityUrgency: "Masala ustuvor e’tiborni talab qiladi.",
    secondaryNote: "Bu materiallar kontekstni tushuntiradi, lekin huquqiy norma, muddat, hisob-kitob yoki majburiy harakatni belgilamaydi.",
  },
  en: {
    main: "Key point",
    law: "What the law says",
    branches: "When the answer changes",
    next: "What to do next",
    important: "Important considerations",
    deadlines: "Deadlines",
    prepare: "What to prepare",
    additional: "Additional materials",
    clarify: "What needs clarification",
    insufficient: "The answer cannot yet be verified",
    checked: "What was checked",
    checkedBody: "The available evidence is insufficient for a complete legal conclusion.",
    partial: "This answer is incomplete: some issues remain unverified",
    missing: "Additional facts or a verified applicable rule are required. JURO will not replace them with an assumption based on a model's general knowledge.",
    authority: {
      official: "Verified by official sources",
      mixed: "Official and contextual sources",
      secondary_only: "Reference materials only",
      private_only: "Facts from your documents",
      none: "Legal basis not verified",
    },
    citationLabel: "Legal authorities",
    openSource: "Open source",
    criticalUrgency: "Critical urgency: check the nearest deadline and whether immediate assistance is available.",
    priorityUrgency: "This matter requires priority attention.",
    secondaryNote: "These materials explain context, but do not establish legal rules, deadlines, calculations or mandatory actions.",
  },
};

