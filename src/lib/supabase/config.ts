export function getSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  // The legacy anon key works the same way; older .env files only have that name.
  const key = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)?.trim();
  if (!url || !key) return null;
  try {
    if (!['https:', 'http:'].includes(new URL(url).protocol)) return null;
  } catch { return null; }
  return { url, key };
}

/** Must match the Turnstile secret saved in Supabase Attack Protection. Empty hides the widget. */
export function getCaptchaSiteKey() {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || null;
}

/** Secure everywhere except `next dev`. The browser client writes these cookies, so they cannot be HttpOnly. */
export const sessionCookieOptions = {
  path: '/',
  sameSite: 'lax',
  secure: process.env.NODE_ENV !== 'development',
} as const;

const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[::1\])$/;

/**
 * The same options for the page actually being served. Plain-http loopback (a local production
 * preview at http://localhost:3300) can't keep Secure cookies in Safari, so sign-in silently failed
 * there; every other origin, and anything over https, stays Secure.
 */
export function sessionCookieOptionsFor(origin: { protocol: string; hostname: string } | null | undefined) {
  if (!origin || origin.protocol !== 'http:' || !LOOPBACK.test(origin.hostname)) return sessionCookieOptions;
  return { ...sessionCookieOptions, secure: false } as const;
}
