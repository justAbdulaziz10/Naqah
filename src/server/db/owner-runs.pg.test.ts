import { execFileSync } from "node:child_process";
import { beforeAll, describe, expect, it } from "vitest";
import { completeWorkerReport } from "@/domain/actions";
import { abandonOwnerCallAttempt, claimDueOwnerCall, markOwnerCallAnswered, resolveOwnerCallAttempt } from "@/domain/ownerCalls";
import { createEmptyWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { diffWorkspace } from "./diff";
import { workspaceFromRows } from "./mappers";
import type { FarmRows } from "./rows";

/** LOCAL ONLY. Real migrations on a throwaway Postgres: supabase/local-validation/run-owner-runs.sh. */
const database = process.env.NAQAH_TEST_DB;
const enabled = database === "naqah_owner_runs_local";
const owner = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const other = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const slot = new Date("2026-11-12T15:00:00.000Z"); // Thursday 18:00 Riyadh
const at = (minutes: number) => new Date(slot.getTime() + minutes * 60_000);

function sql(query: string): string {
  if (!enabled || process.env.PGHOST !== "127.0.0.1" || process.env.PGPORT !== "54500") throw new Error("Only the isolated owner-runs database on port 54500 is allowed");
  return execFileSync("/opt/homebrew/opt/postgresql@17/bin/psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database!], {
    input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}
const json = <T>(query: string): T => JSON.parse(sql(query) || "null") as T;
const list = <T>(table: string, farmId: string) => json<T[]>(`select coalesce(json_agg(t), '[]') from ${table} t where farm_id = '${farmId}'`);

function load(farmId: string): { revision: number; workspace: Workspace } {
  const farm = json<FarmRows["farm"]>(`select row_to_json(f) from farms f where id = '${farmId}'`);
  const reports = json<FarmRows["reports"]>(`select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object(
      'report_answers', (select coalesce(json_agg(a), '[]') from report_answers a where a.report_id = r.id),
      'findings', (select coalesce(json_agg(f), '[]') from findings f where f.report_id = r.id))), '[]')
    from reports r where r.farm_id = '${farmId}'`);
  return {
    revision: farm.revision,
    workspace: workspaceFromRows({
      farm, reports,
      workers: list("workers", farmId), camels: list("camels", farmId), resources: list("resources", farmId), customQuestions: [],
      criteria: list("criteria", farmId), emergencies: [], calls: list("calls", farmId), taskTickets: [], noAnswerTickets: [],
      pendingWorkerCalls: [], reportCallRuns: list("report_call_runs", farmId), relays: [], events: list("events", farmId),
    }),
  };
}

function save(farmId: string, before: Workspace, revision: number, next: Workspace) {
  const changes = JSON.stringify(diffWorkspace(before, next, farmId)).replaceAll("'", "''");
  sql(`set role service_role; select apply_farm_changes('${farmId}', ${revision}, '${changes}'::jsonb)`);
}

function step(farmId: string, action: (ws: Workspace) => Workspace): Workspace {
  const { revision, workspace } = load(farmId);
  save(farmId, workspace, revision, action(workspace));
  return load(farmId).workspace;
}

function seed(id: string, plan: "basic" | "ultimate" = "ultimate") {
  sql(`insert into auth.users values ('${id}') on conflict do nothing;
    insert into farms (id, owner_id, plan, setup_complete, owner_name, owner_phone, name, location, owner_call_day, owner_call_time)
    values ('${id}', '${id}', '${plan}', true, 'Abdullah', '+966550123344', 'Al Nakheel', 'Qassim', ${plan === "basic" ? 4 : "null"}, '18:00');
    insert into workers (farm_id, name, phone, language) values ('${id}', 'Ahmed', '+966501234567', 'ar');`);
  return id;
}

describe.skipIf(!enabled)("owner call runs through the real schema", () => {
  let farmId: string;
  let runId: string;

  beforeAll(() => {
    farmId = seed(owner);
    seed(other);
  });

  it("loads an empty column as null, distinct from a column that isn't there", () => {
    expect(load(farmId).workspace.ownerCallRun).toBeNull();
    expect(createEmptyWorkspace("basic").ownerCallRun).toBeUndefined();
  });

  it("saves a claim and reloads it, with a database run id", () => {
    const ws = step(farmId, (current) => claimDueOwnerCall(current, slot).ws);
    expect(ws.ownerCallRun).toMatchObject({ occurrence: slot.toISOString(), reportId: null, state: "calling", nextAttemptAt: null, attempts: [{ at: slot.toISOString(), result: "pending" }] });
    runId = ws.ownerCallRun!.id;
    expect(runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(claimDueOwnerCall(ws, at(1)).claim).toBeNull();
  });

  it("round-trips answered, unanswered, a refusal, a retry and a completion", () => {
    let ws = step(farmId, (current) => markOwnerCallAnswered(current, at(0), runId));
    expect(ws.ownerCallRun!.state).toBe("answered");
    ws = step(farmId, (current) => resolveOwnerCallAttempt(current, at(1), runId, 1, "interrupted"));
    expect(ws.ownerCallRun).toMatchObject({ state: "calling", nextAttemptAt: at(21).toISOString() });
    expect(ws.ownerCallRun!.attempts[0].result).toBe("interrupted");

    ws = step(farmId, (current) => claimDueOwnerCall(current, at(21)).ws);
    expect(ws.ownerCallRun!.attempts).toHaveLength(2);
    ws = step(farmId, (current) => abandonOwnerCallAttempt(current, at(21), runId, 2));
    expect(ws.ownerCallRun).toMatchObject({ nextAttemptAt: at(41).toISOString() });
    expect(ws.ownerCallRun!.attempts).toHaveLength(1);

    ws = step(farmId, (current) => claimDueOwnerCall(current, at(41)).ws);
    ws = step(farmId, (current) => resolveOwnerCallAttempt(current, at(42), runId, 2, "completed"));
    expect(ws.ownerCallRun).toMatchObject({ state: "completed", nextAttemptAt: null });
    expect(ws.calls.filter((call) => call.kind === "owner_notification")).toEqual([expect.objectContaining({ outcome: "completed", reportId: null })]);
  });

  it("links a summarized report, and later attempts see what was heard", () => {
    const draft = { mode: "open" as const, coverage: [{ questionId: "water_level", status: "not_reported" as const }], answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] };
    const tomorrow = new Date(slot.getTime() + 24 * 60 * 60_000);
    let ws = step(farmId, (current) => completeWorkerReport(current, new Date(tomorrow.getTime() - 3_600_000), draft).ws);
    const reportId = ws.reports[0].id;
    // 20261109182526 lost this write: it is restored by the owner-runs wrapper.
    expect(ws.reports[0]).toMatchObject({ mode: "open", coverage: draft.coverage });

    ws = step(farmId, (current) => claimDueOwnerCall(current, tomorrow).ws);
    expect(ws.ownerCallRun).toMatchObject({ reportId });
    const id = ws.ownerCallRun!.id;
    expect(id).not.toBe(runId);
    ws = step(farmId, (current) => resolveOwnerCallAttempt(current, tomorrow, id, 1, "completed"));
    const next = new Date(tomorrow.getTime() + 24 * 60 * 60_000);
    expect(claimDueOwnerCall(ws, next).claim).toMatchObject({ reportId: null });
  });

  it("keeps a run an older application didn't send", () => {
    const before = sql(`select owner_call_run from farms where id = '${farmId}'`);
    const revision = load(farmId).revision;
    sql(`set role service_role; select apply_farm_changes('${farmId}', ${revision}, '{"farm":{"last_update_at":"2026-11-12T15:00:00.000Z"}}'::jsonb)`);
    expect(sql(`select owner_call_run from farms where id = '${farmId}'`)).toBe(before);
  });

  it("refuses a stale revision, so two schedulers can't both claim", () => {
    const { revision, workspace } = load(other);
    const claimed = claimDueOwnerCall(workspace, slot).ws;
    save(other, workspace, revision, claimed);
    expect(() => save(other, workspace, revision, claimed)).toThrow();
  });

  it("only accepts an object", () => {
    expect(() => sql(`update farms set owner_call_run = '[]' where id = '${farmId}'`)).toThrow();
  });

  it("is read-only to the owner, and private to their farm", () => {
    const own = `set role authenticated; set request.jwt.claim.sub = '${owner}';`;
    expect(sql(`${own} select owner_call_run ->> 'state' from farms where id = '${owner}'`)).toBe("completed");
    expect(sql(`${own} select count(*) from farms where id = '${other}'`)).toBe("0");
    expect(() => sql(`${own} update farms set owner_call_run = '{}' where id = '${owner}'`)).toThrow();
    expect(() => sql(`set role anon; select owner_call_run from farms`)).toThrow();
    expect(sql(`select has_function_privilege('authenticated', 'public.apply_farm_changes(uuid,bigint,jsonb,text,jsonb)', 'execute')`)).toBe("f");
  });
});
