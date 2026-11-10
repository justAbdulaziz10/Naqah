/**
 * Report-call scheduler, run every few minutes by /api/cron/report-calls. For each farm it claims
 * the due slot or due retry (saved before dialling, so a second run can't call twice), then asks
 * Twilio to place the call. A call Twilio never placed is undone, not logged as unanswered.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { claimDueWorkerCall, releaseWorkerCallClaim } from "@/domain/actions";
import {
  abandonReportCallAttempt, claimDueReportCall, dialableWorkerPhone, placeReportCallAttempt, startReportCall,
  type ReportCallBlock,
} from "@/domain/reportCalls";
import { REPORT_CALL_RING_SECONDS } from "@/domain/clock";
import type { Locale } from "@/domain/types";
import { DbError } from "@/server/db/errors";
import { toDbId } from "@/server/db/ids";
import { listScheduledFarmIds, runFarmAction } from "@/server/db/service-repository";
import { dialDueOwnerCall } from "./owner-call";
import { signCallToken } from "./token";
import type { OutboundCaller, OutboundCallResult } from "./twilio";

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
      if (claim) {
        const placed = await dial(client, caller, farmId, claim, { baseUrl, now });
        if (placed.placed) summary.placed += 1;
        else summary.failed += 1;
      }
    } catch (error) {
      summary.errors += 1;
      console.error(`[NAQAH] report call scheduler failed for a farm (${error instanceof DbError ? error.code : error instanceof Error ? error.name : "unknown"})`);
    }
    await dialDueWorkerCall(client, caller, farmId, summary, { baseUrl, now });
    await dialOwner(client, caller, farmId, summary, now);
  }
  return summary;
}

/** One due instruction or verification call. The claim is saved before Twilio is asked. */
async function dialDueWorkerCall(
  client: SupabaseClient,
  caller: OutboundCaller,
  farmId: string,
  summary: SchedulerSummary,
  options: { baseUrl: string; now: Date },
) {
  try {
    const { result: claim } = await runFarmAction(client, farmId, (ws) => {
      const claimed = claimDueWorkerCall(ws, options.now);
      const phone = dialableWorkerPhone(ws);
      if (!claimed.pendingCallId) return { ws: claimed.ws, result: null };
      if (!phone) return { ws: releaseWorkerCallClaim(claimed.ws, claimed.pendingCallId, options.now), result: null };
      return {
        ws: claimed.ws,
        result: { pendingCallId: claimed.pendingCallId, attempt: claimed.attempt, phone, locale: workerLocale(ws) },
      };
    });
    if (!claim) return;
    const pendingId = toDbId(farmId, claim.pendingCallId);
    const query = `s=${encodeURIComponent(signCallToken({ k: "worker", f: farmId, p: pendingId, n: claim.attempt, l: claim.locale, t: options.now.getTime() }))}`;
    const placed = await caller.place({
      to: claim.phone,
      url: `${options.baseUrl}/api/voice/worker?${query}`,
      statusCallback: `${options.baseUrl}/api/voice/worker/status?${query}`,
      timeoutSeconds: REPORT_CALL_RING_SECONDS,
      statusEvents: ["completed"],
    });
    if (placed.placed) {
      summary.placed += 1;
      return;
    }
    summary.failed += 1;
    await runFarmAction(client, farmId, (ws) => ({ ws: releaseWorkerCallClaim(ws, pendingId, options.now), result: null }));
  } catch (error) {
    summary.errors += 1;
    console.error(`[NAQAH] worker call scheduler failed for a farm (${error instanceof DbError ? error.code : error instanceof Error ? error.name : "unknown"})`);
  }
}

/** The owner's due slot or due retry. A slot with no new report still calls, and says so. */
async function dialOwner(
  client: SupabaseClient,
  caller: OutboundCaller,
  farmId: string,
  summary: SchedulerSummary,
  now: Date,
) {
  try {
    const placed = await dialDueOwnerCall(client, { farmId, now }, caller);
    if (!placed) return;
    if (placed.placed) summary.placed += 1;
    else summary.failed += 1;
  } catch (error) {
    summary.errors += 1;
    console.error(`[NAQAH] owner call scheduler failed for a farm (${error instanceof DbError ? error.code : error instanceof Error ? error.name : "unknown"})`);
  }
}

