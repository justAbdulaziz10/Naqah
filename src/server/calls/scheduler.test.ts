import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { toDbId } from "@/server/db/ids";
import { verifyCallToken } from "./token";
import { recordingCaller } from "./twilio";

vi.mock("server-only", () => ({}));
vi.mock("@/server/rate-limit", () => ({ reserveRateLimit: async () => ({ release: async () => {} }) }));

/** One farm held in memory; runFarmAction applies the pure action to it like the database would. */
const store = vi.hoisted(() => ({ ws: null as unknown as Workspace, saves: 0, farmIds: [] as string[], fails: new Set<string>() }));
vi.mock("@/server/db/service-repository", () => ({
  listScheduledFarmIds: async () => store.farmIds,
  runFarmAction: async (_client: unknown, farm: string, action: (ws: Workspace) => { ws: Workspace; result: unknown }) => {
    if (store.fails.has(farm)) throw new Error("farm unavailable");
    const { ws, result } = action(structuredClone(store.ws));
    if (JSON.stringify(ws) !== JSON.stringify(store.ws)) store.saves += 1;
    // Ids as the database would return them: domain ids become stable UUIDs.
    store.ws = {
      ...ws,
      reportCalls: ws.reportCalls?.map((run) => ({ ...run, id: toDbId(FARM, run.id) })),
      ...(ws.ownerCallRun ? { ownerCallRun: { ...ws.ownerCallRun, id: toDbId(FARM, ws.ownerCallRun.id) } } : {}),
    };
    return { status: "saved", result };
  },
}));
const FARM = "11111111-1111-4111-8111-111111111111";
const SECRET = "unit-test-voice-secret-at-least-32-bytes";
const { requestReportCallNow, runReportCallScheduler } = await import("./scheduler");
const { requestOwnerCallNow } = await import("./owner-call-now");

const now = new Date("2026-11-12T14:00:00.000Z"); // Thursday 17:00 Riyadh
const options = { baseUrl: "https://naqah.test", now };

beforeEach(() => {
  vi.stubEnv("NAQAH_VOICE_SECRET", SECRET);
  const ws = createDemoWorkspace("en", "basic");
  store.ws = { ...ws, reports: [], calls: [], lastUpdateAt: null, reportCalls: [], clockOffsetMs: 0, settings: { ...ws.settings, worker: { ...ws.settings.worker, phone: "+966501234567" }, callSchedule: { day: 4, time: "17:00" } } };
  store.saves = 0;
  store.farmIds = [FARM];
  store.fails = new Set();
});

describe("report-call scheduler", () => {
  it("calls the farm's saved primary worker once per slot, with a signed run token", async () => {
    const { caller, requests } = recordingCaller();
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ placed: 1, failed: 0 });
    expect(requests).toHaveLength(1);
    expect(requests[0].to).toBe("+966501234567");
    const token = verifyCallToken(new URL(requests[0].url!).searchParams.get("s"), SECRET, now.getTime());
    expect(token).toMatchObject({ k: "report", f: FARM, r: store.ws.reportCalls![0].id, n: 1 });

    // A second pass for the same slot dials nothing: the attempt was saved before dialling.
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ placed: 0 });
    expect(requests).toHaveLength(1);
  });

  it("undoes an attempt Twilio refused, instead of logging it as unanswered, and retries 20 minutes later", async () => {
    const { caller } = recordingCaller(() => ({ placed: false, reason: "rejected", status: 400 }));
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ placed: 0, failed: 1 });
    const run = store.ws.reportCalls![0];
    expect(run.attempts).toHaveLength(0);
    expect(run.state).toBe("calling");
    expect(run.nextAttemptAt).toBe(new Date(now.getTime() + 20 * 60_000).toISOString());
    expect(store.ws.calls.some((call) => call.kind === "worker_report_missed")).toBe(false);
  });
});

