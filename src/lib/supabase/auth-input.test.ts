import { describe, expect, it } from 'vitest';
import { authIssue, latinDigits, normalizeSaudiPhone, safeReturnPath } from './auth-input';

describe('Saudi SMS numbers', () => {
  it.each(['0501234567', '501234567', '+966501234567', '00966501234567', '+966 (50) 123-4567', '٠٥٠١٢٣٤٥٦٧', '۰۵۰۱۲۳۴۵۶۷'])(
    'normalizes %s', (input) => expect(normalizeSaudiPhone(input)).toBe('+966501234567'),
  );
  it.each(['', '050123456', '05012345678', '+9660501234567', '+15551234567', '0112345678', 'hello0501234567', '0501234567 ext 1', '++966501234567'])(
    'rejects %s', (input) => expect(normalizeSaudiPhone(input)).toBeNull(),
  );
  it('converts both Arabic digit sets', () => expect(latinDigits('١٢٣۴۵۶')).toBe('123456'));
});
describe('internal return destinations', () => {
  it.each(['/ar/start', '/en/app', '/ar/app/herd?tab=all#top', '/en'])(
    'allows %s', (input) => expect(safeReturnPath(input)).toBe(input),
  );
  it.each([undefined, ['/ar/app'], 'https://evil.test', '//evil.test', '/\\evil.test', '/ar/../../evil', '/ar/../en/login', '/ar/login', '/en/signup', '/ar/login/success', '/ar/%2e%2e/%2e%2e/evil', '/ar/%5cevil', '/ar/%0d%0aLocation:evil', 'javascript:alert(1)', '/api/voice', '/ar/%', '/ar/ app'])(
    'rejects unsafe destinations', (input) => expect(safeReturnPath(input)).toBeNull(),
  );
});
describe('safe, account-neutral error messages', () => {
  it.each(['otp_expired', 'invalid_credentials'])('combines wrong and expired codes', (code) => expect(authIssue({ code })).toBe('invalidCode'));
  it('handles rate limits', () => expect(authIssue({ status: 429 })).toBe('rateLimit'));
  it('handles fetch failures', () => expect(authIssue({ name: 'AuthRetryableFetchError' })).toBe('network'));
  it('handles unavailable SMS', () => expect(authIssue({ code: 'sms_send_failed' })).toBe('unavailable'));
  it('does not reveal account existence', () => expect(authIssue({ code: 'user_not_found' })).toBe('failed'));
});
