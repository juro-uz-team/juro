import { z } from "zod";
import { lawyerText } from "./lawyer-localization";
import type { PlatformLocale } from "./routing";

const uuid = z.string().uuid();
const localizedLocale = z.enum(["ru", "uz", "en"]);

export const lawyerRequestSchema = z.object({
  caseId: uuid,
  lawyerProfileId: uuid.optional(),
  anonymizedSummary: z.string().trim().min(20).max(2_000),
  serviceCode: z.enum([
    "initial_consultation",
    "document_review",
    "case_strategy",
    "representation",
    "other",
  ]).optional(),
  preferredFormat: z.enum(["chat", "video", "phone", "office"]).optional(),
  proposedStartsAt: z.string().datetime({ offset: true }).optional(),
  consent: z.literal(true),
  locale: localizedLocale,
}).strict();

export const conflictCheckDecisionSchema = z.object({
  decision: z.enum(["clear", "conflict"]),
  locale: localizedLocale,
}).strict();

export const lawyerAccessGrantSchema = z.object({
  consent: z.literal(true),
  locale: localizedLocale,
}).strict();

export function localizedHandoffError(locale: PlatformLocale, code: string) {
  const messages: Record<string, string> = {
    HANDOFF_PAYMENT_UNAVAILABLE: lawyerText(locale, "Оплата передачи дела пока недоступна.", "Ishni topshirish uchun to‘lov hozircha mavjud emas.", "Payment for case handoff is currently unavailable."),
    PLAN_LIMIT: lawyerText(locale, "Передача дела юристу недоступна на бесплатном плане.", "Ishni yuristga topshirish bepul rejada mavjud emas.", "Lawyer handoff is not available on the free plan."),
    CASE_UNAVAILABLE: lawyerText(locale, "Выбранное дело недоступно.", "Tanlangan ish mavjud emas.", "The selected case is unavailable."),
    LAWYER_UNAVAILABLE: lawyerText(locale, "Выбранный юрист сейчас недоступен.", "Tanlangan yurist hozir mavjud emas.", "The selected lawyer is currently unavailable."),
    REQUEST_UNAVAILABLE: lawyerText(locale, "Заявка недоступна.", "So‘rov mavjud emas.", "The request is unavailable."),
    CONFLICT_REQUIRED: lawyerText(locale, "Сначала необходим положительный conflict check.", "Avval ijobiy manfaatlar to‘qnashuvi tekshiruvi talab qilinadi.", "A successful conflict-of-interest check is required first."),
    GRANT_EXISTS: lawyerText(locale, "Доступ к этому делу уже предоставлен.", "Bu ishga kirish huquqi allaqachon berilgan.", "Access to this case has already been granted."),
    INVALID_INPUT: lawyerText(locale, "Проверьте введённые данные.", "Kiritilgan ma’lumotlarni tekshiring.", "Review the information provided and try again."),
  };
  return messages[code] ?? lawyerText(locale, "Не удалось выполнить действие.", "Amalni bajarib bo‘lmadi.", "We could not complete this action.");
}

export type LawyerRequestInput = z.infer<typeof lawyerRequestSchema>;
