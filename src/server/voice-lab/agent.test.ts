import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { CallSession } from "@/domain/conversation/engine";
import { labWorkspace, openLabAgent, runLabTool } from "./agent";
import { isVoiceLabOwner } from "./config";
import { signLabState, verifyLabState, type LabState } from "./state";
import { sampleLabWorkspace } from "./workspace";

vi.mock("server-only", () => ({}));

const now = new Date("2026-11-08T15:00:00Z");
const ws = labWorkspace(sampleLabWorkspace("ar", now), now);
const open = () => openLabAgent(ws, now, "ar");
const tool = (session: CallSession, name: string, args: unknown, spoke = true) => runLabTool({ session, ws, locale: "ar", name, args, spoke, now });

/** Answers every question with its first reply, or a number where one is asked for. */
function walkToSummary(): CallSession {
  let { session } = open();
  for (let turn = 0; turn < 60 && session.step !== "report_summary"; turn += 1) {
    const args = session.replies.length ? { value: session.replies[0].value } : { text: session.inputMode === "number" ? "5" : "كل شي تمام" };
    const result = tool(session, "answer_question", args);
    expect(result.refused).toBeNull();
    session = result.session;
    expect(session.done).toBe(false);
  }
  expect(session.step).toBe("report_summary");
  return session;
}

describe("Voice Lab agent", () => {
  it("opens with the real report questions", () => {
    const opened = open();
    expect(opened.opening).toContain("مساعد ناقة الآلي");
    expect(opened.instructions).toContain("<call_data>");
    expect(opened.view.queue.length).toBeGreaterThan(0);
  });

  it("refuses a reply the current question does not allow, without moving", () => {
    const { session } = open();
    const result = tool(session, "answer_question", { value: "not_a_reply" });
    expect(result.refused).toBe("value_not_allowed");
    expect(result.session.step).toBe(session.step);
    expect(result.view.facts).toEqual([]);
  });

  const confirm = (session: CallSession, spoke: boolean, workerUtterance: string | null, heardSummary?: boolean) =>
    runLabTool({ session, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke, workerUtterance, heardSummary, now });

  it("does not let the model confirm before the worker has spoken", () => {
    const result = confirm(walkToSummary(), false, "إيه احفظه", true);
    expect(result.refused).toBe("worker_has_not_confirmed");
    expect(result.view.verdict).toBeNull();
  });

  it("requires the worker's final transcript", () => {
    for (const missing of [null, ""]) {
      const result = confirm(walkToSummary(), true, missing, true);
      expect(result.refused).toBe("worker_has_not_confirmed");
    }
  });

  it("never saves after a summary that was interrupted or unfinished", () => {
    for (const heard of [false, undefined]) {
      const result = confirm(walkToSummary(), true, "إيه احفظه", heard);
      expect(result.refused).toBe("summary_not_finished");
      expect(result.view.verdict).toBeNull();
      expect(JSON.parse(result.output).message).toContain("It is being read again now");
      expect(result.summaryText).toBeTruthy();
    }
  });

  it("hands over the summary to read word for word when it first comes up, and not after an unclear yes", () => {
    let { session } = open();
    let last = tool(session, "answer_question", { value: session.replies[0].value });
    for (let turn = 0; turn < 60 && last.session.step !== "report_summary"; turn += 1) {
      session = last.session;
      const args = session.replies.length ? { value: session.replies[0].value } : { text: session.inputMode === "number" ? "5" : "كل شي تمام" };
      last = tool(session, "answer_question", args);
    }
    expect(last.summaryText).toBeTruthy();
    expect(confirm(last.session, true, "لا، الملخص غلط", true).summaryText).toBeUndefined();
  });

  it.each(["لا، الملخص غلط", "إيه بس غير العلف", "لحظة", "إيه لكن فيه غلط", "ما أدري", "الجو حار", "ماهو صحيح", "مهوب صحيح"])("does not take «%s» as confirmation", (said) => {
    const result = confirm(walkToSummary(), true, said, true);
    expect(result.refused).toBe("worker_has_not_confirmed");
    expect(result.view.verdict).toBeNull();
  });

  it.each(["إيه احفظه", "احفظه", "تمام احفظه"])("takes «%s» as confirmation after the full summary", (said) => {
    const result = confirm(walkToSummary(), true, said, true);
    expect(result.refused).toBeNull();
    expect(result.view.verdict).toEqual({ kind: "would_save" });
  });

  it("stops at the second failed confirmation, as a real call does, without saving", () => {
    const first = confirm(walkToSummary(), true, "لا، الملخص غلط", true);
    expect(first.end).toBeNull();
    const second = confirm(first.session, true, "لا، الملخص غلط", true);
    expect(second.end).toBe("fallback");
    expect(second.goodbye).toBeNull();
    expect(second.view.verdict).toEqual({ kind: "fallback" });
    expect(tool(second.session, "confirm_report", { confirmed: true }).view.verdict).toBeNull();
  });

  it("gives a saved verdict through the real contract and never changes the ranch", () => {
    const summary = walkToSummary();
    const before = JSON.stringify(ws);
    const result = confirm(summary, true, "إيه احفظه", true);
    expect(result.refused).toBeNull();
    expect(JSON.parse(result.output).status).toBe("saved");
    expect(result.end).toBe("hangup");
    expect(result.view.verdict).toEqual({ kind: "would_save" });
    expect(result.view.contract).toEqual({ valid: true });
    expect(JSON.stringify(ws)).toBe(before);
  });

  it("records a decline and an early end as nothing saved", () => {
    expect(tool(walkToSummary(), "confirm_report", { confirmed: false }).view.verdict).toEqual({ kind: "declined" });
    expect(tool(open().session, "end_call", { reason: "worker_ended" }).view.verdict).toEqual({ kind: "ended" });
  });

  it("shows answers as facts once accepted", () => {
    const summary = walkToSummary();
    const view = tool(summary, "confirm_report", { confirmed: false }).view;
    expect(view.facts.length).toBeGreaterThan(0);
    expect(view.answered).toBe(view.queue.length);
  });
});

