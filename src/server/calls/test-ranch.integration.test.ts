import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as account } from "@/app/api/account/route";
import { GET as cron } from "@/app/api/cron/report-calls/route";
import { GET as ownerNow } from "@/app/api/owner-call-now/route";
import { GET as reportNow, POST as postPreflight } from "@/app/api/report-call-now/route";
import { GET as testCall, POST as startLabCall } from "@/app/api/test-call/route";
import { POST as voiceLab } from "@/app/api/voice-lab/route";
import { POST as approveNumber } from "@/app/api/test-number/route";
import { POST as inbound } from "@/app/api/voice/inbound/route";
import { POST as reportAnswer } from "@/app/api/voice/outbound/route";
import { POST as reportStatus } from "@/app/api/voice/outbound/status/route";
import { POST as ownerAnswer } from "@/app/api/voice/owner/route";
import { POST as ownerHeard } from "@/app/api/voice/owner/heard/route";
import { POST as ownerStatus } from "@/app/api/voice/owner/status/route";
import { POST as workerAnswer } from "@/app/api/voice/worker/route";
import { POST as workerStatus } from "@/app/api/voice/worker/status/route";
import { POST as realtimeAfter } from "@/app/api/voice/realtime/after/route";
import { POST as realtimeClosed } from "@/app/api/voice/realtime/closed/route";
import { POST as realtimeSession } from "@/app/api/voice/realtime/session/route";
import { POST as realtimeTool } from "@/app/api/voice/realtime/tool/route";
import { POST as voiceStatus } from "@/app/api/voice/status/route";
import { POST as turn } from "@/app/api/voice/turn/route";
import { createOwnerRepository } from "@/server/db/owner-repository";
import { toDbId } from "@/server/db/ids";
import { loadFarm } from "@/server/db/queries";
import { listScheduledFarmIds, recordedOutcome, runFarmAction } from "@/server/db/service-repository";
import { advanceVoiceSession, createVoiceSession, readVoiceSession } from "@/server/db/voice-sessions";
import {
  callNowAvailable, callOwnerNow, callWorkerNow, ensureFarm, loadWorkspace, openAccount, retryUndelivered,
  saveOwnerEdits, selectInitialPlan, testCallsPanelState, testCallReportNow, testCallOwnerSummaryNow,
  testCallWorkerInstructionNow, testCallWorkerVerificationNow,
} from "@/server/farm/actions";
import { reserveRateLimit, resetRateLimitState } from "@/server/rate-limit";
import { markServiceClient, resetCallingOwnerCheck, verifyCallingOwner } from "@/server/test-ranch";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { OWNER_LINE_CLOSED } from "@/server/voice/farm-call";
import { bridgeSignature } from "@/server/voice/realtime/internal";
import { signRealtimeTicket } from "@/server/voice/realtime/ticket";
import { cleanStaleReportCalls, expireReportRuns } from "./reliability";
import { requestOwnerCallNow } from "./owner-call-now";
import { dialDueOwnerCall } from "./owner-call";
import { requestReportCallNow, runReportCallScheduler } from "./scheduler";
import { expireTestCalls, recordTestCallProgress } from "./test-call-store";
import { startTestCall } from "./test-call";
import { signCallToken, verifyCallToken, type CallToken } from "./token";
import { createTwilioCaller, recordingCaller } from "./twilio";

const identity = vi.hoisted(() => ({ ownerId: "", confirmed: true }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({
  getOwner: async () => ({ user: fixtureUser(identity.ownerId, identity.confirmed) }),
  createWritableClient: async () => ownerDb,
}));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: () => db }));

const ORIGIN = "https://naqah.test";
const DB_URL = "https://database.invalid";
const NOW = new Date("2026-11-12T14:00:00.000Z"); // 17:00 Riyadh
const STALE = "2026-11-11T14:00:00.000Z";
const SIGNING_KEY = "test-fixture-preview-voice-secret";
const WEBHOOK_KEY = "test-fixture-webhook-key";
const CRON_KEY = "test-fixture-cron-key";
const FARMS = [1, 2, 3, 4].map((n) => toDbId("test-ranch-fixture", String(n)));
const [TEST, ...OTHERS] = FARMS;
const ownerId = (farmId: string) => toDbId(farmId, "owner");
const fixtureEmail = (id: string) => `owner-${id}@example.test`;
const fixtureUser = (id: string, confirmed = true) => ({
  id, email: fixtureEmail(id), email_confirmed_at: confirmed ? STALE : undefined,
});
const phone = (index: number, owner = false) => `+9665${owner ? 1 : 0}99000${String(index).padStart(2, "0")}`;
const sid = (n: number) => `CA${n.toString(16).padStart(32, "0")}`;
const staleSid = (farmId: string) => sid(200 + FARMS.indexOf(farmId));
const options = { baseUrl: ORIGIN, now: NOW };

type Row = Record<string, unknown>;
type Query = { table: string; method: string; params: URLSearchParams; rows: Row[] };
let rows: Record<string, Row[]>;
let queries: Query[];
let placed: URLSearchParams[];
let providerChecks: URL[];
let db: SupabaseClient;
let ownerDb: SupabaseClient;

const inFarm = (table: string, farmId = TEST) => rows[table]?.filter((row) => row.farm_id === farmId) ?? [];
const farm = (farmId = TEST) => rows.farms.find((row) => row.id === farmId)!;
const session = (callSid: string) => rows.voice_call_sessions.find((row) => row.call_sid === callSid);
const insert = (table: string, row: Row) => (rows[table] ??= []).push(row);
const snapshotOthers = () => structuredClone(Object.fromEntries(Object.entries(rows).map(([table, entries]) => [
  table,
  entries.filter((row) => OTHERS.some((id) => row.id === id || row.farm_id === id) || row.key === "live:ranch:expired" || table === "scheduler_heartbeats"),
]).filter(([, entries]) => entries.length)));

function fixture() {
  rows = {};
  for (const [index, farmId] of FARMS.entries()) {
    insert("farms", {
      id: farmId, owner_id: ownerId(farmId), plan: "ultimate", setup_complete: true, plan_selected_at: STALE,
      name: "Fixture ranch", owner_name: "Salem", owner_phone: phone(index, true), location: "",
      latitude: null, longitude: null, supplier_name: "", supplier_phone: "", window_day: null,
      window_start: null, window_end: null, last_update_at: null, owner_allowance_used_at: null,
      missed_notification_at: null, call_day: null, call_time: "17:00:00", owner_call_day: null, owner_call_time: "17:00:00",
      owner_call_run: null, herd_count: 2, herd_count_reviewed_at: null, primary_worker_id: null,
      report_mode: "guided", created_at: STALE, revision: 1,
    });
    insert("workers", { id: toDbId(farmId, "worker"), farm_id: farmId, name: "Nasser", phone: phone(index), language: "en", created_at: STALE });
    insert("report_call_runs", {
      id: toDbId(farmId, "stale"), farm_id: farmId, occurrence: STALE, trigger: "manual", state: "answered",
      next_attempt_at: null, report_id: null, provider_call_id: staleSid(farmId), attempts: [{ at: STALE, result: "answered" }],
    });
    insert("voice_call_sessions", { call_sid: staleSid(farmId), farm_id: farmId, seq: 0, session: { done: true }, created_at: STALE });
    insert("test_calls", { id: toDbId(farmId, "old-lab-call"), actor_id: ownerId(farmId), farm_id: farmId, status: "calling", created_at: STALE });
    insert("pending_worker_calls", {
      id: toDbId(farmId, "instruction"), farm_id: farmId, purpose: "instruction", message: "Move the feed", task_ticket_id: null,
      relay_id: null, state: "pending", next_attempt_at: NOW.toISOString(), dial_claimed_at: null, worker_call_attempts: [], created_at: STALE,
    });
    insert("pending_worker_calls", {
      id: toDbId(farmId, "exhausted"), farm_id: farmId, purpose: "instruction", message: "Check the gate", task_ticket_id: null,
      relay_id: null, state: "no_answer_ticket", next_attempt_at: null, dial_claimed_at: null, created_at: STALE,
      worker_call_attempts: [1, 2, 3].map((n) => ({ at: new Date(Date.parse(STALE) + n * 60_000).toISOString(), answered: false })),
    });
  }
  insert("rate_limit_buckets", { key: "live:ranch:expired", count: 2, reset_at: STALE });
  insert("scheduler_heartbeats", { job: "report-calls", last_run_at: STALE, outcome: "ran" });
}

