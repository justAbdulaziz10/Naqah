import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ redirect: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: mock.redirect }));
vi.mock('./OwnerAuth', () => ({ OwnerAuth: () => null }));
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/auth-methods', () => ({ getAuthMethods: async () => ({ phone: false, email: true, google: false }) }));
import { AuthEntry } from './AuthEntry';

describe('callback recovery at auth entry pages', () => {
  it.each(['login', 'signup'] as const)('routes a %s PKCE code to server exchange without rendering provider details', async (mode) => {
    mock.redirect.mockImplementation((path) => { throw new Error(path); });
    await expect(AuthEntry({ mode, params: Promise.resolve({ locale: 'ar' }), searchParams: Promise.resolve({ code: 'test-code', error_description: 'PRIVATE', sb_flow_id: 'test-flow' }) })).rejects.toThrow('/ar/login/callback?code=test-code&sb_flow_id=test-flow');
  });
  it('does not loop on the fixed callback failure UI', async () => {
    mock.redirect.mockClear();
    await AuthEntry({ mode: 'login', params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ error: 'callbackFailed' }) });
    expect(mock.redirect).not.toHaveBeenCalled();
  });
});
