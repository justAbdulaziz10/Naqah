"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale, LocalizedText } from "@/domain/types";
import { dirOf } from "./config";
import { formatDate, formatDateTime, formatNumber, formatRelative, formatTime } from "./format";
import { getMessages, type Messages } from "./messages";

interface I18nValue {
  locale: Locale;
  dir: "rtl" | "ltr";
  /** All message namespaces for the current locale: `m.common.nav.overview`. */
  m: Messages;
  /** Pick the current language from a stored bilingual value. */
  t: (text: LocalizedText) => string;
  fmt: {
    dateTime: (iso: string | Date, opts?: Intl.DateTimeFormatOptions) => string;
    date: (iso: string | Date) => string;
    time: (iso: string | Date) => string;
    relative: (iso: string | Date, now: Date) => string;
    number: (n: number) => string;
  };
  /** Prefix a path with the locale: href("/app") → "/ar/app". */
  href: (path: string) => string;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({ locale, children }: { locale: Locale; children: ReactNode }) {
  const value = useMemo<I18nValue>(
    () => ({
      locale,
      dir: dirOf(locale),
      m: getMessages(locale),
      t: (text) => text[locale],
      fmt: {
        dateTime: (iso, opts) => formatDateTime(iso, locale, opts),
        date: (iso) => formatDate(iso, locale),
        time: (iso) => formatTime(iso, locale),
        relative: (iso, now) => formatRelative(iso, now, locale),
        number: (n) => formatNumber(n, locale),
      },
      href: (path) => `/${locale}${path === "/" ? "" : path}`,
    }),
    [locale],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error("useI18n must be used inside <I18nProvider>");
  return v;
}
