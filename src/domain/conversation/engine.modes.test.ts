import { describe, expect, it } from "vitest";
import { fromRiyadh } from "../clock";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "../reportCalls";
import { evaluateFindings } from "../findings";
import { createDemoWorkspace } from "../seed";
import type { Workspace } from "../types";
import { addUrgentNote, addWorkerNote, answer, reportSummaryId, resumeOpenAsGuided, start, type AnswerInput, type CallSession, type OpenFact } from "./engine";

const NOW = fromRiyadh(2026, 11, 5, 17, 10);
const CUSTOM_ID = "custom-vet";

function callOn(customize: (ws: Workspace) => void = () => {}, modesAvailable = false) {
  const ws = createDemoWorkspace("ar", "ultimate", NOW);
  ws.reports = [];
  ws.calls = [];
  ws.taskTickets = [];
  ws.pendingWorkerCalls = [];
  ws.noAnswerTickets = [];
  ws.settings.customQuestions = [{ id: CUSTOM_ID, text: "جا البيطري اليوم؟", createdAt: NOW.toISOString() }];
  customize(ws);
  const opened = startReportCall(ws, NOW, "manual");
  const placed = placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws;
  const live = resolveReportCallAttempt(placed, NOW, opened.run!.id, true).ws;
  return { ws: live, session: start(live, NOW, "report_call", { reportCallId: opened.run!.id, modesAvailable }).session };
}

const step = (session: CallSession, ws: Workspace, input: AnswerInput) => answer(session, ws, NOW, input).session;
const lastLine = (session: CallSession) => [...session.turns].reverse().find((entry) => entry.speaker === "agent")!.text.ar;

function answerEverything(session: CallSession, ws: Workspace) {
  let current = session;
  let guard = 0;
  while (current.step !== "report_summary") {
    if (guard++ > 40) throw new Error("no summary reached at " + current.step);
    const id = current.data.currentQuestionId;
    let input: AnswerInput;
    if (current.step === "report_question" && id === "herd_health") input = { value: "yes" };
    else if (current.step === "report_question" && id === "herd_count") input = { value: "unknown" };
    else if (current.step === "report_question" && id === "feed_level") input = { value: "low" };
    else if (current.step === "report_question" && id === CUSTOM_ID) input = { text: "لا ما جا" };
    else if (current.inputMode === "text") input = { text: "ملاحظة" };
    else input = { value: current.replies[0].value };
    current = step(current, ws, input);
  }
  return current;
}

const planOf = (ws: Workspace, ids: string[]) => {
  ws.settings.questionPlan = ids.map((id) => ({ id, enabled: true, required: true }));
};

describe("read-back", () => {
  it("reads back unknowns and custom answers, not only herd and supply facts", () => {
    const { ws, session } = callOn();
    const summary = answerEverything(session, ws);
    const text = lastLine(summary);
    expect(text).toContain("عدد الحلال: ما أدري");
    expect(text).toContain("جا البيطري اليوم؟ لا ما جا");
    expect(text).toContain("العلف");
    expect(summary.draft.answers.length).toBeGreaterThan(3);
    for (const entry of summary.draft.answers) {
      if (entry.questionId === "herd_health") continue;
      expect(text).toContain(entry.answerText?.ar ?? entry.answer);
    }
  });

  it("never reads a number with an unknown level", () => {
    const { ws, session } = callOn((workspace) => planOf(workspace, ["water_level"]));
    let current = step(session, ws, { text: "200000" });
    while (current.step !== "report_summary") current = step(current, ws, { text: "لا", value: current.inputMode === "text" ? undefined : current.replies[0].value });
    expect(lastLine(current)).not.toContain("غير معروف");
    expect(lastLine(current)).toContain("200000 لتر");
  });
});

