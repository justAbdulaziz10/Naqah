import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "@/domain/types";
import { callingFarmAllowed, requireCallingFarm, testCallScope, verifyCallingOwner } from "@/server/test-ranch";
import { normalizePhone } from "@/server/farm/input";
import { diffWorkspace, hasChanges } from "./diff";
import { DbError, fromPostgrest } from "./errors";
import { loadFarm, requireFarm } from "./queries";

const MAX_ATTEMPTS = 3;

export type Caller = { kind: "worker" | "owner"; farmId: string } | { kind: "unknown" };

/**
 * Caller ID is an identification signal, not proof. A number that matches more than one farm
 * is treated as unknown: guessing could write one farm's update into another.
 */
export async function findCaller(client: SupabaseClient, rawPhone: string): Promise<Caller> {
  const scope = testCallScope();
  if (scope.kind === "invalid") return { kind: "unknown" };
  const phone = normalizePhone(rawPhone);
  if (!phone) return { kind: "unknown" };
  let byWorker = client.from("workers").select("farm_id").eq("phone", phone);
  let byOwner = client.from("farms").select("id").eq("owner_phone", phone);
  if (scope.kind === "ranch") {
    if (!scope.allowlist.includes(phone) || !await verifyCallingOwner(client, scope.farmId)) return { kind: "unknown" };
    byWorker = byWorker.eq("farm_id", scope.farmId);
    byOwner = byOwner.eq("id", scope.farmId);
  }
  const [workers, owners] = await Promise.all([byWorker.limit(2), byOwner.limit(2)]);
  if (workers.error) throw fromPostgrest(workers.error);
  if (owners.error) throw fromPostgrest(owners.error);
  const matches: Caller[] = [
    ...(workers.data ?? []).map((row) => ({ kind: "worker" as const, farmId: row.farm_id as string })),
    ...(owners.data ?? []).map((row) => ({ kind: "owner" as const, farmId: row.id as string })),
  ];
  if (matches.length !== 1) return { kind: "unknown" };
  const match = matches[0];
  // A matching worker number must still be unambiguous across ranches. Only check for
  // a collision after finding the test worker, and read just the count for that number.
  if (scope.kind === "ranch" && match.kind === "worker") {
    const duplicates = await Promise.all([
      client.from("workers").select("farm_id", { head: true, count: "exact" }).eq("phone", phone).neq("farm_id", scope.farmId),
      client.from("farms").select("id", { head: true, count: "exact" }).eq("owner_phone", phone).neq("id", scope.farmId),
    ]);
    for (const duplicate of duplicates) {
      if (duplicate.error) throw fromPostgrest(duplicate.error);
      if (duplicate.count !== 0) return { kind: "unknown" };
    }
  }
  return match;
}

const UNDEFINED_COLUMN = "42703";

/**
 * Farms the report-call scheduler should look at: set up with a worker or owner call time, or with
 * a call still ringing or waiting for a retry. The domain decides what is actually due.
 */
export async function listScheduledFarmIds(client: SupabaseClient): Promise<string[]> {
  const scope = testCallScope();
  if (scope.kind !== "off") return scope.kind === "ranch" ? [scope.farmId] : [];
  const [scheduled, active, ownerScheduled, ownerRuns, workerCalls] = await Promise.all([
    client.from("farms").select("id").eq("setup_complete", true).not("call_time", "is", null).limit(5000),
    client.from("report_call_runs").select("farm_id").in("state", ["calling", "answered"]).limit(5000),
    client.from("farms").select("id").eq("setup_complete", true).not("owner_call_time", "is", null).limit(5000),
    client.from("farms").select("id").in("owner_call_run->>state", ["calling", "answered"]).limit(5000),
    client.from("pending_worker_calls").select("farm_id").eq("state", "pending").limit(5000),
  ]);
  if (scheduled.error) throw fromPostgrest(scheduled.error);
  if (active.error) throw fromPostgrest(active.error);
  if (ownerScheduled.error) throw fromPostgrest(ownerScheduled.error);
  // Before 20261110090000 the column doesn't exist, and no owner run can be live anyway.
  if (ownerRuns.error && ownerRuns.error.code !== UNDEFINED_COLUMN) throw fromPostgrest(ownerRuns.error);
  if (workerCalls.error) throw fromPostgrest(workerCalls.error);
  return [...new Set([
    ...(scheduled.data ?? []).map((row) => row.id as string),
    ...(active.data ?? []).map((row) => row.farm_id as string),
    ...(ownerScheduled.data ?? []).map((row) => row.id as string),
    ...(ownerRuns.data ?? []).map((row) => row.id as string),
    ...(workerCalls.data ?? []).map((row) => row.farm_id as string),
  ])];
}

