/**
 * The owner's scheduled call, to the farm's own owner number (never a number from the environment).
 * Paid, so it runs only with NAQAH_CALL_OWNER=1. The claim is saved before dialling, so a second
 * scheduler can't call twice; a call Twilio never placed is undone, not counted as an attempt.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { REPORT_CALL_RING_SECONDS } from "@/domain/clock";
import { abandonOwnerCallAttempt, claimDueOwnerCall } from "@/domain/ownerCalls";
import { toDbId } from "@/server/db/ids";
import { runFarmAction } from "@/server/db/service-repository";
import { voiceLocale } from "@/server/env";
import { ownerUpdateCallEnabled, outboundConfig } from "./config";
import { signCallToken } from "./token";
import { createTwilioCaller, type OutboundCaller, type OutboundCallResult } from "./twilio";
import { testCallsEnabled } from "./test-call-config";
import { isTestRanch } from "./test-call-store";

export async function dialDueOwnerCall(
  client: SupabaseClient,
  input: { farmId: string; now: Date },
  caller: OutboundCaller = createTwilioCaller(),
): Promise<OutboundCallResult | null> {
  const { farmId, now } = input;
  if (!ownerUpdateCallEnabled()) return null;
  if (testCallsEnabled() && await isTestRanch(client, farmId)) return null;
  const config = outboundConfig();
  if (!config) return { placed: false, reason: "not_configured" };
  const { result: claim } = await runFarmAction(client, farmId, (ws) => {
    // Undefined until migration 20261110090000 runs: a claim could not be saved, so nothing may dial.
    if (ws.ownerCallRun === undefined) return { ws, result: null };
    const claimed = claimDueOwnerCall(ws, now);
    return { ws: claimed.ws, result: claimed.claim };
  });
  if (!claim) return null;

  // A run opened in this pass has a domain id until saved; the database id is derived from it.
  const runId = toDbId(farmId, claim.runId);
  const reportId = claim.reportId ? toDbId(farmId, claim.reportId) : "";
  const query = `s=${encodeURIComponent(signCallToken({ k: "owner", f: farmId, o: runId, r: reportId, n: claim.attempt, l: voiceLocale(), t: now.getTime() }))}`;
  let placed: OutboundCallResult;
  try {
    placed = await caller.place({
      to: claim.phone,
      url: `${config.baseUrl}/api/voice/owner?${query}`,
      statusCallback: `${config.baseUrl}/api/voice/owner/status?${query}`,
      timeoutSeconds: REPORT_CALL_RING_SECONDS,
      statusEvents: ["completed"],
    });
  } catch {
    placed = { placed: false, reason: "network_error" };
  }
  if (!placed.placed && placed.reason !== "network_error") {
    await runFarmAction(client, farmId, (ws) => ({ ws: abandonOwnerCallAttempt(ws, now, runId, claim.attempt), result: null }));
  }
  return placed;
}
