import { execFileSync } from "node:child_process";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadFarm } from "@/server/db/queries";
import { dueReportCallAttempts, reportCallBlock } from "@/domain/reportCalls";
import { applyVoiceEvent, parseVoiceEvent } from "@/server/voice/contract";
import { dialDueOwnerCall } from "./owner-call";
import { requestReportCallNow } from "./scheduler";
import { recordingCaller, type OutboundCallResult } from "./twilio";
import { latestTestCall, startTestCall, testCallReadiness } from "./test-call";
import { closeTestCallRun, expireTestCalls, recordTestCallProgress, testCallView, type TestCallRow } from "./test-call-store";

const limiter = vi.hoisted(() => ({ reserve: vi.fn(), releases: [] as ReturnType<typeof vi.fn>[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/rate-limit", () => ({ reserveRateLimit: limiter.reserve }));

const database = process.env.NAQAH_TEST_DB;
const rest = process.env.NAQAH_TEST_POSTGREST;
const gateway = "http://127.0.0.1:54912";
const local = database === "naqah_testcall" && rest === "http://127.0.0.1:54911" && process.env.PGHOST === "127.0.0.1" && process.env.PGPORT === "54910";
const now = new Date("2026-11-09T12:00:00Z");
const phone = "+966501234567";
const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
function sql(query: string): string {
  if (!local) throw new Error("Only the disposable test-call database is allowed");
  return execFileSync("psql", ["-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-d", database!], { input: query, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim();
}
function jwt(role: string, sub?: string) {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString("base64url");
  const body = `${part({ alg: "HS256", typ: "JWT" })}.${part({ role, sub, exp: 4102444800 })}`;
  return `${body}.${createHmac("sha256", "local-only-jwt-secret-for-live-stack-validation").update(body).digest("base64url")}`;
}
function seed(marked = true) {
  const actorId = randomUUID();
  const farmId = randomUUID();
  sql(`insert into auth.users values (${quote(actorId)});
    insert into farms (id, owner_id, plan, setup_complete, owner_name, owner_phone, name, location)
    values (${quote(farmId)}, ${quote(actorId)}, 'ultimate', true, 'Owner', '+966511111111', 'Test ranch', 'Qassim');
    insert into workers (farm_id, name, phone, language) values (${quote(farmId)}, 'Worker', '+966522222222', 'en');
    ${marked ? `insert into test_call_ranches (farm_id) values (${quote(farmId)});` : ""}`);
  return { actorId, farmId };
}
function audit(farm: ReturnType<typeof seed>, status = "calling", created = now.toISOString()) {
  return sql(`insert into test_calls (request_id, actor_id, farm_id, destination_masked, charge_confirmed, consent_confirmed, status, created_at)
    values (${quote(randomUUID())}, ${quote(farm.actorId)}, ${quote(farm.farmId)}, '+9665******67', true, true, ${quote(status)}, ${quote(created)}) returning id`);
}
function run(farmId: string, state = "calling", reportId: string | null = null) {
  return sql(`insert into report_call_runs (farm_id, occurrence, trigger, state, next_attempt_at, report_id)
    values (${quote(farmId)}, ${quote(now.toISOString())}, 'manual', ${quote(state)}, ${quote(now.toISOString())}, ${reportId ? quote(reportId) : "null"}) returning id`);
}
function rawCall(id: string): TestCallRow {
  return JSON.parse(sql(`select row_to_json(t) from test_calls t where id = ${quote(id)}`));
}

describe.skipIf(!local)("test calls on disposable PostgreSQL + PostgREST", () => {
  let client: SupabaseClient;
  beforeEach(() => {
    sql("delete from test_calls; delete from farms; delete from auth.users;");
    client = createClient(gateway, jwt("service_role"), { auth: { persistSession: false, autoRefreshToken: false } });
    const fetchLocal = globalThis.fetch;
    vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (!url.startsWith(`${gateway}/`)) throw new Error("External network forbidden in test-call validation");
      return fetchLocal(input, init);
    });
    for (const [name, value] of Object.entries({
      NAQAH_TEST_CALLS: "1", NAQAH_TEST_CALL_ADMINS: "", NAQAH_CALL_ALLOWLIST: phone,
      NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_ENGINE: "realtime", NAQAH_BRIDGE_PUBLIC_URL: "wss://bridge.test/voice",
      NAQAH_PUBLIC_BASE_URL: "https://naqah.test", NAQAH_VOICE_SECRET: "local-only-voice-secret-32-characters",
      TWILIO_ACCOUNT_SID: "fake-account", TWILIO_AUTH_TOKEN: "fake-token", TWILIO_PHONE_NUMBER: "+15550123456",
      NEXT_PUBLIC_SUPABASE_URL: gateway, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "local-only-public", SUPABASE_SECRET_KEY: "local-only-service",
      NAQAH_CALL_OWNER: "1", NAQAH_MANUAL_REPORT_CALLS: "", NAQAH_SCHEDULED_CALLS: "",
    })) vi.stubEnv(name, value);
    limiter.releases = [];
    limiter.reserve.mockReset().mockImplementation(async () => {
      const release = vi.fn(async () => {});
      limiter.releases.push(release);
      return { release };
    });
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

  it("enforces one global active call in PostgreSQL, including across actors", async () => {
    const first = seed();
    const second = seed();
    const results = await Promise.all([first, second].map((farm) => client.from("test_calls").insert({
      request_id: randomUUID(), actor_id: farm.actorId, farm_id: farm.farmId, destination_masked: "+9665******67",
      charge_confirmed: true, consent_confirmed: true, status: "calling",
    })));
    expect(results.filter((result) => !result.error)).toHaveLength(1);
    expect(results.find((result) => result.error)?.error?.code).toBe("23505");
    expect(sql("select count(*) from test_calls")).toBe("1");
  });

  it("enables RLS without owner policies and grants only service_role", async () => {
    const farm = seed();
    audit(farm);
    expect(sql("select count(*) from pg_class where relname in ('test_calls','test_call_ranches') and relrowsecurity")).toBe("2");
    expect(sql("select count(*) from pg_policies where tablename in ('test_calls','test_call_ranches')")).toBe("0");
    for (const role of ["anon", "authenticated"]) {
      const ownerClient = createClient(gateway, jwt(role, farm.actorId), { auth: { persistSession: false } });
      for (const table of ["test_calls", "test_call_ranches"]) expect((await ownerClient.from(table).select("*")).error?.code).toBe("42501");
      expect((await ownerClient.rpc("reset_test_call_ranch", { p_test_call_id: randomUUID() })).error?.code).toBe("42501");
    }
    expect((await client.from("test_calls").select("id")).data).toHaveLength(1);
    expect(sql("select has_table_privilege('authenticated', 'test_calls', 'insert')")).toBe("f");
    expect(sql("select has_table_privilege('anon', 'test_call_ranches', 'insert')")).toBe("f");
  });

  it("clears only a marked owned ranch, cascades report details, and preserves the audit", async () => {
    const marked = seed();
    const other = seed(false);
    const priorReport = sql(`insert into reports (farm_id) values (${quote(marked.farmId)}) returning id`);
    const otherReport = sql(`insert into reports (farm_id) values (${quote(other.farmId)}) returning id`);
    const priorRun = run(marked.farmId, "completed", priorReport);
    run(other.farmId, "completed", otherReport);
    const history = audit(marked, "completed");
    sql(`update test_calls set run_id = ${quote(priorRun)} where id = ${quote(history)};
      update farms set last_update_at = now() where id in (${quote(marked.farmId)}, ${quote(other.farmId)});
      insert into report_answers (report_id,question_id,question_ar,question_en,answer,certainty) values (${quote(priorReport)},'test','سؤال','Question','Yes','reported');
      insert into findings (report_id,text_ar,text_en) values (${quote(priorReport)},'نتيجة','Finding');`);
    const before = sql(`select row_to_json(f) from farms f where id = ${quote(other.farmId)}`);
    const current = audit(marked);
    expect((await client.rpc("reset_test_call_ranch", { p_test_call_id: current })).error).toBeNull();
    expect(sql(`select count(*) from reports where farm_id = ${quote(marked.farmId)}`)).toBe("0");
    expect(sql(`select count(*) from report_call_runs where farm_id = ${quote(marked.farmId)}`)).toBe("0");
    expect(sql(`select count(*) from report_answers where report_id = ${quote(priorReport)}`)).toBe("0");
    expect(sql(`select count(*) from findings where report_id = ${quote(priorReport)}`)).toBe("0");
    expect(sql(`select last_update_at is null from farms where id = ${quote(marked.farmId)}`)).toBe("t");
    expect(rawCall(history)).toMatchObject({ run_id: null, report_saved: true });
    expect((await testCallView(client, rawCall(history))).reportSaved).toBe(true);
    expect(sql(`select row_to_json(f) from farms f where id = ${quote(other.farmId)}`)).toBe(before);
    expect(sql(`select count(*) from reports where farm_id = ${quote(other.farmId)}`)).toBe("1");
    expect(sql(`select count(*) from report_call_runs where farm_id = ${quote(other.farmId)}`)).toBe("1");
  });

  it("refuses unmarked farms and cannot clear someone else's ranch", async () => {
    const own = seed(false);
    const other = seed();
    const otherRun = run(other.farmId);
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, own.actorId, { phone, requestId: randomUUID() }, { caller, now })).toEqual({ ok: false, error: "no_test_ranch" });
    expect(requests).toHaveLength(0);
    const unmarked = audit(own);
    expect((await client.rpc("reset_test_call_ranch", { p_test_call_id: unmarked })).error?.code).toBe("42501");
    sql(`update test_calls set farm_id = ${quote(other.farmId)} where id = ${quote(unmarked)}`);
    expect((await client.rpc("reset_test_call_ranch", { p_test_call_id: unmarked })).error?.code).toBe("42501");
    expect(sql(`select count(*) from report_call_runs where id = ${quote(otherRun)}`)).toBe("1");
  });

  it.each(["", " ", "not-a-phone"])("fails closed with allowlist %s", async (allowlist) => {
    const farm = seed();
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", allowlist);
    const { caller, requests } = recordingCaller();
    expect((await testCallReadiness(client, farm.actorId)).blockers).toContain("no_allowlist");
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toEqual({ ok: false, error: "number_not_allowed" });
    expect(requests).toHaveLength(0);
    expect(sql("select count(*) from test_calls")).toBe("0");
  });

  it("refuses an unmarked actor without even expiring another ranch's stale call", async () => {
    const own = seed(false);
    const other = seed();
    const activeId = audit(other, "calling", "2020-01-01T00:00:00Z");
    const runId = run(other.farmId);
    sql(`update test_calls set run_id = ${quote(runId)} where id = ${quote(activeId)}`);
    const before = rawCall(activeId);
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, own.actorId, { phone, requestId: randomUUID() }, { caller, now })).toEqual({ ok: false, error: "no_test_ranch" });
    expect(await latestTestCall(client, own.actorId)).toBeNull();
    expect(rawCall(activeId)).toEqual(before);
    expect(sql(`select state from report_call_runs where id = ${quote(runId)}`)).toBe("calling");
    expect(requests).toHaveLength(0);
  });

  it.each(["NAQAH_VOICE_MODE", "NAQAH_VOICE_ENGINE", "NAQAH_BRIDGE_PUBLIC_URL", "TWILIO_ACCOUNT_SID", "SUPABASE_SECRET_KEY"])("requires %s configuration", async (name) => {
    const farm = seed();
    vi.stubEnv(name, "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toEqual({ ok: false, error: "not_configured" });
    expect(requests).toHaveLength(0);
  });

  it("checks the requested destination, not the saved worker, against the allowlist", async () => {
    const farm = seed();
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", "+966522222222");
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toEqual({ ok: false, error: "number_not_allowed" });
    expect(requests).toHaveLength(0);
    expect(sql("select count(*) from test_calls")).toBe("0");
  });

  it("links the run before dialing, overrides only the destination, and replays a request id", async () => {
    const farm = seed();
    const requestId = randomUUID();
    const place = vi.fn(async () => {
      expect(sql(`select count(*) from test_calls where run_id is not null and farm_id = ${quote(farm.farmId)}`)).toBe("1");
      return { placed: true as const, sid: `CA${"0".repeat(32)}` };
    });
    const result = await startTestCall(client, farm.actorId, { phone, requestId }, { caller: { place }, now });
    expect(result).toMatchObject({ ok: true, call: { status: "calling", destination: "+9665******67" } });
    expect(JSON.stringify(result)).not.toContain(phone);
    expect(place).toHaveBeenCalledWith(expect.objectContaining({ to: phone, statusEvents: ["initiated", "ringing", "answered", "completed"] }));
    expect(sql(`select phone from workers where farm_id = ${quote(farm.farmId)}`)).toBe("+966522222222");
    expect(await startTestCall(client, farm.actorId, { phone, requestId }, { caller: { place }, now })).toEqual(result);
    expect(place).toHaveBeenCalledTimes(1);
    expect(limiter.reserve.mock.calls.map((call) => call.slice(1, 3))).toEqual([[3, 3600], [10, 86400], [20, 86400]]);
    expect(limiter.releases.every((release) => release.mock.calls.length === 0)).toBe(true);
    const another = seed();
    expect(await startTestCall(client, another.actorId, { phone, requestId }, { caller: { place }, now })).toEqual({ ok: false, error: "invalid_request" });
  });

  it("enforces busy atomically and releases unused rate leases", async () => {
    const farm = seed();
    audit(farm);
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toEqual({ ok: false, error: "busy" });
    expect(requests).toHaveLength(0);
    expect(limiter.releases).toHaveLength(3);
    expect(limiter.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it("uses the requested number even when the saved worker phone is empty", async () => {
    const farm = seed();
    sql(`update workers set phone = '' where farm_id = ${quote(farm.farmId)}`);
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toMatchObject({ ok: true, call: { status: "calling" } });
    expect(requests[0].to).toBe(phone);
    expect(sql(`select phone = '' from workers where farm_id = ${quote(farm.farmId)}`)).toBe("t");
  });

  it.each(["calling", "answered"])("clears an old %s run only in the marked ranch", async (state) => {
    const farm = seed();
    run(farm.farmId, state);
    const other = seed(false);
    const untouched = run(other.farmId, state);
    const { caller } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toMatchObject({ ok: true, call: { status: "calling" } });
    expect(sql(`select count(*) from report_call_runs where farm_id = ${quote(farm.farmId)}`)).toBe("1");
    expect(sql(`select state from report_call_runs where id = ${quote(untouched)}`)).toBe(state);
  });

  it("concurrent identical request ids dial exactly once", async () => {
    const farm = seed();
    const requestId = randomUUID();
    const { caller, requests } = recordingCaller();
    const results = await Promise.all([1, 2].map(() => startTestCall(client, farm.actorId, { phone, requestId }, { caller, now })));
    expect(results.every((result) => result.ok)).toBe(true);
    expect(requests).toHaveLength(1);
    expect(sql("select count(*) from test_calls")).toBe("1");
  });

  it.each([0, 1, 2])("releases earlier rate leases when bucket %s refuses", async (refused) => {
    const farm = seed();
    const releases = Array.from({ length: refused }, () => vi.fn(async () => {}));
    limiter.reserve.mockReset();
    for (const release of releases) limiter.reserve.mockResolvedValueOnce({ release });
    limiter.reserve.mockResolvedValueOnce(null);
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toEqual({ ok: false, error: "rate_limited" });
    expect(releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    expect(requests).toHaveLength(0);
    expect(sql("select count(*) from test_calls")).toBe("0");
  });

  it.each([
    [{ placed: false, reason: "rejected", code: 21215 }, "saudi_calls_disabled"],
    [{ placed: false, reason: "rejected", code: 13227 }, "saudi_calls_disabled"],
    [{ placed: false, reason: "rejected", code: 21211 }, "number_rejected"],
    [{ placed: false, reason: "rejected", code: 20003 }, "provider_rejected"],
    [{ placed: false, reason: "network_error" }, "network_error"],
    [{ placed: false, reason: "not_configured" }, "not_placed"],
  ] as const)("ends failed placements with %s", async (providerResult, failure) => {
    const farm = seed();
    const { caller } = recordingCaller(() => providerResult as OutboundCallResult);
    const result = await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now });
    expect(result).toMatchObject({ ok: true, call: { status: "failed", failure, result: "failed", endedAt: now.toISOString() } });
    expect(sql("select count(*) from report_call_runs where state in ('calling','answered') or next_attempt_at is not null")).toBe("0");
    expect(limiter.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it("closes a newly opened run if audit linking fails and never dials", async () => {
    const farm = seed();
    const { caller, requests } = recordingCaller();
    await expect(requestReportCallNow(client, caller, farm.farmId, {
      baseUrl: "https://naqah.test", now, to: phone,
      onRunOpened: async (runId) => {
        await closeTestCallRun(client, farm.farmId, runId);
        throw new Error("Audit write unavailable");
      },
    })).rejects.toThrow("Audit write unavailable");
    expect(requests).toHaveLength(0);
  });

  it.each(["completed", "no-answer", "busy", "failed", "canceled"])("closes %s without any retry, even when never answered", async (status) => {
    const farm = seed();
    const { caller } = recordingCaller();
    const started = await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now });
    if (!started.ok) throw new Error("Expected placed call");
    const row = rawCall(started.call.id);
    await recordTestCallProgress(client, row.run_id!, farm.farmId, status, now);
    const workspace = (await loadFarm(client, { id: farm.farmId }))!.workspace;
    expect(dueReportCallAttempts(workspace, new Date(now.getTime() + 20 * 60_000))).toEqual([]);
    expect(workspace.reportCalls![0]).toMatchObject({ state: "missed", nextAttemptAt: null });
    const finished = rawCall(row.id);
    expect(finished.status).toBe(status === "completed" ? "completed" : "failed");
    expect(finished.ended_at).not.toBeNull();
    await recordTestCallProgress(client, row.run_id!, farm.farmId, "ringing", now);
    await recordTestCallProgress(client, row.run_id!, farm.farmId, "in-progress", now);
    expect(rawCall(row.id)).toEqual(finished);
  });

  it("progress never regresses and report truth is linked to the run", async () => {
    const farm = seed();
    const id = audit(farm);
    const runId = run(farm.farmId);
    sql(`update test_calls set run_id = ${quote(runId)}, report_saved = true where id = ${quote(id)}`);
    expect((await testCallView(client, rawCall(id))).reportSaved).toBe(false);
    await recordTestCallProgress(client, runId, farm.farmId, "in-progress", now);
    await recordTestCallProgress(client, runId, farm.farmId, "ringing", now);
    expect(rawCall(id).status).toBe("connected");
    const reportId = sql(`insert into reports (farm_id) values (${quote(farm.farmId)}) returning id`);
    sql(`update report_call_runs set report_id = ${quote(reportId)}, state = 'completed' where id = ${quote(runId)}`);
    await recordTestCallProgress(client, runId, farm.farmId, "completed", now);
    expect(await testCallView(client, rawCall(id))).toMatchObject({ status: "completed", reportSaved: true, result: "report_saved" });
    await recordTestCallProgress(client, runId, farm.farmId, "failed", now);
    expect(rawCall(id).status).toBe("completed");
  });

  it("no-ops for ordinary calls and never sends owner calls for test ranch reports", async () => {
    const farm = seed();
    const runId = run(farm.farmId);
    await recordTestCallProgress(client, runId, farm.farmId, "completed", now);
    expect(sql(`select state from report_call_runs where id = ${quote(runId)}`)).toBe("calling");
    const { caller, requests } = recordingCaller();
    expect(await dialDueOwnerCall(client, { farmId: farm.farmId, now }, caller)).toBeNull();
    expect(requests).toHaveLength(0);
    vi.stubEnv("NAQAH_TEST_CALLS", "");
    sql(`update report_call_runs set state = 'completed' where id = ${quote(runId)}`);
    sql(`update farms set owner_call_day = null, owner_call_time = to_char(${quote(now.toISOString())}::timestamptz at time zone 'Asia/Riyadh', 'HH24:MI')::time, plan = 'ultimate' where id = ${quote(farm.farmId)}`);
    expect(await dialDueOwnerCall(client, { farmId: farm.farmId, now }, caller)).toMatchObject({ placed: true });
    expect(requests).toHaveLength(1);
  });

  it("times out active rows and closes their runs before a new call", async () => {
    const farm = seed();
    const id = audit(farm, "connected", new Date(now.getTime() - 16 * 60_000).toISOString());
    const runId = run(farm.farmId, "answered");
    sql(`update test_calls set run_id = ${quote(runId)} where id = ${quote(id)}`);
    await expireTestCalls(client, now);
    expect(rawCall(id)).toMatchObject({ status: "failed", result: "timed_out" });
    expect(sql(`select next_attempt_at is null from report_call_runs where id = ${quote(runId)}`)).toBe("t");
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toMatchObject({ ok: true, call: { status: "calling" } });
    expect(requests).toHaveLength(1);
  });

  it("expires stuck calls when read", async () => {
    const farm = seed();
    const id = audit(farm, "ringing", "2020-01-01T00:00:00Z");
    expect(await latestTestCall(client, farm.actorId)).toMatchObject({ id, status: "failed", result: "timed_out" });
  });

  it("expires a stale global slot only for an eligible new placement", async () => {
    const own = seed();
    const other = seed();
    const staleId = audit(other, "calling", "2020-01-01T00:00:00Z");
    const oldRun = run(other.farmId);
    sql(`update test_calls set run_id = ${quote(oldRun)} where id = ${quote(staleId)}`);
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, own.actorId, { phone, requestId: randomUUID() }, { caller, now })).toMatchObject({ ok: true, call: { status: "calling" } });
    expect(rawCall(staleId)).toMatchObject({ status: "failed", result: "timed_out" });
    expect(sql(`select state from report_call_runs where id = ${quote(oldRun)}`)).toBe("missed");
    expect(requests).toHaveLength(1);
  });

  it("retests after a saved report in the same period without affecting another farm", async () => {
    const farm = seed();
    const other = seed(false);
    const reportId = sql(`insert into reports (farm_id, at) values (${quote(farm.farmId)}, ${quote(now.toISOString())}) returning id`);
    const priorRun = run(farm.farmId, "completed", reportId);
    const history = audit(farm, "completed");
    sql(`update test_calls set run_id = ${quote(priorRun)} where id = ${quote(history)}`);
    run(other.farmId);
    expect(reportCallBlock((await loadFarm(client, { id: farm.farmId }))!.workspace, now)).toBe("already_reported");
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now })).toMatchObject({ ok: true, call: { status: "calling" } });
    expect(requests).toHaveLength(1);
    expect(sql(`select count(*) from report_call_runs where farm_id = ${quote(other.farmId)} and state = 'calling'`)).toBe("1");
    expect(rawCall(history)).toMatchObject({ report_saved: true, run_id: null });
  });

  it("saves two real voice-contract reports in the same period on separate test runs", async () => {
    const farm = seed();
    const { caller } = recordingCaller();
    for (const attempt of [1, 2]) {
      const started = await startTestCall(client, farm.actorId, { phone, requestId: randomUUID() }, { caller, now });
      if (!started.ok) throw new Error("Expected test call");
      const row = rawCall(started.call.id);
      const providerCallId = `CA${String(attempt).padStart(32, "0")}`;
      const base = { version: 1, providerCallId, reportCallId: row.run_id };
      expect(await applyVoiceEvent(client, farm.farmId, { party: "system" }, parseVoiceEvent({
        ...base, eventId: `${providerCallId}:answered`, type: "report_call_attempt", attempt: 1, answered: true,
      }), now)).toMatchObject({ status: "saved" });
      expect(await applyVoiceEvent(client, farm.farmId, { party: "worker" }, parseVoiceEvent({
        ...base, eventId: `${providerCallId}:report`, type: "worker_report",
        draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] },
      }), now)).toMatchObject({ status: "saved" });
      await recordTestCallProgress(client, row.run_id!, farm.farmId, "completed", now);
      expect(await testCallView(client, rawCall(row.id))).toMatchObject({ reportSaved: true, result: "report_saved" });
      expect(sql(`select count(*) from reports where farm_id = ${quote(farm.farmId)}`)).toBe("1");
    }
    expect(sql(`select count(*) from test_calls where farm_id = ${quote(farm.farmId)}`)).toBe("2");
  });
});
