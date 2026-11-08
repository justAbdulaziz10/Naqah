import type { Locale } from "@/domain/types";
import { INTL_LOCALE } from "@/i18n/config";

const HOUR = 60 * 60 * 1000;

/** A plain length of time, e.g. "7 hours" or "3 days", for spans that have already ended. */
export function formatDuration(ms: number, locale: Locale): string {
  const [value, unit] = ms < HOUR ? [Math.max(1, Math.round(ms / 60_000)), "minute"] : ms < 48 * HOUR ? [Math.round(ms / HOUR), "hour"] : [Math.round(ms / (24 * HOUR)), "day"];
  return new Intl.NumberFormat(INTL_LOCALE[locale], { style: "unit", unit: unit as string, unitDisplay: "long" }).format(value as number);
}
