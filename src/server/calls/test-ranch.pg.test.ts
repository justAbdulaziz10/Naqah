import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServerClient } from "@supabase/ssr";
import { describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/report-calls/route";
import { POST as inbound } from "@/app/api/voice/inbound/route";
import { POST as reportStatus } from "@/app/api/voice/outbound/status/route";
import { MINUTE, REPORT_CALL_GRACE_MS } from "@/domain/clock";
import { createOwnerRepository } from "@/server/db/owner-repository";
import { createServiceClient } from "@/server/db/service-client";
import { findCaller } from "@/server/db/service-repository";
import { callWorkerNow } from "@/server/farm/actions";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { OWNER_LINE_CLOSED } from "@/server/voice/farm-call";
import { signCallToken, verifyCallToken } from "./token";
import type { OutboundCallRequest, OutboundCaller } from "./twilio";

const boundary = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  caller: undefined as OutboundCaller | undefined,
}));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (load) => ({ ...await load<object>(), connection: async () => {} }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "127.0.0.1" }),
  cookies: async () => ({
    getAll: () => [...boundary.cookies].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => boundary.cookies.set(name, value),
  }),
}));
vi.mock("./twilio", async (load) => ({
  ...await load<typeof import("./twilio")>(),
  createTwilioCaller: () => {
    if (!boundary.caller) throw new Error("The recording caller is required");
    return boundary.caller;
  },
}));

const mode = process.env.NAQAH_RANCH_TEST_MODE;
const database = process.env.NAQAH_TEST_DB;
const gateway = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const validPort = (port: string | undefined) => /^554\d\d$/.test(port ?? "");
const q = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const sid = (n: number) => "CA" + n.toString(16).padStart(32, "0");
const base = "https://naqah-fixture.invalid";
const farms = (["ultimate", "ultimate", "basic", "ultimate"] as const).map((plan, i) => ({
  label: ["test", "other-1", "other-2", "other-3"][i],
  plan,
  id: "10000000-0000-4000-8000-00000000000" + i,
  workerPk: "20000000-0000-4000-8000-00000000000" + i,
  staleRun: "30000000-0000-4000-8000-00000000000" + i,
  staleSid: sid(100 + i),
  worker: "+96650000020" + i,
  owner: "+96650000030" + i,
  email: "owner-" + i + "@example.invalid",
}));
const [testFarm, ...others] = farms;

function sql(query: string): string {
  if (database !== "naqah_ranch_isolation" || process.env.PGHOST !== "127.0.0.1" ||
      !validPort(process.env.PGPORT) || process.env.PGHOSTADDR || process.env.PGSERVICE) {
    throw new Error("Use run-test-ranch.sh to start the private database");
  }
  return execFileSync("psql", ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database], {
    input: query, encoding: "utf8",
  }).trim();
}

