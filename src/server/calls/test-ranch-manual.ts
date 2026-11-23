import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { claimDueWorkerCall, markWorkerCallPlaced, markWorkerCallPlacementUnknown, releaseWorkerCallClaim, resolveWorkerCallAttempt, retryUndeliveredCall, startTaskVerification } from "@/domain/actions";
import { workerLineLive } from "@/domain/ownerCalls";
import { MINUTE, REPORT_CALL_RING_SECONDS } from "@/domain/clock";
import { reportCallBlock } from "@/domain/reportCalls";
import { undeliveredCalls } from "@/domain/alerts";
import { coveredTasks, openTaskTickets, workerCallClaimIsActive } from "@/domain/rules";

export { workerLineLive };
import type { Workspace } from "@/domain/types";
import { callTimeLimitSeconds, manualCallsEnabled, outboundCallMissing, outboundConfig, ownerUpdateCallEnabled } from "./config";
import { placeFarmCall } from "./test-placement";
import { testCallScope, verifyCallingOwner } from "@/server/test-ranch";
import { DbError } from "@/server/db/errors";
import { toDbId } from "@/server/db/ids";
import { runFarmAction } from "@/server/db/service-repository";
import { farmVoiceMissing, voiceMode } from "@/server/env";
import { signCallToken } from "./token";
import type { OutboundCaller, OutboundCallResult } from "./twilio";

export type TestCallStage = "report" | "owner_summary" | "worker_instruction" | "worker_verification";
export type TestCallNotReadyReason =
  | "manual_calls_off"
  | "owner_calls_off"
  | "not_configured"
  | "ultimate_required"
  | "no_worker"
  | "report_already_done"
  | "no_report_questions"
  | "no_owner_number"
  | "number_not_allowlisted"
  | "no_pending_instruction"
  | "no_open_ticket"
  | "instruction_not_delivered"
  | "verification_already_asked"
  | "call_not_placed"
  ;

export type TestCallStatus = "placed" | "call_live" | "cap_reached" | "unavailable" | `not_ready:${TestCallNotReadyReason}`;
export type TestCallStageAvailability =
  | { status: "ready" }
  | { status: "call_live" | "cap_reached" | "unavailable" }
  | { status: "not_ready"; reason: TestCallNotReadyReason };

export interface TestCallPanelState {
  visible: true;
  remainingCalls: number;
  maxCalls: number;
  callLive: boolean;
  stages: Record<TestCallStage, TestCallStageAvailability>;
  scheduleTimes: { report: string | null; ownerSummary: string | null; verification: string | null };
}

function isInstructionAvailable(ws: Workspace): boolean {
  const exhausted = new Set(undeliveredCalls(ws).map((call) => call.id));
  return ws.pendingWorkerCalls.some((call) => call.purpose === "instruction" &&
    (call.state === "pending" || (call.state === "no_answer_ticket" && exhausted.has(call.id))));
}

function instructionDeliveredForTask(ws: Workspace, taskId: string): boolean {
  const exhausted = new Set(undeliveredCalls(ws).map((call) => call.id));
  return ws.pendingWorkerCalls.some((call) => call.purpose === "instruction" && coveredTasks(call).includes(taskId) &&
    (call.state === "delivered" || (call.state === "no_answer_ticket" && !exhausted.has(call.id))));
}

function verificationCallForTask(ws: Workspace, taskId: string) {
  return ws.pendingWorkerCalls.find((call) => call.purpose === "task_verification" && coveredTasks(call).includes(taskId));
}

function eligibleVerificationTask(ws: Workspace) {
  return [...openTaskTickets(ws)]
    .sort((a, b) => Date.parse(a.scheduledFor ?? a.createdAt) - Date.parse(b.scheduledFor ?? b.createdAt))
    .find((task) => {
      if (!instructionDeliveredForTask(ws, task.id)) return false;
      const existing = verificationCallForTask(ws, task.id);
      if (!existing) return true;
      if (existing.state === "pending") return true;
      if (existing.state === "no_answer_ticket") return undeliveredCalls(ws).some((call) => call.id === existing.id);
      return false;
    }) ?? null;
}

function stage(reason?: TestCallNotReadyReason): TestCallStageAvailability {
  return reason ? { status: "not_ready", reason } : { status: "ready" };
}

