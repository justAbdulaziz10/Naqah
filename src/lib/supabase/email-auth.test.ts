import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { authenticateEmail, emailIssue } from './email-auth';

function setup(response: unknown) {
  const auth = { signUp: vi.fn().mockResolvedValue(response), signInWithPassword: vi.fn().mockResolvedValue(response) };
  return { auth, client: { auth } as unknown as SupabaseClient };
}
const callback = 'https://naqah.test/en/login/callback?method=email';
describe('email/password authentication', () => {
  it('passes the configured single-use CAPTCHA token to both email methods', async () => {
    const { client, auth } = setup({ data: { session: null }, error: { code: 'captcha_failed' } });
    expect(await authenticateEmail(client, 'login', 'owner@example.test', 'test-only-password', callback, 'test-only-captcha')).toEqual({ issue: 'captcha' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.test', password: 'test-only-password', options: { captchaToken: 'test-only-captcha' } });
    await authenticateEmail(client, 'signup', 'owner@example.test', 'test-only-password', callback, 'test-only-captcha');
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'owner@example.test', password: 'test-only-password', options: { emailRedirectTo: callback, captchaToken: 'test-only-captcha' } });
  });
  it('signs in with trimmed email and the exact password and requires a returned session', async () => {
    const { client, auth } = setup({ data: { session: { user: { id: 'test-owner' } } }, error: null });
    expect(await authenticateEmail(client, 'login', ' owner@example.test ', ' keep spaces ', callback)).toEqual({ status: 'signedIn' });
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'owner@example.test', password: ' keep spaces ' });
    expect(auth.signUp).not.toHaveBeenCalled();
  });
  it('sets the email confirmation callback on sign-up', async () => {
    const { client, auth } = setup({ data: { session: null, user: { id: 'unconfirmed' } }, error: null });
    expect(await authenticateEmail(client, 'signup', 'owner@example.test', 'test-only-password', callback)).toEqual({ status: 'confirmEmail' });
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'owner@example.test', password: 'test-only-password', options: { emailRedirectTo: callback } });
  });
  it('supports sign-up with confirmation disabled without assuming that setting', async () => {
    const { client } = setup({ data: { session: { user: { id: 'test-owner' } } }, error: null });
    expect(await authenticateEmail(client, 'signup', 'owner@example.test', 'test-only-password', callback)).toEqual({ status: 'signedIn' });
  });
  it.each(['user_already_exists', 'email_exists'])('keeps duplicate sign-up neutral (%s)', async (code) => {
    const { client } = setup({ data: { session: null }, error: { code } });
    expect(await authenticateEmail(client, 'signup', 'owner@example.test', 'test-only-password', callback)).toEqual({ status: 'confirmEmail' });
  });
  it('handles an obfuscated duplicate user exactly like an unconfirmed new user', async () => {
    const { client } = setup({ data: { session: null, user: { id: 'fake', identities: [] } }, error: null });
    expect(await authenticateEmail(client, 'signup', 'owner@example.test', 'test-only-password', callback)).toEqual({ status: 'confirmEmail' });
  });
  it.each([
    ['invalid_credentials', 'credentials'], ['email_not_confirmed', 'confirmRequired'],
    ['weak_password', 'weakPassword'], ['over_email_send_rate_limit', 'rateLimit'], ['email_provider_disabled', 'unavailable'],
    ['unrecognized_backend_detail', 'failed'],
  ])('handles %s without showing raw errors', async (code, issue) => {
    const { client } = setup({ data: { session: null }, error: { code } });
    expect(await authenticateEmail(client, 'login', 'owner@example.test', 'test-only-password', callback)).toEqual({ issue });
  });
  it('does not treat a user object alone as successful login', async () => {
    const { client } = setup({ data: { session: null, user: { id: 'test-owner' } }, error: null });
    expect(await authenticateEmail(client, 'login', 'owner@example.test', 'test-only-password', callback)).toEqual({ issue: 'failed' });
  });
  it('handles network failures', async () => {
    const { client, auth } = setup(null);
    auth.signInWithPassword.mockRejectedValue(new Error('offline'));
    expect(await authenticateEmail(client, 'login', 'owner@example.test', 'test-only-password', callback)).toEqual({ issue: 'network' });
    expect(emailIssue({ status: 429 })).toBe('rateLimit');
    expect(emailIssue({ name: 'AuthRetryableFetchError' })).toBe('network');
  });
});
