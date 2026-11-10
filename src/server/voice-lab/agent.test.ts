import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { askedTopic } from "@/domain/conversation/answer-topic";
import { reportSummaryId } from "@/domain/conversation/engine";
import type { Workspace } from "@/domain/types";
import { labWorkspace, openLabAgent, runLabTool, type LabSession } from "./agent";
import { isVoiceLabOwner } from "./config";
import { signLabState, verifyLabState, type LabState } from "./state";
import { sampleLabWorkspace } from "./workspace";

vi.mock("server-only", () => ({}));

const now = new Date("2026-11-08T15:00:00Z");
const ws = labWorkspace(sampleLabWorkspace("ar", now), now);
const open = () => openLabAgent(ws, now, "ar");
/** A model call: the schema makes it name the asked topic, and the worker's words are the reply it picked. */
const withTopic = (session: LabSession, name: string, args: unknown) => name === "answer_question" ? { topic: askedTopic(session), ...(args as object) } : args;
const tool = (session: LabSession, name: string, args: unknown, spoke = true, workspace: Workspace = ws) => {
  const answer = args as { value?: string; text?: string };
  const workerUtterance = answer.text ?? session.replies.find((reply) => reply.value === answer.value)?.label.ar ?? "تمام";
  return runLabTool({ session, ws: workspace, locale: "ar", name, args: withTopic(session, name, args), spoke, workerUtterance, now });
};
const said = (session: LabSession, args: unknown, workerUtterance: string, workspace: Workspace = ws) =>
  runLabTool({ session, ws: workspace, locale: "ar", name: "answer_question", args: withTopic(session, "answer_question", args), spoke: true, workerUtterance, now });

/** The herd count is the question that takes a spoken number. */
function atHerdCount(): LabSession {
  let session: LabSession = open().session;
  for (let turn = 0; turn < 60 && session.data.currentQuestionId !== "herd_count"; turn += 1) {
    const args = session.inputMode === "number" ? { text: "5" } : session.replies.length ? { value: session.replies[0].value } : { text: "تمام" };
    session = tool(session, "answer_question", args).session;
  }
  expect(session.data.currentQuestionId).toBe("herd_count");
  return session;
}

