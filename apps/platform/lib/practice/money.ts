import { PracticeError } from "./errors";
export const currencyScales: Record<string, number> = {
  UZS: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  RUB: 2,
  CNY: 2,
  KZT: 2,
  TRY: 2,
  AED: 2,
  JPY: 0,
  KWD: 3,
};
export function minorUnits(value: string, currency: string): number {
  const scale = currencyScales[currency];
  if (scale === undefined || !/^\d+(?:\.\d+)?$/.test(value))
    throw new PracticeError("INVALID_MONEY");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > scale) throw new PracticeError("INVALID_MONEY");
  const result =
    BigInt(whole) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, "0") || "0");
  if (result > BigInt(Number.MAX_SAFE_INTEGER))
    throw new PracticeError("INVALID_MONEY");
  return Number(result);
}
export function displayMoney(minor: number | string, currency: string): string {
  const value = BigInt(minor),
    sign = value < 0n ? "−" : "",
    digits = currencyScales[currency] ?? 2;
  const absolute = value < 0n ? -value : value,
    scale = 10n ** BigInt(digits);
  return `${sign}${(absolute / scale).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")}${digits ? "." + (absolute % scale).toString().padStart(digits, "0") : ""} ${currency}`;
}
export function safeSum(values: number[]): number {
  const sum = values.reduce((total, value) => total + BigInt(value), 0n);
  if (
    sum > BigInt(Number.MAX_SAFE_INTEGER) ||
    sum < BigInt(Number.MIN_SAFE_INTEGER)
  )
    throw new PracticeError("INVALID_MONEY");
  return Number(sum);
}
export function invoiceStatus(
  total: number,
  paid: number,
  dueOn: string,
  today: string,
) {
  return paid >= total
    ? "paid"
    : paid > 0
      ? dueOn < today
        ? "overdue_partial"
        : "partial"
      : dueOn < today
        ? "overdue"
        : "unpaid";
}