describe("Voice Lab state", () => {
  const state: LabState = { u: "owner-a", c: "rtc_1", l: "ar", src: "sample", exp: 2_000, session: open().session };
  const token = signLabState(state, "secret");

  it("returns a valid token to its owner", () => expect(verifyLabState(token, "secret", "owner-a", 1_000)?.c).toBe("rtc_1"));
  it("refuses another owner", () => expect(verifyLabState(token, "secret", "owner-b", 1_000)).toBeNull());
  it("refuses an expired token", () => expect(verifyLabState(token, "secret", "owner-a", 3_000)).toBeNull());
  it("refuses a changed token", () => expect(verifyLabState(`x${token}`, "secret", "owner-a", 1_000)).toBeNull());
  it("refuses another secret", () => expect(verifyLabState(token, "other", "owner-a", 1_000)).toBeNull());
});

describe("Voice Lab access", () => {
  it("allows only listed owners, and nobody by default", () => {
    process.env.NAQAH_VOICE_LAB_OWNERS = "";
    expect(isVoiceLabOwner({ id: "a", email: "a@b.c" })).toBe(false);
    process.env.NAQAH_VOICE_LAB_OWNERS = "A@B.c, id-2";
    expect(isVoiceLabOwner({ id: "x", email: "a@b.C" })).toBe(false);
    expect(isVoiceLabOwner({ id: "x", email: "a@b.C", email_confirmed_at: "2026-01-01" })).toBe(true);
    expect(isVoiceLabOwner({ id: "id-2" })).toBe(true);
    expect(isVoiceLabOwner({ id: "x", email: "z@b.c", email_confirmed_at: "2026-01-01" })).toBe(false);
    delete process.env.NAQAH_VOICE_LAB_OWNERS;
  });
});

function sources(path: string): string[] {
  if (statSync(path).isDirectory()) return readdirSync(path).flatMap((name) => sources(join(path, name)));
  return /\.tsx?$/.test(path) && !path.endsWith(".test.ts") ? [path] : [];
}

