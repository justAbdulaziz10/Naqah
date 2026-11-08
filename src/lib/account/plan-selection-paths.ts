import type { Locale } from "@/domain/types";
import { safeReturnPath } from "@/lib/supabase/auth-input";

/** Preserve only a same-origin locale path while sending an owner through the initial plan gate. */
export function planSelectionGatePath(locale: Locale, currentUrl: unknown): string {
  const next = safeReturnPath(currentUrl);
  return `/${locale}/choose-plan${next ? `?next=${encodeURIComponent(next)}` : ""}`;
}

/** A valid return path is honored only after setup; selection itself always leads through setup. */
export function planSelectionResumePath(locale: Locale, setupComplete: boolean, destination: unknown): string {
  const candidate = safeReturnPath(destination);
  const next = candidate && !/^\/(ar|en)\/choose-plan(?:\/|\?|#|$)/.test(candidate) ? candidate : null;
  if (setupComplete) return next ?? `/${locale}/app`;

  const isStartPath = next !== null && /^\/(ar|en)\/start(?:\/|\?|#|$)/.test(next);
  const query = next && !isStartPath ? `?returnTo=${encodeURIComponent(next)}` : "";
  return `/${locale}/start${query}`;
}
