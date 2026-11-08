import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyWorkspace } from "@/domain/seed";
import type { VoiceSessionRow } from "@/server/db/voice-sessions";
import { answerFarmCall, reportCallStatus } from "./farm-call";

const mock = vi.hoisted(() => ({ read: vi.fn(), advance: vi.fn(), load: vi.fn(), save: vi.fn(), find: vi.fn(), remove: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/voice-sessions", async (original) => ({
  ...(await original<typeof import("@/server/db/voice-sessions")>()), readVoiceSession: mock.read, advanceVoiceSession: mock.advance, deleteVoiceSession: mock.remove,
}));
vi.mock("@/server/db/service-repository", async (original) => ({
  ...(await original<typeof import("@/server/db/service-repository")>()), findReportCallRun: mock.find,
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
