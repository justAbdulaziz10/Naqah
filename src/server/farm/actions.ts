"use server";

import { createOwnerRepository, type OwnerRepository } from "@/server/db/owner-repository";
import { DbError, type DbErrorCode } from "@/server/db/errors";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createWritableClient, getOwner } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/supabase/timeout";
import { applyOwnerChanges } from "./changes";
import { isAccountDataEnabled } from "./account-mode";
import type { AccountWorkspace } from "@/lib/account/types";
import type { LoadedFarm } from "@/server/db/queries";
import { isUuid } from "@/server/db/ids";
import { manualCallsEnabled, outboundCallMissing, outboundConfig, ownerUpdateCallEnabled, demoRepeatReports, demoOwnerCallNow, demoOwnerCallNowEnabled } from "@/server/calls/config";
import { requestOwnerCallNow, type OwnerCallNowResult } from "@/server/calls/owner-call-now";
import { testCallScope } from "@/server/test-ranch";
import { withCallNowLimit } from "@/server/calls/call-now-limit";
import { withWorkerRetryLimit } from "@/server/calls/retry-limit";
import { requestReportCallNow, type CallNowResult } from "@/server/calls/scheduler";
import { createTwilioCaller } from "@/server/calls/twilio";
import { createServiceClient } from "@/server/db/service-client";
import { runFarmAction } from "@/server/db/service-repository";
import { retryUndeliveredCall } from "@/domain/actions";
import { farmVoiceMissing, voiceMode } from "@/server/env";
import { placeManualWorkerCall, readTestCallPanelState, readTestPlacementUsage, type TestCallPanelState, type TestCallStage, type TestCallStatus } from "@/server/calls/test-ranch-manual";
import type { Plan } from "@/domain/types";

const DB_TIMEOUT_MS = 8_000;

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: DbErrorCode | "unauthenticated" };

/** Authorization comes only from the validated session. Client ids never select the repository. */
async function asOwner<T>(work: (repository: OwnerRepository, ownerId: string) => Promise<T>): Promise<ActionResult<T>> {
  if (!isAccountDataEnabled()) return { ok: false, error: "unavailable" };
  try {
    const { user, unavailable } = await getOwner();
    // An outage is not a signed-out owner: treating it as one would show them the demo.
    if (!user) return { ok: false, error: unavailable ? "unavailable" : "unauthenticated" };
    const client = await createWritableClient();
    if (!client) return { ok: false, error: "unavailable" };
    const repository = createOwnerRepository(client, user.id, user);
    const data = await withTimeout((async () => {
      await repository.authorize();
      return work(repository, user.id);
    })(), DB_TIMEOUT_MS);
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error instanceof DbError ? error.code : "unavailable" };
  }
}

function accountWorkspace(loaded: LoadedFarm, ownerId: string): AccountWorkspace {
  return { ...loaded.workspace, farmId: loaded.farmId, ownerId };
}

export async function ensureFarm() { return asOwner((r) => r.ensureFarm()); }

/** Validated routing data for the plan gate; ownerId is a stale-page hint, not authorization. */
export async function initialPlanState() {
  return asOwner(async (r, ownerId) => ({ ownerId, state: await r.initialPlanState() }));
}

/**
 * The browser owner id is only a stale-page precondition. Authorization and the RPC identity
 * come from getOwner() and the session-bound repository; it cannot select another owner's farm.
 */
export async function selectInitialPlan(input: unknown, expectedOwnerId: unknown) {
  return asOwner(async (r, ownerId) => {
    if (input !== "basic" && input !== "ultimate") throw new DbError("invalid_input");
    if (typeof expectedOwnerId !== "string" || expectedOwnerId.length > 128) throw new DbError("invalid_input");
    if (ownerId !== expectedOwnerId) throw new DbError("conflict");
    const plan: Plan = input;
    await r.selectInitialPlan(plan);
    // Retryable, stable-id setup defaults are created only after the choice is recorded.
    await r.ensureFarm();
    return { plan };
  });
}

