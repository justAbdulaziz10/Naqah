/**
 * The owner's update call, to the farm's own owner number (never a number from the environment).
 * Paid, so it runs only with NAQAH_CALL_OWNER=1. The call is a real conversation: Twilio fetches
 * /api/voice/owner when the owner answers. A summary is dialed only once its chosen time is due.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimDueOwnerSummary, restoreOwnerSummary } from "@/domain/actions";
import type { Locale } from "@/domain/types";
import { voiceLocale } from "@/server/env";
import { runFarmAction } from "@/server/db/service-repository";
import { ownerUpdateCallEnabled, outboundConfig } from "./config";
import { signCallToken } from "./token";
import { createTwilioCaller, type OutboundCaller, type OutboundCallResult } from "./twilio";

const E164 = /^\+[1-9]\d{7,14}$/;

export async function callOwnerAfterReport(
  client: SupabaseClient,
  input: { farmId: string; reportCallId: string | null; now: Date },
  caller: OutboundCaller = createTwilioCaller(),
): Promise<OutboundCallResult | null> {
  if (!ownerUpdateCallEnabled()) return null;
  const config = outboundConfig();
  if (!config) return { placed: false, reason: "not_configured" };
  const { result: claimed } = await runFarmAction(client, input.farmId, (ws) => {
    const due = claimDueOwnerSummary(ws, input.now);
    const phone = ws.settings.owner.phone.replace(/[\s-]/g, "");
    const report = due.reportId ? ws.reports.find((item) => item.id === due.reportId) : undefined;
    if (!due.reportId || !due.notBefore || !report || !E164.test(phone)) return { ws: due.ws, result: null };
    const locale: Locale = voiceLocale();
    return { ws: due.ws, result: { reportId: due.reportId, notBefore: due.notBefore, phone, locale } };
  });
  if (!claimed) return null;

  const token = signCallToken({ k: "owner", f: input.farmId, r: claimed.reportId, l: claimed.locale, t: input.now.getTime() });
  const query = `s=${encodeURIComponent(token)}`;
  const placed = await caller.place({
    to: claimed.phone,
    url: `${config.baseUrl}/api/voice/owner?${query}`,
    statusCallback: `${config.baseUrl}/api/voice/owner/status?${query}`,
    statusEvents: ["completed"],
  });
  if (!placed.placed) {
    await runFarmAction(client, input.farmId, (ws) => ({
      ws: restoreOwnerSummary(ws, claimed.reportId, claimed.notBefore),
      result: null,
    }));
  }
  return placed;
}
