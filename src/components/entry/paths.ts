import type { Locale } from "@/domain/types";

/** Account data is opt-in at build time; without it a "farm" can only live in this browser. */
export const ACCOUNT_DATA = process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA === "1";

/** Where "Get started" leads: an owner account when accounts are on, otherwise browser setup. */
export function getStartedPath(locale: Locale): string {
  const start = `/${locale}/start`;
  return ACCOUNT_DATA ? `/${locale}/signup?next=${encodeURIComponent(start)}` : start;
}
