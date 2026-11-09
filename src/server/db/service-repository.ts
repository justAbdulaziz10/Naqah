import type { SupabaseClient } from "@supabase/supabase-js";
import type { Workspace } from "@/domain/types";
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
  const phone = normalizePhone(rawPhone);
  if (!phone) return { kind: "unknown" };
  const [workers, owners] = await Promise.all([
    client.from("workers").select("farm_id").eq("phone", phone).limit(2),
    client.from("farms").select("id").eq("owner_phone", phone).limit(2),
  ]);
  if (workers.error) throw fromPostgrest(workers.error);
  if (owners.error) throw fromPostgrest(owners.error);
  const matches: Caller[] = [
    ...(workers.data ?? []).map((row) => ({ kind: "worker" as const, farmId: row.farm_id as string })),
    ...(owners.data ?? []).map((row) => ({ kind: "owner" as const, farmId: row.id as string })),
  ];
  return matches.length === 1 ? matches[0] : { kind: "unknown" };
}

/**
 * Farms the report-call scheduler should look at: set up with a call time, or with a report call
 * still ringing or waiting for a retry. The domain decides what is actually due (reportCalls.ts).
 */
export async function listScheduledFarmIds(client: SupabaseClient): Promise<string[]> {
  const [scheduled, active, summaries, workerCalls] = await Promise.all([
    client.from("farms").select("id").eq("setup_complete", true).not("call_time", "is", null).limit(5000),
    client.from("report_call_runs").select("farm_id").in("state", ["calling", "answered"]).limit(5000),
    client.from("farms").select("id").not("owner_summary_not_before", "is", null).limit(5000),
    client.from("pending_worker_calls").select("farm_id").eq("state", "pending").limit(5000),
  ]);
  if (scheduled.error) throw fromPostgrest(scheduled.error);
  if (active.error) throw fromPostgrest(active.error);
  if (summaries.error) throw fromPostgrest(summaries.error);
  if (workerCalls.error) throw fromPostgrest(workerCalls.error);
  return [...new Set([
    ...(scheduled.data ?? []).map((row) => row.id as string),
    ...(active.data ?? []).map((row) => row.farm_id as string),
    ...(summaries.data ?? []).map((row) => row.id as string),
    ...(workerCalls.data ?? []).map((row) => row.farm_id as string),
  ])];
}

/** The report-call run a provider call belongs to, so a status callback never trusts caller ID. */
export async function findReportCallRun(client: SupabaseClient, providerCallId: string): Promise<{ farmId: string; runId: string } | null> {
  if (!providerCallId || providerCallId.length > 128) return null;
  const { data, error } = await client.from("report_call_runs").select("id, farm_id").eq("provider_call_id", providerCallId).limit(2);
  if (error) throw fromPostgrest(error);
  return data && data.length === 1 ? { farmId: data[0].farm_id as string, runId: data[0].id as string } : null;
}

export type FarmActionResult<T> = { status: "saved" | "unchanged" | "replayed"; result: T };

export async function recordedOutcome<T>(client: SupabaseClient, farmId: string, eventId: string): Promise<T | null> {
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
