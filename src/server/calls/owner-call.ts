/**
 * The owner's update call after a saved report, to the farm's own owner number (never a number
 * from the environment). Paid, so it runs only with NAQAH_CALL_OWNER=1. Its final status records
 * whether the owner answered (/api/voice/owner/status → owner_notification).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { reportCallRuns } from "@/domain/reportCalls";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { voiceLocale } from "@/server/env";
import { buildOwnerCallSummary } from "@/server/voice/summary";
import { sayElement } from "@/server/voice/twiml";
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
  const { workspace } = requireFarm(await loadFarm(client, { id: input.farmId }));
  const run = input.reportCallId ? reportCallRuns(workspace).find((item) => item.id === input.reportCallId) : undefined;
  const report = run?.reportId ? workspace.reports.find((item) => item.id === run.reportId) : workspace.reports.at(-1);
  const to = workspace.settings.owner.phone.replace(/[\s-]/g, "");
  if (!report || !E164.test(to)) return { placed: false, reason: "invalid_number" };

  const locale = voiceLocale();
  const token = signCallToken({ k: "owner", f: input.farmId, r: report.id, l: locale, t: input.now.getTime() });
  return caller.place({
    to,
    twiml: `<Response>${sayElement(buildOwnerCallSummary(report, locale, "farm"), locale)}</Response>`,
    statusCallback: `${config.baseUrl}/api/voice/owner/status?s=${encodeURIComponent(token)}`,
  });
}
