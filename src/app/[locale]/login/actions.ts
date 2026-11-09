'use server';

import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { authIssue, normalizeSaudiPhone, type AuthIssue } from '@/lib/supabase/auth-input';
import { getCaptchaSiteKey } from '@/lib/supabase/config';
import { reserveOtpSend } from '@/lib/supabase/otp-limit';
import { createWritableClient } from '@/lib/supabase/server';
import { withTimeout } from '@/lib/supabase/timeout';
import { isLocale } from '@/i18n/config';

const OTP_SEND_TIMEOUT_MS = 10_000;
const LOGOUT_TIMEOUT_MS = 5_000;

/** Vercel overwrites x-forwarded-for, so its first entry is the visitor. */
function clientIp(list: Headers) {
  const candidate = list.get('x-forwarded-for')?.split(',')[0]?.trim() || list.get('x-real-ip')?.trim() || null;
  return candidate && candidate.length <= 64 ? candidate : null;
}

export async function sendOwnerOtp(input: { phone: string; captchaToken?: string }): Promise<{ issue: AuthIssue | 'invalidPhone' | null }> {
  const phone = typeof input?.phone === 'string' && input.phone.length <= 32 ? normalizeSaudiPhone(input.phone) : null;
  if (!phone) return { issue: 'invalidPhone' };
  const captchaToken = typeof input.captchaToken === 'string' && input.captchaToken.length <= 4096 ? input.captchaToken : undefined;
  if (getCaptchaSiteKey() && !captchaToken) return { issue: 'captcha' };
  const release = await reserveOtpSend(phone, clientIp(await headers()));
  if (!release) return { issue: 'rateLimit' };
  try {
    const client = await createWritableClient();
    if (!client) { await release(); return { issue: 'unavailable' }; }
    const { error } = await withTimeout(
      client.auth.signInWithOtp({ phone, options: { shouldCreateUser: true, channel: 'sms', captchaToken } }),
      OTP_SEND_TIMEOUT_MS,
    );
    if (error) await release();
    return { issue: error ? authIssue(error) : null };
  } catch { await release(); return { issue: 'network' }; }
}

export async function logout(locale: string): Promise<{ failed: true }> {
  if (!isLocale(locale)) return { failed: true };
  try {
    const client = await createWritableClient();
    if (!client) return { failed: true };
    const { error } = await withTimeout(client.auth.signOut({ scope: 'local' }), LOGOUT_TIMEOUT_MS);
    if (error) return { failed: true };
  } catch { return { failed: true }; }
  redirect(`/${locale}/login`);
}
