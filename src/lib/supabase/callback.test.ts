import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
const mock = vi.hoisted(() => ({ create: vi.fn(), exchange: vi.fn(), config: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mock.create }));
vi.mock('./config', () => ({ getSupabaseConfig: mock.config, sessionCookieOptions: { path: '/', sameSite: 'lax', secure: true } }));
import { completeAuthCallback } from './callback';
import { callbackUrl, successPath } from './auth-paths';

describe('PKCE callback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.config.mockReturnValue({ url: 'https://example.supabase.co', key: 'test-only' });
    mock.exchange.mockResolvedValue({ data: { session: { user: { id: 'test-owner' } } }, error: null });
    mock.create.mockReturnValue({ auth: { exchangeCodeForSession: mock.exchange } });
  });
  it('recovers a safe signup destination if a provider drops the requested callback query', async () => {
    const request = new NextRequest('https://naqah.test/ar/login/callback?code=test-code', { headers: { cookie: 'naqah-auth-return=%2Far%2Fstart' } });
    const response = await completeAuthCallback(request, 'ar');
    expect(response.headers.get('location')).toBe('/ar/login/success?next=%2Far%2Fstart');
    expect(response.cookies.get('naqah-auth-return')?.maxAge).toBe(0);
  });
  it('never trusts a navigation cookie as identity or as an external redirect', async () => {
    const request = new NextRequest('https://naqah.test/ar/login/callback?code=test-code', { headers: { cookie: 'naqah-auth-return=https%3A%2F%2Fevil.test' } });
    const response = await completeAuthCallback(request, 'ar');
    expect(response.headers.get('location')).toBe('/ar/login/success');
    mock.exchange.mockResolvedValue({ data: { session: null }, error: { code: 'bad_code_verifier' } });
    const rejected = await completeAuthCallback(new NextRequest('https://naqah.test/ar/login/callback?code=test-code', { headers: { cookie: 'naqah-auth-return=%2Far%2Fstart' } }), 'ar');
    expect(rejected.headers.get('location')).toBe('/ar/login?error=callbackFailed&next=%2Far%2Fstart');
  });
  it('exchanges a code with its verifier cookies and forwards session/deletion cookies and cache headers', async () => {
    const request = new NextRequest('https://naqah.test/en/login/callback?code=test-code&next=%2Fen%2Fapp&sb_flow_id=test-flow', { headers: { cookie: 'test-verifier=test-only' } });
    mock.create.mockImplementation((_url, _key, options) => {
      expect(options.cookieOptions).toEqual({ path: '/', sameSite: 'lax', secure: true });
      expect(options.cookies.getAll()).toContainEqual({ name: 'test-verifier', value: 'test-only' });
      mock.exchange.mockImplementation(async () => {
        options.cookies.setAll([
          { name: 'test-session', value: 'test-only', options: { path: '/', sameSite: 'lax' } },
          { name: 'test-verifier', value: '', options: { path: '/', maxAge: 0 } },
        ], { 'Cache-Control': 'private, no-cache, no-store, must-revalidate', Expires: '0' });
        return { data: { session: { user: { id: 'test-owner' } } }, error: null };
      });
      return { auth: { exchangeCodeForSession: mock.exchange } };
    });
    const response = await completeAuthCallback(request, 'en');
    expect(mock.exchange).toHaveBeenCalledWith('test-code', { flowId: 'test-flow' });
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/en/login/success?next=%2Fen%2Fapp');
    expect(response.cookies.get('test-session')?.value).toBe('test-only');
    expect(response.cookies.get('test-verifier')?.maxAge).toBe(0);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.get('expires')).toBe('0');
  });
  it.each(['https://evil.test', '//evil.test', '/ar/%5Cevil', '/ar/login/callback', '/ar/../../evil', '/api/voice'])(
    'rejects unsafe next %s after successful exchange', async (next) => {
      const response = await completeAuthCallback(new NextRequest(`https://naqah.test/ar/login/callback?code=test-code&next=${encodeURIComponent(next)}`), 'ar');
      expect(response.headers.get('location')).toBe('/ar/login/success');
      expect(mock.exchange).toHaveBeenCalledWith('test-code', undefined);
    },
  );
  it.each(['', '?error=access_denied&error_description=PRIVATE', '?code=one&code=two', '?code=one&sb_flow_id=a&sb_flow_id=b'])(
    'does not exchange missing/ambiguous/denied callbacks', async (query) => {
      const response = await completeAuthCallback(new NextRequest(`https://naqah.test/ar/login/callback${query}`), 'ar');
      expect(mock.exchange).not.toHaveBeenCalled();
      expect(response.headers.get('location')).toBe('/ar/login?error=callbackFailed');
      expect(response.headers.get('location')).not.toContain('PRIVATE');
    },
  );
  it('handles missing configuration and invalid locale without creating a client', async () => {
    mock.config.mockReturnValue(null);
    const response = await completeAuthCallback(new NextRequest('https://naqah.test/en/login/callback?code=test-code'), 'en');
    expect(response.headers.get('location')).toContain('error=callbackFailed');
    expect((await completeAuthCallback(new NextRequest('https://naqah.test/xx/login/callback'), 'xx')).status).toBe(404);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('fails closed on rejected/missing-verifier/expired-code exchanges, preserving only safe UI context', async () => {
    mock.exchange.mockResolvedValue({ data: { session: null }, error: { code: 'bad_code_verifier' } });
    const response = await completeAuthCallback(new NextRequest('https://naqah.test/en/login/callback?code=test-code&method=email&next=%2Fen%2Fstart'), 'en');
    expect(response.headers.get('location')).toBe('/en/login?error=callbackFailed&method=email&next=%2Fen%2Fstart');
  });
  it('handles network errors without exposing code or error details', async () => {
    mock.exchange.mockRejectedValue(new Error('private backend details'));
    const response = await completeAuthCallback(new NextRequest('https://naqah.test/ar/login/callback?code=private-code'), 'ar');
    expect(response.headers.get('location')).toBe('/ar/login?error=callbackFailed');
  });
  it('requires a returned session even if exchange has no error', async () => {
    mock.exchange.mockResolvedValue({ data: { session: null }, error: null });
    const response = await completeAuthCallback(new NextRequest('https://naqah.test/ar/login/callback?code=test-code'), 'ar');
    expect(response.headers.get('location')).toContain('error=callbackFailed');
  });
  it('does not trust forwarded hosts for redirect origins', async () => {
    const response = await completeAuthCallback(new NextRequest('https://naqah.test/ar/login/callback?code=test-code', { headers: { 'x-forwarded-host': 'evil.test' } }), 'ar');
    expect(response.headers.get('location')).toBe('/ar/login/success');
  });
});

describe('outgoing auth destinations', () => {
  it('encodes only validated internal next paths', () => {
    expect(successPath('en', '//evil.test')).toBe('/en/login/success');
    expect(callbackUrl('https://naqah.test', 'ar', '/ar/app?tab=all', 'google')).toBe('https://naqah.test/ar/login/callback?method=google&next=%2Far%2Fapp%3Ftab%3Dall');
    expect(callbackUrl('https://naqah.test', 'en', 'https://evil.test', 'email')).toBe('https://naqah.test/en/login/callback?method=email');
  });
});