const FILTER_COLUMNS: Record<string, string[]> = {
  farms: ["id", "owner_id", "owner_phone", "setup_complete", "call_time", "owner_call_time", "owner_call_run->>state", "primary_worker_id"],
  workers: ["farm_id", "id", "phone"],
  camels: ["farm_id", "id"],
  resources: ["farm_id", "kind"],
  custom_questions: ["farm_id", "id"],
  criteria: ["farm_id", "id"],
  emergency_categories: ["farm_id", "id"],
  reports: ["farm_id"],
  calls: ["farm_id"],
  events: ["farm_id"],
  relays: ["farm_id"],
  task_tickets: ["farm_id", "status"],
  no_answer_tickets: ["farm_id", "status"],
  pending_worker_calls: ["farm_id", "state"],
  report_call_runs: ["farm_id", "id", "state", "provider_call_id"],
  voice_events: ["farm_id", "event_id"],
  voice_call_sessions: [
    "farm_id", "call_sid", "seq", "created_at", "session->realtime->closed", "session->realtime->>jti",
    "session->realtime->>claimedAt", "session->realtime->progressVersion", "session->realtime->confirmationFailures",
  ],
  test_calls: ["farm_id", "status", "created_at"],
  rate_limit_buckets: ["key", "count", "reset_at"],
};

function filtersFor(table: string, params: URLSearchParams): (row: Row) => boolean {
  const checks: ((row: Row) => boolean)[] = [];
  for (const [column, filter] of params) {
    if (["select", "order", "limit", "offset", "on_conflict", "columns"].includes(column)) continue;
    if (!(FILTER_COLUMNS[table] ?? []).includes(column)) throw new Error("Unsupported fake PostgREST column");
    const path = column.split(/->>?/);
    const value = (row: Row) => path.reduce<unknown>((parent, key) =>
      parent && typeof parent === "object" ? (parent as Row)[key] : undefined, row);
    const dot = filter.indexOf(".");
    const operand = filter.slice(dot + 1);
    switch (filter.slice(0, dot)) {
      case "eq": checks.push((row) => value(row) != null && String(value(row)) === operand); break;
      case "neq": checks.push((row) => value(row) != null && String(value(row)) !== operand); break;
      case "lt": checks.push((row) => value(row) != null && String(value(row)) < operand); break;
      case "gte": checks.push((row) => value(row) != null && String(value(row)) >= operand); break;
      case "in":
        if (!operand.startsWith("(") || !operand.endsWith(")")) throw new Error("Unsupported fake PostgREST list");
        checks.push((row) => value(row) != null && operand.slice(1, -1).split(",").includes(String(value(row))));
        break;
      case "is":
        if (operand !== "null") throw new Error("Unsupported fake PostgREST is filter");
        checks.push((row) => value(row) == null);
        break;
      case "not":
        if (operand !== "is.null") throw new Error("Unsupported fake PostgREST not filter");
        checks.push((row) => value(row) != null);
        break;
      default: throw new Error("Unsupported fake PostgREST operator");
    }
  }
  return (row) => checks.every((check) => check(row));
}

function applyChange(body: Row) {
  const farmId = body.p_farm_id as string;
  const savedFarm = farm(farmId);
  if (savedFarm.revision !== body.p_expected_revision) return Response.json({ code: "NQ409" }, { status: 409 });
  const { farm: farmChanges, ...changes } = body.p_changes as Record<string, Row[]>;
  Object.assign(savedFarm, farmChanges, { revision: Number(savedFarm.revision) + 1 });
  if (body.p_event_id) insert("voice_events", { farm_id: farmId, event_id: body.p_event_id, outcome: body.p_outcome });
  for (const [table, incoming] of Object.entries(changes)) {
    for (const row of incoming) {
      if (table === "worker_call_attempts") {
        const pending = inFarm("pending_worker_calls", farmId).find((candidate) => candidate.id === row.pending_call_id)!;
        (pending.worker_call_attempts as Row[]).push(row);
      } else {
        const previous = inFarm(table, farmId).find((existing) => existing.id != null && existing.id === row.id);
        if (previous) Object.assign(previous, row);
        else insert(table, {
          ...(table === "reports" ? { report_answers: [], findings: [] } : {}),
          ...(table === "pending_worker_calls" ? { worker_call_attempts: [], created_at: NOW.toISOString() } : {}),
          ...row, farm_id: farmId,
        });
      }
    }
  }
  return Response.json(savedFarm.revision);
}

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init);
  const url = new URL(request.url);
  if (url.origin === DB_URL) {
    if (url.pathname.startsWith("/auth/v1/admin/users/")) {
      adminLookups += 1;
      const id = url.pathname.split("/").at(-1)!;
      return Response.json(fixtureUser(id));
    }
    const table = url.pathname.slice("/rest/v1/".length);
    const entries = rows[table] ?? [];
    const matches = filtersFor(table, url.searchParams);
    const filtered = entries.filter(matches);
    const found = filtered.slice(0, Number(url.searchParams.get("limit") ?? filtered.length));
    const query = { table, method: request.method, params: url.searchParams, rows: request.method === "HEAD" || request.method === "POST" ? [] : structuredClone(found) };
    queries.push(query);
    if (request.method === "HEAD") return new Response(null, { headers: { "content-range": `*/${filtered.length}` } });
    if (request.method === "GET") return Response.json(found);
    if (request.method === "DELETE") {
      rows[table] = entries.filter((row) => !filtered.includes(row));
      return new Response(null, { status: 204 });
    }
    const body = await request.json() as Row;
    if (table === "rpc/apply_farm_changes") {
      query.rows.push({ farm_id: body.p_farm_id });
      return applyChange(body);
    }
    if (table === "rpc/select_initial_plan") {
      const ownerFarm = rows.farms.find((row) => row.owner_id === identity.ownerId);
      if (ownerFarm) Object.assign(ownerFarm, { plan: body.p_plan, plan_selected_at: NOW.toISOString() });
      else insert("farms", { id: TEST, owner_id: identity.ownerId, plan: body.p_plan, plan_selected_at: NOW.toISOString(), setup_complete: false, primary_worker_id: null });
      return new Response(null, { status: 204 });
    }
    if (table.startsWith("rpc/")) throw new Error("Unexpected shared RPC");
    if (request.method === "PATCH") {
      // Evaluate the compare-and-swap against current data when the write executes.
      const current = entries.filter(matches);
      for (const row of current) Object.assign(row, body);
      return url.searchParams.has("select") ? Response.json(current) : new Response(null, { status: 204 });
    }
    if (table === "rate_limit_buckets" && entries.some((row) => row.key === body.key)) return Response.json({ code: "23505" }, { status: 409 });
    for (const item of Array.isArray(body) ? body as Row[] : [body]) {
      if (table !== "voice_call_sessions" || !session(item.call_sid as string)) {
        insert(table, table === "voice_call_sessions" ? { seq: 0, misses: 0, ...item } : item);
      }
    }
    return new Response(null, { status: 201 });
  }
  if (url.hostname === "api.twilio.com" && url.pathname.endsWith("/Calls.json")) {
    placed.push(new URLSearchParams(await request.text()));
    return Response.json({ sid: sid(placed.length) });
  }
  providerChecks.push(url);
  if (url.hostname === "api.twilio.com") return Response.json({});
  if (url.origin === ORIGIN) return Response.json({});
  throw new Error("Unexpected network request");
}

