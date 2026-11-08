import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import { toDbId } from "@/server/db/ids";
import { verifyCallToken } from "./token";
import { recordingCaller } from "./twilio";

/** One farm held in memory; runFarmAction applies the pure action to it like the database would. */
const store = vi.hoisted(() => ({ ws: null as unknown as Workspace, saves: 0 }));
vi.mock("@/server/db/service-repository", () => ({
  listScheduledFarmIds: async () => [FARM],
  runFarmAction: async (_client: unknown, _farm: string, action: (ws: Workspace) => { ws: Workspace; result: unknown }) => {
    const { ws, result } = action(structuredClone(store.ws));
    if (JSON.stringify(ws) !== JSON.stringify(store.ws)) store.saves += 1;
    // Ids as the database would return them: domain ids become stable UUIDs.
    store.ws = { ...ws, reportCalls: ws.reportCalls?.map((run) => ({ ...run, id: toDbId(FARM, run.id) })) };
    return { status: "saved", result };
  },
}));
const FARM = "11111111-1111-4111-8111-111111111111";
const SECRET = "unit-test-voice-secret-at-least-32-bytes";
const { requestReportCallNow, runReportCallScheduler } = await import("./scheduler");

const now = new Date("2026-11-12T14:00:00.000Z"); // Thursday 17:00 Riyadh
const options = { baseUrl: "https://naqah.test", now };

beforeEach(() => {
  vi.stubEnv("NAQAH_VOICE_SECRET", SECRET);
  const ws = createDemoWorkspace("en", "basic");
  store.ws = { ...ws, reports: [], calls: [], lastUpdateAt: null, reportCalls: [], clockOffsetMs: 0, settings: { ...ws.settings, worker: { ...ws.settings.worker, phone: "+966501234567" }, callSchedule: { day: 4, time: "17:00" } } };
  store.saves = 0;
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
