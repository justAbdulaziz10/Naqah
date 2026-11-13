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
  // A retry that changes nothing, or fails before it is written, gives its slots back.
  let retried = false;
  try {
    retried = await retry();
    return retried;
  } finally {
    if (!retried) await release();
  }
}
