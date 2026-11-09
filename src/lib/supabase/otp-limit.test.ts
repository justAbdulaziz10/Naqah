import { afterEach, beforeEach, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { reserveOtpSend, resetOtpLimits } from './otp-limit';

const phone = '+966501234567';
beforeEach(() => {
  resetOtpLimits();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SECRET_KEY', '');
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('blocks a sixth accepted send to one number, then opens after the window', async () => {
  for (let i = 0; i < 5; i++) expect(await reserveOtpSend(phone, 'a', i)).not.toBeNull();
  expect(await reserveOtpSend(phone, 'b', 1_000)).toBeNull();
  expect(await reserveOtpSend(phone, 'a', 15 * 60_000 + 5)).not.toBeNull();
});
it('never charges an owner for failed sends', async () => {
  for (let i = 0; i < 50; i++) await (await reserveOtpSend(phone, 'a', i))?.();
  expect(await reserveOtpSend(phone, 'a', 100)).not.toBeNull();
});
it('does not charge a number for a request the address limit refused', async () => {
  for (let i = 0; i < 30; i++) await reserveOtpSend(`+9665000000${10 + i}`, 'a', 0);
  expect(await reserveOtpSend(phone, 'a', 0)).toBeNull();
  for (let i = 0; i < 5; i++) expect(await reserveOtpSend(phone, `b${i}`, 0)).not.toBeNull();
});
it('does not pool visitors whose address is unknown', async () => {
  for (let i = 0; i < 100; i++) expect(await reserveOtpSend(`+966500${1000 + i}`, null, 0)).not.toBeNull();
});
it('releases only the failed send when two share a millisecond', async () => {
  const first = await reserveOtpSend(phone, 'a', 0);
  for (let i = 0; i < 4; i++) await reserveOtpSend(phone, 'a', 0);
  await first?.();
  expect(await reserveOtpSend(phone, 'a', 0)).not.toBeNull();
  expect(await reserveOtpSend(phone, 'a', 0)).toBeNull();
});
it('keeps working past the memory bound', async () => {
  for (let i = 0; i < 6_000; i++) await reserveOtpSend(`+9665${i}`, `ip${i}`, 0);
  expect(await reserveOtpSend(phone, 'a', 1)).not.toBeNull();
});
