'use client';

import { Translate } from '@phosphor-icons/react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useI18n } from '@/i18n/client';
import { otherLocale, searchForLocale } from '@/i18n/config';
import { safeReturnPath } from '@/lib/supabase/auth-input';

/** Preserve only auth UI choices and validated destinations, never callback codes/tokens. */
export function AuthLocaleSwitcher() {
  const { locale, m } = useI18n();
  const pathname = usePathname();
  const params = useSearchParams();
  const target = otherLocale(locale);
  const query = new URLSearchParams();
  if (params.get('method') === 'email') query.set('method', 'email');
  const next = safeReturnPath(params.get('next'));
  if (next) query.set('next', next);
  if (params.get('error') === 'callbackFailed') query.set('error', 'callbackFailed');
  const path = (pathname ?? `/${locale}/login`).replace(new RegExp(`^/${locale}(?=/|$)`), `/${target}`);
  return <Link href={`${path}${query.size ? searchForLocale(`?${query}`, locale, target) : ''}`} lang={target} aria-label={m.common.switchLanguageLabel}
    onClick={() => { document.cookie = `naqah-locale=${target}; path=/; max-age=31536000; samesite=lax`; }}
    className="inline-flex min-h-11 items-center gap-2 rounded-full px-3.5 text-sm font-semibold text-espresso transition hover:bg-espresso/5">
    <Translate size={18} aria-hidden /><span className={target === 'ar' ? 'font-arabic' : undefined}>{m.common.switchLanguage}</span>
  </Link>;
}
