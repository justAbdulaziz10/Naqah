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
