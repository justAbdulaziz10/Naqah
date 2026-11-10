import { describe, expect, it } from "vitest";
import { completeWorkerReport } from "../actions";
import { fromRiyadh } from "../clock";
import { placeReportCallAttempt, resolveReportCallAttempt, startReportCall } from "../reportCalls";
import { createDemoWorkspace } from "../seed";
import type { Workspace } from "../types";
import { answer, start, type CallSession } from "./engine";

/** What a real call does: the run is answered first, then the questions start with its id. */
const NOW = fromRiyadh(2026, 11, 5, 17, 10);

function answeredCall(customize: (ws: Workspace) => void = () => {}) {
  const ws = createDemoWorkspace("ar", "ultimate", NOW);
  ws.reports = [];
  ws.calls = [];
  ws.taskTickets = [];
  ws.pendingWorkerCalls = [];
  ws.noAnswerTickets = [];
  customize(ws);
  const opened = startReportCall(ws, NOW, "manual");
  const placed = placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws;
  const live = resolveReportCallAttempt(placed, NOW, opened.run!.id, true).ws;
  return { ws: live, runId: opened.run!.id, session: start(live, NOW, "report_call", { reportCallId: opened.run!.id }).session };
}

const reply = (session: CallSession, ws: Workspace, input: { value?: string; text?: string }) => answer(session, ws, NOW, input).session;

function advanceTo(session: CallSession, ws: Workspace, questionId: string) {
  let current = session;
  while (current.data.currentQuestionId !== questionId || current.step !== "report_question") {
    const input = current.step === "report_question" && current.data.currentQuestionId === "herd_count" ? { text: "42" }
      : current.inputMode === "text" ? { text: "x" }
      : { value: current.replies[0].value };
    current = reply(current, ws, input);
  }
  return current;
}

const custom = (ws: Workspace) => {
  ws.settings.customQuestions = [{ id: "c1", text: "وش سويت اليوم؟", createdAt: NOW.toISOString() }];
};

