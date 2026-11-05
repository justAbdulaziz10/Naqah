import { afterEach, expect, it, vi } from 'vitest';
import { getSupabaseConfig } from './config';
afterEach(() => vi.unstubAllEnvs());
it('disables authentication without both public environment variables', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', '');
  expect(getSupabaseConfig()).toBeNull();
});
it('rejects malformed or unsafe URLs', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'javascript:alert(1)');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'test-only');
  expect(getSupabaseConfig()).toBeNull();
});
it('ignores stray whitespace pasted into environment values', () => {
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', ' https://example.supabase.co\n');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', ' test-only ');
  expect(getSupabaseConfig()).toEqual({ url: 'https://example.supabase.co', key: 'test-only' });
});
it('marks session cookies Secure outside development', async () => {
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'production');
  expect((await import('./config')).sessionCookieOptions).toMatchObject({ secure: true, sameSite: 'lax', path: '/' });
  vi.resetModules();
  vi.stubEnv('NODE_ENV', 'development');
  expect((await import('./config')).sessionCookieOptions.secure).toBe(false);
});
