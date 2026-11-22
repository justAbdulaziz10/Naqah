import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The test preview updates only its own bucket keys. A unique insert or a conditional
 * update reserves a slot across instances, without consume_rate_limit's global delete.
 * Conflicts retry from fresh data. Unknown outcomes keep the slot or deny the request.
 */
export async function reserveTestBucket(
  client: Pick<SupabaseClient, "from">,
  key: string,
  limit: number,
  nowMs: number,
  windowSeconds?: number,
): Promise<boolean> {
  const table = () => client.from("rate_limit_buckets");
  const newReset = windowSeconds === undefined
    ? "9999-12-31T00:00:00.000Z"
    : new Date(nowMs + windowSeconds * 1000).toISOString();

  for (let attempt = 0; attempt < 5; attempt++) {
    const { data: bucket, error } = await table().select("count, reset_at").eq("key", key).maybeSingle();
    if (error) return false;
    if (!bucket) {
      const { error: inserted } = await table().insert({ key, count: 1, reset_at: newReset });
      if (!inserted) return true;
      if (inserted.code === "23505") continue;
      return false;
    }

    const expired = windowSeconds !== undefined && Date.parse(bucket.reset_at) <= nowMs;
    if (!expired && bucket.count >= limit) return false;
    const { data: updated, error: failed } = await table()
      .update({ count: expired ? 1 : bucket.count + 1, reset_at: expired ? newReset : bucket.reset_at })
      .eq("key", key).eq("count", bucket.count).eq("reset_at", bucket.reset_at)
      .select("count").maybeSingle();
    if (failed) return false;
    if (updated) return true;
  }
  return false;
}