/** Look up the signed-in owner's farm without exposing any other ranch to the service key. */
export async function callingFarmForOwner(client: SupabaseClient, ownerId: string): Promise<string | null> {
  const scope = testCallScope();
  if (scope.kind === "invalid") return null;
  let query = client.from("farms").select("id").eq("owner_id", ownerId);
  if (scope.kind === "ranch") query = query.eq("id", scope.farmId);
  const { data, error } = await query.maybeSingle();
  return !error && data && callingFarmAllowed(data.id) ? data.id : null;
}

/** The report-call run a provider call belongs to, so a status callback never trusts caller ID. */
export async function findReportCallRun(client: SupabaseClient, providerCallId: string): Promise<{ farmId: string; runId: string } | null> {
  if (!providerCallId || providerCallId.length > 128) return null;
  const scope = testCallScope();
  if (scope.kind === "invalid") return null;
  let query = client.from("report_call_runs").select("id, farm_id").eq("provider_call_id", providerCallId);
  if (scope.kind === "ranch") query = query.eq("farm_id", scope.farmId);
  const { data, error } = await query.limit(2);
  if (error) throw fromPostgrest(error);
  return data && data.length === 1 ? { farmId: data[0].farm_id as string, runId: data[0].id as string } : null;
}

/** Preserve wrong-SID rejection without loading another ranch's run. */
export async function reportCallBoundOutsideTestRanch(client: SupabaseClient, providerCallId: string, farmId: string): Promise<boolean> {
  const scope = testCallScope();
  if (scope.kind !== "ranch") return false;
  requireCallingFarm(farmId);
  const { count, error } = await client.from("report_call_runs").select("id", { head: true, count: "exact" })
    .eq("provider_call_id", providerCallId).neq("farm_id", farmId);
  if (error) throw fromPostgrest(error);
  return count !== 0;
}

export type FarmActionResult<T> = { status: "saved" | "unchanged" | "replayed"; result: T };

export async function recordedOutcome<T>(client: SupabaseClient, farmId: string, eventId: string): Promise<T | null> {
  requireCallingFarm(farmId);
  const { data, error } = await client
    .from("voice_events")
    .select("outcome")
    .eq("farm_id", farmId)
    .eq("event_id", eventId)
    .maybeSingle();
  if (error) throw fromPostgrest(error);
  return data ? (data.outcome as T) : null;
}

/**
 * The only write path for call outcomes. The action is a pure domain transition and runs
 * again on the fresh state if the farm changed meanwhile, so rules are never checked on stale
 * data. Report "saved" to a caller only when this resolves.
 */
export async function runFarmAction<T>(
  client: SupabaseClient,
  farmId: string,
  action: (ws: Workspace) => { ws: Workspace; result: T },
  options: { eventId?: string; providerCallId?: string; reportCallProviderIds?: Record<string, string> } = {},
): Promise<FarmActionResult<T>> {
  if (!await verifyCallingOwner(client, farmId)) throw new DbError("unavailable");
  const { eventId, providerCallId, reportCallProviderIds } = options;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Checked on every pass: a conflict can mean this same event was saved in the meantime.
    if (eventId) {
      const recorded = await recordedOutcome<T>(client, farmId, eventId);
      if (recorded) return { status: "replayed", result: recorded };
    }
    const { revision, workspace } = requireFarm(await loadFarm(client, { id: farmId }));
    const { ws, result } = action(workspace);
    const changes = diffWorkspace(workspace, ws, farmId, { providerCallId, reportCallProviderIds });
    const changed = hasChanges(changes);
    // An event still goes through when nothing changed: a retry must get this same answer,
    // not a new decision on whatever the farm looks like by then.
    if (!changed && !eventId) return { status: "unchanged", result };

    const { error } = await client.rpc("apply_farm_changes", {
      p_farm_id: farmId,
      p_expected_revision: revision,
      p_changes: changes,
      p_event_id: eventId ?? null,
      p_outcome: eventId ? result : null,
    });
    if (!error) return { status: changed ? "saved" : "unchanged", result };
    // 23503: an owner deleted a row this change points at. Fresh state simply leaves it out.
    if (error.code === "NQ409" || error.code === "23503") continue;
    if (error.code === "23505" && eventId) {
      // Lost the race to the same event running at once: its answer is the answer.
      const recorded = await recordedOutcome<T>(client, farmId, eventId);
      if (recorded) return { status: "replayed", result: recorded };
    }
    throw fromPostgrest(error);
  }
  throw new DbError("conflict");
}