/** Entering the dashboard or setup. Without Supabase configured there is no account to open. */
export async function openAccount() {
  if (!isAccountDataEnabled()) return { ok: false as const, error: "unavailable" as const };
  if (!getSupabaseConfig()) return { ok: false as const, error: "unauthenticated" as const };
  return asOwner(async (r, ownerId) => {
    const selection = await r.initialPlanState();
    if (selection.required) throw new DbError("plan_required");
    await r.ensureFarm();
    return accountWorkspace(await r.load(), ownerId);
  });
}

/** One save from the screens: validated change by change, then the server's copy of the farm. */
export async function saveOwnerEdits(changes: unknown, farm: unknown) {
  return asOwner(async (r, ownerId) => {
    // A tab opened by one owner can outlive their session: its edits must not land on the next farm.
    if (typeof farm !== "string" || !isUuid(farm)) throw new DbError("invalid_input");
    // r is bound to the validated session and RLS. The untrusted id is only a stale-edit
    // precondition; it never selects a farm or changes whose repository executes the write.
    const loaded = await r.load();
    if (loaded.farmId !== farm) throw new DbError("conflict");
    const applied = await applyOwnerChanges(r, changes);
    return { ...applied, workspace: accountWorkspace(await r.load(), ownerId) };
  });
}

export async function loadWorkspace() {
  return asOwner(async (r, ownerId) => {
    if ((await r.initialPlanState()).required) throw new DbError("plan_required");
    return accountWorkspace(await r.load(), ownerId);
  });
}
export async function listAlerts() { return asOwner((r) => r.alerts(new Date())); }
export async function listInstructions() { return asOwner((r) => r.instructions()); }

export async function saveFarmProfile(input: unknown) { return asOwner((r) => r.saveFarmProfile(input)); }
export async function saveWorker(input: unknown) { return asOwner((r) => r.saveWorker(input)); }
export async function saveResource(input: unknown) { return asOwner((r) => r.saveResource(input)); }

export async function addCamel(input: unknown) { return asOwner((r) => r.addCamel(input)); }
export async function updateCamel(id: unknown, input: unknown) { return asOwner((r) => r.updateCamel(id, input)); }
export async function deleteCamel(id: unknown) { return asOwner((r) => r.deleteCamel(id)); }

export async function addCustomQuestion(text: unknown) { return asOwner((r) => r.addCustomQuestion(text)); }
export async function updateCustomQuestion(id: unknown, text: unknown) { return asOwner((r) => r.updateCustomQuestion(id, text)); }
export async function deleteCustomQuestion(id: unknown) { return asOwner((r) => r.deleteCustomQuestion(id)); }

export async function addCriterion(input: unknown) { return asOwner((r) => r.addCriterion(input)); }
export async function updateCriterion(id: unknown, input: unknown) { return asOwner((r) => r.updateCriterion(id, input)); }
export async function deleteCriterion(id: unknown) { return asOwner((r) => r.deleteCriterion(id)); }

export async function addEmergency(input: unknown) { return asOwner((r) => r.addEmergency(input)); }
export async function updateEmergency(id: unknown, input: unknown) { return asOwner((r) => r.updateEmergency(id, input)); }
export async function deleteEmergency(id: unknown) { return asOwner((r) => r.deleteEmergency(id)); }

/** Whether this deployment can place the owner's controlled "Call now". Names nothing secret. */
function outboundCallsReady(): boolean {
  return testCallScope().kind !== "invalid" && voiceMode() === "farm" && !farmVoiceMissing().length && !outboundCallMissing().length && Boolean(outboundConfig());
}

function callNowReady(): boolean {
  return manualCallsEnabled() && outboundCallsReady();
}

async function ownerCallingFarm(repository: OwnerRepository): Promise<string> {
  return testCallScope().kind === "off" ? (await repository.load()).farmId : repository.callingFarmId();
}

/**
 * The owner asks NAQAH to try an undelivered call again. Ownership comes from the session; the service
 * key does the write because owners can only read calls. Nothing dials here: the scheduler still decides.
 */
export async function retryUndelivered(id: unknown): Promise<ActionResult<boolean>> {
  return asOwner(async (r) => {
    if (typeof id !== "string" || !isUuid(id)) throw new DbError("invalid_input");
    const farmId = await ownerCallingFarm(r);
    const service = createServiceClient();
    if (!service) throw new DbError("unavailable");
    const now = new Date();
    return withWorkerRetryLimit(farmId, now, async () => {
      const { result } = await runFarmAction(service, farmId, (ws) => {
        const next = retryUndeliveredCall(ws, now, id);
        return { ws: next, result: next !== ws };
      });
      return result;
    });
  });
}

