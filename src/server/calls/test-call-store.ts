import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { runFarmAction } from "@/server/db/service-repository";
import type { TestCallFailure, TestCallResult, TestCallStatus, TestCallView } from "./test-call-api";

export const ACTIVE_TEST_CALLS: TestCallStatus[] = ["calling", "ringing", "connected"];
export const TEST_CALL_COLUMNS = "id,request_id,actor_id,farm_id,run_id,destination_masked,status,result,failure,report_saved,created_at,ended_at";
export interface TestCallRow {
  id: string;
  request_id: string;
  actor_id: string;
  farm_id: string;
  run_id: string | null;
  destination_masked: string;
  status: TestCallStatus;
  result: TestCallResult | null;
  failure: TestCallFailure | null;
  report_saved: boolean;
  created_at: string;
  ended_at: string | null;
}

export function requireTestCallData<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw new Error("Test call storage unavailable");
  return data;
}

export async function isTestRanch(client: SupabaseClient, farmId: string): Promise<boolean> {
  return Boolean(requireTestCallData(await client.from("test_call_ranches").select("farm_id").eq("farm_id", farmId).maybeSingle()));
}

export async function testCallView(client: SupabaseClient, row: TestCallRow): Promise<TestCallView> {
  const run = row.run_id ? requireTestCallData(await client.from("report_call_runs").select("report_id").eq("id", row.run_id).eq("farm_id", row.farm_id).maybeSingle()) : null;
  const reportSaved = row.run_id ? Boolean(run?.report_id) : row.report_saved;
  return {
    id: row.id, status: row.status, destination: row.destination_masked,
    startedAt: new Date(row.created_at).toISOString(), endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    result: row.status === "completed" ? (reportSaved ? "report_saved" : "no_report") : row.result,
    failure: row.failure, reportSaved,
  };
}

export async function closeTestCallRun(client: SupabaseClient, farmId: string, runId: string | null): Promise<void> {
  if (!runId) return;
  await runFarmAction(client, farmId, (workspace) => {
    const run = workspace.reportCalls?.find((entry) => entry.id === runId);
    if (!run || (run.state !== "calling" && run.state !== "answered")) return { ws: workspace, result: null };
    const ws = structuredClone(workspace);
    const closed = ws.reportCalls!.find((entry) => entry.id === runId)!;
    closed.state = closed.reportId ? "completed" : "missed";
    closed.nextAttemptAt = null;
    for (const attempt of closed.attempts) if (attempt.result === "pending") attempt.result = "no_answer";
    return { ws, result: null };
  });
}

export async function expireTestCalls(client: SupabaseClient, now: Date, actorId?: string): Promise<void> {
  const cutoff = new Date(now.getTime() - 15 * 60_000).toISOString();
  let query = client.from("test_calls").select(TEST_CALL_COLUMNS).in("status", ACTIVE_TEST_CALLS).lt("created_at", cutoff);
  if (actorId) query = query.eq("actor_id", actorId);
  const rows = requireTestCallData(await query) as TestCallRow[];
  for (const row of rows) {
    await closeTestCallRun(client, row.farm_id, row.run_id);
    const view = await testCallView(client, row);
    requireTestCallData(await client.from("test_calls").update({
      status: "failed", result: "timed_out", report_saved: view.reportSaved,
      updated_at: now.toISOString(), ended_at: now.toISOString(),
    }).eq("id", row.id).in("status", ACTIVE_TEST_CALLS));
  }
}

export function testCallProgress(status: string): { status: TestCallStatus; result: TestCallResult | null; from: TestCallStatus[] } | null {
  if (status === "ringing") return { status: "ringing", result: null, from: ["calling"] };
  if (status === "in-progress" || status === "answered") return { status: "connected", result: null, from: ["calling", "ringing"] };
  if (status === "completed") return { status: "completed", result: "no_report", from: ACTIVE_TEST_CALLS };
  const finals = { "no-answer": "no_answer", busy: "busy", failed: "failed", canceled: "canceled" } as const;
  const result = Object.hasOwn(finals, status) ? finals[status as keyof typeof finals] : null;
  return result ? { status: "failed", result, from: ACTIVE_TEST_CALLS } : null;
}

export async function recordTestCallProgress(client: SupabaseClient, runId: string, farmId: string, status: string, now: Date): Promise<void> {
  const progress = testCallProgress(status);
  if (!progress) return;
  const row = requireTestCallData(await client.from("test_calls").select(TEST_CALL_COLUMNS).eq("run_id", runId).eq("farm_id", farmId).maybeSingle()) as TestCallRow | null;
  if (!row) return;
  const final = progress.status === "completed" || progress.status === "failed";
  if (final) await closeTestCallRun(client, row.farm_id, row.run_id);
  const view = await testCallView(client, row);
  requireTestCallData(await client.from("test_calls").update({
    status: progress.status,
    result: progress.status === "completed" && view.reportSaved ? "report_saved" : progress.result,
    report_saved: view.reportSaved, updated_at: now.toISOString(),
    ...(final ? { ended_at: now.toISOString() } : {}),
  }).eq("id", row.id).in("status", progress.from));
}