function twilio(path: string, callSid: string, fields: Record<string, string> = {}, signed?: string) {
  const url = new URL(path, ORIGIN);
  if (signed) url.searchParams.set("s", signed);
  const params = { CallSid: callSid, ...fields };
  return new Request(url, { method: "POST", body: new URLSearchParams(params), headers: { "X-Twilio-Signature": twilioRequestSignature(url.href, params, WEBHOOK_KEY) } });
}

function bridge(path: string, body: Row) {
  const raw = JSON.stringify(body);
  const timestamp = Date.now().toString();
  return new Request(new URL(path, ORIGIN), { method: "POST", body: raw, headers: {
    "x-naqah-bridge-timestamp": timestamp, "x-naqah-bridge-signature": bridgeSignature(timestamp, raw, SIGNING_KEY),
  } });
}

const cronRequest = (key = CRON_KEY) => cron(new Request(`${ORIGIN}/api/cron/report-calls`, { headers: { Authorization: `Bearer ${key}` } }));
const accountRequest = (op: string, body: Row = {}) => account(new Request(`${ORIGIN}/api/account`, {
  method: "POST", headers: { Origin: ORIGIN, Host: new URL(ORIGIN).host }, body: JSON.stringify({ op, ...body }),
}));
const get = (path: string) => new Request(new URL(path, ORIGIN));
const phase = (value: string) => vi.stubEnv("NAQAH_TEST_CALL_PHASE", value);
const callToken = (kind: CallToken["k"], f: string) => signCallToken({
  k: kind, f, n: 1, l: "en", t: Date.now(),
  ...(kind === "report" ? { r: toDbId(f, "stale") } : kind === "owner" ? { o: toDbId(f, "owner-run"), r: "" } : { p: toDbId(f, "instruction") }),
} as CallToken, SIGNING_KEY);
const lastPlacementToken = () => new URL(placed.at(-1)!.get("Url")!).searchParams.get("s")!;
const json = async (response: Promise<Response>) => (await response).json();

function isOwnershipLookup(query: Query) {
  return query.table === "farms" && query.method === "GET" && query.params.get("id") === `eq.${TEST}`
    && ["id", "owner_id"].includes(query.params.get("select") ?? "");
}

function clearTestSettings() {
  for (const key of ["NAQAH_TEST_OWNER_EMAIL", "NAQAH_TEST_RANCH_ID", "NAQAH_TEST_CALL_PHASE", "NAQAH_TEST_MAX_CALLS"]) vi.stubEnv(key, undefined);
}

let adminLookups = 0;

function expectOnlyTestRows() {
  const accessed = queries.flatMap((query) => query.rows.flatMap((row) => query.table === "farms" ? [row.id] : row.farm_id ? [row.farm_id] : []));
  expect([...new Set(accessed)].filter(Boolean).every((id) => id === TEST)).toBe(true);
  expect(queries.some((query) => query.table === "rpc/consume_rate_limit")).toBe(false);
  expect(queries.some((query) => query.table === "scheduler_heartbeats")).toBe(false);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const [key, value] of Object.entries({
    NAQAH_TEST_OWNER_EMAIL: fixtureEmail(ownerId(TEST)).toUpperCase(), NAQAH_TEST_RANCH_ID: TEST, NAQAH_TEST_CALL_PHASE: "", NAQAH_TEST_MAX_CALLS: "", NAQAH_CALL_ALLOWLIST: FARMS.flatMap((_, i) => [phone(i), phone(i, true)]).join(","),
    NAQAH_CALL_ALLOWLIST_FILE: "", NAQAH_MANUAL_REPORT_CALLS: "1", NAQAH_SCHEDULED_CALLS: "1", NAQAH_CALL_OWNER: "1",
    NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "en", NAQAH_VOICE_SECRET: SIGNING_KEY, NAQAH_PUBLIC_BASE_URL: ORIGIN,
    NAQAH_VOICE_ENGINE: "scripted", NAQAH_BRIDGE_PUBLIC_URL: "wss://naqah.test/voice-bridge/media",
    NAQAH_TEST_CALLS: "1", NAQAH_TEST_CALL_ADMINS: FARMS.map(ownerId).join(","), NAQAH_VOICE_LAB: "1", CRON_SECRET: CRON_KEY,
    TWILIO_ACCOUNT_SID: "fixture-account", TWILIO_AUTH_TOKEN: WEBHOOK_KEY, TWILIO_PHONE_NUMBER: phone(9),
    NEXT_PUBLIC_SUPABASE_URL: DB_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "fixture-publishable",
    SUPABASE_SECRET_KEY: "fixture-service", NEXT_PUBLIC_NAQAH_ACCOUNT_DATA: "1",
  })) vi.stubEnv(key, value);
  vi.stubEnv("VERCEL_ENV", undefined);
  vi.stubEnv("NAQAH_PREVIEW_ALL_RANCHES", undefined);
  fixture();
  queries = [];
  placed = [];
  providerChecks = [];
  identity.ownerId = ownerId(TEST);
  identity.confirmed = true;
  vi.stubGlobal("fetch", fakeFetch);
  db = markServiceClient(createClient(DB_URL, "fixture-service", { auth: { persistSession: false, autoRefreshToken: false } }));
  ownerDb = createClient(DB_URL, "fixture-publishable", { auth: { persistSession: false, autoRefreshToken: false } });
  resetRateLimitState();
  resetCallingOwnerCheck();
  adminLookups = 0;
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("test-ranch owner account isolation", () => {
  const unavailable = { ok: false, error: "unavailable" };

  it.each(["setup", "ranch"])("refuses foreign owner edits, open, ensure, plan selection and loads in %s mode before querying any farm", async (mode) => {
    if (mode === "setup") vi.stubEnv("NAQAH_TEST_RANCH_ID", undefined);
    const before = structuredClone(rows);
    for (const other of OTHERS) {
      identity.ownerId = ownerId(other);
      const changes = [{ kind: "profile", input: { name: "Foreign edit" } }];
      expect(await saveOwnerEdits(changes, other)).toEqual(unavailable);
      expect(await openAccount()).toEqual(unavailable);
      expect(await ensureFarm()).toEqual(unavailable);
      expect(await selectInitialPlan("basic", identity.ownerId)).toEqual(unavailable);
      expect(await loadWorkspace()).toEqual(unavailable);
      expect(await json(accountRequest("save", { changes, farm: other }))).toEqual(unavailable);
      expect(await json(accountRequest("open"))).toEqual(unavailable);
      expect(await json(accountRequest("load"))).toEqual(unavailable);
      const repo = createOwnerRepository(ownerDb, identity.ownerId, fixtureUser(identity.ownerId));
      await expect(repo.saveFarmProfile({ name: "Foreign edit" })).rejects.toMatchObject({ code: "unavailable" });
      await expect(repo.selectInitialPlan("basic")).rejects.toMatchObject({ code: "unavailable" });
    }
    expect(queries).toEqual([]);
    expect(rows).toEqual(before);
  });

  it("lets only the confirmed test owner select a plan, open and edit a new ranch in setup while every call stays closed", async () => {
    vi.stubEnv("NAQAH_TEST_RANCH_ID", undefined);
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NAQAH_PREVIEW_ALL_RANCHES", "1");
    rows.farms = rows.farms.filter((row) => row.id !== TEST);
    rows.workers = rows.workers.filter((row) => row.farm_id !== TEST);
    const before = snapshotOthers();
    identity.confirmed = false;
    expect(await selectInitialPlan("basic", identity.ownerId)).toEqual(unavailable);
    expect(await json(accountRequest("open"))).toEqual(unavailable);
    expect(queries).toEqual([]);

    identity.confirmed = true;
    expect(await openAccount()).toEqual({ ok: false, error: "plan_required" });
    expect(await selectInitialPlan("basic", identity.ownerId)).toEqual({ ok: true, data: { plan: "basic" } });
    expect(await ensureFarm()).toEqual({ ok: true, data: TEST });
    expect(await json(accountRequest("open"))).toMatchObject({ ok: true, data: { farmId: TEST, ownerId: identity.ownerId } });
    const changes = [{ kind: "profile", input: { name: "Disposable ranch" } }];
    expect(await json(accountRequest("save", { changes, farm: TEST }))).toMatchObject({ ok: true, data: { failed: [] } });
    expect(farm().name).toBe("Disposable ranch");

    expect(await callNowAvailable()).toEqual({ ok: true, data: false });
    expect(await callWorkerNow()).toEqual(unavailable);
    expect((await cronRequest()).status).toBe(503);
    expect((await inbound(twilio("/api/voice/inbound", sid(1), { From: phone(0) }))).status).toBe(503);
    expect(await json(accountRequest("load"))).toMatchObject({ ok: true, data: { farmId: TEST } });
    expect(snapshotOthers()).toEqual(before);
    expect(placed).toEqual([]);
    expect(providerChecks).toEqual([]);
  });

  it("lets the matching confirmed owner read and edit only the configured ranch", async () => {
    const before = snapshotOthers();
    const changes = [{ kind: "profile", input: { name: "Authorized edit" } }];
    expect(await json(accountRequest("save", { changes, farm: OTHERS[0] }))).toEqual({ ok: false, error: "conflict" });
    expect(await json(accountRequest("save", { changes, farm: TEST }))).toMatchObject({ ok: true, data: { failed: [] } });
    expect(farm().name).toBe("Authorized edit");
    expectOnlyTestRows();
    expect(snapshotOthers()).toEqual(before);
  });

  it.each([
    ["belongs to a different Auth user", OTHERS[0]],
    ["does not exist", toDbId(TEST, "missing-ranch")],
  ])("fails closed for account and calling paths when the configured ranch %s", async (_reason, wrongRanch) => {
    vi.stubEnv("NAQAH_TEST_RANCH_ID", wrongRanch);
    const before = structuredClone(rows);
    const { caller, requests } = recordingCaller();
    expect(await openAccount()).toEqual(unavailable);
    expect(await ensureFarm()).toEqual(unavailable);
    expect(await selectInitialPlan("basic", identity.ownerId)).toEqual(unavailable);
    expect(await json(accountRequest("load"))).toEqual(unavailable);
    expect(await json(accountRequest("save", { changes: [], farm: TEST }))).toEqual(unavailable);
    const cron = await cronRequest();
    expect(cron.status).toBe(403);
    expect(await cron.json()).toMatchObject({ ok: false, reason: "manual_only" });
    expect(await requestReportCallNow(db, caller, wrongRanch, options)).toEqual({ status: "blocked", reason: "unavailable" });
    expect(await requestOwnerCallNow(db, caller, wrongRanch, { ...options, allowlist: [] })).toEqual({ status: "blocked", reason: "unavailable" });
    expect((await inbound(twilio("/api/voice/inbound", sid(1), { From: phone(1) }))).status).toBe(503);
    expect((await reportStatus(twilio("/api/voice/outbound/status", staleSid(wrongRanch), { CallStatus: "completed" }, callToken("report", wrongRanch)))).status).toBe(503);
    vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
    expect((await postPreflight(bridge("/api/report-call-now", { farmId: wrongRanch }))).status).toBe(503);
    expect(queries.every((query) => query.table === "farms" && query.method === "GET" && query.params.get("id") === `eq.${wrongRanch}`
      && ["owner_id", "id"].includes(query.params.get("select") ?? ""))).toBe(true);
    expect(rows).toEqual(before);
    expect(requests).toEqual([]);
    expect(placed).toEqual([]);
    expect(providerChecks).toEqual([]);
  });
});