describe("answers captured on a real call", () => {
  it.each(["ما أدري", "مدري", "ما ادري", "مَا أَدْرِي", "I don’t know"])("records «%s» said to a free-text question as unknown", (said) => {
    const { ws, session } = answeredCall(custom);
    const next = reply(advanceTo(session, ws, "c1"), ws, { text: said });
    expect(next.draft.answers.at(-1)).toMatchObject({ questionId: "c1", certainty: "unknown", answerText: { ar: "ما أدري" } });
  });

  it("keeps a spoken number given to a how-much question, without inventing a level", () => {
    const { ws, session } = answeredCall();
    const atFeed = advanceTo(session, ws, "feed_level");
    const next = reply(atFeed, ws, { text: "20" });
    expect(next.data.currentQuestionId).not.toBe("feed_level");
    expect(next.draft.resourceUpdates.at(-1)).toMatchObject({ kind: "feed", level: "unknown", quantity: "20 كيس", certainty: "approximate" });
  });

  it("asks again instead of carrying a value the save would refuse", () => {
    const { ws, session } = answeredCall();
    const atFeed = advanceTo(session, ws, "feed_level");
    const next = reply(atFeed, ws, { text: "مدري وش" });
    expect(next.step).toBe("report_question");
    expect(next.data.currentQuestionId).toBe("feed_level");
    expect(next.draft.resourceUpdates).toHaveLength(0);
  });

  it.each(["لا", "لا والله", "ما فيه", "مافي شي", "ما أدري"])("doesn't save «%s» as the camel's note", (said) => {
    const { ws, session } = answeredCall();
    let current = reply(session, ws, { value: "no" });
    current = reply(current, ws, { value: current.replies[0].value });
    expect(current.step).toBe("health_status");
    current = reply(current, ws, { value: "sick", text: said });
    expect(current.step).toBe("health_more");
    expect(current.draft.camelUpdates.at(-1)?.note).toBeNull();
  });

  it("keeps a real note", () => {
    const { ws, session } = answeredCall();
    let current = reply(session, ws, { value: "no" });
    current = reply(current, ws, { value: current.replies[0].value });
    current = reply(current, ws, { value: "sick", text: "ما تاكل من أمس" });
    expect(current.step).toBe("health_more");
    expect(current.draft.camelUpdates.at(-1)?.note).toBe("ما تاكل من أمس");
  });

  it("doesn't add «لا» to the count when asked which camels are missing", () => {
    const { ws, session } = answeredCall((farm) => { farm.settings.herdCount = 50; });
    let current = advanceTo(session, ws, "herd_count");
    current = reply(current, ws, { text: "40" });
    expect(current.step).toBe("herd_count_detail");
    current = reply(current, ws, { text: "لا" });
    const saved = current.draft.answers.at(-1);
    expect(saved?.answer).not.toContain("لا");
    expect(saved?.answerText?.ar).toContain("40");
  });

  it("speaks and saves the unit in Arabic for an Arabic worker", () => {
    const { ws, session } = answeredCall();
    let current = advanceTo(session, ws, "feed_level");
    current = reply(current, ws, { text: "20" });
    const feed = current.draft.answers.find((item) => item.questionId === "feed_level");
    expect(feed?.answerText).toMatchObject({ ar: expect.stringContaining("20 كيس"), en: expect.stringContaining("20 bags") });
    expect(current.draft.resourceUpdates.at(-1)?.quantity).toBe("20 كيس");
  });

  it("doesn't tell the worker there is nothing to save when only free-text answers exist", () => {
    const { ws, session } = answeredCall((farm) => {
      farm.camels = [];
      farm.settings.herdCount = null;
      farm.resources = farm.resources.map((item) => ({ ...item, present: false }));
      custom(farm);
    });
    let current = reply(session, ws, { value: "yes" });
    current = reply(current, ws, { text: "سقيت الحلال" });
    expect(current.step).toBe("report_summary");
    expect(current.turns.at(-1)?.text.ar).not.toContain("ما فيه معلومات");
  });

  it("doesn't read a task back as still open when the worker doesn't know", () => {
    const { ws, session } = answeredCall((farm) => {
      farm.taskTickets = [{ id: "t1", instruction: "افحص الشبك", createdAt: NOW.toISOString(), scheduledFor: null, status: "open", closedAt: null, closedVia: null }];
    });
    const next = reply(advanceTo(session, ws, "task_t1"), ws, { value: "unknown" });
    expect(next.draft.taskConfirmations).toEqual([]);
    expect(next.draft.answers.at(-1)).toMatchObject({ questionId: "task_t1", certainty: "unknown" });
  });

  it("links the saved report to the call it was taken on, with every configured question answered", () => {
    const { ws, session, runId } = answeredCall(custom);
    let current = session;
    while (current.step !== "report_summary") {
      const input = current.data.currentQuestionId === "herd_count" && current.step === "report_question" ? { text: "42" }
        : current.inputMode === "text" ? { text: "x" }
        : { value: current.replies[0].value };
      current = reply(current, ws, input);
    }
    const asked = current.data.queue!.map((item) => item.id);
    expect(current.draft.answers.map((item) => item.questionId)).toEqual(asked);

    const { ws: saved, report } = completeWorkerReport(ws, NOW, current.draft, runId);
    expect(report.answers.map((item) => item.questionId)).toEqual(asked);
    expect(saved.reportCalls?.find((run) => run.id === runId)).toMatchObject({ state: "completed", reportId: report.id });
    expect(saved.calls.at(-1)).toMatchObject({ kind: "worker_report", direction: "outbound", reportId: report.id });
  });
});

describe("answers that can't both be true", () => {
  const atStep = (step: string) => {
    const { ws, session } = answeredCall();
    let current = session;
    for (let turn = 0; turn < 60 && current.step !== step; turn += 1) {
      const input = current.inputMode === "number" ? { text: "5" } : current.replies.length ? { value: current.replies[0].value } : { text: "تمام" };
      current = reply(current, ws, input);
    }
    expect(current.step).toBe(step);
    return { ws, current };
  };

  it("goes straight on after a level, with no quantity and no invented number", () => {
    const { ws, session } = answeredCall();
    const next = reply(advanceTo(session, ws, "feed_level"), ws, { value: "good" });
    expect(next.step).toBe("report_question");
    expect(next.data.currentQuestionId).not.toBe("feed_level");
    expect(next.draft.resourceUpdates.at(-1)).toMatchObject({ kind: "feed", level: "good", quantity: null, certainty: "reported" });
  });

  it("records a spoken zero as a number, without a level", () => {
    const { ws, session } = answeredCall();
    const next = reply(advanceTo(session, ws, "feed_level"), ws, { text: "0" });
    expect(next.draft.resourceUpdates.at(-1)).toMatchObject({ kind: "feed", level: "unknown", quantity: "0 كيس", certainty: "approximate" });
  });

  it("keeps an Arabic herd detail in Arabic", () => {
    const { ws, current } = atStep("herd_count_detail");
    const herd = reply(current, ws, { text: "شعلة ضايعة" }).draft.answers.at(-1)!;
    expect(herd.answerText?.ar).toBe("5 من الحلال — شعلة ضايعة");
    expect(herd.answerText?.en).toBe("5 camels — شعلة ضايعة");
  });
});
