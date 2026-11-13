export function createRateLimitRpc(nowMs: () => number) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return async (name: string, args: { p_key: string; p_limit?: number; p_window_seconds?: number }) => {
    const { p_key: key } = args;
    if (name === "release_rate_limit") {
      const bucket = buckets.get(key);
      if (bucket && bucket.count > 0) bucket.count -= 1;
      return { data: true, error: null };
    }
    if (name !== "consume_rate_limit") throw new Error("Unexpected RPC");
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= nowMs()) {
      bucket = { count: 0, resetAt: nowMs() + args.p_window_seconds! * 1000 };
      buckets.set(key, bucket);
    }
    if (bucket.count >= args.p_limit!) return { data: false, error: null };
    bucket.count += 1;
    return { data: true, error: null };
  };
}
