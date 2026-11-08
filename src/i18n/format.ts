import type { Locale, LocalizedText } from "@/domain/types";
import { INTL_LOCALE, TIME_ZONE } from "./config";

export const pick = (text: LocalizedText, locale: Locale) => text[locale];

/** One clock everywhere: en-GB alone prints "pm", so English day periods are raised to AM/PM. Arabic ص/م is unaffected. */
function formatClock(iso: string | Date, locale: Locale, opts: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: TIME_ZONE, ...opts })
    .format(new Date(iso))
    .replace(/\b[ap]m\b/, (period) => period.toUpperCase());
}

export function formatDateTime(iso: string | Date, locale: Locale, opts: Intl.DateTimeFormatOptions = {}) {
  return formatClock(iso, locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    ...opts,
  });
}

export function formatTime(iso: string | Date, locale: Locale) {
  return formatClock(iso, locale, { hour: "numeric", minute: "2-digit", hour12: true });
}

export function formatDate(iso: string | Date, locale: Locale) {
  return new Intl.DateTimeFormat(INTL_LOCALE[locale], { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long" }).format(
    new Date(iso),
  );
}

/** "3 hours ago" relative to the workspace clock `now`. */
export function formatRelative(iso: string | Date, now: Date, locale: Locale) {
  const diff = new Date(iso).getTime() - now.getTime();
  const abs = Math.abs(diff);
  const rtf = new Intl.RelativeTimeFormat(INTL_LOCALE[locale], { numeric: "auto" });
  if (abs < 60_000) return rtf.format(0, "second");
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), "minute");
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), "hour");
  return rtf.format(Math.round(diff / 86_400_000), "day");
}

export function formatNumber(n: number, locale: Locale) {
  return new Intl.NumberFormat(INTL_LOCALE[locale]).format(n);
}
