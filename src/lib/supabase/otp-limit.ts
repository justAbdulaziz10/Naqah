import { reserveRateLimit, resetRateLimitState, type RateLimitLease } from "@/server/rate-limit";

const WINDOW_SECONDS = 15 * 60;
// Generous on purpose. Only sends Supabase accepted count, and a mobile carrier can put many owners on one address.
const PHONE_LIMIT = 5;
const IP_LIMIT = 30;

/** Reserve phone and IP slots; failed sends release both reservations. */
export async function reserveOtpSend(phone: string, ip: string | null, now = Date.now()): Promise<(() => Promise<void>) | null> {
  const leases: RateLimitLease[] = [];
  const phoneLease = await reserveRateLimit(`otp:phone:${phone}`, PHONE_LIMIT, WINDOW_SECONDS, now);
  if (!phoneLease) return null;
  leases.push(phoneLease);

  if (ip) {
    const ipLease = await reserveRateLimit(`otp:ip:${ip}`, IP_LIMIT, WINDOW_SECONDS, now);
    if (!ipLease) {
      await phoneLease.release();
      return null;
    }
    leases.push(ipLease);
  }

  return async () => {
    await Promise.all(leases.map((lease) => lease.release()));
  };
}

export function resetOtpLimits(): void {
  resetRateLimitState();
}
