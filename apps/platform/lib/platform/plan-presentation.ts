import type { PlatformLocale } from "./routing";
import { CASE_SCENARIOS, isCaseScenarioId } from "./case-create";

/** Keep matter names short; the complete legal answer remains in the conversation. */
export function suggestedMatterTitle(value: string): string {
  const title = value.replace(/\s+/gu, " ").trim();
  if (title.length <= 100) return title;
  const prefix = title.slice(0, 97);
  const boundary = prefix.lastIndexOf(" ");
  return `${boundary > 60 ? prefix.slice(0, boundary) : prefix}…`;
}

export function planAreaLabel(area: string, locale: PlatformLocale): string {
  if (isCaseScenarioId(area)) return CASE_SCENARIOS[area].label[locale];
  return { ru: "По ответу JURO", uz: "JURO javobi asosida", en: "From a JURO answer" }[locale];
}

export function planStatusLabel(status: string, locale: PlatformLocale): string {
  const labels: Record<string, Record<PlatformLocale, string>> = {
    planned: {ru:"Запланировано",uz:"Rejalashtirilgan",en:"Planned"},
    not_started: {ru:"Не начато",uz:"Boshlanmagan",en:"Not started"},
    in_progress: {ru:"В работе",uz:"Jarayonda",en:"In progress"},
    waiting_user: {ru:"Ждёт меня",uz:"Meni kutmoqda",en:"Waiting for me"},
    waiting_response: {ru:"Ожидает ответа",uz:"Javob kutilmoqda",en:"Awaiting response"},
    overdue: {ru:"Просрочено",uz:"Muddati o‘tgan",en:"Overdue"},
    completed: {ru:"Завершено",uz:"Bajarilgan",en:"Completed"},
    cancelled: {ru:"Отменено",uz:"Bekor qilingan",en:"Cancelled"},
  };
  return labels[status]?.[locale] ?? {ru:"Не начато",uz:"Boshlanmagan",en:"Not started"}[locale];
}
