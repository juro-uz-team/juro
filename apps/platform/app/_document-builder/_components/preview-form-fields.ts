import { getAnswer, localize, setAnswer, type BuilderLanguage } from "../../../lib/document-builder/registry/engine";
import type { AnswerScalar, DocumentDefinition, QuestionnaireAnswers } from "../../../lib/document-builder/registry/types";
import { parseAmount } from "../../../lib/document-builder/money-to-words";
import type { PreviewFieldRef, ReceiptAnswers } from "../../../lib/document-builder/types";
import type { PlatformLocale } from "../../../lib/platform/routing";
import type { PreviewEditField } from "./PreviewEditControl";

export function configuredPreviewField(
  definition: DocumentDefinition,
  answers: QuestionnaireAnswers,
  language: BuilderLanguage,
  ref: PreviewFieldRef,
  apply: (next: QuestionnaireAnswers, key: string) => void,
): PreviewEditField | undefined {
  const fields = definition.questionnaire.flatMap(step => step.fields);
  const group = ref.row ? fields.find(field => field.id === ref.row?.group) : undefined;
  const field = (ref.row ? group?.fields ?? group?.columns ?? [] : fields).find(field => field.id === ref.key);
  if (!field || ["file", "multiselect", "repeatable-group", "table", "witnesses"].includes(field.type)) return undefined;
  const rows = ref.row ? getAnswer(answers, ref.row.group) : undefined;
  const row = ref.row && Array.isArray(rows) ? rows[ref.row.index] : undefined;
  if (ref.row && (!row || typeof row !== "object")) return undefined;
  const value = row && typeof row === "object" ? (row as Record<string, AnswerScalar>)[ref.key] : getAnswer(answers, ref.key);
  const options = field.options?.map(option => ({ value: option.value, label: localize(option.label, language) }))
    ?? (field.type === "checkbox" ? [{ value: "true", label: language === "ru" ? "Да" : "Ha" }, { value: "false", label: language === "ru" ? "Нет" : "Yo‘q" }] : undefined);
  const numeric = ["money", "number", "percent"].includes(field.type);
  const type = numeric ? "number" : field.type === "date" || field.type === "email" ? field.type
    : field.type === "phone" ? "tel" : ["long-text", "bank-details"].includes(field.type) ? "multiline" : "text";
  const rules = field.validation;
  return {
    label: localize(field.label, language),
    value: value == null ? "" : String(value),
    type,
    options,
    maxLength: Math.min(rules?.maxLength ?? 20_000, 20_000),
    validate: next => {
      if (!next) return true;
      if (next.length > Math.min(rules?.maxLength ?? 20_000, 20_000) || (rules?.minLength && next.length < rules.minLength)) return false;
      if (rules?.pattern && !new RegExp(rules.pattern).test(next)) return false;
      if (field.type === "pinfl" && !/^\d{14}$/.test(next)) return false;
      if (field.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) return false;
      if (numeric && (!Number.isFinite(Number(next)) || (rules?.min !== undefined && Number(next) < rules.min) || (rules?.max !== undefined && Number(next) > rules.max))) return false;
      return true;
    },
    commit: next => {
      const scalar = field.type === "checkbox" ? next === "true" : next;
      if (ref.row && Array.isArray(rows)) {
        const index = ref.row.index;
        const values = (rows as Record<string, AnswerScalar>[]).map((item, rowIndex) => rowIndex === index ? { ...item, [ref.key]: scalar } : item);
        apply(setAnswer(answers, ref.row.group, values), ref.row.group);
      } else {
        apply(setAnswer(answers, ref.key, scalar), ref.key);
      }
    },
  };
}

