import type { Locale } from "@/domain/types";

export const LOCALES: Locale[] = ["ar", "en"];
export const DEFAULT_LOCALE: Locale = "ar";

export const isLocale = (v: string | undefined | null): v is Locale => v === "ar" || v === "en";
export const dirOf = (l: Locale) => (l === "ar" ? "rtl" : "ltr");
export const otherLocale = (l: Locale): Locale => (l === "ar" ? "en" : "ar");

/** Keeps a query string across a language switch, moving a `next` return path to the new language. */
export function searchForLocale(search: string, from: Locale, to: Locale) {
  const params = new URLSearchParams(search);
  const next = params.get("next");
  const prefix = new RegExp(`^/${from}(?=[/?#]|$)`);
  if (!next || !prefix.test(next)) return search;
  params.set("next", next.replace(prefix, `/${to}`));
  return `?${params}`;
}

/** Intl locale tags: Gregorian calendar, Latin digits (brand: Montserrat renders numbers). */
export const INTL_LOCALE: Record<Locale, string> = {
  ar: "ar-SA-u-ca-gregory-nu-latn",
  en: "en-GB",
};

export const TIME_ZONE = "Asia/Riyadh";