/** Answers every question with its first reply, or a number where one is asked for. */
function walkToSummary(): LabSession {
  let session: LabSession = open().session;
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
    expect(opened.instructions).toContain('"firstStep"');
    expect(opened.repromptText).toBeTruthy();
    expect(opened.view.queue.length).toBeGreaterThan(0);
  });

  it("refuses a reply the current question does not allow, without moving", () => {
    const { session } = open();
    const result = tool(session, "answer_question", { value: "not_a_reply" });
    expect(result.refused).toBe("value_not_allowed");
    expect(result.session.step).toBe(session.step);
    expect(result.view.facts).toEqual([]);
  });

  const confirm = (session: LabSession, spoke: boolean, workerUtterance: string | null, heardSummaryId: string | undefined = reportSummaryId(session, "ar")) =>
    runLabTool({ session, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke, workerUtterance, heardSummaryId, now });

  it("does not let the model confirm before the worker has spoken", () => {
    const result = confirm(walkToSummary(), false, "إيه احفظه");
    expect(result.refused).toBe("worker_has_not_confirmed");
    expect(result.view.verdict).toBeNull();
  });

  it("requires the worker's final transcript", () => {
    for (const missing of [null, ""]) {
      const result = confirm(walkToSummary(), true, missing);
      expect(result.refused).toBe("worker_has_not_confirmed");
    }
  });

  it("never saves after a summary that was interrupted or unfinished, and reads it again", () => {
    for (const heardId of [undefined, "0:stale"]) {
      const summary = walkToSummary();
      const result = runLabTool({ session: summary, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, workerUtterance: "إيه احفظه", heardSummaryId: heardId, now });
      expect(result.refused).toBe("summary_not_finished");
      expect(result.view.verdict).toBeNull();
      expect(result.summaryText).toBeTruthy();
      expect(result.summaryId).toBe(reportSummaryId(summary, "ar"));
    }
  });

  it("hands over the summary to read word for word, with its id", () => {
    let session: LabSession = open().session;
    let last = tool(session, "answer_question", { value: session.replies[0].value });
    for (let turn = 0; turn < 60 && last.session.step !== "report_summary"; turn += 1) {
      session = last.session;
      const args = session.replies.length ? { value: session.replies[0].value } : { text: session.inputMode === "number" ? "5" : "كل شي تمام" };
      last = tool(session, "answer_question", args);
    }
    expect(last.summaryText).toBeTruthy();
    expect(last.summaryId).toBe(reportSummaryId(last.session, "ar"));
    expect(last.sayText).toBeUndefined();
  });

  it.each(["لا، الملخص غلط", "إيه بس غير العلف", "لحظة", "إيه لكن فيه غلط", "ما أدري", "الجو حار", "ماهو صحيح", "مهوب صحيح"])("does not take «%s» as confirmation", (words) => {
    const result = confirm(walkToSummary(), true, words);
    expect(result.refused).toBe("worker_has_not_confirmed");
    expect(result.view.verdict).toBeNull();
  });

  it.each(["إيه احفظه", "احفظه", "تمام احفظه"])("takes «%s» as confirmation after the full summary", (words) => {
    const result = confirm(walkToSummary(), true, words);
    expect(result.refused).toBeNull();
    expect(result.view.verdict).toEqual({ kind: "would_save" });
  });

  it("stops at the third failed confirmation, as a real call does, without saving", () => {
    const first = confirm(walkToSummary(), true, "لا، الملخص غلط");
    expect(first.end).toBeNull();
    const second = confirm(first.session, true, "لا، الملخص غلط");
    expect(second.end).toBeNull();
    expect(second.sayText).toContain("أحفظه");
    expect(second.summaryText).toBeUndefined();
    const third = confirm(second.session, true, "لا، الملخص غلط");
    expect(third.end).toBe("fallback");
    expect(third.goodbye).toBeNull();
    expect(third.view.verdict).toEqual({ kind: "fallback" });
    expect(tool(third.session, "confirm_report", { confirmed: true }).view.verdict).toBeNull();
  });

  it("gives a saved verdict through the real contract and never changes the ranch", () => {
    const summary = walkToSummary();
    const before = JSON.stringify(ws);
    const result = confirm(summary, true, "إيه احفظه");
    expect(result.refused).toBeNull();
    expect(JSON.parse(result.output).status).toBe("saved");
    expect(result.end).toBe("hangup");
    expect(result.view.verdict).toEqual({ kind: "would_save" });
    expect(result.view.contract).toEqual({ valid: true });
    expect(JSON.stringify(ws)).toBe(before);
  });

  it("records an end of call as nothing saved", () => {
    const end = (session: LabSession) => runLabTool({ session, ws, locale: "ar", name: "end_call", args: { reason: "worker_ended" }, spoke: true, workerUtterance: "مع السلامة", now });
    expect(end(walkToSummary()).view.verdict).toEqual({ kind: "declined" });
    expect(end(open().session).view.verdict).toEqual({ kind: "ended" });
  });

  it("keeps the call going when the model ends it without words asking to stop", () => {
    const { session } = open();
    const result = runLabTool({ session, ws, locale: "ar", name: "end_call", args: { reason: "worker_ended" }, spoke: true, workerUtterance: "", now });
    expect(result.end).toBeNull();
    expect(result.silent).toBe(true);
    expect(result.view.verdict).toBeNull();
  });

  it("treats a no to the summary as a correction, not an end", () => {
    const result = runLabTool({ session: walkToSummary(), ws, locale: "ar", name: "confirm_report", args: { confirmed: false }, spoke: true, workerUtterance: "لا، فيه غلط", now });
    expect(result.session.step).toBe("report_correct_pick");
    expect(result.view.verdict).toBeNull();
    expect(result.end).toBeNull();
    expect(result.sayText).toBeTruthy();
  });

  it("shows answers as facts once accepted", () => {
    const summary = walkToSummary();
    const view = tool(summary, "repeat_or_clarify", { reason: "asked_to_repeat" }).view;
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
  function walkTo(step: string): LabSession {
    let session: LabSession = open().session;
    for (let turn = 0; turn < 60 && session.step !== step; turn += 1) {
      const args = session.inputMode === "number" ? { text: "5" } : session.replies.length ? { value: session.replies[0].value } : { text: "تمام" };
      session = tool(session, "answer_question", args).session;
    }
    expect(session.step).toBe(step);
    return session;
  }

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
    const session = atHerdCount();
    expect(said(session, { text: "12" }, "عشرة").refused).toBe("number_not_in_answer");
    expect(said(session, { text: "10" }, "عشرة").refused).toBeNull();
  });

  it("won't take 'unknown' from the model when the worker said a number", () => {
    expect(said(atHerdCount(), { value: "unknown" }, "عشرة").refused).toBe("answer_conflicts_with_words");
  });

  it("ignores a parser reading the current question doesn't offer", () => {
    let session: LabSession = open().session;
    for (let turn = 0; turn < 60 && session.data.currentQuestionId !== "fences_condition"; turn += 1) {
      const args = session.inputMode === "number" ? { text: "5" } : session.replies.length ? { value: session.replies[0].value } : { text: "تمام" };
      session = tool(session, "answer_question", args).session;
    }
    expect(said(session, { value: "good" }, "الشبك سليم").refused).toBeNull();
  });

  it("refuses conflicting herd-health classification instead of flipping the value", () => {
    const { session } = open();
    const result = said(session, { value: "no" }, "لا ما فيه مريض");
    expect(result.refused).toBe("answer_conflicts_with_words");
    expect(result.session.step).not.toBe("health_pick");
    expect(result.session.draft.camelUpdates).toHaveLength(0);
  });

  it("never records a healthy herd from words about something else", () => {
    const { session } = open();
    expect(session.data.queue?.[session.data.reportIndex ?? 0]?.id).toBe("herd_health");
    for (const [words, refused] of [["العلف زين", "answer_off_topic"], ["الجو حار اليوم", "answer_unclear"]]) {
      const result = said(session, { value: "yes" }, words);
      expect(result.refused).toBe(refused);
      expect(result.session.draft.camelUpdates).toEqual([]);
      expect(result.session.step).toBe(session.step);
      expect(result.session.draft.resourceUpdates).toEqual([]);
    }
    expect(said(session, { value: "yes" }, "العلف زين").session.draft.answers.map((entry) => entry.answer)).toEqual(["العلف زين"]);
    expect(said(session, { value: "yes" }, "كلها بخير").refused).toBeNull();
  });

  it("gives the model the real call's instructions, unchanged", () => {
    expect(open().instructions).toContain("لا تتكلم بنفسك أبداً");
    expect(open().instructions.endsWith("</call_data>")).toBe(true);
  });
});

