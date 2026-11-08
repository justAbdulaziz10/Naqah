import { latinDigits, normalizeSaudiPhone } from "@/lib/supabase/auth-input";

/** Handles what owners paste or type beyond the sign-in formats: dots, bidi marks and +966 05…. */
function toE164(value: string): string | null {
  const compact = latinDigits(value)
    .replace(/[\s().\-؜‎‏‪-‮⁦-⁩]/g, "")
    .replace(/^(?:\+|00)?9660/, "+966");
  return normalizeSaudiPhone(compact);
}

export function isSaudiMobile(value: string) {
  return toE164(value) !== null;
}

/** Empty is allowed: phone numbers are optional until calls are set up. */
export function phoneNeedsFixing(value: string) {
  return value.trim() !== "" && !isSaudiMobile(value);
}

/** One stored form for every accepted input, e.g. +966 50 123 4567. Anything else stays as typed. */
export function formatSaudiMobile(value: string) {
  const phone = toE164(value);
  return phone ? `+966 ${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : value;
}