describe("worker instruction and verification dialing", () => {
  const pendingId = "22222222-2222-4222-8222-222222222222";

  beforeEach(() => {
    store.ws.settings = { ...store.ws.settings, plan: "ultimate", callSchedule: null };
    store.ws.pendingWorkerCalls = [{
      id: pendingId,
      purpose: "instruction",
      message: "Move Wadha to the shade",
      taskTicketId: null,
      relayId: null,
      attempts: [],
      nextAttemptAt: now.toISOString(),
      state: "pending",
    }];
  });

  it("dials a due instruction once and does not dial it again while the claim is held", async () => {
    const { caller, requests } = recordingCaller();
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ placed: 1, failed: 0 });
    const worker = requests.find((request) => request.url?.includes("/api/voice/worker"));
    expect(worker?.to).toBe("+966501234567");
    const token = verifyCallToken(new URL(worker!.url!).searchParams.get("s"), SECRET, now.getTime());
    expect(token).toMatchObject({ k: "worker", f: FARM, p: pendingId, n: 1 });
    expect(store.ws.pendingWorkerCalls[0].attempts).toHaveLength(0);
    expect(store.ws.pendingWorkerCalls[0].state).toBe("pending");

    const again = recordingCaller();
    expect(await runReportCallScheduler({} as never, again.caller, options)).toMatchObject({ placed: 0 });
    expect(again.requests).toHaveLength(0);
  });

  it("never rings the worker twice at once: a report call being placed holds the instruction back", async () => {
    store.ws.settings = { ...store.ws.settings, callSchedule: { day: 4, time: "17:00" } };
    const { caller, requests } = recordingCaller();
    await runReportCallScheduler({} as never, caller, options);
    expect(requests.filter((request) => request.url?.includes("/api/voice/worker"))).toHaveLength(0);
    expect(requests.filter((request) => request.url?.includes("/api/voice/outbound"))).toHaveLength(1);
    expect(store.ws.pendingWorkerCalls[0].nextAttemptAt).toBe(now.toISOString());
  });

  it.each(["rejected", "not_configured", "invalid_number", "not_allowed"] as const)("releases the worker claim after %s and waits before asking again", async (reason) => {
    const { caller } = recordingCaller(() => ({ placed: false, reason, status: 400 }));
    const result = await runReportCallScheduler({} as never, caller, options);
    expect(result.failed).toBeGreaterThan(0);
    expect(store.ws.pendingWorkerCalls[0].attempts).toHaveLength(0);
    expect(new Date(store.ws.pendingWorkerCalls[0].nextAttemptAt!).getTime()).toBe(now.getTime() + 20 * 60 * 1000);
  });

  it.each(["instruction", "task_verification"] as const)("keeps an ambiguous %s claim until its stale lock expires", async (purpose) => {
    store.ws.pendingWorkerCalls[0].purpose = purpose;
    const { caller, requests } = recordingCaller(() => ({ placed: false, reason: "network_error" }));
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ failed: 1, errors: 0 });
    expect(store.ws.pendingWorkerCalls[0]).toMatchObject({ attempts: [], nextAttemptAt: new Date(now.getTime() + 2 * 60 * 60_000).toISOString() });
    await runReportCallScheduler({} as never, caller, { ...options, now: new Date(now.getTime() + 21 * 60_000) });
    expect(requests).toHaveLength(1);
    await runReportCallScheduler({} as never, caller, { ...options, now: new Date(now.getTime() + 2 * 60 * 60_000) });
    expect(requests).toHaveLength(2);
  });

  it("keeps a worker claim if the provider throws after sending", async () => {
    const caller = { place: vi.fn(async () => { throw new Error("response lost"); }) };
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ failed: 1, errors: 0 });
    await runReportCallScheduler({} as never, caller, { ...options, now: new Date(now.getTime() + 21 * 60_000) });
    expect(caller.place).toHaveBeenCalledTimes(1);
  });
});