const receiptLabels: Record<string, [string, string, string]> = {
  documentPlace: ["Место составления", "Tuzilgan joy", "Place of execution"],
  documentDate: ["Дата составления", "Tuzilgan sana", "Date of execution"],
  loanTransferDate: ["Дата фактической передачи денег", "Pul topshirilgan sana", "Date of transfer"],
  loanRepaymentDate: ["Срок возврата", "Qaytarish muddati", "Repayment due date"],
  loanAmountNumeric: ["Сумма цифрами", "Raqamlardagi summa", "Amount in figures"],
  loanAmountWords: ["Сумма прописью", "So‘z bilan summa", "Amount in words"],
  birthDate: ["Дата рождения", "Tug‘ilgan sana", "Date of birth"],
  fullName: ["Ф.И.О.", "F.I.Sh.", "Full name"],
  idDocumentType: ["Тип документа", "Hujjat turi", "Identity document type"],
  idDocumentNumber: ["Номер документа", "Hujjat raqami", "Identity document number"],
  idIssuedBy: ["Кем выдан", "Kim tomonidan berilgan", "Issuing authority"],
  idIssueDate: ["Дата выдачи", "Berilgan sana", "Issue date"],
  pinfl: ["ПИНФЛ", "JSHSHIR", "PINFL"],
  registeredAddress: ["Адрес регистрации", "Ro‘yxat manzili", "Registered address"],
  phone: ["Телефон", "Telefon", "Phone"],
  noticeDetails: ["Контакты для уведомлений", "Xabarnoma aloqalari", "Notice contact details"],
  date: ["Дата", "Sana", "Date"],
  amount: ["Сумма", "Summa", "Amount"],
  place: ["Место", "Joy", "Place"],
  comment: ["Комментарий", "Izoh", "Comment"],
  bankName: ["Банк", "Bank", "Bank"],
  accountNumber: ["Счёт", "Hisob raqami", "Account number"],
  paymentReference: ["Назначение платежа", "To‘lov maqsadi", "Payment reference"],
  confirmationDetails: ["Подтверждение", "Tasdiq", "Confirmation details"],
  senderCardLast4: ["Последние 4 цифры карты отправителя", "Jo‘natuvchi kartasining oxirgi 4 raqami", "Sender card’s last four digits"],
  recipientCardLast4: ["Последние 4 цифры карты получателя", "Qabul qiluvchi kartasining oxirgi 4 raqami", "Recipient card’s last four digits"],
  time: ["Время перевода", "O‘tkazma vaqti", "Transfer time"],
  transferredAmount: ["Сумма перевода", "O‘tkazma summasi", "Transfer amount"],
  transactionNumber: ["Номер транзакции", "Tranzaksiya raqami", "Transaction number"],
  otherMethodName: ["Способ передачи", "Topshirish usuli", "Transfer method"],
  otherDetails: ["Реквизиты возврата", "Qaytarish tafsilotlari", "Repayment details"],
  rate: ["Процентная ставка", "Foiz stavkasi", "Interest rate"],
  customPeriod: ["Период начисления", "Hisoblash davri", "Interest period"],
  customPaymentOrder: ["Порядок уплаты процентов", "Foizlarni to‘lash tartibi", "Interest payment terms"],
  otherTerms: ["Иные условия займа", "Qarzning boshqa shartlari", "Other loan terms"],
  earlyRepaymentCustom: ["Условия досрочного возврата", "Muddatidan oldin qaytarish shartlari", "Early repayment terms"],
  additionalTerms: ["Дополнительные условия", "Qo‘shimcha shartlar", "Additional terms"],
  notificationPeriod: ["Срок уведомления", "Xabarnoma muddati", "Notice period"],
};

export function receiptPreviewField(answers: ReceiptAnswers, { key }: PreviewFieldRef, locale: PlatformLocale, apply: (next: ReceiptAnswers) => void): PreviewEditField | undefined {
  const segments = key.split(".");
  const name = segments.at(-1) ?? "";
  const field = receiptLabels[name];
  const value = getAnswer(answers as unknown as Record<string, unknown>, key);
  if (!field || typeof value !== "string") return undefined;
  const lang = locale === "ru" ? 0 : locale === "uz" ? 1 : 2;
  const party = segments[0] === "lender" ? ["Займодавец", "Qarz beruvchi", "Lender"]
    : segments[0] === "borrower" ? ["Заемщик", "Qarz oluvchi", "Borrower"] : null;
  const type = /date$/i.test(name) ? "date" : name === "phone" ? "tel" : "text";
  const options = name === "idDocumentType" ? [
    { value: "passport", label: locale === "ru" ? "Паспорт" : "Pasport" },
    { value: "id_card", label: locale === "ru" ? "ID-карта" : "ID card" },
  ] : undefined;
  return {
    label: party ? `${party[lang]} · ${field[lang]}` : field[lang],
    value, type, options, maxLength: 500,
    validate: next => {
      if (!next) return true;
      if (name === "pinfl") return /^\d{14}$/.test(next);
      if (name.endsWith("Last4")) return /^\d{4}$/.test(next);
      if (["amount", "loanAmountNumeric", "transferredAmount", "rate"].includes(name)) return parseAmount(next) !== null;
      if (name === "notificationPeriod") return /^\d+$/.test(next);
      return true;
    },
    commit: next => {
      const updated = structuredClone(answers);
      const parent = segments.length === 1 ? updated : getAnswer(updated as unknown as Record<string, unknown>, segments.slice(0, -1).join("."));
      if (!parent || typeof parent !== "object") return;
      (parent as Record<string, unknown>)[name] = next;
      if (key === "loanAmountWords") updated.loanAmountWordsManuallyEdited = Boolean(next);
      apply(updated);
    },
  };
}
