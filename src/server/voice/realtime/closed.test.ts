import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VoiceSessionRow } from "@/server/db/voice-sessions";
import { signRealtimeTicket, type RealtimeTicket } from "./ticket";

const mocks = vi.hoisted(() => ({ row: null as unknown, failures: [] as unknown[][], silence: vi.fn() }));
vi.mock("@/server/db/voice-sessions", () => ({
  readVoiceSession: async () => mocks.row,
  advanceVoiceSession: async (_client: unknown, _sid: string, seq: number, next: object) => {
    mocks.row = { ...(mocks.row as object), ...next, seq: seq + 1 };
    return mocks.row;
  },
}));
vi.mock("../farm-call", () => ({ resolveSilentReportCall: mocks.silence }));
vi.mock("@/server/calls/reliability", () => ({
  recordCallFailure: async (...args: unknown[]) => { mocks.failures.push(args.slice(1, 4)); },
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

const notice = (reason: string, ticket: RealtimeTicket = TICKET, extra: Record<string, unknown> = {}) =>
  recordBridgeClosed(client, { ticket: signRealtimeTicket(ticket, SECRET), callSid: ticket.sid, reason, event: "provider_error", ...extra }, SECRET, NOW);

describe("bridge closed notice", () => {
  beforeEach(() => {
    mocks.row = row();
    mocks.failures = [];
    mocks.silence.mockClear();
    vi.spyOn(console, "info").mockImplementation(() => {});
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
