import { redirect } from 'next/navigation';
import { connection } from 'next/server';
import { isLocale } from '@/i18n/config';
import { getAuthMethods } from '@/lib/supabase/auth-methods';
import { safeReturnPath } from '@/lib/supabase/auth-input';
import { getOwner } from '@/lib/supabase/server';
import { OwnerAuth } from './OwnerAuth';

type Query = Record<string, string | string[] | undefined>;
export type AuthEntryProps = { params: Promise<{ locale: string }>; searchParams: Promise<Query> };

/** Supabase's Site URL may return a PKCE code to login instead of the requested callback. */
export async function AuthEntry({ params, searchParams, mode }: AuthEntryProps & { mode: 'login' | 'signup' }) {
  const { locale } = await params;
  const query = await searchParams;
  if (isLocale(locale) && (query.code !== undefined || query.error_code !== undefined || (query.error !== undefined && query.error !== 'callbackFailed'))) {
    const forwarded = new URLSearchParams();
    for (const key of ['code', 'next', 'method', 'sb_flow_id', 'error', 'error_code']) {
      const value = query[key];
      for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
        if (item.length <= 4096) forwarded.append(key, item);
      }
    }
    redirect(`/${locale}/login/callback?${forwarded}`);
  }
  // A signed-in owner who comes back to these pages goes straight to the ranch (or where they were headed).
  if (isLocale(locale) && process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA === '1') {
    const { user } = await getOwner();
    const next = Array.isArray(query.next) ? query.next[0] : query.next;
    if (user) redirect(safeReturnPath(next) ?? `/${locale}/app`);
  }
  await connection(); // The methods are read per request (cached briefly by time), never at prerender.
  return <OwnerAuth mode={mode} methods={await getAuthMethods()} />;
}
