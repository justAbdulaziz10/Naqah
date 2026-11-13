import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

type RpcClient = Pick<SupabaseClient, "rpc">;
type LocalBucket = { count: number; resetAt: number };
export type RateLimitLease = { release(): Promise<void> };

const localBuckets = new Map<string, LocalBucket>();
let cachedClient: { url: string; key: string; client: RpcClient } | null = null;
let warnedAboutRpc = false;

function configuredClient(): RpcClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !key || key.startsWith("sb_publishable_")) return null;
  if (cachedClient?.url === url && cachedClient.key === key) return cachedClient.client;
  try {
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    cachedClient = { url, key, client };
    return client;
  } catch {
    return null;
  }
}

function warnRpcFailure(): void {
  if (warnedAboutRpc) return;
  warnedAboutRpc = true;
  console.warn("[NAQAH] shared rate-limit RPC unavailable; paid actions denied, only OTP/push may use instance-local limits");
}

function reserveLocal(key: string, limit: number, windowSeconds: number, nowMs: number): RateLimitLease | null {
  const windowMs = windowSeconds * 1000;
  let bucket = localBuckets.get(key);
  if (!bucket || bucket.resetAt <= nowMs) {
    bucket = { count: 0, resetAt: nowMs + windowMs };
    localBuckets.set(key, bucket);
  }
  if (bucket.count >= limit) return null;
  bucket.count += 1;
  if (localBuckets.size > 10_000) {
    for (const [existingKey, existing] of localBuckets) {
      if (existing.resetAt <= nowMs) localBuckets.delete(existingKey);
      if (localBuckets.size <= 10_000) break;
    }
  }
  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      const current = localBuckets.get(key);
      if (current === bucket && current.count > 0) current.count -= 1;
      if (current === bucket && current.count === 0) localBuckets.delete(key);
    },
  };
}

/** Reserve a shared slot. Only non-paid OTP/push buckets may fall back to instance-local limits. */
export async function reserveRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  nowMs = Date.now(),
): Promise<RateLimitLease | null> {
  if (!key || key.length > 240 || !Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1) {
    throw new RangeError("Invalid rate-limit bucket configuration");
  }

  const client = configuredClient();
  if (!client) warnRpcFailure();
  if (client) {
    try {
      const { data, error } = await client.rpc("consume_rate_limit", {
        p_key: key,
        p_limit: limit,
        p_window_seconds: windowSeconds,
      });
      if (!error && typeof data === "boolean") {
        if (!data) return null;
        let released = false;
        return {
          async release() {
            if (released) return;
            released = true;
            try {
              const result = await client.rpc("release_rate_limit", { p_key: key });
              if (result.error || result.data !== true) warnRpcFailure();
            } catch {
              warnRpcFailure();
            }
          },
        };
      }
      warnRpcFailure();
    } catch {
      warnRpcFailure();
    }
  }

  return key.startsWith("otp:") || key.startsWith("push:") ? reserveLocal(key, limit, windowSeconds, nowMs) : null;
}

/** Test seam for resetting process-local state between limiter cases. */
export function resetRateLimitState(): void {
  localBuckets.clear();
  cachedClient = null;
  warnedAboutRpc = false;
}
