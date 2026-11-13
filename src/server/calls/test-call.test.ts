import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { recordingCaller, type OutboundCallResult } from "./twilio";

const mock = vi.hoisted(() => ({ reserve: vi.fn(), close: vi.fn(), release: vi.fn(), audit: null as Record<string, unknown> | null, reads: 0, failFinalRead: false }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/env", () => ({ farmVoiceMissing: () => [], realtimeVoiceConfig: () => ({}), voiceMode: () => "farm" }));
vi.mock("./config", () => ({ callAllowlist: () => ["+966501234567"], outboundConfig: () => ({ baseUrl: "https://naqah.test" }) }));
vi.mock("@/server/rate-limit", () => ({ reserveRateLimit: mock.reserve }));
vi.mock("./test-call-store", () => ({
  ACTIVE_TEST_CALLS: ["calling", "ringing", "answered"], TEST_CALL_COLUMNS: "*",
  expireTestCalls: async () => {}, isTestRanch: async () => true,
  requireTestCallData: (result: { data: unknown }) => result.data,
  closeTestCallRun: mock.close,
  testCallView: async (_client: unknown, row: unknown) => row,
}));
vi.mock("./scheduler", () => ({
  requestReportCallNow: async (_client: unknown, caller: import("./twilio").OutboundCaller, _farm: string, options: { onRunOpened: (id: string) => Promise<void> }) => {
    await options.onRunOpened("run");
    let result: OutboundCallResult;
    try {
      result = await caller.place({ to: "+966501234567", url: "https://naqah.test/voice", statusCallback: "https://naqah.test/status" });
    } catch {
      result = { placed: false, reason: "network_error" };
    }
    return result.placed ? { status: "placed" } : { status: "failed", reason: "not_placed", failureReason: result.reason };
  },
}));
const { startTestCall } = await import("./test-call");
const now = new Date("2026-11-13T10:00:00Z");

function fakeClient() {
  return {
    rpc: async () => ({ data: true, error: null }),
    from(table: string) {
      const chain = {
        select: () => chain, eq: () => chain, in: () => chain,
        maybeSingle: async () => ({ data: table === "farms" ? { id: "farm" } : null, error: null }),
        insert(values: Record<string, unknown>) {
          mock.audit = { id: "test", ...values };
          return chain;
        },
        update(values: Record<string, unknown>) {
          Object.assign(mock.audit!, values);
          return chain;
        },
        single: async () => {
          mock.reads += 1;
          if (mock.failFinalRead && mock.reads === 3) throw new Error("Audit read unavailable after dialling");
          return { data: mock.audit, error: null };
        },
        then(resolve: (result: unknown) => unknown) { return Promise.resolve(resolve({ data: mock.audit, error: null })); },
      };
      return chain;
    },
  };
}

describe("paid test-call placement reservations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mock.audit = null;
    mock.reads = 0;
    mock.failFinalRead = false;
    mock.reserve.mockImplementation(async () => ({ release: mock.release }));
    mock.release.mockResolvedValue(undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it.each([false, true])("keeps the audit, run and all quotas after ambiguous acceptance (throw: %s)", async (throws) => {
    const caller = throws ? { place: async () => { throw new Error("timeout after sending"); } }
      : recordingCaller(() => ({ placed: false, reason: "network_error" })).caller;
    const result = await startTestCall(fakeClient() as never, "owner", { phone: "+966501234567", requestId: "request" }, { now, caller });
    expect(result).toMatchObject({ ok: true, call: { status: "calling", run_id: "run" } });
    expect(mock.close).not.toHaveBeenCalled();
    expect(mock.release).not.toHaveBeenCalled();
  });

  it.each(["rejected", "not_configured", "invalid_number", "not_allowed"] as const)("refunds all quotas only after definite non-placement: %s", async (reason) => {
    const { caller } = recordingCaller(() => ({ placed: false, reason }));
    expect(await startTestCall(fakeClient() as never, "owner", { phone: "+966501234567", requestId: "request" }, { now, caller }))
      .toMatchObject({ ok: true, call: { status: "failed" } });
    expect(mock.close).toHaveBeenCalledWith(expect.anything(), "farm", "run");
    expect(mock.release).toHaveBeenCalledTimes(3);
  });

  it("does not dial when the shared limiter denies a slot", async () => {
    mock.reserve.mockResolvedValue(null);
    const { caller, requests } = recordingCaller();
    expect(await startTestCall(fakeClient() as never, "owner", { phone: "+966501234567", requestId: "request" }, { now, caller }))
      .toEqual({ ok: false, error: "rate_limited" });
    expect(requests).toHaveLength(0);
    expect(mock.audit).toBeNull();
  });

  it("retains quota and the active audit if reading the audit fails after sending", async () => {
    mock.failFinalRead = true;
    const { caller, requests } = recordingCaller(() => ({ placed: false, reason: "network_error" }));
    expect(await startTestCall(fakeClient() as never, "owner", { phone: "+966501234567", requestId: "request" }, { now, caller }))
      .toEqual({ ok: false, error: "failed" });
    expect(requests).toHaveLength(1);
    expect(mock.close).not.toHaveBeenCalled();
    expect(mock.release).not.toHaveBeenCalled();
    expect(mock.audit).toMatchObject({ status: "calling" });
  });
});
