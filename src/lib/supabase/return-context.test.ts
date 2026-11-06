import { afterEach, expect, it, vi } from 'vitest';
import { AUTH_RETURN_COOKIE, readAuthReturn, rememberAuthReturn } from './return-context';
afterEach(() => vi.unstubAllGlobals());
it('restores only validated internal navigation hints', () => {
  expect(readAuthReturn(encodeURIComponent('/ar/start'))).toBe('/ar/start');
  for (const value of ['https://evil.test', '//evil.test', '/ar/login', '/ar/../../evil', '%', undefined]) {
    expect(readAuthReturn(value)).toBeNull();
  }
});
it('remembers a short-lived destination without storing any credentials or identity', () => {
  const doc = { cookie: '' };
  vi.stubGlobal('document', doc);
  vi.stubGlobal('window', { location: { protocol: 'https:' } });
  rememberAuthReturn('/en/start');
  expect(doc.cookie).toBe(`${AUTH_RETURN_COOKIE}=%2Fen%2Fstart; Path=/; Max-Age=3600; SameSite=Lax; Secure`);
  rememberAuthReturn('https://evil.test');
  expect(doc.cookie).toContain('Max-Age=0');
});
