/**
 * Report-call scheduler, run every few minutes by /api/cron/report-calls. For each farm it claims
 * the due slot or due retry (saved before dialling, so a second run can't call twice), then asks
 * Twilio to place the call. A call Twilio never placed is undone, not logged as unanswered.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  abandonReportCallAttempt, claimDueReportCall, dialableWorkerPhone, placeReportCallAttempt, startReportCall,
  type ReportCallBlock,
} from "@/domain/reportCalls";
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
        return { ws: claimed.ws, result: claimed.claim ? { ...claimed.claim, locale: workerLocale(ws) } : null };
      });
      if (!claim) continue;
      const placed = await dial(client, caller, farmId, claim, { baseUrl, now });
      if (placed) summary.placed += 1;
      else summary.failed += 1;
    } catch (error) {
      summary.errors += 1;
      console.error(`[NAQAH] report call scheduler failed for a farm (${error instanceof DbError ? error.code : error instanceof Error ? error.name : "unknown"})`);
    }
  }
  return summary;
}

type Claim = { runId: string; attempt: number; phone: string; locale: Locale };

const workerLocale = (ws: { settings: { worker: { language: string } } }): Locale => (ws.settings.worker.language === "en" ? "en" : "ar");

/**
 * Dial one claimed attempt. The claim was saved before this runs, so a second scheduler pass
 * can't dial it again; a call Twilio never placed is undone and retried later, never logged as
 * unanswered. Returns whether Twilio accepted the call.
 */
async function dial(client: SupabaseClient, caller: OutboundCaller, farmId: string, claim: Claim, options: { baseUrl: string; now: Date }) {
  const { baseUrl, now } = options;
  // A run opened in this pass has a domain id until saved; the database id is derived from it.
  const runId = toDbId(farmId, claim.runId);
  const query = `s=${encodeURIComponent(signCallToken({ k: "report", f: farmId, r: runId, n: claim.attempt, l: claim.locale, t: now.getTime() }))}`;
  const placed = await caller.place({
    to: claim.phone,
    url: `${baseUrl}/api/voice/outbound?${query}`,
    statusCallback: `${baseUrl}/api/voice/outbound/status?${query}`,
  });
  if (placed.placed) return { sid: placed.sid };
  await runFarmAction(client, farmId, (ws) => ({ ws: abandonReportCallAttempt(ws, now, runId, claim.attempt), result: null }));
  return null;
}

export type CallNowResult =
  | { status: "placed" }
  | { status: "blocked"; reason: ReportCallBlock | "duplicate" }
  | { status: "failed"; reason: "not_placed" };

/**
 * One report call now, asked for by the farm's owner. The number is the farm's saved primary
 * worker, never one from the request. Uses the same claim → dial path as the scheduler, so the
 * retries, duplicate guard and status handling are identical.
 */
export async function requestReportCallNow(
  client: SupabaseClient,
  caller: OutboundCaller,
  farmId: string,
  options: { baseUrl: string; now: Date },
): Promise<CallNowResult> {
  const { now } = options;
  type Opened = { blocked: ReportCallBlock | "duplicate" } | { claim: Claim };
  const { result } = await runFarmAction<Opened>(client, farmId, (ws) => {
    const opened = startReportCall(ws, now, "manual");
    if (!opened.run) return { ws, result: { blocked: opened.blocked ?? ("duplicate" as const) } };
    const placed = placeReportCallAttempt(opened.ws, now, opened.run.id);
    const phone = dialableWorkerPhone(opened.ws);
    if (placed.attempt === null || !phone) return { ws, result: { blocked: "duplicate" as const } };
    return { ws: placed.ws, result: { claim: { runId: opened.run.id, attempt: placed.attempt, phone, locale: workerLocale(ws) } } };
  });
  if ("blocked" in result) return { status: "blocked", reason: result.blocked };
  return (await dial(client, caller, farmId, result.claim, options)) ? { status: "placed" } : { status: "failed", reason: "not_placed" };
}
