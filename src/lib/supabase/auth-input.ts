/** Normalize Arabic/Persian digits before validating, without accepting arbitrary text. */
export function latinDigits(value: string) {
  return value.replace(/[٠-٩۰-۹]/g, (digit) => String(digit.charCodeAt(0) - (digit <= '٩' ? 0x660 : 0x6f0)));
}

/** Saudi mobile numbers (SMS): 05xxxxxxxx, 5xxxxxxxx, 9665xxxxxxxx, +9665xxxxxxxx, 009665xxxxxxxx. */
export function normalizeSaudiPhone(value: string): string | null {
  const phone = latinDigits(value).replace(/[\s()\-\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ''); // Pasted numbers carry bidi marks.
  if (/^05\d{8}$/.test(phone)) return `+966${phone.slice(1)}`;
  if (/^5\d{8}$/.test(phone)) return `+966${phone}`;
  if (/^(?:\+|00)?9665\d{8}$/.test(phone)) return `+${phone.replace(/^(?:\+|00)/, '')}`;
  return null;
}

/** Same-origin locale routes only. Decode first to reject encoded redirect tricks. */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (/[\\\u0000-\u0020\u007f]/.test(decoded) || !/^\/(ar|en)(?:\/|\?|#|$)/.test(decoded)) return null;
    const url = new URL(decoded, 'https://naqah.invalid');
    if (url.origin !== 'https://naqah.invalid' || !/^\/(ar|en)(?:\/|$)/.test(url.pathname)) return null;
    if (/^\/(ar|en)\/(login|signup)(?:\/|$)/.test(url.pathname)) return null;
    // Keep encoded values intact after validating their decoded form.
    const kept = new URL(value, 'https://naqah.invalid');
    if (kept.origin !== url.origin || !/^\/(ar|en)(?:\/|$)/.test(kept.pathname)) return null;
    return kept.pathname + kept.search + kept.hash;
  } catch { return null; }
}

export type AuthIssue = 'invalidCode' | 'rateLimit' | 'network' | 'unavailable' | 'captcha' | 'failed';
export function authIssue(error: { code?: string; status?: number; name?: string } | null): AuthIssue {
  if (error?.code === 'otp_expired' || error?.code === 'invalid_credentials') return 'invalidCode';
  if (error?.status === 429 || error?.code?.includes('rate_limit')) return 'rateLimit';
  if (error?.name === 'AuthRetryableFetchError' || error?.name === 'TypeError' || error?.status === 0) return 'network';
  if (error?.code === 'captcha_failed') return 'captcha';
  if (error?.code === 'sms_send_failed' || error?.code === 'phone_provider_disabled' || error?.code === 'signup_disabled' || error?.code === 'otp_disabled') return 'unavailable';
  return 'failed';
}