describe("corrections", () => {
  it("offers a correction at the summary and re-reads the whole summary after it", () => {
    const { ws, session } = callOn();
    const summary = answerEverything(session, ws);
    expect(summary.replies.map((entry) => entry.value)).toEqual(["confirm_save", "correct", "end_without_save"]);
    const pick = step(summary, ws, { value: "correct" });
    expect(pick.step).toBe("report_correct_pick");
    expect(pick.replies.map((entry) => entry.value)).toContain("correct:feed_level");
    const asked = step(pick, ws, { value: "correct:feed_level" });
    expect(asked.data.currentQuestionId).toBe("feed_level");
    expect(asked.draft.resourceUpdates.find((entry) => entry.kind === "feed")).toBeUndefined();
    const again = step(asked, ws, { value: "good" });
    expect(again.step).toBe("report_summary");
    expect(again.draft.resourceUpdates.filter((entry) => entry.kind === "feed")).toHaveLength(1);
    expect(again.draft.resourceUpdates.find((entry) => entry.kind === "feed")?.level).toBe("good");
    expect(again.draft.answers.filter((entry) => entry.questionId === "feed_level")).toHaveLength(1);
    expect(lastLine(again)).toContain("جا البيطري اليوم؟ لا ما جا");
  });

  it("changes the summary id after a correction, so an old confirmation can't apply", () => {
    const { ws, session } = callOn();
    const summary = answerEverything(session, ws);
    const before = reportSummaryId(summary, "ar");
    expect(reportSummaryId(summary, "ar")).toBe(before);
    const asked = step(summary, ws, { value: "correct:herd_count" });
    const again = step(asked, ws, { value: "unknown" });
    expect(again.step).toBe("report_summary");
    expect(reportSummaryId(again, "ar")).not.toBe(before);
  });

  it("a correction of camel health forgets the earlier camels", () => {
    const { ws, session } = callOn();
    const summary = answerEverything(session, ws);
    expect(summary.draft.camelUpdates.length).toBeGreaterThan(0);
    const asked = step(summary, ws, { value: "correct:herd_health" });
    expect(asked.draft.camelUpdates).toEqual([]);
  });

  it("can go back without changing anything, or end without saving", () => {
    const { ws, session } = callOn();
    const summary = answerEverything(session, ws);
    const back = step(step(summary, ws, { value: "correct" }), ws, { value: "back_to_summary" });
    expect(back.step).toBe("report_summary");
    expect(back.draft.answers).toHaveLength(summary.draft.answers.length);
    const ended = answer(step(summary, ws, { value: "correct" }), ws, NOW, { value: "end_without_save" });
    expect(ended.session.done).toBe(true);
  });

  it("saves exactly what was last read", () => {
    const { ws, session } = callOn();
    const summary = answerEverything(session, ws);
    const asked = step(summary, ws, { value: "correct:herd_count" });
    const again = step(asked, ws, { value: "unknown" });
    const saved = answer(again, ws, NOW, { value: "confirm_save" });
    const next = saved.commit!(ws);
    expect(next.reports[0].answers.filter((entry) => entry.questionId === "herd_count")).toHaveLength(1);
  });
});

describe("owner plan", () => {
  it("asks only enabled questions, in the owner's order", () => {
    const { session } = callOn((workspace) => {
      workspace.settings.questionPlan = [
        { id: "water_level", enabled: true, required: true },
        { id: CUSTOM_ID, enabled: true, required: true },
        { id: "herd_health", enabled: false, required: true },
        { id: "herd_count", enabled: false, required: true },
        { id: "feed_level", enabled: false, required: true },
        { id: "fences_condition", enabled: false, required: true },
        { id: "shelter_condition", enabled: false, required: true },
        { id: "medicine_stock", enabled: false, required: true },
      ];
    });
    expect(session.data.queue?.map((item) => item.id)).toEqual(["water_level", CUSTOM_ID]);
    expect(session.data.currentQuestionId).toBe("water_level");
  });

  it("an optional question can be skipped and is saved as not reported", () => {
    const { ws, session } = callOn((workspace) => {
      workspace.settings.questionPlan = [{ id: CUSTOM_ID, enabled: true, required: false }, ...["herd_health", "herd_count", "feed_level", "water_level", "fences_condition", "shelter_condition", "medicine_stock"].map((id) => ({ id, enabled: false, required: true }))];
    });
    expect(session.replies.map((entry) => entry.value)).toContain("skip_question");
    const summary = step(session, ws, { value: "skip_question" });
    expect(summary.step).toBe("report_summary");
    const unsaved = answer(summary, ws, NOW, { value: "confirm_save" });
    expect(unsaved.session.done).toBe(true);
    expect(unsaved.session.next).toBeUndefined();
    const withAnswer = callOn((workspace) => {
      workspace.settings.questionPlan = [{ id: CUSTOM_ID, enabled: true, required: false }, { id: "feed_level", enabled: true, required: true }, ...["herd_health", "herd_count", "water_level", "fences_condition", "shelter_condition", "medicine_stock"].map((id) => ({ id, enabled: false, required: true }))];
    });
    let current = step(withAnswer.session, withAnswer.ws, { value: "skip_question" });
    current = step(current, withAnswer.ws, { value: "good" });
    const saved = answer(current, withAnswer.ws, NOW, { value: "confirm_save" });
    expect(saved.commit!(withAnswer.ws).reports[0].coverage).toEqual([{ questionId: CUSTOM_ID, status: "not_reported" }, { questionId: "feed_level", status: "reported" }]);
  });

  it("does not personalize the owner's own words", () => {
    const { session } = callOn((workspace) => {
      workspace.settings.customQuestions = [{ id: CUSTOM_ID, text: "أحمد سقى الحلال؟", createdAt: NOW.toISOString() }];
      workspace.settings.questionPlan = [{ id: CUSTOM_ID, enabled: true, required: true }, ...["herd_health", "herd_count", "feed_level", "water_level", "fences_condition", "shelter_condition", "medicine_stock"].map((id) => ({ id, enabled: false, required: true }))];
    });
    expect(session.turns.at(-1)?.literal).toBe(true);
  });
});