describe("test-ranch calling isolation", () => {
  it.each(["report", "owner", "worker", undefined])("refuses cron in manual-only ranch scope with phase %s", async (configuredPhase) => {
    const before = structuredClone(rows);
    if (configuredPhase) phase(configuredPhase);
    vi.stubEnv("NAQAH_SCHEDULED_CALLS", "1");
    // Unauthenticated callers get the same answers as before test-ranch mode; manual_only is for the secret holder.
    const wrong = await cronRequest("wrong");
    expect(wrong.status).toBe(401);
    expect(await wrong.json()).toEqual({ ok: false, reason: "unauthorized" });
    vi.stubEnv("CRON_SECRET", "");
    expect((await cronRequest()).status).toBe(503);
    vi.stubEnv("CRON_SECRET", CRON_KEY);
    expect(await json(cronRequest())).toMatchObject({ ok: false, placed: 0, reason: "manual_only" });
    expect((await cronRequest()).status).toBe(403);
    await expect(runReportCallScheduler(db, recordingCaller().caller, options)).rejects.toMatchObject({ code: "unavailable" });
    expect(placed).toEqual([]);
    expect(queries).toEqual([]);
    expect(rows).toEqual(before);
  });

  it("exposes test-call availability only to the confirmed owner of the configured ranch", async () => {
    const before = structuredClone(rows);
    expect(await testCallsPanelState()).toMatchObject({ ok: true, data: { visible: true, maxCalls: 8, callLive: false } });
    expect(await json(accountRequest("testCallsPanel"))).toMatchObject({ ok: true, data: { visible: true } });

    for (const foreign of OTHERS) {
      identity.ownerId = ownerId(foreign);
      expect(await testCallsPanelState()).toEqual({ ok: false, error: "unavailable" });
      expect(await testCallReportNow()).toEqual({ ok: false, error: "unavailable" });
      expect(await testCallOwnerSummaryNow()).toEqual({ ok: false, error: "unavailable" });
      expect(await testCallWorkerInstructionNow()).toEqual({ ok: false, error: "unavailable" });
      expect(await testCallWorkerVerificationNow()).toEqual({ ok: false, error: "unavailable" });
    }
    identity.ownerId = ownerId(TEST);

    vi.stubEnv("NAQAH_TEST_RANCH_ID", OTHERS[0]);
    expect(await testCallsPanelState()).toEqual({ ok: false, error: "unavailable" });
    expect(await testCallReportNow()).toEqual({ ok: false, error: "unavailable" });
    expect(await testCallOwnerSummaryNow()).toEqual({ ok: false, error: "unavailable" });
    expect(await testCallWorkerInstructionNow()).toEqual({ ok: false, error: "unavailable" });
    expect(await testCallWorkerVerificationNow()).toEqual({ ok: false, error: "unavailable" });
    vi.stubEnv("NAQAH_TEST_RANCH_ID", TEST);

    clearTestSettings();
    expect(await testCallsPanelState()).toEqual({ ok: true, data: null });
    expect(placed).toEqual([]);
    expect(rows).toEqual(before);
    expectOnlyTestRows();
  });

  it("refuses worker instruction delivery when no instruction is pending", async () => {
    rows.pending_worker_calls = rows.pending_worker_calls.filter((row) => row.farm_id !== TEST);
    const before = structuredClone(rows);
    expect(await testCallWorkerInstructionNow()).toEqual({ ok: true, data: "not_ready:no_pending_instruction" });
    expect(placed).toEqual([]);
    expect(rows).toEqual(before);
  });

  it.each([
    ["report", "report", () => testCallReportNow()],
    ["owner summary", "owner", () => testCallOwnerSummaryNow()],
    ["worker instruction", "worker", () => testCallWorkerInstructionNow()],
    ["worker verification", "worker", () => testCallWorkerVerificationNow()],
  ] as const)("enforces the shared lifetime cap for the %s button", async (_label, _kind, action) => {
    vi.stubEnv("NAQAH_TEST_MAX_CALLS", "1");
    insert("rate_limit_buckets", { key: `test-ranch:${TEST}:placements`, count: 1, reset_at: STALE });
    if (_label === "worker verification") {
      const taskId = toDbId(TEST, "cap-ticket");
      Object.assign(inFarm("pending_worker_calls")[0], { state: "delivered", task_ticket_id: taskId, next_attempt_at: null });
      insert("task_tickets", {
        id: taskId, farm_id: TEST, instruction: "Check the gate", status: "open",
        scheduled_for: new Date(NOW.getTime() + 24 * 60 * 60_000).toISOString(), created_at: STALE, closed_at: null, closed_via: null,
      });
    }
    expect(await action()).toEqual({ ok: true, data: "cap_reached" });
    expect(placed).toEqual([]);
    expect(rows.rate_limit_buckets).toContainEqual(expect.objectContaining({ key: `test-ranch:${TEST}:placements`, count: 1 }));
    expectOnlyTestRows();
  });

  it("rejects service reads, farm actions, direct calls, reconciliation and Call Lab helpers before database access", async () => {
    const before = structuredClone(rows);
    const { caller, requests } = recordingCaller();
    expect(await listScheduledFarmIds(db)).toEqual([TEST]);
    for (const foreign of OTHERS) {
      const action = vi.fn();
      expect(await loadFarm(db, { id: foreign })).toBeNull();
      expect(await loadFarm(db, { owner_id: ownerId(foreign) })).toBeNull();
      await expect(runFarmAction(db, foreign, action)).rejects.toMatchObject({ code: "unavailable" });
      await expect(recordedOutcome(db, foreign, "foreign-event")).rejects.toMatchObject({ code: "unavailable" });
      await expect(cleanStaleReportCalls(db, foreign, NOW)).rejects.toMatchObject({ code: "unavailable" });
      expect(await requestReportCallNow(db, caller, foreign, options)).toMatchObject({ status: "blocked", reason: "unavailable" });
      expect(await requestOwnerCallNow(db, caller, foreign, { ...options, allowlist: [phone(0, true)] })).toMatchObject({ status: "blocked", reason: "unavailable" });
      expect(await dialDueOwnerCall(db, { farmId: foreign, now: NOW }, caller)).toBeNull();
      expect(await readVoiceSession(db, staleSid(foreign))).toBeNull();
      expect(await advanceVoiceSession(db, staleSid(foreign), 0, { session: {} as never, last_response: "", misses: 0 })).toBeNull();
      await expect(createVoiceSession(db, { call_sid: sid(999), farm_id: foreign, party: "worker", locale: "en", session: {} as never, last_response: "", created_at: STALE })).rejects.toMatchObject({ code: "unavailable" });
      expect(await startTestCall(db, ownerId(foreign), { phone: phone(0), requestId: toDbId(foreign, "request") }, { caller })).toEqual({ ok: false, error: "unavailable" });
      await recordTestCallProgress(db, toDbId(foreign, "stale"), foreign, "completed", NOW);
      expect(action).not.toHaveBeenCalled();
    }
    await expireTestCalls(db, NOW);
    const testWorkspace = (await loadFarm(db, { id: TEST }))!.workspace;
    expect(expireReportRuns(testWorkspace, OTHERS[0], NOW)).toBe(testWorkspace);
    expect(queries.some((query) => query.table.startsWith("rpc/") || query.table === "test_calls")).toBe(false);
    expect(requests).toEqual([]);
    expect(rows).toEqual(before);
    expectOnlyTestRows();
  });

  it("hangs up for other workers and owners before session lookup or stale cleanup, and refuses a shared caller number", async () => {
    const before = structuredClone(rows);
    for (const [index, foreign] of OTHERS.entries()) {
      for (const from of [phone(index + 1), phone(index + 1, true)]) {
        const response = await inbound(twilio("/api/voice/inbound", staleSid(foreign), { From: from }));
        expect(await response.text()).toContain(OWNER_LINE_CLOSED.en);
      }
    }
    expect(queries.every((query) => query.method === "GET" && ["farms", "workers"].includes(query.table))).toBe(true);
    expect(rows).toEqual(before);
    expectOnlyTestRows();
    // A duplicate across farms is rejected even when the test worker is itself allowlisted.
    inFarm("workers", OTHERS[0])[0].phone = phone(0);
    queries = [];
    const collision = await inbound(twilio("/api/voice/inbound", sid(300), { From: phone(0) }));
    expect(await collision.text()).toContain(OWNER_LINE_CLOSED.en);
    expect(queries.filter((query) => query.method === "HEAD").map((query) => query.table)).toEqual(["workers", "farms"]);
    expect(queries.some((query) => query.method === "DELETE" || query.table === "voice_call_sessions")).toBe(false);
    expectOnlyTestRows();
    inFarm("workers", OTHERS[0])[0].phone = phone(1);
    const response = await inbound(twilio("/api/voice/inbound", sid(300), { From: phone(0) }));
    expect(await response.text()).not.toContain(OWNER_LINE_CLOSED.en);
    expect(session(staleSid(TEST))).toBeUndefined();
    expect(snapshotOthers().voice_call_sessions).toEqual(before.voice_call_sessions.filter((row) => row.farm_id !== TEST));
  });

  it("refuses other owners' call-now, both preflights, worker requeue, and paid Labs with account mode enabled", async () => {
    const before = structuredClone(rows);
    vi.stubEnv("VERCEL", undefined);
    vi.stubEnv("NAQAH_DEMO_OWNER_CALL", "1");
    vi.stubEnv("NAQAH_DEMO_REPEAT_FARMS", FARMS.join(","));
    // The local-demo owner route only accepts an approved-numbers file in the OS temp directory.
    const approved = join(mkdtempSync(join(tmpdir(), "naqah-approved-")), "approved-numbers.txt");
    writeFileSync(approved, "");
    vi.stubEnv("NAQAH_CALL_ALLOWLIST_FILE", approved);
    for (const foreign of OTHERS) {
      identity.ownerId = ownerId(foreign);
      expect(await callNowAvailable()).toEqual({ ok: false, error: "unavailable" });
      expect(await callWorkerNow()).toEqual({ ok: false, error: "unavailable" });
      expect(await callOwnerNow()).toEqual({ ok: false, error: "unavailable" });
      expect(await retryUndelivered(toDbId(foreign, "exhausted"))).toEqual({ ok: false, error: "unavailable" });
      expect((await reportNow(get("/api/report-call-now"))).status).toBe(503);
      expect((await reportNow(get("/api/report-call-now?preflight=1"))).status).toBe(503);
      expect((await ownerNow(get("/api/owner-call-now?preflight=1"))).status).toBe(503);
      vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
      expect((await postPreflight(bridge("/api/report-call-now", { farmId: foreign }))).status).toBe(503);
      expect((await testCall()).status).toBe(404);
      expect((await startLabCall(get("/api/test-call"))).status).toBe(404);
      expect((await voiceLab(get("/api/voice-lab"))).status).toBe(404);
      expect((await approveNumber(get("/api/test-number"))).status).toBe(404);
    }
    expect(queries.every(isOwnershipLookup)).toBe(true);
    expect(placed).toEqual([]);
    expect(providerChecks).toEqual([]);
    expect(rows).toEqual(before);
  });

  it("rejects foreign signed report, owner and worker tokens, all realtime routes, and SID-only writes", async () => {
    vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
    const before = structuredClone(rows);
    for (const foreign of OTHERS) {
      const callSid = staleSid(foreign);
      const signed = { report: callToken("report", foreign), owner: callToken("owner", foreign), worker: callToken("worker", foreign) };
      const routes = [
        [reportAnswer, "/api/voice/outbound", signed.report],
        [reportStatus, "/api/voice/outbound/status", signed.report],
        [reportStatus, "/api/voice/outbound/status?amd=1", signed.report],
        [ownerAnswer, "/api/voice/owner", signed.owner],
        [ownerHeard, "/api/voice/owner/heard", signed.owner],
        [ownerStatus, "/api/voice/owner/status", signed.owner],
        [workerAnswer, "/api/voice/worker", signed.worker],
        [workerStatus, "/api/voice/worker/status", signed.worker],
        [realtimeAfter, "/api/voice/realtime/after", signed.report],
        [realtimeAfter, "/api/voice/realtime/after", signed.owner],
      ] as const;
      for (const [handler, path, token] of routes) {
        expect((await handler(twilio(path, callSid, { CallStatus: "completed" }, token))).status).toBe(403);
      }
      const ticket = signRealtimeTicket({ f: foreign, sid: callSid, r: toDbId(foreign, "stale"), j: "fixture-ticket", l: "en", t: Date.now() }, SIGNING_KEY);
      const body = { ticket, callSid, toolCallId: "fixture-tool", name: "get_step", args: {}, userSpokeSinceLastTool: false, reason: "silence" };
      expect((await realtimeSession(bridge("/api/voice/realtime/session", body))).status).toBe(403);
      expect((await realtimeTool(bridge("/api/voice/realtime/tool", body))).status).toBe(403);
      expect((await realtimeClosed(bridge("/api/voice/realtime/closed", body))).status).toBe(403);
      expect(queries.every(isOwnershipLookup)).toBe(true);
      expect(await (await turn(twilio("/api/voice/turn?n=0", callSid))).text()).toContain("<Hangup/>");
      expect((await voiceStatus(twilio("/api/voice/status", callSid, { CallStatus: "completed" }))).status).toBe(204);
      expect(queries.every((query) => isOwnershipLookup(query) || (query.table === "voice_call_sessions" && query.params.get("farm_id") === `eq.${TEST}`))).toBe(true);
      queries = [];
    }
    expect(rows).toEqual(before);
    expect(providerChecks).toEqual([]);
    expect(placed).toEqual([]);
  });

  it("uses a count-only provider SID collision check and refuses foreign tokens at the real adapter", async () => {
    const before = structuredClone(rows);
    expect(await (await reportAnswer(twilio("/api/voice/outbound", staleSid(OTHERS[0]), {}, callToken("report", TEST)))).text()).toContain("<Hangup/>");
    expect(queries.filter((query) => !isOwnershipLookup(query)).map(({ table, method }) => [table, method])).toEqual([["report_call_runs", "HEAD"]]);
    const signed = callToken("report", OTHERS[0]);
    const result = await createTwilioCaller().place({
      to: phone(0), url: `${ORIGIN}/api/voice/outbound?s=${signed}`, statusCallback: `${ORIGIN}/api/voice/outbound/status?s=${signed}`,
    });
    expect(result).toEqual({ placed: false, reason: "not_allowed" });
    expect(rows).toEqual(before);
    expect(placed).toEqual([]);
  });

  it.each([
    ["NAQAH_TEST_OWNER_EMAIL", ""],
    ["NAQAH_TEST_OWNER_EMAIL", undefined],
    ["NAQAH_TEST_RANCH_ID", ""],
    ["NAQAH_TEST_RANCH_ID", undefined],
    ["NAQAH_TEST_RANCH_ID", "invalid"],
    ["NAQAH_TEST_RANCH_ID", FARMS.join(",")],
    ["NAQAH_TEST_RANCH_ID", TEST.toUpperCase()],
    ["NAQAH_CALL_ALLOWLIST", ""],
    ["NAQAH_CALL_ALLOWLIST", "invalid"],
    ["NAQAH_VOICE_SECRET", ""],
    ["NAQAH_TEST_CALL_PHASE", "invalid"],
    ["NAQAH_TEST_MAX_CALLS", "100"],
  ])("fails closed with a log for %s misconfiguration (%#)", async (setting, value) => {
    const before = structuredClone(rows);
    phase("report");
    vi.stubEnv(setting, value);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await cronRequest()).status).toBe(503);
    expect((await inbound(twilio("/api/voice/inbound", sid(1), { From: phone(0) }))).status).toBe(503);
    expect((await reportNow(get("/api/report-call-now?preflight=1"))).status).toBe(503);
    expect(await callWorkerNow()).toEqual({ ok: false, error: "unavailable" });
    await expect(runReportCallScheduler(db, recordingCaller().caller, options)).rejects.toMatchObject({ code: "unavailable" });
    expect(await listScheduledFarmIds(db)).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining(setting));
    expect(placed).toEqual([]);
    expect(queries).toEqual([]);
    expect(rows).toEqual(before);
  });

  it("refuses a Vercel preview with no scope before scheduling, call-now, inbound and signed webhooks reach data", async () => {
    clearTestSettings();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
    const before = structuredClone(rows);
    const { caller, requests } = recordingCaller();
    expect((await cronRequest()).status).toBe(503);
    expect(await callWorkerNow()).toEqual({ ok: false, error: "unavailable" });
    expect(await requestReportCallNow(db, caller, TEST, options)).toEqual({ status: "blocked", reason: "unavailable" });
    expect(await requestOwnerCallNow(db, caller, TEST, { ...options, allowlist: [] })).toEqual({ status: "blocked", reason: "unavailable" });
    expect(await dialDueOwnerCall(db, { farmId: TEST, now: NOW }, caller)).toBeNull();
    expect((await inbound(twilio("/api/voice/inbound", sid(1), { From: phone(0) }))).status).toBe(503);
    expect((await workerAnswer(twilio("/api/voice/worker", sid(1), {}, callToken("worker", TEST)))).status).toBe(503);
    expect((await reportStatus(twilio("/api/voice/outbound/status", sid(1), {}, callToken("report", TEST)))).status).toBe(503);
    expect((await realtimeSession(bridge("/api/voice/realtime/session", {}))).status).toBe(503);
    expect((await reportNow(get("/api/report-call-now?preflight=1"))).status).toBe(503);
    expect(queries).toEqual([]);
    expect(requests).toEqual([]);
    expect(placed).toEqual([]);
    expect(providerChecks).toEqual([]);
    expect(rows).toEqual(before);
  });

  it("rejects unsupported fake database columns and operators even on an empty table", async () => {
    await expect(fakeFetch(new URL("/rest/v1/reports?farm_id=like.any", DB_URL))).rejects.toThrow("Unsupported fake PostgREST operator");
    await expect(fakeFetch(new URL("/rest/v1/reports?unknown=eq.any", DB_URL))).rejects.toThrow("Unsupported fake PostgREST column");
  });

  it.each([undefined, "production", "preview"])("keeps all-ranch scheduling and the heartbeat in %s with no scope (preview requires opt-out)", async (env) => {
    clearTestSettings();
    vi.stubEnv("VERCEL_ENV", env);
    if (env === "preview") vi.stubEnv("NAQAH_PREVIEW_ALL_RANCHES", "1");
    // Suppress owner calls here so each due report is the only placement per ranch.
    vi.stubEnv("NAQAH_CALL_OWNER", "");
    expect(await json(cronRequest())).toMatchObject({ farms: FARMS.length, placed: FARMS.length });
    expect(queries.some((query) => query.table === "farms" && !query.params.has("id"))).toBe(true);
    expect(queries.some((query) => query.table === "scheduler_heartbeats" && query.method === "POST")).toBe(true);
    expect(placed.length).toBe(FARMS.length);
    expect(OTHERS.every((id) => inFarm("report_call_runs", id).length === 2)).toBe(true);
  });
});

