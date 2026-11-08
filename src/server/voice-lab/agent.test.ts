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

  it("does not let the model confirm before the worker has spoken", () => {
    const summary = walkToSummary();
    const result = tool(summary, "confirm_report", { confirmed: true }, false);
    expect(result.refused).toBe("worker_has_not_confirmed");
    expect(result.session.done).toBe(false);
  });

  it("gives a saved verdict through the real contract and never changes the ranch", () => {
    const summary = walkToSummary();
    const before = JSON.stringify(ws);
    const result = tool(summary, "confirm_report", { confirmed: true });
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

  it("refuses to record zero when the worker just said there was enough, and records nothing", () => {
    const session = walkTo("quantity_input");
    expect(["good", "medium"]).toContain(session.data.tempLevel);
    const result = tool(session, "answer_question", { text: "لا ما فيه شي" });
    expect(result.refused).toBe("quantity_contradicts_level");
    expect(result.session.step).toBe("quantity_input");
    expect(result.session.draft.resourceUpdates).toEqual(session.draft.resourceUpdates);
    expect(JSON.parse(result.output).clarify).toContain("كم باقي");
  });

  it("accepts a real number after asking, with the level intact", () => {
    const asked = tool(walkTo("quantity_input"), "answer_question", { text: "لا ما فيه شي" }).session;
    const counted = tool(asked, "answer_question", { text: "عشرة" });
    expect(counted.refused).toBeNull();
    expect(counted.session.step).toBe("quantity_confirm");
    expect(counted.session.data.tempLevel).toMatch(/good|medium/);
  });

  it("drops the earlier 'enough' when the worker repeats there is none", () => {
    const asked = tool(walkTo("quantity_input"), "answer_question", { text: "لا ما فيه شي" }).session;
    const again = tool(asked, "answer_question", { text: "لا ما فيه شي" });
    expect(again.refused).toBeNull();
    expect(again.session.data.tempLevel).toBe("unknown");
  });

  it("keeps a zero that agrees with a low level", () => {
    const session = { ...walkTo("quantity_input") };
    session.data = { ...session.data, tempLevel: "critical" };
    expect(tool(session, "answer_question", { text: "صفر" }).refused).toBeNull();
  });

  it("stores the Arabic herd detail in Arabic, with an English reading", () => {
    const session = walkTo("herd_count_detail");
    const result = tool(session, "answer_question", { text: "شعلة ضايعة" });
    const herd = result.session.draft.answers.at(-1)!;
    expect(herd.answerText?.ar).toBe(`${session.draft.herdCount} من الحلال — شعلة ضايعة`);
    expect(herd.answerText?.en).toBe(`${session.draft.herdCount} camels — شعلة ضايعة`);
    expect(result.view.facts.some((fact) => /camels/.test(fact.value))).toBe(false);
    expect(result.view.contract).toEqual({ valid: true });
  });

  it("never records an answer with no words from the worker behind it", () => {
    const { session } = open();
    const result = tool(session, "answer_question", { value: session.replies[0].value }, false);
    expect(result.refused).toMatch(/no_worker_answer|worker_has_not_answered/);
    expect(result.session.draft).toEqual(session.draft);
  });

  it("asks when the number recorded is not the number said", () => {
    const session = walkTo("quantity_input");
    const heard = "عشرة أكياس";
    const wrong = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { text: "12" }, spoke: true, heard, now });
    expect(wrong.refused).toBe("number_not_in_answer");
    const right = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: { text: "10" }, spoke: true, heard, now });
    expect(right.refused).toBeNull();
  });

  it("asks when a saved report contradicts the worker's refusal", () => {
    const summary = walkToSummary();
    const result = runLabTool({ session: summary, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "لا، الملخص غلط", now });
    expect(result.refused).toBe("answer_conflicts_with_words");
    expect(result.view.verdict).toBeNull();
    expect(result.session.done).toBe(false);
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

  it("does not loop: the worker's repeated answer goes through after one question", () => {
    const summary = walkToSummary();
    const first = runLabTool({ session: summary, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "لا، الملخص غلط", now });
    const second = runLabTool({ session: first.session, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, heard: "لا، الملخص غلط", now });
    expect(second.refused).toBeNull();
  });

  it("tells the model to clarify rather than call the tool", () => {
    expect(open().instructions).toContain("لا تنادي الأداة ولا تفترض شي");
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