/** Pure server-side view model. The owner UI gets no test-ranch state until its action proves scope. */
export function buildTestCallPanelState(
  ws: Workspace,
  now: Date,
  input: { maxCalls: number; usedCalls: number; callsConfigured: boolean; manualEnabled: boolean; ownerEnabled: boolean; workerAllowed: boolean; ownerAllowed: boolean },
): TestCallPanelState {
  const remainingCalls = Math.max(0, input.maxCalls - input.usedCalls);
  const callLive = workerLineLive(ws, now);
  const common: TestCallStageAvailability | null = !input.callsConfigured
    ? { status: "not_ready", reason: "not_configured" }
    : callLive
      ? { status: "call_live" }
      : remainingCalls === 0 ? { status: "cap_reached" } : null;

  const reportBlock = reportCallBlock(ws, now);
  const reportReason: TestCallNotReadyReason | undefined = reportBlock === "no_worker_phone" ? "no_worker"
    : reportBlock === "already_reported" ? "report_already_done"
    : reportBlock === "no_questions" ? "no_report_questions"
    : !input.manualEnabled ? "manual_calls_off"
    : !input.workerAllowed ? "number_not_allowlisted"
    : reportBlock === "in_progress" ? undefined : undefined;

  const ownerPhone = ws.settings.owner.phone.replace(/[\s-]/g, "");
  // Ultimate-only on purpose: the test ranch is Ultimate, and a Basic summary call has no button to test here.
  const ownerReason: TestCallNotReadyReason | undefined = ws.settings.plan !== "ultimate" ? "ultimate_required"
    : !input.ownerEnabled ? "owner_calls_off"
    : !/^\+[1-9]\d{7,14}$/.test(ownerPhone) ? "no_owner_number"
    : !input.ownerAllowed ? "number_not_allowlisted"
    : undefined;

  const instructionReason: TestCallNotReadyReason | undefined = ws.settings.plan !== "ultimate" ? "ultimate_required"
    : !input.manualEnabled ? "manual_calls_off"
    : !input.workerAllowed ? "number_not_allowlisted"
    : isInstructionAvailable(ws) ? undefined : "no_pending_instruction";

  const hasOpenTasks = openTaskTickets(ws).length > 0;
  const verificationReason: TestCallNotReadyReason | undefined = ws.settings.plan !== "ultimate" ? "ultimate_required"
    : !input.manualEnabled ? "manual_calls_off"
    : !input.workerAllowed ? "number_not_allowlisted"
    : !hasOpenTasks ? "no_open_ticket"
    : eligibleVerificationTask(ws) ? undefined
    : openTaskTickets(ws).some((task) => !instructionDeliveredForTask(ws, task.id)) ? "instruction_not_delivered"
    : "verification_already_asked";

  const select = (reason?: TestCallNotReadyReason): TestCallStageAvailability => common ?? stage(reason);
  const verifyTask = eligibleVerificationTask(ws) ?? openTaskTickets(ws)[0] ?? null;
  return {
    visible: true,
    remainingCalls,
    maxCalls: input.maxCalls,
    callLive,
    stages: {
      report: select(reportReason),
      owner_summary: select(ownerReason),
      worker_instruction: select(instructionReason),
      worker_verification: select(verificationReason),
    },
    scheduleTimes: {
      report: ws.settings.callSchedule?.time || null,
      ownerSummary: ws.settings.ownerCallSchedule?.time || null,
      verification: verifyTask?.scheduledFor ?? null,
    },
  };
}

export async function readTestPlacementUsage(client: SupabaseClient, farmId: string, maxCalls: number) {
  const { data, error } = await client.from("rate_limit_buckets")
    .select("count").eq("key", `test-ranch:${farmId}:placements`).maybeSingle();
  if (error) throw new DbError("unavailable");
  const usedCalls = typeof data?.count === "number" ? data.count : 0;
  return { usedCalls, remainingCalls: Math.max(0, maxCalls - usedCalls) };
}

export async function readTestCallPanelState(client: SupabaseClient, farmId: string, ws: Workspace, now: Date): Promise<TestCallPanelState | null> {
  const scope = testCallScope();
  if (scope.kind !== "ranch" || scope.farmId !== farmId || !await verifyCallingOwner(client, farmId)) return null;
  const { usedCalls } = await readTestPlacementUsage(client, farmId, scope.maxCalls);
  const callsConfigured = voiceMode() === "farm" && !farmVoiceMissing().length && !outboundCallMissing().length && Boolean(outboundConfig());
  return buildTestCallPanelState(ws, now, {
    maxCalls: scope.maxCalls,
    usedCalls,
    callsConfigured,
    manualEnabled: manualCallsEnabled(),
    ownerEnabled: ownerUpdateCallEnabled(),
    workerAllowed: Boolean(outboundConfig()?.allowlist.includes(ws.settings.worker.phone.replace(/[\s-]/g, ""))),
    ownerAllowed: Boolean(outboundConfig()?.allowlist.includes(ws.settings.owner.phone.replace(/[\s-]/g, ""))),
  });
}