describe("the test ranch owner check", () => {
  it("remembers a confirmed owner briefly instead of repeating the Auth lookup on every webhook step", async () => {
    expect(await verifyCallingOwner(db, TEST)).toBe(true);
    expect(await verifyCallingOwner(db, TEST)).toBe(true);
    expect(adminLookups).toBe(1);
    vi.setSystemTime(NOW.getTime() + 61_000);
    expect(await verifyCallingOwner(db, TEST)).toBe(true);
    expect(adminLookups).toBe(2);
  });

  it("never remembers a refusal, and never lets a remembered owner cover another ranch", async () => {
    const email = process.env.NAQAH_TEST_OWNER_EMAIL!;
    vi.stubEnv("NAQAH_TEST_OWNER_EMAIL", "someone-else@example.test");
    expect(await verifyCallingOwner(db, TEST)).toBe(false);
    vi.stubEnv("NAQAH_TEST_OWNER_EMAIL", email);
    expect(await verifyCallingOwner(db, TEST)).toBe(true);
    expect(adminLookups).toBe(2);
    expect(await verifyCallingOwner(db, OTHERS[0])).toBe(false);
    expect(adminLookups).toBe(2);
  });
});

describe("the test ranch can complete real calling paths with mocked providers", () => {
  async function manualCall(op: string, kind: CallToken["k"]) {
    const before = placed.length;
    const response = await accountRequest(op);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, data: "placed" });
    expect(placed).toHaveLength(before + 1);
    const token = new URL(placed.at(-1)!.get("Url")!).searchParams.get("s")!;
    expect(verifyCallToken(token)).toMatchObject({ k: kind, f: TEST });
    expect(placed.at(-1)!.get("To")).toBe(phone(0, kind === "owner"));
    expect(placed.at(-1)!.get("Record")).toBe("false");
    expect(Number(placed.at(-1)!.get("TimeLimit"))).toBeGreaterThan(0);
    return { token, callSid: sid(placed.length) };
  }

  const keypad = (callSid: string, seq: number, digits: string) => turn(twilio(`/api/voice/turn?n=${seq}`, callSid, { Digits: digits }));
  const complete = (handler: (req: Request) => Promise<Response>, path: string, callSid: string, token: string) =>
    handler(twilio(path, callSid, { CallStatus: "completed" }, token));

  async function saveReport(report: { callSid: string; token: string }) {
    expect(await (await reportAnswer(twilio("/api/voice/outbound", report.callSid, {}, report.token))).text()).toContain("<Gather");
    for (let seq = 0; seq < 12; seq++) {
      const current = session(report.callSid)?.session as { done?: boolean };
      if (current.done) break;
      expect((await keypad(report.callSid, seq, "1")).status).toBe(200);
    }
    expect((await complete(reportStatus, "/api/voice/outbound/status", report.callSid, report.token)).status).toBe(204);
  }

  it("claims, dials and completes report, owner summary, worker instruction and worker verification", async () => {
    const before = snapshotOthers();
    rows.pending_worker_calls = rows.pending_worker_calls.filter((row) => row.farm_id !== TEST);
    await saveReport(await manualCall("testCallReport", "report"));
    expect(inFarm("reports")).toHaveLength(1);
    expect(inFarm("report_call_runs").at(-1)).toMatchObject({ state: "completed", report_id: inFarm("reports")[0].id });

    vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
    vi.stubEnv("NAQAH_VOICE_LOCALE", "ar");
    const owner = await manualCall("testCallOwnerSummary", "owner");
    const ownerXml = await (await ownerAnswer(twilio("/api/voice/owner", owner.callSid, {}, owner.token))).text();
    expect(ownerXml).toContain("<Stream");
    const ownerTicket = /name="ticket" value="([^"]+)"/.exec(ownerXml)?.[1];
    expect(ownerTicket).toBeTruthy();
    expect((await realtimeSession(bridge("/api/voice/realtime/session", { ticket: ownerTicket, callSid: owner.callSid }))).status).toBe(200);
    const proposed = await json(realtimeTool(bridge("/api/voice/realtime/tool", {
      ticket: ownerTicket, callSid: owner.callSid, toolCallId: "manual-owner-proposal", name: "propose_instructions",
      args: { items: [{ message: "صلح البوابة", kind: "task", due: new Date(NOW.getTime() + 24 * 60 * 60_000).toISOString(), evidence: "صلح البوابة بكرة" }] },
      workerUtterance: "قل له يصلح البوابة بكرة", userSpokeSinceLastTool: true,
    })));
    expect(proposed.awaitingConfirmation).toBe(true);
    const sessionNow = session(owner.callSid)?.session as Row;
    const { reportSummaryId } = await import("@/domain/conversation/engine");
    const summaryId = reportSummaryId(sessionNow as never, "ar");
    const confirmed = await json(realtimeTool(bridge("/api/voice/realtime/tool", {
      ticket: ownerTicket, callSid: owner.callSid, toolCallId: "manual-owner-confirm", name: "confirm_instructions",
      args: { confirmed: true }, workerUtterance: "إيه احفظها", heardSummaryId: summaryId, userSpokeSinceLastTool: true,
    })));
    expect(JSON.parse(String(confirmed.output)).status).toBe("saved");
    expect((await realtimeClosed(bridge("/api/voice/realtime/closed", { ticket: ownerTicket, callSid: owner.callSid, reason: "normal" }))).status).toBe(204);
    expect((await complete(ownerStatus, "/api/voice/owner/status", owner.callSid, owner.token)).status).toBe(204);
    expect(farm().owner_call_run).toMatchObject({ state: "completed", reportId: inFarm("reports")[0].id });
    expect(inFarm("task_tickets")).toHaveLength(1);
    const scheduledFor = Date.parse(String(inFarm("task_tickets")[0].scheduled_for));
    expect(scheduledFor).toBeGreaterThan(NOW.getTime());

    vi.stubEnv("NAQAH_VOICE_ENGINE", "scripted");
    const worker = await manualCall("testCallWorkerInstruction", "worker");
    expect(await (await workerAnswer(twilio("/api/voice/worker", worker.callSid, {}, worker.token))).text()).toContain("صلح البوابة");
    expect((await keypad(worker.callSid, 0, "1")).status).toBe(200);
    expect((await complete(workerStatus, "/api/voice/worker/status", worker.callSid, worker.token)).status).toBe(204);
    expect(inFarm("pending_worker_calls")[0]).toMatchObject({ purpose: "instruction", state: "delivered", worker_call_attempts: [{ answered: true }] });
    expect(inFarm("pending_worker_calls")[0].message).toBe("صلح البوابة");

    expect(NOW.getTime()).toBeLessThan(scheduledFor);
    const verification = await manualCall("testCallWorkerVerification", "worker");
    expect(await (await workerAnswer(twilio("/api/voice/worker", verification.callSid, {}, verification.token))).text()).toContain("صلح البوابة");
    expect((await keypad(verification.callSid, 0, "1")).status).toBe(200);
    expect((await complete(workerStatus, "/api/voice/worker/status", verification.callSid, verification.token)).status).toBe(204);
    expect(inFarm("task_tickets")).toMatchObject([{ status: "closed" }]);
    expect(inFarm("pending_worker_calls")).toContainEqual(expect.objectContaining({ purpose: "task_verification", state: "delivered" }));
    expect(rows.rate_limit_buckets).toContainEqual(expect.objectContaining({ key: `test-ranch:${TEST}:placements`, count: 4 }));
    expect(snapshotOthers()).toEqual(before);
    expectOnlyTestRows();
  });

  it("allows the test ranch's account preflight, manual report and worker requeue using dedicated buckets", async () => {
    const before = snapshotOthers();
    expect(await callNowAvailable()).toEqual({ ok: true, data: true });
    expect((await reportNow(get("/api/report-call-now?preflight=1"))).status).toBe(200);
    vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
    expect((await postPreflight(bridge("/api/report-call-now", { farmId: TEST }))).status).toBe(200);
    expect(await retryUndelivered(toDbId(TEST, "exhausted"))).toEqual({ ok: true, data: true });
    expect(await callWorkerNow()).toEqual({ ok: true, data: { status: "placed" } });
    expect(placed).toHaveLength(1);
    expect(verifyCallToken(lastPlacementToken())).toMatchObject({ k: "report", f: TEST });
    expect(inFarm("pending_worker_calls").find((row) => row.id === toDbId(TEST, "exhausted"))).toMatchObject({ state: "pending", retry_base: 3 });
    expect(rows.rate_limit_buckets.filter((row) => row.key !== "live:ranch:expired").every((row) => String(row.key).startsWith(`test-ranch:${TEST}:`))).toBe(true);
    expect(snapshotOthers()).toEqual(before);
    expectOnlyTestRows();
  });

  it("waits for the owner's next button press after an unanswered worker call", async () => {
    const first = await manualCall("testCallWorkerInstruction", "worker");
    const callToken = verifyCallToken(first.token);
    if (!callToken || callToken.k !== "worker") throw new Error("worker_call_token_missing");
    expect((await workerStatus(twilio("/api/voice/worker/status", first.callSid, { CallStatus: "no-answer" }, first.token))).status).toBe(204);
    const pending = inFarm("pending_worker_calls").find((row) => row.id === callToken.p);
    expect(pending).toMatchObject({ state: "pending", worker_call_attempts: [{ answered: false }] });
    expect(Date.parse(String(pending?.next_attempt_at))).toBeGreaterThan(NOW.getTime());

    expect(await json(cronRequest())).toMatchObject({ ok: false, placed: 0, reason: "manual_only" });
    await expect(runReportCallScheduler(db, recordingCaller().caller, options)).rejects.toMatchObject({ code: "unavailable" });
    expect(placed).toHaveLength(1);

    const second = await manualCall("testCallWorkerInstruction", "worker");
    expect(second.callSid).not.toBe(first.callSid);
    expect(placed).toHaveLength(2);
    expect(rows.rate_limit_buckets).toContainEqual(expect.objectContaining({ key: `test-ranch:${TEST}:placements`, count: 2 }));
    expectOnlyTestRows();
  });

  it("refuses the report and owner summary buttons while a worker instruction call is live", async () => {
    await manualCall("testCallWorkerInstruction", "worker");
    const cap = () => rows.rate_limit_buckets.find((row) => row.key === `test-ranch:${TEST}:placements`)?.count;
    const capBefore = cap();
    const runsBefore = structuredClone(inFarm("report_call_runs"));
    const pendingBefore = structuredClone(inFarm("pending_worker_calls"));
    const { caller, requests } = recordingCaller();
    const allowlist = [phone(0), phone(0, true)];

    // The CallBar «اتصال حقيقي», the panel's report button and a second tab all reach the same in-transaction check.
    expect(await callWorkerNow()).toEqual({ ok: true, data: { status: "blocked", reason: "in_progress" } });
    expect(await testCallReportNow()).toEqual({ ok: true, data: "call_live" });
    expect(await json(accountRequest("callNow"))).toEqual({ ok: true, data: { status: "blocked", reason: "in_progress" } });
    expect(await requestReportCallNow(db, caller, TEST, { ...options, allowlist })).toEqual({ status: "blocked", reason: "in_progress" });
    // A stale panel skipping the availability read still meets the owner path's own check.
    expect(await requestOwnerCallNow(db, caller, TEST, { ...options, allowlist })).toEqual({ status: "blocked", reason: "call_live" });
    expect(await testCallOwnerSummaryNow()).toEqual({ ok: true, data: "call_live" });

    expect(placed).toHaveLength(1);
    expect(requests).toEqual([]);
    expect(cap()).toBe(capBefore);
    expect(inFarm("report_call_runs").map((row) => row.id)).toEqual(runsBefore.map((row) => row.id));
    expect(inFarm("pending_worker_calls")).toEqual(pendingBefore);
    expect(farm().owner_call_run).toBeNull();
    expectOnlyTestRows();
  });

  it("refuses the owner summary and worker buttons while a report call is live", async () => {
    await manualCall("testCallReport", "report");
    const cap = () => rows.rate_limit_buckets.find((row) => row.key === `test-ranch:${TEST}:placements`)?.count;
    const capBefore = cap();
    const { caller, requests } = recordingCaller();
    expect(await requestOwnerCallNow(db, caller, TEST, { ...options, allowlist: [phone(0, true)] })).toEqual({ status: "blocked", reason: "call_live" });
    expect(await testCallOwnerSummaryNow()).toEqual({ ok: true, data: "call_live" });
    expect(await testCallWorkerInstructionNow()).toEqual({ ok: true, data: "call_live" });
    expect(await testCallReportNow()).toEqual({ ok: true, data: "call_live" });
    expect(placed).toHaveLength(1);
    expect(requests).toEqual([]);
    expect(cap()).toBe(capBefore);
    expect(farm().owner_call_run).toBeNull();
    expectOnlyTestRows();
  });

  it("opens, advances, closes and resumes a signed realtime session only for the test ranch", async () => {
    vi.stubEnv("NAQAH_VOICE_ENGINE", "realtime");
    vi.stubEnv("NAQAH_VOICE_STYLE", "guided");
    const before = snapshotOthers();
    const { callSid, token } = await manualCall("testCallReport", "report");
    const answer = await (await reportAnswer(twilio("/api/voice/outbound", callSid, {}, token))).text();
    expect(answer).toContain("<Stream");
    const ticket = /name="ticket" value="([^"]+)"/.exec(answer)?.[1];
    expect(ticket).toBeTruthy();
    const opened = await realtimeSession(bridge("/api/voice/realtime/session", { ticket, callSid }));
    expect(opened.status).toBe(200);
    const body = { ticket, callSid, toolCallId: "test-turn", name: "answer_question", args: {}, workerUtterance: "Ready", userSpokeSinceLastTool: true };
    expect((await realtimeTool(bridge("/api/voice/realtime/tool", body))).status).toBe(200);
    expect((await realtimeClosed(bridge("/api/voice/realtime/closed", { ticket, callSid, reason: "normal" }))).status).toBe(204);
    expect(await (await realtimeAfter(twilio("/api/voice/realtime/after", callSid, {}, token))).text()).toContain("<Gather");
    expect((session(callSid)?.session as Row).bridgeCloseReason).toBe("normal");
    const realtimeWrites = queries.filter((query) => query.table === "voice_call_sessions" && query.method === "PATCH" && query.params.has("session->realtime->>jti"));
    expect(realtimeWrites).toHaveLength(1);
    expect(realtimeWrites[0].params.get("farm_id")).toBe(`eq.${TEST}`);
    expect(snapshotOthers()).toEqual(before);
    expectOnlyTestRows();
  });

  it("enforces both the lifetime placement cap and the stricter race-safe per-window reservations", async () => {
    const before = snapshotOthers();
    const key = `call-now:farm:${TEST}:hour`;
    const leases = await Promise.all(Array.from({ length: 5 }, () => reserveRateLimit(key, 3, 3600, Date.now())));
    expect(leases.filter(Boolean)).toHaveLength(3);
    await leases[0]?.release();
    expect(await reserveRateLimit(key, 3, 3600, Date.now())).toBeNull();
    expect(await reserveRateLimit(`call-now:farm:${OTHERS[0]}:hour`, 3, 3600)).toBeNull();
    expect(await reserveRateLimit(key, 3, 3600, Date.now() + 3_600_000)).not.toBeNull();

    vi.stubEnv("NAQAH_TEST_MAX_CALLS", "1");
    const report = await manualCall("testCallReport", "report");
    expect((await reportStatus(twilio("/api/voice/outbound/status", report.callSid, { CallStatus: "no-answer" }, report.token))).status).toBe(204);
    expect(await testCallOwnerSummaryNow()).toEqual({ ok: true, data: "cap_reached" });
    expect(placed).toHaveLength(1);
    expect(rows.rate_limit_buckets).toContainEqual(expect.objectContaining({ key: `test-ranch:${TEST}:placements`, count: 1 }));
    expect(snapshotOthers()).toEqual(before);
    expectOnlyTestRows();
  });
});
