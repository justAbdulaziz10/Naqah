const WINDOW_MS = 15 * 60_000;
// Generous on purpose. Only sends Supabase accepted count, and a mobile carrier can put many owners on one address.
const PHONE_LIMIT = 5;
const IP_LIMIT = 30;
const MAX_KEYS = 5_000;

const attempts = new Map<string, number[]>();

function recent(key: string, now: number) {
  return (attempts.get(key) ?? []).filter((time) => now - time < WINDOW_MS);
}

function prune(now: number) {
  for (const key of attempts.keys()) if (!recent(key, now).length) attempts.delete(key);
  for (const key of attempts.keys()) {
    if (attempts.size <= MAX_KEYS) break;
    attempts.delete(key);
  }
}

function release(key: string, time: number) {
  const times = attempts.get(key) ?? [];
  const index = times.indexOf(time);
  if (index >= 0) times.splice(index, 1);
  if (!times.length) attempts.delete(key);
}

/**
 * Holds a slot for one send, or returns null over the limit. Call the returned function when the
 * send fails, so a bad CAPTCHA or an outage never uses up an owner's attempts. An unknown address
 * has no limit of its own: those visitors must not share one bucket.
 *
 * Per-instance only: serverless instances do not share this memory, so it slows abuse of this
 * app's route. Supabase CAPTCHA and SMS limits are the real boundary.
 */
export function reserveOtpSend(phone: string, ip: string | null, now = Date.now()) {
  const keys = [{ key: `phone:${phone}`, limit: PHONE_LIMIT }];
  if (ip) keys.push({ key: `ip:${ip}`, limit: IP_LIMIT });
  const held = keys.map(({ key, limit }) => ({ key, times: recent(key, now), limit }));
  if (held.some(({ times, limit }) => times.length >= limit)) return null;
  held.forEach(({ key, times }) => attempts.set(key, [...times, now]));
  if (attempts.size > MAX_KEYS) prune(now);
  return () => held.forEach(({ key }) => release(key, now));
}

export function resetOtpLimits() {
  attempts.clear();
}