describe("Voice Lab has no way to write or call", () => {
  const files = [...sources("src/server/voice-lab"), ...sources("src/app/api/voice-lab"), ...sources("src/components/voice-lab")];

  it.each(files)("%s stays off every write path", (file) => {
    const text = readFileSync(file, "utf8");
    expect(text).not.toMatch(/applyVoiceEvent|runFarmAction|createWritableClient|createServiceClient|SUPABASE_SECRET|service-repository|service-client|voice-sessions|farm-call|server\/calls|twilio/i);
    expect(text).not.toMatch(/\.(insert|upsert|rpc)\(/);
  });

  it("keeps the OpenAI key out of browser code", () => {
    for (const file of sources("src/components/voice-lab")) expect(readFileSync(file, "utf8")).not.toMatch(/OPENAI_API_KEY|voice-lab\/config/);
  });
});

describe("Voice Lab asks instead of guessing", () => {
  function walkTo(step: string): CallSession {
    let { session } = open();
    for (let turn = 0; turn < 60 && session.step !== step; turn += 1) {
      const args = session.inputMode === "number" ? { text: "5" } : session.replies.length ? { value: session.replies[0].value } : { text: "تمام" };
      session = tool(session, "answer_question", args).session;
    }
    expect(session.step).toBe(step);
    return session;
  }

  it("asks again about zero after 'enough', through the real engine, and records nothing", () => {
    const session = walkTo("quantity_input");
    expect(["good", "medium"]).toContain(session.data.tempLevel);
    const result = tool(session, "answer_question", { text: "لا ما فيه شي" });
    expect(result.session.step).toBe("quantity_input");
    expect(result.session.draft.resourceUpdates).toEqual(session.draft.resourceUpdates);
    expect(JSON.parse(result.output).question).toContain("كم باقي");
  });

  it("accepts a real number after asking, with the level intact", () => {
    const asked = tool(walkTo("quantity_input"), "answer_question", { text: "لا ما فيه شي" }).session;
    const counted = tool(asked, "answer_question", { text: "عشرة" });
    expect(counted.session.step).toBe("quantity_confirm");
    expect(counted.session.data.tempLevel).toMatch(/good|medium/);
  });

  it("drops the earlier 'enough' when the worker repeats there is none", () => {
    const asked = tool(walkTo("quantity_input"), "answer_question", { text: "لا ما فيه شي" }).session;
    expect(tool(asked, "answer_question", { text: "لا ما فيه شي" }).session.data.tempLevel).toBe("unknown");
  });

  it("stores the Arabic herd detail in Arabic, with an English reading", () => {
    const session = walkTo("herd_count_detail");
    const result = tool(session, "answer_question", { text: "شعلة ضايعة" });
    const herd = result.session.draft.answers.at(-1)!;
    expect(herd.answerText?.ar).toBe(`${session.draft.herdCount} من الحلال — شعلة ضايعة`);
    expect(result.view.facts.some((fact) => /camels/.test(fact.value))).toBe(false);
    expect(result.view.contract).toEqual({ valid: true });
  });

  it("never records an answer with no words from the worker behind it", () => {
    const { session } = open();
    const result = tool(session, "answer_question", { value: session.replies[0].value }, false);
    expect(result.refused).toBe("worker_has_not_answered");
    expect(result.session.draft).toEqual(session.draft);
  });

  it("asks when the number recorded is not the number said", () => {
    const session = walkTo("quantity_input");
    const heard = "عشرة أكياس";
    expect(runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { text: "12" }, spoke: true, heard, now }).refused).toBe("number_not_in_answer");
    expect(runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { text: "10" }, spoke: true, heard, now }).refused).toBeNull();
  });

  it("won't accept an answer without the worker's words once the question needed clarifying", () => {
    const session = walkTo("quantity_input");
    const first = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { text: "12" }, spoke: true, heard: "عشرة أكياس", now });
    const late = runLabTool({ session: first.session, ws, locale: "ar", name: "answer_question", args: { text: "12" }, spoke: true, heard: null, now });
    expect(late.refused).toBe("number_not_in_answer");
    expect(late.session.draft).toEqual(session.draft);
  });

  it("won't take 'unknown' from the model when the worker said a number", () => {
    const session = walkTo("quantity_input");
    const result = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { value: "quantity_unknown" }, spoke: true, heard: "عشرة أكياس", now });
    expect(result.refused).toBe("answer_conflicts_with_words");
  });

  it("ignores a parser reading the current question doesn't offer", () => {
    let { session } = open();
    for (let turn = 0; turn < 60 && session.data.currentQuestionId !== "fences_condition"; turn += 1) {
      const args = session.inputMode === "number" ? { text: "5" } : session.replies.length ? { value: session.replies[0].value } : { text: "تمام" };
      session = tool(session, "answer_question", args).session;
    }
    const result = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { value: "good" }, spoke: true, heard: "الشبك سليم", now });
    expect(result.refused).toBeNull();
  });

  it("keeps asking when the words keep disagreeing, and never accepts on a repeat", () => {
    let session = walkTo("quantity_input");
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const result = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { text: "12" }, spoke: true, heard: "عشرة أكياس", now });
      expect(result.refused).toBe("number_not_in_answer");
      expect(result.session.draft).toEqual(session.draft);
      session = result.session;
    }
  });

  it("follows the worker's clear words on the herd-health question, as a real call does", () => {
    const { session } = open();
    const result = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { value: "no" }, spoke: true, heard: "لا ما فيه مريض", now });
    expect(result.refused).toBeNull();
    expect(result.session.step).not.toBe("health_pick");
    expect(result.session.draft.camelUpdates.every((update) => update.health === "healthy")).toBe(true);
  });

  it("never records a healthy herd from words about something else", () => {
    const { session } = open();
    expect(session.data.queue?.[session.data.reportIndex ?? 0]?.id).toBe("herd_health");
    const yes = (heard: string) => runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { value: "yes" }, spoke: true, heard, now });
    for (const [heard, refused] of [["العلف زين", "answer_off_topic"], ["الجو حار اليوم", "answer_unclear"], ["", "answer_unclear"]]) {
      const result = yes(heard);
      expect(result.refused).toBe(refused);
      expect(result.session.draft.camelUpdates).toEqual([]);
      expect(result.session.step).toBe(session.step);
      expect(result.view.facts).toEqual([]);
    }
    expect(yes("كلها بخير").refused).toBeNull();
  });

  it("gives the model the real call's instructions, unchanged", () => {
    expect(open().instructions).toContain("إذا انقطع الملخص أعده كاملاً");
    expect(open().instructions.endsWith("</call_data>")).toBe(true);
  });
});

