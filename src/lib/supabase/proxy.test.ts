import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mock = vi.hoisted(() => ({ claims: vi.fn(), create: vi.fn(), config: vi.fn() }));
vi.mock('@supabase/ssr', () => ({ createServerClient: mock.create }));
vi.mock('./config', () => ({ getSupabaseConfig: mock.config }));
import { updateSession } from './proxy';

describe('SSR session refresh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.config.mockReturnValue({ url: 'https://example.supabase.co', key: 'test-only' });
    mock.claims.mockResolvedValue({ data: null, error: null });
    mock.create.mockReturnValue({ auth: { getClaims: mock.claims } });
  });
  it('does not gate the demo when configuration is missing', async () => {
    mock.config.mockReturnValue(null);
    const response = await updateSession(new NextRequest('https://naqah.test/ar/app'));
    expect(response.status).toBe(200);
    expect(mock.create).not.toHaveBeenCalled();
  });
  it('validates claims and copies refreshed cookies and cache headers', async () => {
    const request = new NextRequest('https://naqah.test/en/app');
    mock.create.mockImplementation((_url, _key, options) => {
      mock.claims.mockImplementation(async () => {
        options.cookies.setAll([{ name: 'test-session', value: 'test-only', options: { path: '/', httpOnly: true } }], { 'Cache-Control': 'private, no-store' });
        return { data: null, error: null };
      });
      return { auth: { getClaims: mock.claims } };
    });
    const response = await updateSession(request);
    expect(mock.claims).toHaveBeenCalledOnce();
    expect(request.cookies.get('test-session')?.value).toBe('test-only');
    expect(response.cookies.get('test-session')?.httpOnly).toBe(true);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('location')).toBeNull();
  });
  it('keeps public routes available on network failure', async () => {
    mock.claims.mockRejectedValue(new Error('offline'));
    expect((await updateSession(new NextRequest('https://naqah.test/ar'))).status).toBe(200);
  });
});
