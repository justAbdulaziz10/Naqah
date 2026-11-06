import type { Locale } from '@/domain/types';
import { safeReturnPath } from './auth-input';

/** Sign-up starts the existing setup wizard; an explicit safe return path still wins. */
export function authDestination(locale: Locale, mode: 'login' | 'signup', destination: unknown) {
  return safeReturnPath(destination) ?? `/${locale}/${mode === 'signup' ? 'start' : 'app'}`;
}

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