export async function callNowAvailable() {
  return asOwner(async (r) => {
    if (!callNowReady()) return false;
    if (testCallScope().kind === "off") return true;
    try {
      await ownerCallingFarm(r);
      return true;
    } catch {
      return false;
    }
  });
}

/**
 * One report call now, for the signed-in owner's own farm. The farm comes from the session (RLS
 * resolves it), the number from that farm's saved primary worker: nothing in the request chooses
 * who is called. Off unless NAQAH_MANUAL_REPORT_CALLS=1 and real calls are fully configured.
 */
export async function callWorkerNow(): Promise<ActionResult<CallNowResult>> {
  if (!callNowReady()) return { ok: false, error: "unavailable" };
  return asOwner(async (r) => {
    const farmId = await ownerCallingFarm(r); // Proves the session owns this farm, under RLS.
    const service = createServiceClient();
    const config = outboundConfig();
    if (!service || !config) throw new DbError("unavailable");
    const now = new Date();
    return withCallNowLimit(farmId, now, () =>
      requestReportCallNow(service, createTwilioCaller(config), farmId, { baseUrl: config.baseUrl, now, allowlist: config.allowlist, repeatReports: demoRepeatReports(farmId) }));
  });
}

function availabilityStatus(state: TestCallPanelState, stage: TestCallStage): TestCallStatus | null {
  const availability = state.stages[stage];
  if (availability.status === "ready") return null;
  if (availability.status === "not_ready") return `not_ready:${availability.reason}`;
  return availability.status;
}

/** The test-ranch panel is returned only after the session and service both prove the configured ranch. */
export async function testCallsPanelState(): Promise<ActionResult<TestCallPanelState | null>> {
  const scope = testCallScope();
  if (scope.kind === "off") return { ok: true, data: null };
  if (scope.kind !== "ranch") return { ok: false, error: "unavailable" };
  return asOwner(async (r) => {
    const farmId = await r.callingFarmId();
    if (farmId !== scope.farmId) throw new DbError("unavailable");
    const service = createServiceClient();
    if (!service) throw new DbError("unavailable");
    const panel = await readTestCallPanelState(service, farmId, (await r.load()).workspace, new Date());
    if (!panel) throw new DbError("unavailable");
    return panel;
  });
}

/** Report stage wrapper for the existing guarded Call now path. */
export async function testCallReportNow(): Promise<ActionResult<TestCallStatus>> {
  if (testCallScope().kind !== "ranch") return { ok: false, error: "unavailable" };
  if (!manualCallsEnabled()) return { ok: true, data: "not_ready:manual_calls_off" };
  if (!outboundCallsReady()) return { ok: true, data: "not_ready:not_configured" };
  const result = await callWorkerNow();
  if (!result.ok) return result;
  if (result.data.status === "placed") return { ok: true, data: "placed" };
  if (result.data.status === "blocked") {
    if (result.data.reason === "in_progress") return { ok: true, data: "call_live" };
    if (result.data.reason === "not_allowed") return { ok: true, data: "not_ready:number_not_allowlisted" };
    if (result.data.reason === "rate_limited") {
      const scope = testCallScope();
      const service = createServiceClient();
      if (scope.kind !== "ranch" || !service) return { ok: false, error: "unavailable" };
      const usage = await readTestPlacementUsage(service, scope.farmId, scope.maxCalls);
      return { ok: true, data: usage.remainingCalls === 0 ? "cap_reached" : "not_ready:call_not_placed" };
    }
    if (result.data.reason === "no_worker_phone") return { ok: true, data: "not_ready:no_worker" };
    if (result.data.reason === "already_reported") return { ok: true, data: "not_ready:report_already_done" };
    if (result.data.reason === "no_questions") return { ok: true, data: "not_ready:no_report_questions" };
    return { ok: true, data: "unavailable" };
  }
  if (result.data.status === "failed" && result.data.failureReason === "network_error") return { ok: true, data: "call_live" };
  return { ok: true, data: "not_ready:call_not_placed" };
}

