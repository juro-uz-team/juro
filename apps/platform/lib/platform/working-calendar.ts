/** Uzbekistan five-day workweek. Annual exceptions are versioned with their sources.
 * Fixed holidays: Labour Code, article 208, https://lex.uz/docs/6257291
 * 2026 transfers/additional days: https://lex.uz/docs/7938924
 * Eid: https://lex.uz/docs/-8090629 and https://president.uz/ru/lists/view/9233
 * Other years deliberately remain partial until annual decisions are reviewed.
 */
const fixedHolidays = ["01-01", "03-08", "03-21", "05-09", "09-01", "10-01", "12-08"];
const annualDaysOff: Record<number, string[]> = {
  2026: ["01-02", "03-09", "03-20", "03-23", "05-11", "05-27", "05-28", "05-29", "08-31", "12-31"],
};
const annualWorkingDays: Record<number, string[]> = { 2026: ["12-12"] };
export const uzCalendarVersion = "uz-five-day-2026-v1";
export function uzWorkingCalendar(sourceYear: number) {
  const holidays = new Set<string>();
  const workingDays = new Set<string>();
  // Covers the maximum 3,650-business-day calculation plus safety margin.
  for (let year = sourceYear - 1; year <= sourceYear + 16; year++) {
    for (const date of [...fixedHolidays, ...(annualDaysOff[year] ?? [])]) holidays.add(`${year}-${date}`);
    for (const date of annualWorkingDays[year] ?? []) workingDays.add(`${year}-${date}`);
  }
  return { holidays, workingDays, version: uzCalendarVersion, covers: (from: string, to: string) => from >= "2026-01-01" && to <= "2026-12-31" };
}
