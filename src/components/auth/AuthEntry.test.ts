import { describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ redirect: vi.fn(), user: null as { id: string } | null }));
vi.mock('next/navigation', () => ({ redirect: mock.redirect }));
vi.mock('next/server', () => ({ connection: async () => undefined }));
vi.mock('@/lib/supabase/server', () => ({ getOwner: async () => ({ user: mock.user, unavailable: false }) }));
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
  it('sends a signed-in owner straight to the ranch, or to a safe next path', async () => {
    vi.stubEnv('NEXT_PUBLIC_NAQAH_ACCOUNT_DATA', '1');
    mock.user = { id: 'owner' };
    mock.redirect.mockImplementation((path) => { throw new Error(path); });
    await expect(AuthEntry({ mode: 'signup', params: Promise.resolve({ locale: 'ar' }), searchParams: Promise.resolve({}) })).rejects.toThrow('/ar/app');
    await expect(AuthEntry({ mode: 'login', params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ next: '/en/app/settings' }) })).rejects.toThrow('/en/app/settings');
    await expect(AuthEntry({ mode: 'login', params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({ next: 'https://evil.example' }) })).rejects.toThrow('/en/app');
    mock.user = null;
    mock.redirect.mockClear();
    await AuthEntry({ mode: 'login', params: Promise.resolve({ locale: 'en' }), searchParams: Promise.resolve({}) });
    expect(mock.redirect).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});