describe("Voice Lab follows the server-spoken protocol", () => {
  const withMode = (reportMode: Workspace["settings"]["reportMode"]): Workspace => ({ ...ws, settings: { ...ws.settings, reportMode } });
  const openFor = (workspace: Workspace) => openLabAgent(workspace, now, "ar");
  const actionsOf = (result: { summaryText?: string; sayText?: string; silent?: true }) => [result.summaryText, result.sayText, result.silent].filter((value) => value !== undefined).length;

  function walkTo(step: string): LabSession {
    let session: LabSession = open().session;
    for (let turn = 0; turn < 60 && session.step !== step; turn += 1) {
      const args = session.inputMode === "number" ? { text: "5" } : session.replies.length ? { value: session.replies[0].value } : { text: "تمام" };
      session = tool(session, "answer_question", args).session;
    }
    expect(session.step).toBe(step);
    return session;
  }

  it("carries exactly one spoken action on every result that doesn't end the call", () => {
    let session: LabSession = open().session;
    for (let turn = 0; turn < 60 && session.step !== "report_summary"; turn += 1) {
      const args = session.replies.length ? { value: session.replies[0].value } : { text: session.inputMode === "number" ? "5" : "كل شي تمام" };
      const result = tool(session, "answer_question", args);
      expect(actionsOf(result)).toBe(1);
      expect(result.repromptText).toBeTruthy();
      session = result.session;
    }
    expect(actionsOf(tool(session, "repeat_or_clarify", { reason: "unclear" }))).toBe(1);
  });

  it("stays silent on the first noise, then says it couldn't hear, recording nothing", () => {
    const { session } = open();
    const first = runLabTool({ session, ws, locale: "ar", name: "answer_question", args: withTopic(session, "answer_question", { value: "yes" }), spoke: true, workerUtterance: "", now });
    expect(first.silent).toBe(true);
    expect(first.refused).toBe("noise");
    expect(first.session.draft).toEqual(session.draft);
    const second = runLabTool({ session: first.session, ws, locale: "ar", name: "answer_question", args: withTopic(session, "answer_question", { value: "yes" }), spoke: true, workerUtterance: "ضجيج", now });
    expect(second.silent).toBeUndefined();
    expect(second.sayText).toContain("ما وصلني صوتك زين");
    expect(second.session.draft).toEqual(session.draft);
  });

  it("speaks its own refusal with the current question", () => {
    const { session } = open();
    const result = said(session, { value: "yes" }, "العلف زين");
    expect(result.sayText).toContain("خلنا نرجع للسؤال");
    expect(result.sayText).toContain(JSON.parse(result.output).question);
  });

  it("gives up after two refusals and records unknown, never the disputed number", () => {
    let session = atHerdCount();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const result = said(session, { text: "12" }, "عشرة");
      expect(result.refused).toBe("number_not_in_answer");
      expect(result.session.draft).toEqual(session.draft);
      session = result.session;
    }
    const third = said(session, { text: "12" }, "عشرة");
    expect(third.refused).toBeNull();
    expect(third.sayText).toContain("بنسجلها غير معروف");
    expect(third.session.draft.herdCount).not.toBe(12);
  });

  it("stores free text as the worker said it, not as the model worded it", () => {
    const session = walkTo("herd_count_detail");
    const result = said(session, { text: "ناقة مفقودة في الوادي" }, "شعلة ضايعة");
    expect(result.session.draft.answers.at(-1)?.answerText?.ar).toContain("شعلة ضايعة");
    expect(JSON.stringify(result.session.draft)).not.toContain("مفقودة في الوادي");
  });

  it("warns on an urgent concern, keeps the worker's words and stays on the question", () => {
    const { session } = open();
    const result = runLabTool({ session, ws, locale: "ar", name: "flag_urgent", args: { note: "حالة طارئة" }, spoke: true, workerUtterance: "الناقة تنزف", now });
    expect(result.sayText).toContain("اتصل بصاحب العزبة مباشرة");
    expect(result.session.draft.urgentNote).toBe("الناقة تنزف");
    expect(result.session.step).toBe(session.step);
  });

  it("re-reads the whole summary after a correction, and an old id no longer confirms", () => {
    const summary = walkToSummary();
    const heardBefore = reportSummaryId(summary, "ar");
    let result = tool(summary, "correct_report", { item_id: "water_level" });
    for (let turn = 0; turn < 10 && result.session.step !== "report_summary"; turn += 1) {
      const session = result.session;
      result = tool(session, "answer_question", session.replies.length ? { value: session.replies[0].value } : { text: session.inputMode === "number" ? "5" : "تمام" });
    }
    expect(result.summaryText).toBeTruthy();
    expect(result.summaryId).not.toBe(heardBefore);
    const stale = runLabTool({ session: result.session, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, workerUtterance: "إيه احفظه", heardSummaryId: heardBefore, now });
    expect(stale.refused).toBe("summary_not_finished");
    const fresh = runLabTool({ session: result.session, ws, locale: "ar", name: "confirm_report", args: { confirmed: true }, spoke: true, workerUtterance: "إيه احفظه", heardSummaryId: result.summaryId, now });
    expect(fresh.view.verdict).toEqual({ kind: "would_save" });
  });

  it("uses the owner's fixed guided mode", () => {
    const opened = openFor(withMode("guided"));
    expect(opened.session.step).toBe("report_question");
    expect(opened.view.mode).toBe("guided");
  });

  it("lets the worker choose when the owner left it to them, either way", () => {
    const workspace = withMode("worker_choice");
    const opened = openFor(workspace);
    expect(opened.session.step).toBe("report_mode_choice");
    expect(opened.view.mode).toBeNull();
    const words = (mode: string) => runLabTool({ session: opened.session, ws: workspace, locale: "ar", name: "choose_mode", args: { mode }, spoke: true, workerUtterance: "أقول اللي صار", now });
    expect(words("open").session.step).toBe("open_listen");
    expect(words("open").view.mode).toBe("open");
    expect(words("guided").view.mode).toBe("guided");
  });

  it("takes an open update through facts, then reads it back and saves what was never mentioned as not reported", () => {
    const workspace = withMode("open");
    const opened = openFor(workspace);
    expect(opened.session.step).toBe("open_listen");
    const run = (session: LabSession, name: string, args: unknown, workerUtterance: string, heardSummaryId?: string) => runLabTool({ session, ws: workspace, locale: "ar", name, args, spoke: true, workerUtterance, heardSummaryId, now });
    const heard = run(opened.session, "record_facts", { facts: [{ type: "resource", resource: "feed", level: "low", quantity: null, evidence: "العلف قليل" }] }, "العلف قليل");
    expect(heard.refused).toBeNull();
    expect(heard.session.step).toBe("open_more");
    expect(heard.session.draft.resourceUpdates[0]).toMatchObject({ kind: "feed", level: "low" });
    let result = run(heard.session, "finish_update", {}, "لا ما عندي شي");
    for (let turn = 0; turn < 10 && result.session.step !== "report_summary"; turn += 1) {
      const session = result.session;
      result = tool(session, "answer_question", session.replies.length ? { value: session.replies[0].value } : { text: "تمام" }, true, workspace);
    }
    expect(result.summaryText).toBeTruthy();
    expect(result.view.notReported.length).toBeGreaterThan(0);
    const saved = run(result.session, "confirm_report", { confirmed: true }, "إيه احفظه", result.summaryId);
    expect(saved.view.verdict).toEqual({ kind: "would_save" });
    expect(saved.session.draft.mode).toBe("open");
    expect(saved.session.draft.coverage?.some((entry) => entry.status === "not_reported")).toBe(true);
  });

  it("keeps unsupported facts as the worker's words, recording no topic from them", () => {
    const workspace = withMode("open");
    const { session } = openFor(workspace);
    const facts = { facts: [{ type: "resource", resource: "water", level: "good", quantity: null, evidence: "الماء زين" }] };
    const attempt = (current: LabSession) => runLabTool({ session: current, ws: workspace, locale: "ar", name: "record_facts", args: facts, spoke: true, workerUtterance: "العلف قليل", now });
    const result = attempt(session);
    expect(result.refused).toBeNull();
    expect(result.session.draft.resourceUpdates).toEqual([]);
    expect(result.session.draft.answers).toHaveLength(1);
    expect(result.session.step).toBe("open_more");
    expect(result.sayText).toContain("ملاحظة");
  });

  it("never turns unsupported facts into a topic update", () => {
    const workspace = withMode("open");
    const { session } = openFor(workspace);
    const result = runLabTool({ session, ws: workspace, locale: "ar", name: "record_facts", args: { facts: [{ type: "resource", resource: "water", level: "good", quantity: null, evidence: "الماء زين" }] }, spoke: true, workerUtterance: "العلف قليل", now });
    expect(result.sayText).toBeTruthy();
    expect(result.session.draft.resourceUpdates).toEqual([]);
  });
});

