import type { Locale, Plan } from "@/domain/types";

/**
 * Shared by every week visual. Weeks run Sunday first (index 0), as in the product.
 * Arabic has no short weekday names, so tight strips use the one-letter `narrow` forms (ح ن ث …).
 */
export function weekdayForms(locale: Locale, index: number): { short: string; narrow: string } {
  const at = Date.UTC(2023, 0, 1 + index); // 1 Jan 2023 was a Sunday.
  const form = (weekday: "short" | "narrow") => new Intl.DateTimeFormat(locale, { weekday, timeZone: "UTC" }).format(at);
  return { short: form("short"), narrow: form("narrow") };
}

/** Whether a plan's week marks this day: Ultimate every day, Basic only its chosen weekday. */
export function isCallDay(plan: Plan, day: number | null | undefined, index: number): boolean {
  return plan === "ultimate" || index === day;
}
