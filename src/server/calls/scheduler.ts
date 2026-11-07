/**
 * Report-call scheduler, run every few minutes by /api/cron/report-calls. For each farm it claims
 * the due slot or due retry (saved before dialling, so a second run can't call twice), then asks
 * Twilio to place the call. A call Twilio never placed is undone, not logged as unanswered.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { abandonReportCallAttempt, claimDueReportCall } from "@/domain/reportCalls";
import type { Locale } from "@/domain/types";
import { DbError } from "@/server/db/errors";
import { toDbId } from "@/server/db/ids";
import { listScheduledFarmIds, runFarmAction } from "@/server/db/service-repository";
import { signCallToken } from "./token";
import type { OutboundCaller } from "./twilio";

export interface SchedulerSummary {
  farms: number;
  placed: number;
  /** Twilio refused or couldn't be reached; the attempt was undone and retries later. */
  failed: number;
  /** A farm that couldn't be read or saved. Nothing was dialled for it. */
  errors: number;
}

export async function runReportCallScheduler(
  client: SupabaseClient,
  caller: OutboundCaller,
  options: { baseUrl: string; now: Date },
): Promise<SchedulerSummary> {
  const { baseUrl, now } = options;
  const farmIds = await listScheduledFarmIds(client);
  const summary: SchedulerSummary = { farms: farmIds.length, placed: 0, failed: 0, errors: 0 };

  for (const farmId of farmIds) {
    try {
      const { result: claim } = await runFarmAction(client, farmId, (ws) => {
        const claimed = claimDueReportCall(ws, now);
        const locale: Locale = ws.settings.worker.language === "en" ? "en" : "ar";
        return { ws: claimed.ws, result: claimed.claim ? { ...claimed.claim, locale } : null };
      });
      if (!claim) continue;

      // A run opened in this pass has a domain id until saved; the database id is derived from it.
      const runId = toDbId(farmId, claim.runId);
      const query = `s=${encodeURIComponent(signCallToken({ k: "report", f: farmId, r: runId, n: claim.attempt, l: claim.locale, t: now.getTime() }))}`;
      const placed = await caller.place({
        to: claim.phone,
        url: `${baseUrl}/api/voice/outbound?${query}`,
        statusCallback: `${baseUrl}/api/voice/outbound/status?${query}`,
      });
      if (placed.placed) {
        summary.placed += 1;
        continue;
      }
      summary.failed += 1;
      await runFarmAction(client, farmId, (ws) => ({ ws: abandonReportCallAttempt(ws, now, runId, claim.attempt), result: null }));
    } catch (error) {
      summary.errors += 1;
      console.error(`[NAQAH] report call scheduler failed for a farm (${error instanceof DbError ? error.code : error instanceof Error ? error.name : "unknown"})`);
    }
  }
  return summary;
}
