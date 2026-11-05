import { beforeEach, expect, it } from 'vitest';
import { reserveOtpSend, resetOtpLimits } from './otp-limit';

const phone = '+966501234567';
beforeEach(() => resetOtpLimits());

it('blocks a sixth accepted send to one number, then opens after the window', () => {
  for (let i = 0; i < 5; i++) expect(reserveOtpSend(phone, 'a', i)).not.toBeNull();
  expect(reserveOtpSend(phone, 'b', 1_000)).toBeNull();
  expect(reserveOtpSend(phone, 'a', 15 * 60_000 + 5)).not.toBeNull();
});
it('never charges an owner for failed sends', () => {
  for (let i = 0; i < 50; i++) reserveOtpSend(phone, 'a', i)?.();
  expect(reserveOtpSend(phone, 'a', 100)).not.toBeNull();
});
it('does not charge a number for a request the address limit refused', () => {
  for (let i = 0; i < 30; i++) reserveOtpSend(`+9665000000${10 + i}`, 'a', 0);
  expect(reserveOtpSend(phone, 'a', 0)).toBeNull();
  for (let i = 0; i < 5; i++) expect(reserveOtpSend(phone, `b${i}`, 0)).not.toBeNull();
});
it('does not pool visitors whose address is unknown', () => {
  for (let i = 0; i < 100; i++) expect(reserveOtpSend(`+966500${1000 + i}`, null, 0)).not.toBeNull();
});
it('releases only the failed send when two share a millisecond', () => {
  const first = reserveOtpSend(phone, 'a', 0);
  for (let i = 0; i < 4; i++) reserveOtpSend(phone, 'a', 0);
  first?.();
  expect(reserveOtpSend(phone, 'a', 0)).not.toBeNull();
  expect(reserveOtpSend(phone, 'a', 0)).toBeNull();
});
it('keeps working past the memory bound', () => {
  for (let i = 0; i < 6_000; i++) reserveOtpSend(`+9665${i}`, `ip${i}`, 0);
  expect(reserveOtpSend(phone, 'a', 1)).not.toBeNull();
});