/** Owner summary now: one manual attempt, through the signed realtime owner call path. */
export async function testCallOwnerSummaryNow(): Promise<ActionResult<TestCallStatus>> {
  const scope = testCallScope();
  if (scope.kind !== "ranch") return { ok: false, error: "unavailable" };
  if (!ownerUpdateCallEnabled()) return { ok: true, data: "not_ready:owner_calls_off" };
  if (!outboundCallsReady()) return { ok: true, data: "not_ready:not_configured" };
  return asOwner(async (r) => {
    const farmId = await r.callingFarmId();
    if (farmId !== scope.farmId) throw new DbError("unavailable");
    const service = createServiceClient();
    const config = outboundConfig();
    if (!service || !config) throw new DbError("unavailable");
    const now = new Date();
    const panel = await readTestCallPanelState(service, farmId, (await r.load()).workspace, now);
    if (!panel) throw new DbError("unavailable");
    const blocked = availabilityStatus(panel, "owner_summary");
    if (blocked) return blocked;
    const result = await requestOwnerCallNow(service, createTwilioCaller(config), farmId, { baseUrl: config.baseUrl, now, allowlist: config.allowlist });
    if (result.status === "placed") return "placed";
    if (result.status === "blocked") {
      if (result.reason === "call_live") return "call_live";
      if (result.reason === "unavailable") return "unavailable";
      if (result.reason === "not_approved") return "not_ready:number_not_allowlisted";
      if (result.reason === "no_owner_phone") return "not_ready:no_owner_number";
      if (result.reason === "rate_limited") {
        const usage = await readTestPlacementUsage(service, farmId, scope.maxCalls);
        return usage.remainingCalls === 0 ? "cap_reached" : "not_ready:call_not_placed";
      }
      return "not_ready:call_not_placed";
    }
    return "not_ready:call_not_placed";
  });
}

async function testWorkerStage(purpose: "instruction" | "task_verification"): Promise<ActionResult<TestCallStatus>> {
  const scope = testCallScope();
  if (scope.kind !== "ranch") return { ok: false, error: "unavailable" };
  if (!callNowReady()) return { ok: true, data: manualCallsEnabled() ? "not_ready:not_configured" : "not_ready:manual_calls_off" };
  return asOwner(async (r) => {
    const farmId = await r.callingFarmId();
    if (farmId !== scope.farmId) throw new DbError("unavailable");
    const service = createServiceClient();
    const config = outboundConfig();
    if (!service || !config) return "not_ready:not_configured";
    return placeManualWorkerCall(service, createTwilioCaller(config), farmId, purpose, { baseUrl: config.baseUrl, now: new Date() });
  });
}

/** Place the pending owner-confirmed instruction call now, one attempt. */
export async function testCallWorkerInstructionNow(): Promise<ActionResult<TestCallStatus>> {
  return testWorkerStage("instruction");
}

/** Ask about the open ticket now, even if its saved verification time is later. */
export async function testCallWorkerVerificationNow(): Promise<ActionResult<TestCallStatus>> {
  return testWorkerStage("task_verification");
}

/**
 * LOCAL DEMO ONLY: NAQAH calls the signed-in owner now with the briefing («العامل / المالك» on the Dashboard). Its own
 * path beside callWorkerNow. Off unless the local runner set NAQAH_DEMO_OWNER_CALL=1 (never on Vercel), real calls
 * are fully configured, and the farm is the presentation ranch. The number is the farm's own saved owner number,
 * and it must be approved on this computer; nothing in the request chooses who is called.
 */
export async function callOwnerNow(): Promise<ActionResult<OwnerCallNowResult>> {
  if (!demoOwnerCallNowEnabled() || !callNowReady()) return { ok: false, error: "unavailable" };
  return asOwner(async (r) => {
    const farmId = await ownerCallingFarm(r); // Proves the session owns this farm, under RLS.
    if (!demoOwnerCallNow(farmId)) throw new DbError("unavailable");
    const service = createServiceClient();
    const config = outboundConfig();
    if (!service || !config) throw new DbError("unavailable");
    return requestOwnerCallNow(service, createTwilioCaller(config), farmId, { baseUrl: config.baseUrl, now: new Date(), allowlist: config.allowlist });
  });
}
