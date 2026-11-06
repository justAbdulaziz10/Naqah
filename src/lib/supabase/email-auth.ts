import type { SupabaseClient } from '@supabase/supabase-js';

export type EmailIssue = 'credentials' | 'accountExists' | 'confirmRequired' | 'weakPassword' | 'rateLimit' | 'network' | 'unavailable' | 'captcha' | 'failed';
type ErrorDetails = { code?: string; status?: number; name?: string };
export function emailIssue(error: ErrorDetails): EmailIssue {
  if (error.code === 'captcha_failed') return 'captcha';
  if (error.code === 'invalid_credentials') return 'credentials';
  if (error.code === 'email_not_confirmed') return 'confirmRequired';
  if (error.code === 'weak_password') return 'weakPassword';
  if (error.status === 429 || error.code?.includes('rate_limit')) return 'rateLimit';
  if (error.name === 'AuthRetryableFetchError' || error.name === 'TypeError' || error.status === 0) return 'network';
  if (['email_provider_disabled', 'signup_disabled', 'provider_disabled'].includes(error.code ?? '')) return 'unavailable';
  return 'failed';
}

type Result = { status: 'signedIn' | 'confirmEmail' } | { issue: EmailIssue };
/** Never infer account existence from the user/identities in a sign-up response. */
export async function authenticateEmail(
  client: SupabaseClient,
  mode: 'login' | 'signup',
  email: string,
  password: string,
  emailRedirectTo: string,
  captchaToken?: string,
): Promise<Result> {
  try {
    const { data, error } = mode === 'signup'
      ? await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo, ...(captchaToken ? { captchaToken } : {}) } })
      : await client.auth.signInWithPassword({ email: email.trim(), password, ...(captchaToken ? { options: { captchaToken } } : {}) });
    if (error) {
      // Only report a duplicate when Supabase explicitly rejects it. Never infer
      // account existence from an obfuscated user or bypass password verification.
      if (mode === 'signup' && ['user_already_exists', 'email_exists'].includes(error.code ?? '')) return { issue: 'accountExists' };
      return { issue: emailIssue(error) };
    }
    if (data.session) return { status: 'signedIn' };
    return mode === 'signup' ? { status: 'confirmEmail' } : { issue: 'failed' };
  } catch { return { issue: 'network' }; }
}
