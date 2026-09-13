import { aiText, type AiOutputLocale } from "./localization";

export type LegalAnswerFailureReason = "question_interpretation_unavailable" | "official_research_unavailable";

export function legalResearchFailureReason(errors: readonly {code: string}[]): LegalAnswerFailureReason | undefined {
  if (errors.some(error => error.code === "QUESTION_INTERPRETATION_UNAVAILABLE")) return "question_interpretation_unavailable";
  return errors.some(error => /^(?:LEGAL_SOURCE_(?:SEARCH_TIMEOUT|SEARCH_UNAVAILABLE|UPSTREAM_UNAVAILABLE|CURRENT_STATUS_UNAVAILABLE|TIMEOUT|HTTP_\d+)|TARGET_RETRIEVAL_(?:TIMEOUT|FAILED))$/u.test(error.code))
    ? "official_research_unavailable" : undefined;
}

export function officialResearchFailureText(locale: AiOutputLocale): string {
  return aiText(locale,
    "Не удалось завершить проверку официальных источников из-за временной недоступности поиска или документов. Это не означает отсутствия применимых норм. Показанные материалы не составляют полного правового ответа. Повторите поиск; лимит ответа не списан.",
    "Qidiruv yoki hujjatlar vaqtincha mavjud bo‘lmagani sababli rasmiy manbalarni tekshirish yakunlanmadi. Bu tegishli normalar mavjud emasligini anglatmaydi. Ko‘rsatilgan materiallar to‘liq huquqiy javob emas. Qidiruvni takrorlang; javob limiti sarflanmadi.",
    "Official source verification could not finish because search or documents were temporarily unavailable. This does not mean that no applicable law exists. The displayed material is not a complete legal answer. Retry the search; your answer allowance was not used.");
}

export function questionInterpretationFailureText(locale: AiOutputLocale): string {
  return aiText(locale,
    "Не удалось надёжно разобрать все части вопроса. Поиск правовых источников не начался. Попробуйте отправить вопрос ещё раз; лимит ответа не списан.",
    "Savolning barcha qismlarini ishonchli tushunib bo‘lmadi. Huquqiy manbalarni qidirish boshlanmadi. Savolni qayta yuboring; javob limiti sarflanmadi.",
    "JURO could not reliably interpret every part of the question. Legal source search did not start. Try sending the question again; your answer allowance was not used.");
}
