import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import type { VoiceSessionRow } from "@/server/db/voice-sessions";
import { answerFarmCall, eventFor, OWNER_LINE_CLOSED, reportCallStatus, respond, startFarmCall, type VoiceCallSession } from "./farm-call";

const mock = vi.hoisted(() => ({ read: vi.fn(), advance: vi.fn(), load: vi.fn(), save: vi.fn(), find: vi.fn(), remove: vi.fn(), caller: vi.fn(), create: vi.fn(), stale: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/voice-sessions", async (original) => ({
  ...(await original<typeof import("@/server/db/voice-sessions")>()), readVoiceSession: mock.read, advanceVoiceSession: mock.advance, deleteVoiceSession: mock.remove, createVoiceSession: mock.create, deleteStaleVoiceSessions: mock.stale,
}));
vi.mock("@/server/db/service-repository", async (original) => ({
  ...(await original<typeof import("@/server/db/service-repository")>()), findReportCallRun: mock.find, findCaller: mock.caller,
}));
vi.mock("@/server/db/queries", async (original) => ({
  ...(await original<typeof import("@/server/db/queries")>()), loadFarm: mock.load,
}));
vi.mock("./contract", async (original) => ({
  ...(await original<typeof import("./contract")>()), applyVoiceEvent: mock.save,
}));

const client = {} as SupabaseClient;
const callSid = `CA${"a".repeat(32)}`;
const now = new Date("2026-11-08T11:04:58Z");
let row: VoiceSessionRow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  mock.find.mockResolvedValue(null);
  const workspace = createEmptyWorkspace();
  mock.load.mockResolvedValue({ workspace });
  row = {
    call_sid: callSid, farm_id: "test-farm", party: "worker", locale: "ar", seq: 0, misses: 0, last_response: "cached",
    session: {
      scenario: "report_call", step: "report_question", inputMode: "choices", done: false, startedAt: now.toISOString(), notices: [],
      turns: [{ speaker: "agent", text: { ar: "كل الحلال بخير؟", en: "Are all camels well?" }, at: now.toISOString() }],
      replies: [{ id: "unknown", value: "unknown", label: { ar: "ما أدري", en: "I do not know" } }],
      data: { reportIndex: 0, queue: [{ kind: "predefined", id: "herd_health", answerKind: "herd-health", resource: null, question: { ar: "الحلال بخير؟", en: "Are the camels well?" } }] },
      draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] },
    },
  };
  mock.read.mockImplementation(async () => row);
  mock.advance.mockImplementation(async (_client, _sid, seq, next) => {
    row = { ...row, ...next, seq: seq + 1 };
    return row;
  });
});
afterEach(() => vi.restoreAllMocks());

