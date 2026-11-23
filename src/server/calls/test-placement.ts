import type { SupabaseClient } from "@supabase/supabase-js";
import { requireCallingFarm, testCallScope } from "@/server/test-ranch";
import { reserveTestBucket } from "./test-rate-limit";
import type { OutboundCaller, OutboundCallRequest, OutboundCallResult } from "./twilio";

/** Reserve a durable slot immediately before attempting placement, even if the provider rejects it. */
export async function placeFarmCall(
  client: SupabaseClient, caller: OutboundCaller, farmId: string, request: OutboundCallRequest, now: Date,
): Promise<OutboundCallResult> {
  requireCallingFarm(farmId);
  const scope = testCallScope();
  if (scope.kind === "ranch") {
    if (!scope.allowlist.includes(request.to)) return { placed: false, reason: "not_allowed" };
    if (!await reserveTestBucket(client, `test-ranch:${farmId}:placements`, scope.maxCalls, now.getTime()).catch(() => false)) {
      console.warn("[NAQAH] test-ranch call refused: placement budget exhausted or unavailable");
      return { placed: false, reason: "rate_limited" };
    }
  }
  return caller.place(request);
}
