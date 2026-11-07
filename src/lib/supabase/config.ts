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
