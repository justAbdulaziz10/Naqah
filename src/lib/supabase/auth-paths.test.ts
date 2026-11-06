import { describe, expect, it } from 'vitest';
import { authDestination, callbackUrl, successPath } from './auth-paths';

describe('new account setup destination', () => {
  it.each(['ar', 'en'] as const)('uses the existing %s setup route after verified sign-up', (locale) => {
    const next = authDestination(locale, 'signup', null);
    expect(next).toBe(`/${locale}/start`);
    expect(new URL(callbackUrl('https://naqah.test', locale, next, 'email')).searchParams.get('next')).toBe(next);
    expect(new URL(callbackUrl('https://naqah.test', locale, next, 'google')).searchParams.get('next')).toBe(next);
    expect(successPath(locale, next)).toBe(`/${locale}/login/success?next=${encodeURIComponent(next!)}`);
  });
  it('retains explicit valid return paths', () => {
    expect(authDestination('ar', 'signup', '/ar/welcome')).toBe('/ar/welcome');
    expect(authDestination('en', 'login', '/en/app')).toBe('/en/app');
  });
  it.each(['https://evil.test', '//evil.test', '/ar/login', '/ar/../../evil', ['/ar/app']])('rejects unsafe sign-up destinations', (next) => {
    expect(authDestination('ar', 'signup', next)).toBe('/ar/start');
  });
  it('does not infer an existing owner farm or redirect ordinary login into setup', () => {
    expect(authDestination('ar', 'login', null)).toBe('/ar/app');
  });
});
