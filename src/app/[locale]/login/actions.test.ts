import { beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({ create: vi.fn(), signOut: vi.fn(), signInWithOtp: vi.fn(), redirect: vi.fn(), ip: '203.0.113.1' }));
vi.mock('@/lib/supabase/server', () => ({ createWritableClient: mock.create }));
vi.mock('next/navigation', () => ({ redirect: mock.redirect }));
vi.mock('next/headers', () => ({ headers: async () => new Headers({ 'x-forwarded-for': `${mock.ip}, 10.0.0.1` }) }));
import { logout, sendOwnerOtp } from './actions';
import { resetOtpLimits } from '@/lib/supabase/otp-limit';

describe('sending the owner code', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetOtpLimits();
    mock.ip = '203.0.113.1';
    mock.create.mockResolvedValue({ auth: { signInWithOtp: mock.signInWithOtp } });
    mock.signInWithOtp.mockResolvedValue({ error: null });
  });
  it('validates on the server and sends E.164 with the CAPTCHA token', async () => {
    expect(await sendOwnerOtp({ phone: '966501234567', captchaToken: 'test-only' })).toEqual({ issue: null });
    expect(mock.signInWithOtp).toHaveBeenCalledWith({ phone: '+966501234567', options: { shouldCreateUser: true, channel: 'sms', captchaToken: 'test-only' } });
  });
  it.each(['+15551234567', '0112345678', '', '0'.repeat(33)])('never contacts Supabase for %s', async (phone) => {
    expect(await sendOwnerOtp({ phone })).toEqual({ issue: 'invalidPhone' });
    expect(mock.signInWithOtp).not.toHaveBeenCalled();
  });
  it('rejects non-string input from a forged request', async () => {
    expect(await sendOwnerOtp({ phone: { toString: () => '0501234567' } as unknown as string })).toEqual({ issue: 'invalidPhone' });
  });
  it('limits repeat sends to one number from any address', async () => {
    for (let i = 1; i <= 5; i++) { mock.ip = `203.0.113.${i}`; await sendOwnerOtp({ phone: '0501234567' }); }
    mock.ip = '203.0.113.9';
    expect(await sendOwnerOtp({ phone: '0501234567' })).toEqual({ issue: 'rateLimit' });
    expect(mock.signInWithOtp).toHaveBeenCalledTimes(5);
  });
  it('limits one address across many numbers', async () => {
    for (let i = 0; i < 30; i++) await sendOwnerOtp({ phone: `05012345${10 + i}` });
    expect(await sendOwnerOtp({ phone: '0509999999' })).toEqual({ issue: 'rateLimit' });
    expect(mock.signInWithOtp).toHaveBeenCalledTimes(30);
  });
  it.each([
    ['rejected CAPTCHA', { error: { code: 'captcha_failed', status: 400 } }],
    ['Supabase rate limit', { error: { code: 'over_sms_send_rate_limit', status: 429 } }],
    ['SMS provider failure', { error: { code: 'sms_send_failed', status: 500 } }],
  ])('does not lock an owner out after a %s', async (_name, result) => {
    mock.signInWithOtp.mockResolvedValue(result);
    for (let i = 0; i < 12; i++) await sendOwnerOtp({ phone: '0501234567', captchaToken: 'junk' });
    mock.signInWithOtp.mockResolvedValue({ error: null });
    expect(await sendOwnerOtp({ phone: '0501234567' })).toEqual({ issue: null });
  });
  it('does not lock an owner out after an outage', async () => {
    mock.signInWithOtp.mockRejectedValue(new Error('offline'));
    for (let i = 0; i < 12; i++) await sendOwnerOtp({ phone: '0501234567' });
    mock.signInWithOtp.mockResolvedValue({ error: null });
    expect(await sendOwnerOtp({ phone: '0501234567' })).toEqual({ issue: null });
  });
  it('refuses a missing token before touching limits or Supabase', async () => {
    vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-only');
    for (let i = 0; i < 12; i++) expect(await sendOwnerOtp({ phone: '0501234567' })).toEqual({ issue: 'captcha' });
    expect(mock.signInWithOtp).not.toHaveBeenCalled();
    expect(await sendOwnerOtp({ phone: '0501234567', captchaToken: 'test-only' })).toEqual({ issue: null });
    vi.unstubAllEnvs();
  });
  it('maps Supabase failures without exposing them', async () => {
    mock.signInWithOtp.mockResolvedValue({ error: { code: 'captcha_failed', status: 400 } });
    expect(await sendOwnerOtp({ phone: '0501234567' })).toEqual({ issue: 'captcha' });
    mock.signInWithOtp.mockRejectedValue(new Error('offline'));
    expect(await sendOwnerOtp({ phone: '0501234568' })).toEqual({ issue: 'network' });
  });
  it('reports missing configuration', async () => {
    mock.create.mockResolvedValue(null);
    expect(await sendOwnerOtp({ phone: '0501234567' })).toEqual({ issue: 'unavailable' });
  });
});

describe('logout action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.create.mockResolvedValue({ auth: { signOut: mock.signOut } });
    mock.signOut.mockResolvedValue({ error: null });
    mock.redirect.mockImplementation(() => { throw new Error('NEXT_REDIRECT'); });
  });
  it('clears the current session and redirects to localized login', async () => {
    await expect(logout('ar')).rejects.toThrow('NEXT_REDIRECT');
    expect(mock.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(mock.redirect).toHaveBeenCalledWith('/ar/login');
  });
  it('does not claim logout success on failure', async () => {
    mock.signOut.mockResolvedValue({ error: { status: 500 } });
    expect(await logout('en')).toEqual({ failed: true });
    expect(mock.redirect).not.toHaveBeenCalled();
  });
  it('handles unavailable configuration', async () => {
    mock.create.mockResolvedValue(null);
    expect(await logout('ar')).toEqual({ failed: true });
  });
  it('does not use untrusted locale values for redirects', async () => {
    expect(await logout('//evil.test')).toEqual({ failed: true });
    expect(mock.create).not.toHaveBeenCalled();
  });
});