type Claim = { runId: string; attempt: number; phone: string; locale: Locale };

const workerLocale = (ws: { settings: { worker: { language: string } } }): Locale => (ws.settings.worker.language === "en" ? "en" : "ar");

/**
 * Dial one claimed attempt. The claim was saved before this runs, so a second scheduler pass
 * can't dial it again; a call Twilio never placed is undone and retried later, never logged as
 * unanswered. Returns whether Twilio accepted the call.
 */
async function dial(
  client: SupabaseClient,
  caller: OutboundCaller,
  farmId: string,
  claim: Claim,
  options: { baseUrl: string; now: Date; retry?: boolean },
) {
  const { baseUrl, now, retry = true } = options;
  // A run opened in this pass has a domain id until saved; the database id is derived from it.
  const runId = toDbId(farmId, claim.runId);
  const query = `s=${encodeURIComponent(signCallToken({ k: "report", f: farmId, r: runId, n: claim.attempt, l: claim.locale, t: now.getTime() }))}`;
  const placed = await caller.place({
    to: claim.phone,
    url: `${baseUrl}/api/voice/outbound?${query}`,
    statusCallback: `${baseUrl}/api/voice/outbound/status?${query}`,
    timeoutSeconds: REPORT_CALL_RING_SECONDS,
    statusEvents: ["initiated", "ringing", "answered", "completed"],
  });
  if (placed.placed) return placed;
  await runFarmAction(client, farmId, (ws) => ({ ws: abandonReportCallAttempt(ws, now, runId, claim.attempt, retry), result: null }));
  return placed;
}

export type CallNowResult =
  | { status: "placed" }
  | { status: "blocked"; reason: ReportCallBlock | "duplicate" | "not_allowed" | "rate_limited" }
  | { status: "failed"; reason: "not_placed"; code?: number; failureReason?: Extract<OutboundCallResult, { placed: false }>["reason"] };

/**
 * One report call now, normally to the farm's saved primary worker. Controlled server callers
 * may override the destination and await audit linking before dialing. Uses the scheduler's
 * claim → dial path, but manual calls never retry automatically.
 */
export async function requestReportCallNow(
  client: SupabaseClient,
  caller: OutboundCaller,
  farmId: string,
  options: { baseUrl: string; now: Date; allowlist?: string[] | null; to?: string; onRunOpened?: (runId: string) => Promise<void> },
): Promise<CallNowResult> {
  const { now, allowlist } = options;
  type Opened = { blocked: ReportCallBlock | "duplicate" | "not_allowed" } | { claim: Claim };
  const { result } = await runFarmAction<Opened>(client, farmId, (ws) => {
    // Checked before a run exists, so a number outside a controlled test leaves no trace and no retry.
    const saved = options.to ?? dialableWorkerPhone(ws);
    if (saved && allowlist && !allowlist.includes(saved)) return { ws, result: { blocked: "not_allowed" as const } };
    const input = options.to ? { ...ws, settings: { ...ws.settings, worker: { ...ws.settings.worker, phone: options.to } } } : ws;
    const opened = startReportCall(input, now, "manual");
    if (!opened.run) return { ws, result: { blocked: opened.blocked ?? ("duplicate" as const) } };
    opened.ws.settings = ws.settings;
    const placed = placeReportCallAttempt(opened.ws, now, opened.run.id);
    const phone = options.to ?? dialableWorkerPhone(opened.ws);
    if (placed.attempt === null || !phone) return { ws, result: { blocked: "duplicate" as const } };
    return { ws: placed.ws, result: { claim: { runId: opened.run.id, attempt: placed.attempt, phone, locale: workerLocale(ws) } } };
  });
  if ("blocked" in result) return { status: "blocked", reason: result.blocked };
  await options.onRunOpened?.(toDbId(farmId, result.claim.runId));
  const placed = await dial(client, caller, farmId, result.claim, { ...options, retry: false });
  return placed.placed ? { status: "placed" } : {
    status: "failed", reason: "not_placed",
    ...(placed.code === undefined ? {} : { code: placed.code }),
    ...(options.to === undefined ? {} : { failureReason: placed.reason }),
  };
}
