import { DbError } from "@/server/db/errors";
import { reserveRateLimit, type RateLimitLease } from "@/server/rate-limit";
import { CALL_NOW_LIMITS } from "./config";

export async function withWorkerRetryLimit(farmId: string, now: Date, retry: () => Promise<boolean>): Promise<boolean> {
  const leases: RateLimitLease[] = [];
  const release = () => Promise.all(leases.map((lease) => lease.release()));
  for (const { window, limit, seconds } of CALL_NOW_LIMITS) {
    const lease = await reserveRateLimit(`worker-retry:farm:${farmId}:${window}`, limit, seconds, now.getTime());
    if (!lease) {
      await release();
      throw new DbError("limit_reached");
    }
    leases.push(lease);
  }
  const retried = await retry();
  if (!retried) await release();
  return retried;
}