describe("farm capture retries", () => {
  it("keeps silent questions unanswered and gives up only after three consecutive silent turns", async () => {
    const initial = row.session;
    const answer = (seq: number) => answerFarmCall(client, { callSid, seq, speech: "", digits: null, confidence: null, now });
    expect(await answer(0)).toContain("ما فهمت عليك");
    expect(await answer(1)).toContain("نعيد السؤال مرة أخيرة");
    expect(row.session).toMatchObject(initial);
    expect(row.misses).toBe(2);
    expect(row.session.draft.answers).toEqual([]);
    expect(await answer(2)).toContain("<Hangup/>");
    expect(row.session.done).toBe(true);
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("moves an unrecognized spoken answer to unknown without losing earlier answers", async () => {
    const earlier = { questionId: "earlier", question: { ar: "السابق", en: "Earlier" }, answer: "reported fact", certainty: "reported" as const, followUp: false };
    row.session.draft.answers.push(earlier);
    const first = await answerFarmCall(client, { callSid, seq: 0, speech: "hello there", digits: null, confidence: "0.0", now });
    expect(first).toContain("سمعتك");
    const next = await answerFarmCall(client, { callSid, seq: 1, speech: "hello again", digits: null, confidence: "0.45", now });
    expect(next).toContain("غير معروف ونكمل");
    expect(row.session.draft.answers).toEqual([earlier, expect.objectContaining({ questionId: "herd_health", certainty: "unknown" })]);
    expect(row.session.done).toBe(false);
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("keeps a speaking worker at the summary instead of discarding the report", async () => {
    row.session.step = "report_summary";
    row.session.replies = [
      { id: "confirm_save", value: "confirm_save", label: { ar: "تأكيد وحفظ", en: "Confirm and save" } },
      { id: "end_without_save", value: "end_without_save", label: { ar: "إنهاء بدون حفظ", en: "End without saving" } },
    ];
    for (let seq = 0; seq < 5; seq += 1) {
      expect(await answerFarmCall(client, { callSid, seq, speech: "hello there", digits: null, confidence: "0", now })).not.toContain("<Hangup/>");
    }
    for (let seq = 5; seq < 7; seq += 1) {
      expect(await answerFarmCall(client, { callSid, seq, speech: "", digits: null, now })).not.toContain("<Hangup/>");
    }
    expect(await answerFarmCall(client, { callSid, seq: 7, speech: "", digits: null, now })).toContain("<Hangup/>");
  });

  it("does not advance duplicate webhooks or write a report", async () => {
    row.seq = 2;
    expect(await answerFarmCall(client, { callSid, seq: 1, speech: "", digits: null, now })).toBe("cached");
    expect(mock.advance).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("ends after six consecutive unmatched spoken turns at the summary without saving", async () => {
    row.session.step = "report_summary";
    row.session.replies = [
      { id: "confirm_save", value: "confirm_save", label: { ar: "تأكيد وحفظ", en: "Confirm and save" } },
      { id: "end_without_save", value: "end_without_save", label: { ar: "إنهاء بدون حفظ", en: "End without saving" } },
    ];
    for (let seq = 0; seq < 5; seq += 1) {
      expect(await answerFarmCall(client, { callSid, seq, speech: "background noise", digits: null, now })).toContain("<Gather");
    }
    const goodbye = await answerFarmCall(client, { callSid, seq: 5, speech: "background noise", digits: null, now });
    expect(goodbye).toContain("<Hangup/>");
    expect(goodbye).toContain("ما قدرت أفهم");
    expect(row.session.done).toBe(true);
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("resets consecutive unmatched speech when an actual answer is accepted", async () => {
    await answerFarmCall(client, { callSid, seq: 0, speech: "background noise", digits: null, now });
    expect((row.session as { voiceUnmatched?: number }).voiceUnmatched).toBe(1);
    await answerFarmCall(client, { callSid, seq: 1, speech: "ما أدري", digits: null, now });
    expect((row.session as { voiceUnmatched?: number }).voiceUnmatched).toBe(0);
    expect(row.session.done).toBe(false);
  });

  it("still accepts an explicit unknown answer", async () => {
    row.session.data = {
      reportIndex: 0,
      queue: [{ kind: "predefined", id: "herd_health", answerKind: "herd-health", resource: null, question: { ar: "الحلال بخير؟", en: "Are the camels well?" } }],
    };
    await answerFarmCall(client, { callSid, seq: 0, speech: "ما أدري", digits: null, confidence: "0.9", now });
    expect(row.misses).toBe(0);
    expect(row.session.draft.answers).toEqual([expect.objectContaining({ questionId: "herd_health", certainty: "unknown" })]);
    expect(mock.save).not.toHaveBeenCalled();
  });

  it("keeps completed distinct from an earlier no-answer while retries keep the same event key", async () => {
    const token = { k: "report" as const, f: "00000000-0000-4000-8000-000000000001", r: "00000000-0000-4000-8000-000000000002", n: 1, l: "ar" as const, t: now.getTime() };
    for (const status of ["no-answer", "completed", "completed"]) await reportCallStatus(client, { token, callSid, status, now });
    expect(mock.save.mock.calls.map((call) => call[3].eventId)).toEqual([
      `${callSid}:final:no-answer`, `${callSid}:final:completed`, `${callSid}:final:completed`,
    ]);
  });
});

describe("the owner's line", () => {
  it("is closed on the farm path: nothing is loaded, stored or saved", async () => {
    mock.read.mockResolvedValueOnce(null);
    mock.caller.mockResolvedValue({ kind: "owner", farmId: "test-farm" });
    vi.stubEnv("NAQAH_VOICE_LOCALE", "ar");
    const xml = await startFarmCall(client, { from: "+966501234567", callSid, now });
    vi.unstubAllEnvs();
    expect(xml).toContain(OWNER_LINE_CLOSED.ar);
    expect(xml).toContain("<Hangup/>");
    expect(xml).not.toContain("<Gather");
    expect(mock.load).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
    expect(mock.save).not.toHaveBeenCalled();
  });
});

describe("reading the options aloud", () => {
  const twoChoices = (extra: Partial<VoiceCallSession> = {}): VoiceCallSession => ({ ...row.session, replies: [row.session.replies[0], { id: "yes", value: "yes", label: { ar: "إيه", en: "Yes" } }], ...extra });
  const workspace = createEmptyWorkspace();

  it("hides them on a first ask", () => {
    expect(respond(twoChoices(), 0, workspace, "ar", 1)).not.toContain("اضغط");
  });
  it("shows them once the worker has used the keypad, or on a re-ask after a miss", () => {
    expect(respond(twoChoices({ voiceKeypad: true }), 0, workspace, "ar", 1)).toContain("اضغط 1");
    expect(respond(twoChoices(), 0, workspace, "ar", 1, "", true)).toContain("اضغط 1");
  });
  it("re-asks with the options after a silent turn, on the real path", async () => {
    expect(await answerFarmCall(client, { callSid, seq: 0, speech: "", digits: null, confidence: null, now })).toContain("اضغط 1");
    expect((row.session as VoiceCallSession).voiceKeypad).toBeUndefined();
  });
  it("remembers a keypad press for the rest of the call", async () => {
    await answerFarmCall(client, { callSid, seq: 0, speech: "", digits: "1", confidence: null, now });
    expect((row.session as VoiceCallSession).voiceKeypad).toBe(true);
  });
});

describe("an empty report", () => {
  it("is ended, never sent as a saved report", () => {
    const before = { step: "report_summary", scenario: "report_call", data: { reportCallId: "run-1" } } as never;
    const refused = { session: { done: true }, commit: (ws: never) => ws } as never;
    const saved = { session: { done: true, next: { scenario: "owner_notification", reportId: "r" }, draft: { answers: [] } }, commit: (ws: never) => ws } as never;
    expect(eventFor(before, refused, { value: "confirm_save" }, callSid)).toMatchObject({ type: "report_call_ended" });
    expect(eventFor(before, saved, { value: "confirm_save" }, callSid)).toMatchObject({ type: "worker_report" });
  });
});
