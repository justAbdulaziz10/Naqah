import { latinDigits, normalizeSaudiPhone } from "@/lib/supabase/auth-input";

/**
 * LOCAL DEMO ONLY (the runner's --allow-uk-numbers): a UK mobile is accepted too, beside a «+966 / +44» choice, so a
 * tester can take NAQAH's UK-number call on a UK phone. Off everywhere else: Saudi mobiles only.
 */
export const DEMO_UK_NUMBERS = process.env.NEXT_PUBLIC_NAQAH_DEMO_UK_NUMBERS === "1";

export type PhoneCountry = "SA" | "GB";

const compactOf = (value: string) => latinDigits(value).replace(/[\s().\-؜‎‏‪-‮⁦-⁩]/g, "");

function ukE164(value: string): string | null {
  if (!DEMO_UK_NUMBERS) return null;
  const compact = compactOf(value);
  if (/^(?:\+|00)?447\d{9}$/.test(compact)) return `+${compact.replace(/^(?:\+|00)/, "")}`;
  if (/^07\d{9}$/.test(compact)) return `+44${compact.slice(1)}`;
  return null;
}

/** Handles what owners paste or type beyond the sign-in formats: dots, bidi marks and +966 05…. */
function toE164(value: string): string | null {
  const compact = compactOf(value).replace(/^(?:\+|00)?9660/, "+966");
  return normalizeSaudiPhone(compact) ?? ukE164(value);
}

/** Which country a number is in, for the demo's «+966 / +44» choice. */
export function phoneCountry(value: string): PhoneCountry {
  return DEMO_UK_NUMBERS && /^\s*(?:\+|00)?44/.test(latinDigits(value)) ? "GB" : "SA";
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
  if (phone?.startsWith("+44")) return `+44 ${phone.slice(3, 7)} ${phone.slice(7)}`;
  return phone ? `+966 ${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` : value;
}

/** What the owner sees after the fixed +966: "50 123 4567" for a saved number, anything else as typed. */
export function localSaudiPart(value: string) {
  const phone = toE164(value);
  if (phone?.startsWith("+44")) return `${phone.slice(3, 7)} ${phone.slice(7)}`;
  if (phone) return `${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}`;
  return value.replace(/^\s*\+(?:966|44)\s*/, "");
}

/**
 * What is stored for what the owner typed after +966. A number they typed in full (05…, +966…, 00966…)
 * is kept as typed, so nothing they meant is lost; the rest gets the country code in front.
 */
export function fromLocalSaudiPart(typed: string, country: PhoneCountry = "SA") {
  const text = latinDigits(typed).trim();
  if (!text) return "";
  if (/^(?:0|\+|00)/.test(text)) return text;
  return `${country === "GB" ? "+44" : "+966"} ${text}`;
}
