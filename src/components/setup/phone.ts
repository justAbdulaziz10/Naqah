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

/** What the owner sees after the fixed +966: "50 123 4567" for a saved number, anything else as typed. */
export function localSaudiPart(value: string) {
  const phone = toE164(value);
  if (phone) return `${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`;
  return value.replace(/^\s*\+966\s*/, "");
}

/**
 * What is stored for what the owner typed after +966. A number they typed in full (05…, +966…, 00966…)
 * is kept as typed, so nothing they meant is lost; the rest gets the country code in front.
 */
export function fromLocalSaudiPart(typed: string) {
  const text = latinDigits(typed).trim();
  if (!text) return "";
  if (/^(?:0|\+|00)/.test(text)) return text;
  return `+966 ${text}`;
}