describe("urgent concerns and empty reports", () => {
  it("re-reads the summary, with a new id, when a concern is raised at the summary", () => {
    const { ws, session } = callOn();
    const summary = answerEverything(session, ws);
    const flagged = addUrgentNote(summary, ws, NOW, "الناقة طايحة");
    expect(lastLine(flagged)).toContain("الناقة طايحة");
    expect(reportSummaryId(flagged, "ar")).not.toBe(reportSummaryId(summary, "ar"));
    expect(addUrgentNote(flagged, ws, NOW, "والبوابة مفتوحة").draft.urgentNote).toContain("الناقة طايحة");
  });

  it("ends a picked-up call when the owner has since switched everything off", () => {
    const off = ["herd_health", "herd_count", "feed_level", "water_level", "fences_condition", "shelter_condition", "medicine_stock", CUSTOM_ID];
    const { ws, session } = callOn();
    ws.settings.questionPlan = off.map((id) => ({ id, enabled: false, required: true }));
    const restarted = start(ws, NOW, "report_call", { reportCallId: session.data.reportCallId });
    expect(restarted.session.done).toBe(true);
  });
});

describe("mode choice", () => {
  it("is always guided on a call that has no realtime model", () => {
    const { session } = callOn((workspace) => { workspace.settings.reportMode = "open"; });
    expect(session.step).toBe("report_question");
    expect(session.data.reportMode).toBe("guided");
  });

  it("asks only when the owner lets the worker choose", () => {
    expect(callOn((workspace) => { workspace.settings.reportMode = "worker_choice"; }, true).session.step).toBe("report_mode_choice");
    expect(callOn((workspace) => { workspace.settings.reportMode = "guided"; }, true).session.step).toBe("report_question");
    expect(callOn((workspace) => { workspace.settings.reportMode = "open"; }, true).session.step).toBe("open_listen");
  });

  it("routes the worker's choice", () => {
    const { ws, session } = callOn((workspace) => { workspace.settings.reportMode = "worker_choice"; }, true);
    expect(step(session, ws, { value: "mode_open" }).step).toBe("open_listen");
    const guided = step(session, ws, { value: "mode_guided" });
    expect(guided.step).toBe("report_question");
    expect(guided.data.reportMode).toBe("guided");
  });
});