type Fixture = typeof testFarm;
const password = () => randomBytes(20).toString("hex");
async function seedFarm(farm: Fixture, now: Date) {
  const pass = password();
  const registered = await fetch(gateway + "/__test/users", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: farm.email, password: pass }),
  });
  expect(registered.status).toBe(201);
  const user = await registered.json() as { id: string; email_confirmed_at?: string };
  expect(Boolean(user.email_confirmed_at)).toBe(true);
  const slot = new Date(now.getTime() - MINUTE).toISOString();
  // Near the end of the grace period, an in-flight report no longer defers the owner summary.
  const ownerSlot = new Date(now.getTime() - REPORT_CALL_GRACE_MS + 5 * MINUTE).toISOString();
  const stale = new Date(now.getTime() - 8 * 86_400_000).toISOString();
  const localSlot = q(slot) + "::timestamptz at time zone 'Asia/Riyadh'";
  const localOwnerSlot = q(ownerSlot) + "::timestamptz at time zone 'Asia/Riyadh'";
  const id = q(farm.id);
  sql(`begin;
    insert into farms (id, owner_id, plan, setup_complete, plan_selected_at, name, owner_name, owner_phone,
                       call_time, call_day, owner_call_time, owner_call_day)
    values (${id}, ${q(user.id)}, ${q(farm.plan)}, true, ${q(stale)}, ${q(farm.label)}, 'Fixture owner', ${q(farm.owner)},
            (${localSlot})::time(0), extract(dow from ${localSlot}),
            (${localOwnerSlot})::time(0), extract(dow from ${localOwnerSlot}));
    insert into workers (id, farm_id, name, phone, language)
    values (${q(farm.workerPk)}, ${id}, 'Fixture worker', ${q(farm.worker)}, 'en');
    update farms set primary_worker_id = ${q(farm.workerPk)} where id = ${id};
    insert into custom_questions (farm_id, text) values (${id}, 'Was the gate closed?');
    insert into report_call_runs (id, farm_id, occurrence, trigger, attempts, state, provider_call_id)
    values (${q(farm.staleRun)}, ${id}, ${q(stale)}, 'manual',
            jsonb_build_array(jsonb_build_object('at', ${q(stale)}::text, 'result', 'answered')), 'answered', ${q(farm.staleSid)});
    with old_call as (
      insert into calls (farm_id, kind, direction, party, at, outcome)
      values (${id}, 'worker_report', 'outbound', 'worker', ${q(stale)}, 'completed') returning id
    ), old_report as (
      insert into reports (farm_id, call_id, at) select ${id}, id, ${q(stale)}::timestamptz from old_call returning id
    )
    insert into report_answers (report_id, question_id, question_ar, question_en, answer, certainty)
    select id, 'gate', 'البوابة', 'Gate', 'Closed', 'verified' from old_report;
    insert into events (farm_id, at, text_ar, text_en) values (${id}, ${q(stale)}, 'تم', 'Fixture event');
    insert into voice_call_sessions (farm_id, call_sid, party, locale, session, last_response, created_at)
    values (${id}, ${q(farm.staleSid)}, 'worker', 'en', '{"done":true}', '<Response><Hangup/></Response>', ${q(stale)});
    insert into rate_limit_buckets (key, count, reset_at) values (${q("fixture:farm:" + farm.id)}, 2, ${q(stale)});
    ${farm.plan === "ultimate" ? `
    with task as (
      insert into task_tickets (farm_id, instruction, created_at)
      values (${id}, 'Check the gate', ${q(stale)}) returning id
    ), pending as (
      insert into pending_worker_calls (farm_id, purpose, message, task_ticket_id, next_attempt_at, created_at)
      select ${id}, 'instruction', 'Check the gate', id, ${q(slot)}::timestamptz, ${q(stale)}::timestamptz from task returning id
    )
    insert into worker_call_attempts (pending_call_id, at, answered)
    select id, ${q(stale)}::timestamptz, false from pending;
    ` : ""}
    commit;`);
  return { ...farm, userId: user.id, pass };
}

const source: Record<string, { from: string; farm: string }> = Object.fromEntries(
  ["workers", "report_call_runs", "reports", "calls", "events", "pending_worker_calls",
    "pending_worker_call_tasks", "voice_call_sessions"].map((table) => [table, { from: table + " t", farm: "t.farm_id" }]),
);
Object.assign(source, {
  farms: { from: "farms t", farm: "t.id" },
  report_answers: { from: "report_answers t join reports p on p.id = t.report_id", farm: "p.farm_id" },
  worker_call_attempts: { from: "worker_call_attempts t join pending_worker_calls p on p.id = t.pending_call_id", farm: "p.farm_id" },
  rate_limit_buckets: { from: "rate_limit_buckets t join farms p on t.key = 'fixture:farm:' || p.id or t.key like 'test-ranch:' || p.id || ':%' or t.key like '%:farm:' || p.id || ':%'", farm: "p.id" },
});
type Snapshot = Record<string, Record<string, string[]>>;
function snapshot(): Snapshot {
  const ids = others.map((farm) => q(farm.id)).join(",");
  const values = Object.entries(source).map(([table, { from, farm }]) =>
    `select ${q(table)} as name, f.id,
      coalesce((select jsonb_agg(md5(to_jsonb(t)::text) order by md5(to_jsonb(t)::text))
        from ${from} where ${farm} = f.id), '[]') as hashes
      from farms f where f.id in (${ids})`,
  ).join(" union all ");
  return JSON.parse(sql(`with hashed as (${values}),
    by_table as (select name, jsonb_object_agg(id, hashes) as farms from hashed group by name)
    select jsonb_object_agg(name, farms) from by_table`));
}