describe("Voice Lab stays in step with the phone call", () => {
  const bridge = readFileSync("services/voice-bridge/server.mjs", "utf8");
  const calls = readFileSync("src/server/voice/farm-call.ts", "utf8");
  const lab = readFileSync("src/server/voice-lab/openai.ts", "utf8");
  const loop = readFileSync("src/components/voice-lab/turnLoop.ts", "utf8");

  it.each(["threshold: 0.5", "prefix_padding_ms: 300", "silence_duration_ms: 500", "create_response: false", "interrupt_response: false"])("matches the bridge's VAD setting %s", (setting) => {
    expect(bridge).toContain(setting);
    expect(lab).toContain(setting);
  });

  it("uses the bridge's voice and reasoning effort", () => {
    expect(bridge).toMatch(/voice: 'marin'/);
    expect(lab).toContain('voice: "marin"');
    expect(bridge).toMatch(/reasoning: \{ effort: 'minimal' \}/);
    expect(lab).toContain('reasoning: { effort: "minimal" }');
  });

  const service = readFileSync("src/server/voice/realtime/service.ts", "utf8");
  it("uses the real call's confirmation limits", () => {
    expect(service).toContain("failures >= 2");
    expect(service).toContain('"summary_not_finished"');
    expect(service).toContain("isVerifiedConfirmation");
    expect(service).toContain("summaryText");
    expect(bridge).toContain("requestResponse('summary', summary)");
    for (const limit of ["transcriptionMs: 2_500", "speechMs: 10_000"]) expect(bridge).toContain(limit);
    for (const value of ["TRANSCRIPTION_MS = 2_500", "SPEECH_MS = 10_000"]) expect(loop).toContain(value);
  });

  it("uses the phone call's closing line", () => {
    expect(calls).toContain("تم حفظ التحديث، شكراً لك. مع السلامة.");
  });

  it.each(["silenceMs: 45_000", "responseMs: 45_000", "goodbyeMs: 15_000"])("matches the bridge's limit %s", (limit) => {
    expect(bridge).toContain(limit);
    expect(loop).toContain(limit.replace(/^(\w+?)Ms: /, (_, name: string) => `${name.toUpperCase()}_MS = `));
  });

  it("handles the provider events the bridge's turn logic depends on", () => {
    for (const event of ["input_audio_buffer.speech_started", "input_audio_buffer.committed", "response.function_call_arguments.done", "response.done", "session.created"]) {
      expect(loop).toContain(`"${event}"`);
    }
  });
});