describe("Voice Lab stays in step with the phone call", () => {
  const bridge = readFileSync("services/voice-bridge/server.mjs", "utf8");
  const calls = readFileSync("src/server/voice/farm-call.ts", "utf8");
  const lab = readFileSync("src/server/voice-lab/openai.ts", "utf8");
  const loop = readFileSync("src/components/voice-lab/turnLoop.ts", "utf8");

  it.each(["threshold: 0.5", "prefix_padding_ms: 300", "silence_duration_ms: 700", "create_response: false", "interrupt_response: false"])("matches the bridge's VAD setting %s", (setting) => {
    expect(bridge).toContain(setting);
    expect(lab).toContain(setting);
  });

  it("uses the bridge's voice and reasoning effort", () => {
    // The phone's default voice; a local test can pick another with --voice.
    expect(readFileSync("services/voice-bridge/config.mjs", "utf8")).toContain("env.NAQAH_REALTIME_VOICE || 'marin'");
    expect(lab).toContain('voice: "marin"');
    expect(bridge).toMatch(/reasoning: \{ effort: 'minimal' \}/);
    expect(lab).toContain('reasoning: { effort: "minimal" }');
  });

  const decide = readFileSync("src/server/voice/realtime/decide.ts", "utf8");
  const service = readFileSync("src/server/voice/realtime/service.ts", "utf8");
  it("decides through the same code as a real call, free of the write paths", () => {
    expect(readFileSync("src/server/voice-lab/agent.ts", "utf8")).toContain("decideTool(");
    expect(service).toContain("decideTool(");
    expect(decide).not.toMatch(/^import (?!type).*(?:farm-call|voice-sessions|server\/db)/m);
  });

  it("uses the real call's confirmation limits", () => {
    expect(decide).toContain("failures >= 3");
    expect(decide).toContain('"summary_not_finished"');
    expect(decide).toContain("isVerifiedConfirmation");
    expect(decide).toContain("summaryText");
    expect(bridge).toContain("requestResponse('summary', summary,");
    for (const limit of ["transcriptionMs: 2_500", "speechMs: 10_000"]) expect(bridge).toContain(limit);
    for (const value of ["TRANSCRIPTION_MS = 2_500", "SPEECH_MS = 10_000"]) expect(loop).toContain(value);
  });

  it("makes the model call tools and re-speaks on the bridge's schedule", () => {
    expect(bridge).toContain("tool_choice: 'required'");
    expect(lab).toContain('tool_choice: "required"');
    expect(bridge).toContain("repromptMs: 10_000");
    expect(loop).toContain("REPROMPT_MS = 10_000");
    expect(bridge).toContain("maxReprompts: 2");
    expect(loop).toContain("MAX_REPROMPTS = 2");
  });

  it("uses the phone call's closing line", () => {
    const closing = "انحفظ التحديث. يعطيك العافية، مع السلامة.";
    expect(calls).toContain(closing);
    expect(readFileSync("src/server/voice-lab/agent.ts", "utf8")).toContain(closing);
  });

  it("transcribes with the phone call's model and a hint", () => {
    expect(bridge).toContain("model: 'gpt-4o-transcribe'");
    expect(lab).toContain('"gpt-4o-transcribe"');
  });

  it.each(["responseMs: 45_000", "goodbyeMs: 15_000"])("matches the bridge's limit %s", (limit) => {
    expect(bridge).toContain(limit);
    expect(loop).toContain(limit.replace(/^(\w+?)Ms: /, (_, name: string) => `${name.toUpperCase()}_MS = `));
  });

  it("handles the provider events the bridge's turn logic depends on", () => {
    for (const event of ["input_audio_buffer.speech_started", "input_audio_buffer.committed", "response.function_call_arguments.done", "response.done", "session.created"]) {
      expect(loop).toContain(`"${event}"`);
    }
  });
});