describe("scheduled owner call", () => {
  const reportId = "33333333-3333-4333-8333-333333333333";
  const attempts = () => store.ws.ownerCallRun!.attempts;
  const later = (minutes: number) => ({ ...options, now: new Date(now.getTime() + minutes * 60_000) });
  const tokenOf = (url?: string) => verifyCallToken(new URL(url!).searchParams.get("s"), SECRET, later(40).now.getTime());

  beforeEach(() => {
    vi.stubEnv("NAQAH_CALL_OWNER", "1");
    vi.stubEnv("TWILIO_ACCOUNT_SID", `AC${"1".repeat(32)}`);
    vi.stubEnv("TWILIO_AUTH_TOKEN", "token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+15555550100");
    vi.stubEnv("NAQAH_PUBLIC_BASE_URL", "https://naqah.test");
    store.ws.reports = [{ id: reportId, at: now.toISOString(), callId: "c", answers: [], findings: [] }];
    store.ws.lastUpdateAt = now.toISOString();
    store.ws.settings.owner.phone = "+966550123344";
    store.ws.settings.ownerCallSchedule = { day: 4, time: "17:00" };
    store.ws.ownerCallRun = null;
  });

  it("dials a due slot as a conversation URL, saved before dialling, and not twice", async () => {
    const { caller, requests } = recordingCaller((request) => {
      if (request.to === "+966550123344") expect(store.ws.ownerCallRun?.attempts).toHaveLength(1);
      return { placed: true, sid: `CA${"2".repeat(32)}` };
    });
    expect(await runReportCallScheduler({} as never, caller, options)).toEqual({ farms: 1, placed: 1, failed: 0, errors: 0 });
    expect(requests[0].url).toContain("https://naqah.test/api/voice/owner?s=");
    expect(requests[0].twiml).toBeUndefined();
    expect(requests[0].to).toBe("+966550123344");
    expect(tokenOf(requests[0].url)).toMatchObject({ k: "owner", f: FARM, o: store.ws.ownerCallRun!.id, r: reportId, n: 1 });

    const again = recordingCaller();
    expect(await runReportCallScheduler({} as never, again.caller, options)).toMatchObject({ placed: 0 });
    expect(again.requests).toHaveLength(0);
  });

  it("waits for the worker's call before opening the owner's slot", async () => {
    store.ws.reports = [];
    store.ws.lastUpdateAt = null;
    const { caller, requests } = recordingCaller();
    await runReportCallScheduler({} as never, caller, options);
    expect(requests.map((request) => request.to)).toEqual(["+966501234567"]);
    expect(store.ws.ownerCallRun).toBeNull();
  });

  it("still calls when there is no report, with an empty report in the token", async () => {
    store.ws.reports = [];
    store.ws.lastUpdateAt = null;
    store.ws.settings.callSchedule = null;
    const { caller, requests } = recordingCaller();
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ placed: 1 });
    expect(tokenOf(requests.at(-1)!.url)).toMatchObject({ k: "owner", r: "", n: 1 });
  });

  it("does nothing with the switch off, and leaves no run", async () => {
    vi.stubEnv("NAQAH_CALL_OWNER", "");
    const { caller, requests } = recordingCaller();
    await runReportCallScheduler({} as never, caller, options);
    expect(requests.filter((request) => request.to === "+966550123344")).toHaveLength(0);
    expect(store.ws.ownerCallRun).toBeNull();
  });

  it("never dials before the column exists, because the claim couldn't be saved", async () => {
    store.ws.ownerCallRun = undefined;
    const { caller, requests } = recordingCaller();
    await runReportCallScheduler({} as never, caller, options);
    expect(requests.filter((request) => request.to === "+966550123344")).toHaveLength(0);
  });

  it.each(["rejected", "not_configured", "invalid_number", "not_allowed"] as const)("releases the owner claim after %s and retries it 20 minutes later", async (reason) => {
    const refuse = recordingCaller(() => ({ placed: false, reason, status: 400 }));
    expect(await runReportCallScheduler({} as never, refuse.caller, options)).toMatchObject({ placed: 0, failed: 1 });
    expect(attempts()).toEqual([]);
    expect(store.ws.ownerCallRun).toMatchObject({ state: "calling", nextAttemptAt: new Date(now.getTime() + 20 * 60_000).toISOString() });

    const { caller, requests } = recordingCaller();
    expect(await runReportCallScheduler({} as never, caller, later(19))).toMatchObject({ placed: 0 });
    expect(await runReportCallScheduler({} as never, caller, later(20))).toMatchObject({ placed: 1 });
    expect(tokenOf(requests[0].url)).toMatchObject({ k: "owner", n: 1 });
  });

  it("keeps the claim when the caller throws after sending", async () => {
    const thrower = { place: vi.fn(async () => { throw new Error("offline"); }) };
    expect(await runReportCallScheduler({} as never, thrower, options)).toMatchObject({ failed: 1, errors: 0 });
    expect(attempts()).toEqual([{ at: now.toISOString(), result: "pending" }]);
    expect(store.ws.ownerCallRun!.nextAttemptAt).toBeNull();
    await runReportCallScheduler({} as never, thrower, later(1));
    expect(thrower.place).toHaveBeenCalledTimes(1);
  });

  it("keeps ambiguous owner placement pending until the stale-run timeout settles it", async () => {
    const { caller, requests } = recordingCaller(() => ({ placed: false, reason: "network_error" }));
    await runReportCallScheduler({} as never, caller, options);
    await runReportCallScheduler({} as never, caller, later(1));
    expect(attempts()).toEqual([{ at: now.toISOString(), result: "pending" }]);
    expect(requests).toHaveLength(1);
    await runReportCallScheduler({} as never, caller, later(15));
    expect(attempts()[0].result).toBe("unanswered");
    expect(requests).toHaveLength(1);
  });

  it.each(["network_error", "rejected"] as const)("handles manual owner placement %s without unsafe rollback", async (reason) => {
    const chain = { select: () => chain, eq: () => chain, gte: () => chain, in: () => chain, limit: async () => ({ data: [], error: null }) };
    const client = { from: () => chain };
    const { caller } = recordingCaller(() => ({ placed: false, reason }));
    expect(await requestOwnerCallNow(client as never, caller, FARM, { ...options, allowlist: ["+966550123344"] })).toEqual({ status: "failed", reason: "not_placed" });
    expect(attempts()).toHaveLength(reason === "network_error" ? 1 : 0);
    expect(store.ws.ownerCallRun!.state).toBe(reason === "network_error" ? "calling" : "missed");
    if (reason === "network_error") {
      expect(await requestOwnerCallNow(client as never, caller, FARM, { ...options, allowlist: ["+966550123344"] })).toEqual({ status: "blocked", reason: "call_live" });
    }
  });

  it("frees an attempt whose webhook never arrives, then dials the retry", async () => {
    const { caller, requests } = recordingCaller();
    await runReportCallScheduler({} as never, caller, options);
    await runReportCallScheduler({} as never, caller, later(15));
    expect(attempts()[0].result).toBe("unanswered");
    await runReportCallScheduler({} as never, caller, later(35));
    expect(requests).toHaveLength(2);
    expect(tokenOf(requests[1].url)).toMatchObject({ k: "owner", n: 2 });
  });

  it("uses a newer report on the retry", async () => {
    const { caller, requests } = recordingCaller();
    await runReportCallScheduler({} as never, caller, options);
    await runReportCallScheduler({} as never, caller, later(15));
    const newer = "44444444-4444-4444-8444-444444444444";
    store.ws.reports.push({ id: newer, at: later(30).now.toISOString(), callId: "c2", answers: [], findings: [] });
    await runReportCallScheduler({} as never, caller, later(35));
    expect(tokenOf(requests[1].url)).toMatchObject({ r: newer, n: 2 });
  });
});