function reportDiff(before: Snapshot, after: Snapshot) {
  const result = Object.fromEntries(Object.keys(source).sort().map((table) => [
    table, others.filter(({ id }) => JSON.stringify(before[table][id]) !== JSON.stringify(after[table][id])),
  ]));
  for (const [table, changed] of Object.entries(result)) {
    console.log(`${mode} ${table}: ${changed.length ? "changed (" + changed.map((farm) => farm.label).join(", ") + ")" : "unchanged (all 3)"}`);
  }
  return result;
}

function bucketSnapshot(): Record<string, string> {
  return JSON.parse(sql("select coalesce(jsonb_object_agg(t.key, md5(to_jsonb(t)::text)), '{}') from rate_limit_buckets t"));
}

const cronRequest = () => new Request(base + "/api/cron/report-calls", {
  headers: { authorization: "Bearer " + process.env.CRON_SECRET },
});
function hook(url: string, fields: Record<string, string>) {
  return new Request(url, {
    method: "POST",
    headers: { "x-twilio-signature": twilioRequestSignature(url, fields, process.env.TWILIO_AUTH_TOKEN!) },
    body: new URLSearchParams(fields),
  });
}
const tokenIn = (url: string) => new URL(url).searchParams.get("s")!;
type Placement = OutboundCallRequest & { sid: string };
async function noAnswer(placement: Placement) {
  expect((await reportStatus(hook(placement.statusCallback, {
    CallSid: placement.sid, CallStatus: "no-answer",
  }))).status).toBe(204);
}

