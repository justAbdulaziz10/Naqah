import { reserveRateLimit, type RateLimitLease } from "@/server/rate-limit";
import { CALL_NOW_LIMITS, demoNoCallLimit } from "./config";
import type { CallNowResult } from "./scheduler";

/**
 * «اتصال حقيقي» per ranch: 3 an hour and 10 a day. Each window's slot is reserved atomically (the
 * consume_rate_limit function in Supabase) before anything opens, so parallel presses can't slip
 * past. A call refused before dialling gives its slots back; a placed or failed dial keeps them.
 */
export async function withCallNowLimit(farmId: string, now: Date, place: () => Promise<CallNowResult>): Promise<CallNowResult> {
  // The local presentation ranch, only while the runner says so (see demoNoCallLimit).
  if (demoNoCallLimit(farmId)) return place();
  const leases: RateLimitLease[] = [];
  const release = () => Promise.all(leases.map((lease) => lease.release()));
  for (const { window, limit, seconds } of CALL_NOW_LIMITS) {
    const lease = await reserveRateLimit(`call-now:farm:${farmId}:${window}`, limit, seconds, now.getTime());
    if (!lease) {
      await release();
      return { status: "blocked", reason: "rate_limited" };
    }
    leases.push(lease);
  }
  try {
    const result = await place();
    if (result.status === "blocked") await release();
    return result;
  } catch (error) {
    throw error;
  }
}