describe("one farm's failure", () => {
  it("never stops the farms after it", async () => {
    const { caller, requests } = recordingCaller();
    store.farmIds = ["bad", FARM];
    store.fails = new Set(["bad"]);
    expect(await runReportCallScheduler({} as never, caller, options)).toMatchObject({ farms: 2, placed: 1, errors: 3 });
    expect(requests).toHaveLength(1);
  });
});

describe("owner's Call now", () => {
  it("dials the saved primary worker and refuses a second call while one is in progress", async () => {
    const { caller, requests } = recordingCaller();
    expect(await requestReportCallNow({} as never, caller, FARM, options)).toEqual({ status: "placed" });
    expect(requests.map((r) => r.to)).toEqual(["+966501234567"]);
    expect(store.ws.reportCalls![0]).toMatchObject({ trigger: "manual", state: "calling" });
    expect(await requestReportCallNow({} as never, caller, FARM, options)).toEqual({ status: "blocked", reason: "in_progress" });
    expect(requests).toHaveLength(1);
  });

  it("places exactly one call when two requests arrive together", async () => {
    const { caller, requests } = recordingCaller();
    const results = await Promise.all([
      requestReportCallNow({} as never, caller, FARM, options),
      requestReportCallNow({} as never, caller, FARM, { ...options, now: new Date(now.getTime() + 5) }),
    ]);
    expect(results.filter((r) => r.status === "placed")).toHaveLength(1);
    expect(results.filter((r) => r.status === "blocked")).toHaveLength(1);
    expect(requests).toHaveLength(1);
  });

  it("never dials without a saved, dialable worker number", async () => {
    store.ws = { ...store.ws, settings: { ...store.ws.settings, worker: { ...store.ws.settings.worker, phone: "0501234567x" } } };
    const { caller, requests } = recordingCaller();
    expect(await requestReportCallNow({} as never, caller, FARM, options)).toEqual({ status: "blocked", reason: "no_worker_phone" });
    expect(requests).toHaveLength(0);
  });

  it("refuses once this period's report is in", async () => {
    store.ws = { ...store.ws, reports: [{ id: "rep_1", at: now.toISOString(), callId: "c", answers: [], findings: [] }], lastUpdateAt: now.toISOString() };
    const { caller, requests } = recordingCaller();
    expect(await requestReportCallNow({} as never, caller, FARM, options)).toEqual({ status: "blocked", reason: "already_reported" });
    expect(requests).toHaveLength(0);
  });

  it("ends a call Twilio refused instead of retrying, so the owner can try again at once", async () => {
    const { caller } = recordingCaller(() => ({ placed: false, reason: "rejected", status: 400 }));
    expect(await requestReportCallNow({} as never, caller, FARM, options)).toEqual({ status: "failed", reason: "not_placed" });
    expect(store.ws.reportCalls![0]).toMatchObject({ state: "missed", nextAttemptAt: null, attempts: [] });
    const { caller: second, requests } = recordingCaller();
    const later = { ...options, now: new Date(now.getTime() + 60_000) };
    expect(await requestReportCallNow({} as never, second, FARM, later)).toEqual({ status: "placed" });
    expect(requests).toHaveLength(1);
  });

  it("refuses a number outside the test allowlist before any run exists", async () => {
    const { caller, requests } = recordingCaller();
    expect(await requestReportCallNow({} as never, caller, FARM, { ...options, allowlist: ["+966500000001"] })).toEqual({ status: "blocked", reason: "not_allowed" });
    expect(requests).toHaveLength(0);
    expect(store.ws.reportCalls).toEqual([]);
    expect(store.saves).toBe(0);
  });
});