describe.skipIf(!mode)("test-ranch isolation with PostgreSQL + PostgREST", () => {
  it("checks full foreign-row snapshots and the actual placement destinations", async () => {
    expect(["phases", "scoped-unfiltered", "off"]).toContain(mode);
    if (!gateway || !anon || !/^http:\/\/127\.0\.0\.1:554\d\d$/.test(gateway)) throw new Error("Local gateway required");
    const realFetch = globalThis.fetch;
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      if (new URL(input instanceof Request ? input.url : input).origin !== gateway) throw new Error("Non-fixture network request refused");
      return realFetch(input, { ...init, redirect: "error" });
    });

    const now = new Date(process.env.NAQAH_RANCH_TEST_NOW!);
    vi.setSystemTime(now);
    const set = (key: string, val: string | undefined) => vi.stubEnv(key, val);
    try {
      const scoped = mode !== "off";
      const allowlist = farms.flatMap((farm) => [farm.owner, farm.worker]);
      for (const [key, val] of Object.entries({
        NAQAH_TEST_RANCH_ID: scoped ? testFarm.id : undefined,
        NAQAH_TEST_OWNER_EMAIL: scoped ? testFarm.email : undefined,
        NAQAH_CALL_ALLOWLIST: allowlist.join(","),
        NAQAH_VOICE_SECRET: password(), CRON_SECRET: password(), TWILIO_AUTH_TOKEN: password(),
        NAQAH_PUBLIC_BASE_URL: base, TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_PHONE_NUMBER: "+966500000299",
        NAQAH_VOICE_MODE: "farm", NAQAH_VOICE_LOCALE: "en", NAQAH_SCHEDULED_CALLS: "1",
        NAQAH_CALL_OWNER: "1", NAQAH_MANUAL_REPORT_CALLS: "1", NEXT_PUBLIC_NAQAH_ACCOUNT_DATA: "1",
      })) set(key, val);
      const placed: Placement[] = [];
      boundary.caller = { async place(request) {
        const providerSid = sid(placed.length + 1);
        placed.push({ ...request, sid: providerSid });
        return { placed: true, sid: providerSid };
      } };

      const seeded: Awaited<ReturnType<typeof seedFarm>>[] = [];
      for (const farm of farms) seeded.push(await seedFarm(farm, now));
      // Global expired sentinel catches an accidental call to consume_rate_limit's global cleanup.
      sql("insert into rate_limit_buckets (key, count, reset_at) values ('fixture:global-expired', 2, '2020-01-01')");
      const rls = sql(`select count(*) from pg_class where relrowsecurity and oid in
        (${[...Object.keys(source), "scheduler_heartbeats"].map((name) => q("public." + name) + "::regclass").join(",")})`);
      expect(Number(rls)).toBe(Object.keys(source).length + 1);

      const service = createServiceClient()!;
      expect(Boolean(service)).toBe(true);
      const serviceRows = await service.from("farms").select("id");
      expect(serviceRows.error).toBeNull();
      expect(serviceRows.data?.length).toBe(farms.length);
      const before = snapshot();
      expect(Object.values(before).every((rows) => Object.values(rows).some((hashes) => hashes.length > 0))).toBe(true);
      const beforeBuckets = bucketSnapshot();
      const unchanged = () => expect(snapshot()).toEqual(before);

      async function runCron(phase: string | undefined, farmCount: number, placementCount: number) {
        set("NAQAH_TEST_CALL_PHASE", phase);
        const response = await cron(cronRequest());
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true, farms: farmCount, placed: placementCount, failed: 0, errors: 0 });
        if (scoped) {
          unchanged();
          expect(sql("select count(*) from scheduler_heartbeats")).toBe("0");
        }
      }
      function checkPlacement(index: number, kind: string, farm: Fixture) {
        const placement = placed[index];
        expect(placement.to === (kind === "owner" ? farm.owner : farm.worker)).toBe(true);
        expect(verifyCallToken(placement.url ? tokenIn(placement.url) : null)).toMatchObject({ k: kind, f: farm.id });
        return placement;
      }
      async function signIn(farm: typeof seeded[number]) {
        boundary.cookies.clear();
        const client = createServerClient(gateway!, anon!, {
          cookies: {
            getAll: () => [...boundary.cookies].map(([name, value]) => ({ name, value })),
            setAll: (cookies) => cookies.forEach(({ name, value }) => boundary.cookies.set(name, value)),
          },
        });
        const { data, error } = await client.auth.signInWithPassword({ email: farm.email, password: farm.pass });
        expect(!error && data.user?.id === farm.userId && Boolean(data.user.email_confirmed_at)).toBe(true);
        return client;
      }

      if (mode === "phases") {
        const foreign = seeded[1];
        const auth = await signIn(foreign);
        // The same database returns all farms to the service role and only the session's farm to an owner.
        const own = await auth.from("farms").select("id");
        expect(own.error).toBeNull();
        expect(own.data).toEqual([{ id: foreign.id }]);
        const denied = await auth.from("farms").update({ name: "Cross-farm write probe" }).eq("id", testFarm.id).select("id");
        expect(denied.error).toBeNull();
        expect(denied.data).toEqual([]);
        const foreignRepo = createOwnerRepository(auth, foreign.userId);
        await expect(foreignRepo.load()).rejects.toMatchObject({ code: "unavailable" });
        await expect(foreignRepo.saveFarmProfile({ name: "Scoped save probe" })).rejects.toMatchObject({ code: "unavailable" });
        expect(await callWorkerNow()).toEqual({ ok: false, error: "unavailable" });
        expect(placed.length).toBe(0);
        unchanged();

        await signIn(seeded[0]);
        expect(await callWorkerNow()).toEqual({ ok: true, data: { status: "placed" } });
        await noAnswer(checkPlacement(0, "report", testFarm));
        unchanged();

        for (const other of others) {
          expect(await findCaller(service, other.worker)).toEqual({ kind: "unknown" });
          const response = await inbound(hook(base + "/api/voice/inbound", { From: other.worker, CallSid: other.staleSid }));
          const body = await response.text();
          expect(response.status).toBe(200);
          expect(body.includes(OWNER_LINE_CLOSED.en) && body.includes("<Hangup")).toBe(true);

          const foreignToken = { k: "report", f: other.id, r: other.staleRun, n: 1, l: "en", t: now.getTime() } as const;
          const signed = signCallToken(foreignToken);
          set("NAQAH_TEST_RANCH_ID", undefined);
          set("NAQAH_TEST_OWNER_EMAIL", undefined);
          expect(verifyCallToken(signed)).toEqual(foreignToken);
          set("NAQAH_TEST_RANCH_ID", testFarm.id);
          set("NAQAH_TEST_OWNER_EMAIL", testFarm.email);
          expect(verifyCallToken(signed) === null).toBe(true);
          const statusUrl = base + "/api/voice/outbound/status?s=" + encodeURIComponent(signed);
          expect((await reportStatus(hook(statusUrl, { CallSid: other.staleSid, CallStatus: "no-answer" }))).status).toBe(403);
        }
        unchanged();

        await runCron("report", 1, 1);
        await noAnswer(checkPlacement(1, "report", testFarm));
        await runCron("owner", 1, 1);
        checkPlacement(2, "owner", testFarm);
        await runCron("worker", 1, 1);
        checkPlacement(3, "worker", testFarm);
        await runCron(undefined, 1, 0);
        expect(placed.length).toBe(4);

        const id = q(testFarm.id);
        expect(sql(`select count(*) from report_call_runs where farm_id = ${id} and
          (id = ${q(testFarm.staleRun)} and state = 'missed'
          or trigger = 'manual' and state = 'missed' and provider_call_id = ${q(placed[0].sid)}
          or trigger = 'schedule' and next_attempt_at is not null and provider_call_id = ${q(placed[1].sid)})`)).toBe("3");
        expect(sql(`select owner_call_run->>'state' from farms where id = ${id}`)).toBe("calling");
        expect(sql(`select count(*) from pending_worker_calls where farm_id = ${id}
          and state = 'pending' and next_attempt_at > dial_claimed_at`)).toBe("1");
      } else {
        await runCron(undefined, scoped ? 1 : 4, scoped ? 2 : 8);
        if (scoped) {
          checkPlacement(0, "report", testFarm);
          checkPlacement(1, "owner", testFarm);
        }
      }

      const changed = reportDiff(before, snapshot());
      const foreignPlacements = placed.filter((call) => others.some((farm) => [farm.owner, farm.worker].includes(call.to)));
      expect(foreignPlacements.length).toBe(scoped ? 0 : 6);
      const afterBuckets = bucketSnapshot();
      const newKeys = Object.keys(afterBuckets).filter((key) => !(key in beforeBuckets));
      expect(Object.fromEntries(Object.keys(beforeBuckets).map((key) => [key, afterBuckets[key]]))).toEqual(beforeBuckets);
      expect(newKeys.length).toBe(mode === "phases" ? 3 : scoped ? 1 : 0);
      expect(newKeys.every((key) => key.startsWith("test-ranch:" + testFarm.id + ":"))).toBe(true);
      if (scoped) {
        expect(Object.values(changed).every((rows) => rows.length === 0)).toBe(true);
        expect(sql(`select count from rate_limit_buckets where key = ${q("test-ranch:" + testFarm.id + ":placements")}`)).toBe(String(placed.length));
      } else {
        expect(changed.report_call_runs.map((farm) => farm.label)).toEqual(others.map((farm) => farm.label));
        expect(changed.farms.map((farm) => farm.label)).toEqual(others.map((farm) => farm.label));
        expect(sql("select count(*) from scheduler_heartbeats where job = 'report-calls' and outcome = 'ran'")).toBe("1");
      }
      console.log(`${mode}: ${placed.length} placements, ${foreignPlacements.length} foreign, ${newKeys.length} new rate keys, ${scoped ? 0 : 1} heartbeat rows`);
    } finally {
      boundary.cookies.clear();
      boundary.caller = undefined;
      vi.useRealTimers();
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });
});