describe("open mode", () => {
  const open = (customize: (ws: Workspace) => void = () => {}) =>
    callOn((workspace) => { workspace.settings.reportMode = "open"; customize(workspace); }, true);
  const camel = (ws: Workspace, index = 0) => ws.camels[index];

  it("sorts several topics into their own places and asks if there is more", () => {
    const { ws, session } = open();
    const facts: OpenFact[] = [
      { type: "camel_health", camelId: camel(ws).id, scope: "one", status: "sick", note: "تعرج", evidence: "x" },
      { type: "resource", resource: "feed", level: "low", quantity: 5, evidence: "x" },
      { type: "custom", questionId: CUSTOM_ID, answer: "جا الصبح", evidence: "x" },
    ];
    const more = step(session, ws, { facts });
    expect(more.step).toBe("open_more");
    expect(lastLine(more)).toBe("فيه شي ثاني تبي تضيفه؟");
    expect(more.draft.camelUpdates).toEqual([{ camelId: camel(ws).id, health: "sick", note: "تعرج", certainty: "reported" }]);
    expect(more.draft.resourceUpdates.map((entry) => entry.kind)).toEqual(["feed"]);
    expect(more.draft.resourceUpdates[0].certainty).toBe("approximate");
    expect(more.draft.answers.find((entry) => entry.questionId === CUSTOM_ID)?.answer).toBe("جا الصبح");
  });

  it("marks everything unmentioned as not reported and never as healthy", () => {
    const { ws, session } = open();
    const more = step(session, ws, { facts: [{ type: "resource", resource: "water", level: "good", quantity: null, evidence: "x" }] });
    const summary = step(more, ws, { value: "open_done" });
    expect(summary.step).toBe("report_summary");
    expect(summary.draft.camelUpdates).toEqual([]);
    const saved = answer(summary, ws, NOW, { value: "confirm_save" });
    const report = saved.commit!(ws).reports[0];
    expect(report.mode).toBe("open");
    const status = Object.fromEntries((report.coverage ?? []).map((entry) => [entry.questionId, entry.status]));
    expect(status.water_level).toBe("reported");
    expect(status.herd_health).toBe("not_reported");
    expect(status.feed_level).toBe("not_reported");
    expect(status[CUSTOM_ID]).toBe("not_reported");
  });

  it("asks which camel when the worker didn't say", () => {
    const { ws, session } = open();
    const asked = step(session, ws, { facts: [{ type: "camel_health", camelId: null, scope: "one", status: "sick", note: null, evidence: "x" }] });
    expect(asked.step).toBe("open_clarify");
    expect(asked.draft.camelUpdates).toEqual([]);
    const more = step(asked, ws, { value: "camel:" + camel(ws).id });
    expect(more.step).toBe("open_more");
    expect(more.draft.camelUpdates[0].camelId).toBe(camel(ws).id);
  });

  it("keeps the concern as a note when the camel can't be identified", () => {
    const { ws, session } = open();
    const asked = step(session, ws, { facts: [{ type: "camel_health", camelId: null, scope: "one", status: "sick", note: null, evidence: "x" }] });
    const more = step(asked, ws, { value: "unknown" });
    expect(more.draft.camelUpdates).toEqual([]);
    expect(more.draft.answers.some((entry) => entry.answerText?.ar.includes("غير محددة"))).toBe(true);
    expect(evaluateFindings(ws, more.draft).some((finding) => finding.text.ar.includes("غير محددة"))).toBe(true);
  });

  it("one observation never spreads to the herd", () => {
    const { ws, session } = open();
    const more = step(session, ws, { facts: [{ type: "camel_health", camelId: camel(ws).id, scope: "one", status: "healthy", note: null, evidence: "x" }] });
    expect(more.draft.camelUpdates).toHaveLength(1);
  });

  it("«the rest are fine» never overwrites a camel the worker named", () => {
    const { ws, session } = open();
    const more = step(session, ws, { facts: [
      { type: "camel_health", camelId: camel(ws).id, scope: "one", status: "sick", note: null, evidence: "x" },
      { type: "camel_health", camelId: null, scope: "all", status: "healthy", note: null, evidence: "x" },
    ] });
    expect(more.draft.camelUpdates.find((entry) => entry.camelId === camel(ws).id)?.health).toBe("sick");
    expect(more.draft.camelUpdates.filter((entry) => entry.health === "healthy")).toHaveLength(ws.camels.length - 1);
    const summary = step(more, ws, { value: "open_done" });
    expect(lastLine(summary)).toContain("الباقي بخير");
    expect(evaluateFindings(ws, summary.draft).some((finding) => finding.text.ar.includes(camel(ws).name))).toBe(true);
  });

  it("reads back a note given about the whole herd", () => {
    const { ws, session } = open();
    const more = step(session, ws, { facts: [{ type: "camel_health", camelId: null, scope: "all", status: "watch", note: "ما تاكل زين", evidence: "x" }] });
    expect(lastLine(step(more, ws, { value: "open_done" }))).toContain("ما تاكل زين");
  });

  it("a later fact replaces an earlier one on the same topic", () => {
    const { ws, session } = open();
    const more = step(session, ws, { facts: [{ type: "resource", resource: "feed", level: "low", quantity: null, evidence: "x" }] });
    const fixed = step(more, ws, { facts: [{ type: "resource", resource: "feed", level: "good", quantity: null, evidence: "x" }] });
    expect(fixed.draft.resourceUpdates).toHaveLength(1);
    expect(fixed.draft.resourceUpdates[0].level).toBe("good");
    expect(fixed.draft.answers.filter((entry) => entry.questionId === "feed_level")).toHaveLength(1);
  });

  it("keeps things that fit no topic as notes, reads them back and lets them be corrected", () => {
    const { ws, session } = open();
    const more = step(session, ws, { facts: [{ type: "other", note: "الوايت تأخر", evidence: "x" }] });
    const summary = step(more, ws, { value: "open_done" });
    expect(lastLine(summary)).toContain("ملاحظة: الوايت تأخر");
    const asked = step(summary, ws, { value: "correct:open_note_1" });
    expect(asked.step).toBe("report_question");
    const again = step(asked, ws, { text: "الوايت وصل" });
    expect(again.step).toBe("report_summary");
    expect(lastLine(again)).toContain("الوايت وصل");
    expect(lastLine(again)).not.toContain("تأخر");
  });

  it("records what was said about a topic the owner turned off, but does not ask about it", () => {
    const { ws, session } = open((workspace) => { workspace.settings.questionPlan = [{ id: "herd_health", enabled: false, required: true }]; });
    expect(session.data.queue?.some((item) => item.id === "herd_health")).toBe(false);
    const more = step(session, ws, { facts: [{ type: "camel_health", camelId: camel(ws).id, scope: "one", status: "sick", note: null, evidence: "x" }] });
    expect(more.draft.camelUpdates).toHaveLength(1);
    expect(step(more, ws, { value: "open_done" }).step).toBe("report_summary");
  });

  it("still asks due tasks after the update, and never closes one from free speech", () => {
    const { ws, session } = open((workspace) => {
      workspace.taskTickets.push({ id: "fix-gate", instruction: "أصلح البوابة", createdAt: NOW.toISOString(), scheduledFor: null, status: "open", closedAt: null, closedVia: null });
    });
    const more = step(session, ws, { facts: [{ type: "other", note: "أصلحت البوابة", evidence: "x" }] });
    expect(more.draft.taskConfirmations).toEqual([]);
    const task = step(more, ws, { value: "open_done" });
    expect(task.step).toBe("report_question");
    expect(task.data.currentQuestionId).toBe("task_fix-gate");
    const summary = step(task, ws, { value: "yes" });
    expect(summary.step).toBe("report_summary");
    expect(summary.draft.taskConfirmations).toEqual([{ taskId: "fix-gate", done: true }]);
  });

  it("adds no invented facts when told nothing", () => {
    const { ws, session } = open();
    const guided = step(session, ws, { value: "open_done" });
    expect(guided.step).toBe("report_question");
    expect(guided.data.reportMode).toBe("guided");
    expect(guided.draft.answers).toEqual([]);
  });

  it("falls back: captured facts stand, or the script asks if nothing was captured", () => {
    const { ws, session } = open();
    expect(resumeOpenAsGuided(session, ws, NOW).step).toBe("report_question");
    const more = step(session, ws, { facts: [{ type: "resource", resource: "water", level: "good", quantity: null, evidence: "x" }] });
    expect(resumeOpenAsGuided(more, ws, NOW).step).toBe("report_summary");
  });
});

