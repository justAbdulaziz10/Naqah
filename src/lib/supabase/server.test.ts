import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ getUser: vi.fn(), create: vi.fn(), config: vi.fn(), set: vi.fn() }));
vi.mock('server-only', () => ({}));
vi.mock('@supabase/ssr', () => ({ createServerClient: mock.create }));
vi.mock('next/server', () => ({ connection: async () => {} }));
vi.mock('next/headers', () => ({ cookies: async () => ({ getAll: () => [], set: mock.set }), headers: async () => new Headers({ host: 'naqah.vercel.app' }) }));
vi.mock('./config', async (original) => ({ ...await original<typeof import('./config')>(), getSupabaseConfig: mock.config }));
import { getOwner, createWritableClient } from './server';

describe('server-confirmed owner session', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.config.mockReturnValue({ url: 'https://example.supabase.co', key: 'test-only' });
    mock.create.mockReturnValue({ auth: { getUser: mock.getUser } });
  });
  it('uses Auth server validation for a session after reload', async () => {
    mock.getUser.mockResolvedValue({ data: { user: { id: 'owner-test' } }, error: null });
    expect((await getOwner()).user?.id).toBe('owner-test');
    expect(mock.getUser).toHaveBeenCalledOnce();
  });
  afterEach(() => vi.unstubAllEnvs());
  it('returns an unavailable sign-in result for any unconfirmed or foreign email in test setup', async () => {
    vi.stubEnv('NAQAH_TEST_OWNER_EMAIL', 'TEST-OWNER@example.test');
    vi.stubEnv('NAQAH_TEST_RANCH_ID', undefined);
    const user = { id: 'owner-test', email: 'test-owner@example.test', email_confirmed_at: '2026-11-23' };
    for (const denied of [{ ...user, email_confirmed_at: undefined }, { ...user, email: 'another-owner@example.test' }]) {
      mock.getUser.mockResolvedValue({ data: { user: denied }, error: null });
      expect(await getOwner()).toEqual({ user: null, unavailable: true });
    }
    mock.getUser.mockResolvedValue({ data: { user }, error: null });
    expect(await getOwner()).toEqual({ user, unavailable: false });
  });
  it('checks the configured ranch owner before accepting the sign-in result', async () => {
    const farmId = '11111111-1111-4111-8111-111111111111';
    vi.stubEnv('NAQAH_TEST_OWNER_EMAIL', 'test-owner@example.test');
    vi.stubEnv('NAQAH_TEST_RANCH_ID', farmId);
    const user = { id: 'owner-test', email: 'test-owner@example.test', email_confirmed_at: '2026-11-23' };
    const maybeSingle = vi.fn().mockResolvedValueOnce({ data: null, error: null }).mockResolvedValueOnce({ data: { id: farmId }, error: null });
    const query = { eq: vi.fn().mockReturnThis(), maybeSingle };
    const from = vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(query) });
    mock.create.mockReturnValue({ auth: { getUser: mock.getUser }, from });
    mock.getUser.mockResolvedValue({ data: { user }, error: null });
    expect(await getOwner()).toEqual({ user: null, unavailable: true });
    expect(await getOwner()).toEqual({ user, unavailable: false });
    expect(from).toHaveBeenCalledWith('farms');
    expect(query.eq.mock.calls.slice(0, 2)).toEqual([['id', farmId], ['owner_id', user.id]]);
  });
  it('rejects an expired or revoked session', async () => {
    mock.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    expect((await getOwner()).user).toBeNull();
  });
  it('reports configuration and network outages', async () => {
    mock.config.mockReturnValue(null);
    expect(await getOwner()).toEqual({ user: null, unavailable: true });
    mock.config.mockReturnValue({ url: 'https://example.supabase.co', key: 'test-only' });
    mock.getUser.mockRejectedValue(new Error('offline'));
    expect(await getOwner()).toEqual({ user: null, unavailable: true });
  });
  it('treats a hung Auth check as unavailable', async () => {
    vi.useFakeTimers();
    mock.getUser.mockReturnValue(new Promise(() => {}));
    const pending = getOwner();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await pending).toEqual({ user: null, unavailable: true });
    vi.useRealTimers();
  });
  it('writes session deletion cookies without swallowing failures in actions', async () => {
    await createWritableClient();
    const adapter = mock.create.mock.calls[0][2].cookies;
    adapter.setAll([{ name: 'test-session', value: '', options: { maxAge: 0 } }]);
    expect(mock.set).toHaveBeenCalledWith('test-session', '', { maxAge: 0 });
    mock.set.mockImplementation(() => { throw new Error('not writable'); });
    expect(() => adapter.setAll([{ name: 'test-session', value: '', options: {} }])).toThrow();
  });
});