function callPath(farmId: string, pendingCallId: string, attempt: number, retryBase: number, locale: string, baseUrl: string) {
  const query = `s=${encodeURIComponent(signCallToken({ k: "worker", f: farmId, p: pendingCallId, n: attempt - retryBase, ...(retryBase ? { b: retryBase } : {}), l: locale === "en" ? "en" : "ar", t: Date.now() }))}`;
  return {
    url: `${baseUrl}/api/voice/worker?${query}`,
    statusCallback: `${baseUrl}/api/voice/worker/status?${query}`,
  };
}

type WorkerClaim = { pendingCallId: string; attempt: number; retryBase: number; phone: string; locale: "en" | "ar"; purpose: "instruction" | "task_verification" };
type WorkerClaimResult =
  | { status: "claim"; claim: WorkerClaim }
  | { status: "blocked"; reason: "call_live" | "no_pending_instruction" | "no_open_ticket" | "instruction_not_delivered" | "verification_already_asked" | "ultimate_required" | "no_worker" | "unavailable" };

type PickedWorkerCall = { ws: Workspace; pendingCallId: string }
  | { reason: "call_live" | "no_pending_instruction" | "no_open_ticket" | "instruction_not_delivered" | "verification_already_asked" | "ultimate_required" | "no_worker" };

function pickWorkerCall(ws: Workspace, purpose: "instruction" | "task_verification", now: Date): PickedWorkerCall {
  if (ws.settings.plan !== "ultimate") return { reason: "ultimate_required" };
  const worker = ws.settings.worker.phone.replace(/[\s-]/g, "");
  if (!/^\+[1-9]\d{7,14}$/.test(worker)) return { reason: "no_worker" };
  if (workerLineLive(ws, now)) return { reason: "call_live" };

  let next = structuredClone(ws);
  let selected = purpose === "instruction"
    ? next.pendingWorkerCalls.find((call) => call.purpose === "instruction" && call.state === "pending")
      ?? next.pendingWorkerCalls.find((call) => call.purpose === "instruction" && call.state === "no_answer_ticket" && undeliveredCalls(next).some((item) => item.id === call.id))
    : null;

  if (purpose === "instruction" && !selected) return { reason: "no_pending_instruction" };
  if (purpose === "task_verification") {
    const task = eligibleVerificationTask(next);
    if (!task) {
      if (!openTaskTickets(next).length) return { reason: "no_open_ticket" };
      if (openTaskTickets(next).some((item) => !instructionDeliveredForTask(next, item.id))) return { reason: "instruction_not_delivered" };
      return { reason: "verification_already_asked" };
    }
    const started = startTaskVerification(next, now, task.id);
    if (!started.pendingCallId) return { reason: "no_open_ticket" };
    next = started.ws;
    selected = next.pendingWorkerCalls.find((call) => call.id === started.pendingCallId) ?? null;
  }

  if (!selected) return { reason: purpose === "instruction" ? "no_pending_instruction" : "no_open_ticket" };
  const selectedId = selected.id;
  if (selected.state === "no_answer_ticket") {
    next = retryUndeliveredCall(next, now, selectedId);
    selected = next.pendingWorkerCalls.find((call) => call.id === selectedId) ?? null;
  }
  if (!selected || selected.state !== "pending") return { reason: purpose === "instruction" ? "no_pending_instruction" : "verification_already_asked" };

  // A stale placement claim is settled as an interrupted attempt first. The fresh click then
  // authorizes exactly the next attempt, while a claim with time left still blocks above.
  if (selected.dialClaimedAt && !workerCallClaimIsActive(selected, now)) {
    next = resolveWorkerCallAttempt(next, now, selectedId, "unanswered").ws;
    selected = next.pendingWorkerCalls.find((call) => call.id === selectedId) ?? null;
    if (selected?.state === "no_answer_ticket") {
      next = retryUndeliveredCall(next, now, selectedId);
      selected = next.pendingWorkerCalls.find((call) => call.id === selectedId) ?? null;
    }
  }
  if (!selected || selected.state !== "pending") return { reason: purpose === "instruction" ? "no_pending_instruction" : "verification_already_asked" };
  selected.dialClaimedAt = null;
  selected.nextAttemptAt = now.toISOString();

  // Reuse the existing pure claim transition for its 3-attempt accounting, but isolate this
  // owner-authorized call from other overdue work in the workspace.
  const isolated = structuredClone(next);
  for (const call of isolated.pendingWorkerCalls) {
    if (call.id === selectedId) continue;
    call.dialClaimedAt = null;
    call.nextAttemptAt = null;
  }
  const claimed = claimDueWorkerCall(isolated, now);
  if (!claimed.pendingCallId || claimed.pendingCallId !== selectedId) return { reason: "call_live" };

  const claimedCall = claimed.ws.pendingWorkerCalls.find((call) => call.id === selectedId);
  if (!claimedCall) return { reason: "call_live" };
  const committed = structuredClone(next);
  const index = committed.pendingWorkerCalls.findIndex((call) => call.id === selectedId);
  committed.pendingWorkerCalls[index] = claimedCall;
  return { ws: committed, pendingCallId: selectedId };
}