describe("kept notes in guided mode", () => {
  it("reads a note back but never asks it as a question", () => {
    const { ws, session } = callOn();
    const noted = addWorkerNote(session, "العلف زين");
    expect(noted.data.currentQuestionId).toBe("herd_health");
    const summary = answerEverything(noted, ws);
    expect(summary.turns.some((entry) => entry.text.ar.includes("وش الملاحظة الصحيحة"))).toBe(false);
    expect(lastLine(summary)).toContain("ملاحظة: العلف زين");
  });

  it("does not shift the question being asked when a note arrives during a task", () => {
    const { ws, session } = callOn((workspace) => {
      workspace.settings.questionPlan = ["herd_health", "herd_count", "feed_level", "water_level", "fences_condition", "shelter_condition", "medicine_stock", CUSTOM_ID].map((id) => ({ id, enabled: false, required: true }));
      workspace.taskTickets.push({ id: "fix-gate", instruction: "أصلح البوابة", createdAt: NOW.toISOString(), scheduledFor: null, status: "open", closedAt: null, closedVia: null });
      workspace.pendingWorkerCalls = [];
    });
    expect(session.data.currentQuestionId).toBe("task_fix-gate");
    const noted = addWorkerNote(session, "الوايت تأخر");
    expect(noted.data.queue?.[noted.data.reportIndex ?? 0]?.id).toBe("task_fix-gate");
    expect(step(noted, ws, { value: "yes" }).step).toBe("report_summary");
  });
});
