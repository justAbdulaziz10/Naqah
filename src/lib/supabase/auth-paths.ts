import type { Locale } from '@/domain/types';
import { safeReturnPath } from './auth-input';

export function successPath(locale: Locale, destination: unknown) {
  const next = safeReturnPath(destination);
  return `/${locale}/login/success${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}

export function callbackUrl(origin: string, locale: Locale, destination: unknown, method: 'email' | 'google') {
  const url = new URL(`/${locale}/login/callback`, origin);
  url.searchParams.set('method', method);
  const next = safeReturnPath(destination);
  if (next) url.searchParams.set('next', next);
  return url.toString();
}