export async function placeManualWorkerCall(
  client: SupabaseClient,
  caller: OutboundCaller,
  farmId: string,
  purpose: "instruction" | "task_verification",
  options: { baseUrl: string; now: Date },
): Promise<TestCallStatus> {
  const scope = testCallScope();
  if (scope.kind !== "ranch" || scope.farmId !== farmId) return "unavailable";
  if (!manualCallsEnabled()) return "not_ready:manual_calls_off";
  if (voiceMode() !== "farm" || farmVoiceMissing().length || outboundCallMissing().length || !outboundConfig()) return "not_ready:not_configured";
  if (!await verifyCallingOwner(client, farmId)) return "unavailable";
  const { now, baseUrl } = options;
  type ClaimResult = WorkerClaimResult | { status: "blocked"; reason: "unavailable" };
  const { result } = await runFarmAction<ClaimResult>(client, farmId, (ws) => {
    const picked = pickWorkerCall(ws, purpose, now);
    if ("reason" in picked) return { ws, result: { status: "blocked", reason: picked.reason } };
    const pending = picked.ws.pendingWorkerCalls.find((call) => call.id === picked.pendingCallId)!;
    const phone = ws.settings.worker.phone.replace(/[\s-]/g, "");
    return {
      ws: picked.ws,
      result: { status: "claim", claim: {
        pendingCallId: toDbId(farmId, pending.id),
        attempt: pending.attempts.length + 1,
        retryBase: pending.retryBase ?? 0,
        phone,
        locale: ws.settings.worker.language === "en" ? "en" : "ar",
        purpose,
      } },
    };
  });
  if (result.status === "blocked") {
    if (result.reason === "unavailable") return "unavailable";
    if (result.reason === "call_live") return "call_live";
    return `not_ready:${result.reason}`;
  }

  const call = callPath(farmId, result.claim.pendingCallId, result.claim.attempt, result.claim.retryBase, result.claim.locale, baseUrl);
  let placed: OutboundCallResult;
  try {
    placed = await placeFarmCall(client, caller, farmId, {
      to: result.claim.phone,
      url: call.url,
      statusCallback: call.statusCallback,
      timeoutSeconds: REPORT_CALL_RING_SECONDS,
      statusEvents: ["completed"],
    }, now);
  } catch {
    placed = { placed: false, reason: "network_error" };
  }
  if (placed.placed) {
    const durationMs = (REPORT_CALL_RING_SECONDS + callTimeLimitSeconds()) * 1000 + MINUTE;
    await runFarmAction(client, farmId, (ws) => ({ ws: markWorkerCallPlaced(ws, result.claim.pendingCallId, result.claim.attempt, now, durationMs), result: null }));
    return "placed";
  }
  if (placed.reason === "network_error") {
    await runFarmAction(client, farmId, (ws) => ({ ws: markWorkerCallPlacementUnknown(ws, result.claim.pendingCallId, result.claim.attempt, now), result: null }));
    return "call_live";
  }
  await runFarmAction(client, farmId, (ws) => ({ ws: releaseWorkerCallClaim(ws, result.claim.pendingCallId, now), result: null }));
  if (placed.reason === "rate_limited") return "cap_reached";
  if (placed.reason === "not_allowed") return "not_ready:number_not_allowlisted";
  if (placed.reason === "not_configured") return "not_ready:not_configured";
  return "not_ready:call_not_placed";
}
