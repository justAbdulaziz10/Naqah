import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceSessionRow } from "@/server/db/voice-sessions";
import { signRealtimeTicket, type RealtimeTicket } from "./ticket";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "@/domain/reportCalls";
import { createEmptyWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";

const mocks = vi.hoisted(() => ({
  row: null as unknown, failures: [] as unknown[][], silence: vi.fn(), order: [] as string[],
  workspace: null as unknown, deferred: [] as (() => Promise<unknown>)[],
}));
vi.mock("@/server/db/voice-sessions", () => ({
  readVoiceSession: async () => mocks.row,
  advanceVoiceSession: async (_client: unknown, _sid: string, seq: number, next: object) => {
    mocks.order.push("session");
    mocks.row = { ...(mocks.row as object), ...next, seq: seq + 1 };
    return mocks.row;
  },
}));
vi.mock("../farm-call", () => ({ resolveSilentReportCall: mocks.silence }));
vi.mock("@/server/calls/reliability", () => ({
  recordCallFailure: async (...args: unknown[]) => { mocks.failures.push(args.slice(1, 4)); },
}));
vi.mock("@/server/calls/after", () => ({
  afterResponse: async (task: () => Promise<unknown>) => { mocks.deferred.push(task); },
}));
vi.mock("@/server/db/service-repository", () => ({
  findReportCallRun: async () => ({ farmId: "farm-1", runId: "run-1" }),
  runFarmAction: async (_client: unknown, _farm: string, action: (ws: Workspace) => { ws: Workspace }) => {
    mocks.order.push("farm");
    mocks.workspace = action(mocks.workspace as Workspace).ws;
  },
}));

const { recordBridgeClosed } = await import("./closed");

const SECRET = "closed-test-secret";
const NOW = new Date("2026-11-13T15:00:00Z");
const SID = `CA${"c".repeat(32)}`;
const TICKET: RealtimeTicket = { sid: SID, f: "farm-1", r: "run-1", l: "ar", j: "jti-1", t: NOW.getTime() };
const client = {} as SupabaseClient;

function row(realtime: Record<string, unknown> = {}, done = false): VoiceSessionRow {
  return {
    call_sid: SID, farm_id: "farm-1", party: "worker", locale: "ar", seq: 3, misses: 0, last_response: "",
    session: { done, realtime: { jti: "jti-1", closed: false, recent: [], ...realtime } } as unknown as VoiceSessionRow["session"],
  };
}

const notice = async (reason: string, ticket: RealtimeTicket = TICKET, extra: Record<string, unknown> = {}) => {
  const outcome = await recordBridgeClosed(client, { ticket: signRealtimeTicket(ticket, SECRET), callSid: ticket.sid, reason, event: "provider_error", ...extra }, SECRET, NOW);
  // The run's follow-up runs after the response, as `after` does in Next.
  for (const task of mocks.deferred.splice(0)) await task();
  return outcome;
};

/** A scheduled run whose first attempt was answered a minute before the ticket. */
function answeredRun(): Workspace {
  const at = new Date(NOW.getTime() - 60_000);
  const ws = createEmptyWorkspace("basic");
  ws.setupComplete = true;
  ws.settings.worker = { id: "w1", name: "Ahmed", phone: "+966501234567", language: "ar" };
  ws.settings.callSchedule = { day: 4, time: "17:00" };
  const opened = startReportCall(ws, at, "schedule");
  opened.ws.reportCalls![0].id = "run-1";
  return resolveReportCallAttempt(placeReportCallAttempt(opened.ws, at, "run-1").ws, at, "run-1", true).ws;
}

describe("bridge closed notice", () => {
  beforeEach(() => {
    mocks.row = row();
    mocks.failures = [];
    mocks.silence.mockClear();
    vi.spyOn(console, "info").mockImplementation(() => {});
    mocks.order = [];
    mocks.deferred = [];
  });

  it("treats silence after the worker spoke as an answered call that ended unsaved", async () => {
    mocks.row = row({ naturalBase: {} });
    mocks.workspace = answeredRun();
    expect(await notice("silence", TICKET, { workerSpoke: true })).toBe("recorded");
    expect(mocks.silence).not.toHaveBeenCalled();
    expect(mocks.failures).toEqual([["farm-1", "run-1", "not_saved"]]);
    // Stored as a normal ending, so a later status callback also reads it as answered-but-unsaved.
    expect((mocks.row as VoiceSessionRow).session).toMatchObject({ bridgeCloseReason: "normal", done: true });
    const workspace = mocks.workspace as Workspace;
    const run = workspace.reportCalls![0];
    expect(run.state).toBe("calling");
    expect(run.attempts.map((entry) => entry.result)).toEqual(["answered"]);
    expect(run.nextAttemptAt).not.toBeNull();
    expect(workspace.calls.some((call) => call.kind === "worker_report_missed")).toBe(false);
  });

  it("keeps the unanswered path when workerSpoke is false or absent, and refuses a malformed flag", async () => {
    mocks.row = row({ naturalBase: {} });
    await notice("silence", TICKET, { workerSpoke: false });
    mocks.row = row({ naturalBase: {} });
    await notice("silence");
    expect(mocks.silence).toHaveBeenCalledTimes(2);
    expect(mocks.failures.map((entry) => entry[2])).toEqual(["no_answer", "no_answer"]);
    expect((mocks.row as VoiceSessionRow).session).toMatchObject({ bridgeCloseReason: "silence" });
    expect(await notice("silence", TICKET, { workerSpoke: "yes" })).toBe("invalid");
  });

  it("stores the closure on the session before any farm work", async () => {
    mocks.row = row({ naturalBase: {} });
    mocks.workspace = answeredRun();
    const body = { ticket: signRealtimeTicket(TICKET, SECRET), callSid: SID, reason: "silence", workerSpoke: true };
    expect(await recordBridgeClosed(client, body, SECRET, NOW)).toBe("recorded");
    expect(mocks.order).toEqual(["session"]);
    for (const task of mocks.deferred.splice(0)) await task();
    expect(mocks.order).toEqual(["session", "farm"]);
  });

  it("records an OpenAI failure as the run's diagnostic", async () => {
    expect(await notice("openai_error")).toBe("recorded");
    expect(await notice("openai_credit")).toBe("recorded");
    expect(await notice("timeout")).toBe("recorded");
    expect(mocks.failures).toEqual([["farm-1", "run-1", "bridge_disconnected"], ["farm-1", "run-1", "openai_quota"], ["farm-1", "run-1", "timed_out"]]);
  });

  it("leaves normal endings and caller hang-ups to the status callback", async () => {
    expect(await notice("normal")).toBe("logged");
    expect(await notice("twilio_closed")).toBe("logged");
    expect(mocks.failures).toEqual([]);
  });

  it("records silence only when the call does not carry on by keypad", async () => {
    expect(await notice("silence")).toBe("logged");
    mocks.row = row({ naturalBase: {} });
    expect(await notice("silence")).toBe("recorded");
    mocks.row = null;
    expect(await notice("silence")).toBe("recorded");
    expect(mocks.failures.map((entry) => entry[2])).toEqual(["no_answer", "no_answer"]);
  });

  it("skips an owner's call", async () => {
    mocks.row = { ...row(), party: "owner" };
    expect(await notice("openai_error", { ...TICKET, p: "owner" })).toBe("logged");
    expect(mocks.failures).toEqual([]);
  });

  it("stores a closure once and resolves natural silence, but not guided fallback", async () => {
    await notice("silence");
    expect(mocks.silence).not.toHaveBeenCalled();
    mocks.row = row({ naturalBase: {} });
    await notice("silence");
    const seq = (mocks.row as VoiceSessionRow).seq;
    await notice("silence");
    expect((mocks.row as VoiceSessionRow).seq).toBe(seq);
    expect(mocks.silence).toHaveBeenCalledWith(client, TICKET, NOW);
    expect((mocks.row as VoiceSessionRow).session).toMatchObject({ bridgeCloseReason: "silence", done: true, realtime: { closed: true, fallbackPrepared: true } });
    expect((mocks.row as VoiceSessionRow).last_response).toBe("<Response><Hangup/></Response>");
  });

  it("refuses a bad ticket, another call's sid, a mismatched row and an unknown reason", async () => {
    expect(await recordBridgeClosed(client, { ticket: "nope", callSid: SID, reason: "normal" }, SECRET, NOW)).toBe("forbidden");
    expect(await notice("normal", TICKET, { callSid: `CA${"d".repeat(32)}` })).toBe("forbidden");
    mocks.row = row({ jti: "other" });
    expect(await notice("openai_error")).toBe("forbidden");
    expect(await notice("crashed")).toBe("invalid");
    expect(await notice("normal", TICKET, { event: "Not A Label" })).toBe("invalid");
    expect(mocks.failures).toEqual([]);
  });
});
