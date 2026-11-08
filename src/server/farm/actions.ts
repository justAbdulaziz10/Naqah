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
import { manualCallsEnabled, outboundCallMissing, outboundConfig } from "@/server/calls/config";
import { requestReportCallNow, type CallNowResult } from "@/server/calls/scheduler";
import { createTwilioCaller } from "@/server/calls/twilio";
import { createServiceClient } from "@/server/db/service-client";
import { farmVoiceMissing, voiceMode } from "@/server/env";
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
    return { ok: true, data: await withTimeout(work(createOwnerRepository(client, user.id), user.id), DB_TIMEOUT_MS) };
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
function callNowReady(): boolean {
  return manualCallsEnabled() && voiceMode() === "farm" && !farmVoiceMissing().length && !outboundCallMissing().length;
}

export async function callNowAvailable() {
  return asOwner(async () => callNowReady());
}

/**
 * One report call now, for the signed-in owner's own farm. The farm comes from the session (RLS
 * resolves it), the number from that farm's saved primary worker: nothing in the request chooses
 * who is called. Off unless NAQAH_MANUAL_REPORT_CALLS=1 and real calls are fully configured.
 */
export async function callWorkerNow(): Promise<ActionResult<CallNowResult>> {
  if (!callNowReady()) return { ok: false, error: "unavailable" };
  return asOwner(async (r) => {
    const { farmId } = await r.load(); // Proves the session owns this farm, under RLS.
    const service = createServiceClient();
    const config = outboundConfig();
    if (!service || !config) throw new DbError("unavailable");
    return requestReportCallNow(service, createTwilioCaller(config), farmId, { baseUrl: config.baseUrl, now: new Date(), allowlist: config.allowlist });
  });
}
