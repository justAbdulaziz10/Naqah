import { describe, expect, it } from "vitest";
import { recordOwnerInquiry, submitOwnerInstruction } from "../actions";
import { fromRiyadh, RETRY_DELAY_MS } from "../clock";
import { evaluateFindings, ownerBriefing } from "../findings";
import { routeOwnerInboundCall } from "../rules";
import { createDemoWorkspace, createEmptyWorkspace } from "../seed";
import { withDemoHeat } from "../weather";
import type { Workspace } from "../types";
import { answer, hangUp, scenarioAvailability, start, type CallSession } from "./engine";

const NOW = fromRiyadh(2026, 11, 5, 17, 10);

function applyAnswer(
  session: CallSession,
  ws: Workspace,
  now: Date,
  input: { value?: string; text?: string },
) {
  const result = answer(session, ws, now, input);
  return { session: result.session, ws: result.commit ? result.commit(ws) : ws };
}

function scheduledTaskWorkspace() {
  const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 5, 17, 10));
  const task = {
    id: "scheduled-review",
    instruction: "Check the shade net",
    createdAt: fromRiyadh(2026, 11, 5, 17, 0).toISOString(),
    scheduledFor: fromRiyadh(2026, 11, 5, 18, 0).toISOString(),
    status: "open" as const,
    closedAt: null,
    closedVia: null,
  };
  ws.taskTickets.push(task);
  return { ws, task };
}

function ownerInstruction(ws: Workspace, now = NOW) {
  let session = start(ws, now, "owner_notification").session;
  let result = applyAnswer(session, ws, now, { value: "answer" });
  session = result.session;
  ws = result.ws;
  result = applyAnswer(session, ws, now, { value: "instruction_yes" });
  session = result.session;
  result = applyAnswer(session, ws, now, { text: "Move Wadha into the shaded pen" });
  session = result.session;
  result = applyAnswer(session, ws, now, { value: "actionable" });
  session = result.session;
  return session.step === "instruction_schedule"
    ? applyAnswer(session, ws, now, { value: "any_time" })
    : result;
}

function noAnswerFourTimes(ws: Workspace, startAt = NOW) {
  let now = startAt;
  let session = start(ws, now, "worker_outbound").session;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let result = applyAnswer(session, ws, now, { value: "no_answer" });
    session = result.session;
    ws = result.ws;
    if (attempt < 3) {
      result = applyAnswer(session, ws, now, { value: "skip_20" });
      session = result.session;
      ws = result.ws;
      now = new Date(now.getTime() + RETRY_DELAY_MS);
    }
  }
  return { ws, session, now };
}

describe("Call Lab conversation engine", () => {
  it("completes a sick-camel and low-feed report, then briefs the owner", () => {
    let ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    let session = start(ws, NOW, "worker_report").session;
    let guard = 0;

    while (session.step !== "report_summary" && guard < 40) {
      guard += 1;
      let input: { value?: string; text?: string };
      if (session.step === "report_question") {
        const questionId = session.data.currentQuestionId;
        if (questionId === "herd_health") input = { value: "no" };
        else if (questionId === "herd_count") input = { value: "yes" };
        else if (questionId === "feed_level") input = { value: "low" };
        else if (questionId === "water_level" || questionId === "fences_condition" || questionId === "medicine_stock") input = { value: "good" };
        else if (questionId?.startsWith("task_")) input = { value: "no" };
        else input = { text: "No visitors today" };
      } else if (session.step === "health_pick") {
        input = { value: "camel:" + ws.camels[0].id };
      } else if (session.step === "health_status") {
        input = { value: "sick" };
      } else if (session.step === "health_note") {
        input = { text: "limping" };
      } else if (session.step === "health_name_confirm") {
        input = { value: "yes" };
      } else if (session.step === "health_more") {
        input = { value: "no" };
      } else if (session.step === "quantity_input") {
        input = session.data.currentQuestionId === "feed_level" ? { text: "12" } : { value: "quantity_skip" };
      } else if (session.step === "quantity_confirm") {
        input = { value: "yes" };
      } else {
        throw new Error("Unexpected report step: " + session.step);
      }
      const result = applyAnswer(session, ws, NOW, input);
      session = result.session;
      ws = result.ws;
    }

    expect(session.step).toBe("report_summary");
    const saved = applyAnswer(session, ws, NOW, { value: "confirm_save" });
    session = saved.session;
    ws = saved.ws;

    expect(ws.reports).toHaveLength(2);
    expect(ws.reports[1].findings.map((finding) => finding.text.en)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Wadha is sick"),
        expect.stringContaining("Feed"),
      ]),
    );
    expect(session.next?.scenario).toBe("owner_notification");
    expect(ownerBriefing(ws.reports[1].findings).en).toContain("Wadha is sick");

    const notification = start(ws, NOW, "owner_notification", { reportId: ws.reports[1].id }).session;
    const briefed = applyAnswer(notification, ws, NOW, { value: "answer" }).session;
    expect(briefed.turns.some((turn) => turn.text.en.includes("Wadha is sick") && turn.text.en.includes("Feed"))).toBe(true);
  });

  it("records an I don’t know answer with unknown certainty", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    let session = start(ws, NOW, "worker_report").session;
    session = answer(session, ws, NOW, { value: "unknown" }).session;
    expect(session.draft.answers[0].certainty).toBe("unknown");
  });

  it("repeats an overdue scheduled task in the next report after the worker says not yet", () => {
    const { ws, task } = scheduledTaskWorkspace();
    const dueAt = fromRiyadh(2026, 11, 5, 19, 0);
    const started = start(ws, dueAt, "worker_outbound");
    let session = started.session;
    let current = started.commit?.(ws) ?? ws;

    let result = applyAnswer(session, current, dueAt, { value: "answer" });
    session = result.session;
    current = result.ws;
    result = applyAnswer(session, current, dueAt, { value: "no" });
    session = result.session;
    current = result.ws;

    expect(current.taskTickets.find((item) => item.id === task.id)?.status).toBe("open");
    const tomorrow = fromRiyadh(2026, 11, 6, 9, 0);
    const again = start(current, tomorrow, "worker_outbound");
    const afterAgain = again.commit?.(current) ?? current;
    expect(afterAgain.pendingWorkerCalls.filter((call) => call.purpose === "task_verification" && call.taskTicketId === task.id)).toHaveLength(1);
    expect(scenarioAvailability(afterAgain, tomorrow).dueTaskVerificationCount).toBe(0);
    const report = start(current, tomorrow, "worker_report").session;
    expect(report.data.queue?.some((item) => item.kind === "task" && item.taskId === task.id)).toBe(true);
  });

  it("delivers a No Answer callback before asking about its overdue task and closes only on yes", () => {
    const { ws, task } = scheduledTaskWorkspace();
    const dueAt = fromRiyadh(2026, 11, 5, 19, 0);
    const started = start(ws, dueAt, "worker_outbound");
    let session = started.session;
    let current = started.commit?.(ws) ?? ws;
    let now = dueAt;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let result = applyAnswer(session, current, now, { value: "no_answer" });
      session = result.session;
      current = result.ws;
      if (attempt < 3) {
        result = applyAnswer(session, current, now, { value: "skip_20" });
        session = result.session;
        current = result.ws;
        now = new Date(now.getTime() + RETRY_DELAY_MS);
      }
    }

    expect(current.noAnswerTickets.some((ticket) => ticket.taskTicketId === task.id && ticket.status === "open")).toBe(true);
    const reportsBefore = current.reports.length;
    const callbackAt = fromRiyadh(2026, 11, 6, 9, 0);
    const callback = start(current, callbackAt, "worker_callback").session;
    expect(callback.step).toBe("callback_acknowledge");
    expect(callback.turns[0].text.en).toContain("Check the shade net");

    let result = applyAnswer(callback, current, callbackAt, { value: "received" });
    session = result.session;
    current = result.ws;
    expect(session.step).toBe("callback_task_confirmation");
    expect(current.noAnswerTickets.every((ticket) => ticket.status === "closed")).toBe(true);
    expect(current.reports).toHaveLength(reportsBefore);
    expect(current.taskTickets.find((item) => item.id === task.id)?.status).toBe("open");

    let guard = 0;
    while (session.step === "callback_task_confirmation" && guard < 6) {
      guard += 1;
      const askingShade = session.turns.at(-1)?.text.en.includes("Check the shade net") ?? false;
      result = applyAnswer(session, current, callbackAt, { value: askingShade ? "yes" : "no" });
      session = result.session;
      current = result.ws;
      if (askingShade) break;
    }
    const closed = current.taskTickets.find((item) => item.id === task.id);
    expect(closed?.status).toBe("closed");
    expect(closed?.closedVia).toBe("worker_callback");
  });

  it("hangs up an unanswered outbound verification without changing the workspace", () => {
    const { ws } = scheduledTaskWorkspace();
    const dueAt = fromRiyadh(2026, 11, 5, 19, 0);
    const started = start(ws, dueAt, "worker_outbound");
    const afterStart = started.commit?.(ws) ?? ws;
    const ended = hangUp(started.session, afterStart, dueAt);
    const afterHangUp = ended.commit?.(afterStart) ?? afterStart;

    expect(ended.session.done).toBe(true);
    expect(afterHangUp).toEqual(ws);
  });

  it("does not save an unfinished worker report when hung up", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const session = start(ws, NOW, "worker_report").session;
    const partial = answer(session, ws, NOW, { value: "no" }).session;
    const ended = hangUp(partial, ws, NOW);

    expect(ended.session.done).toBe(true);
    expect(ended.commit).toBeUndefined();
    expect(ws.reports).toHaveLength(1);
  });

  it("rejects a Basic report outside its weekly window and records the rejection", () => {
    const ws = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    const session = start(ws, fromRiyadh(2026, 11, 5, 18, 30), "worker_report");
    expect(session.session.done).toBe(true);
    expect(session.session.turns[0].text.en).toContain("weekly reporting window is closed");
    const updated = session.commit?.(ws) ?? ws;
    expect(updated.calls.at(-1)?.kind).toBe("worker_report_rejected");
    expect(updated.calls.at(-1)?.outcome).toBe("rejected");
  });

  it("creates an Ultimate task ticket and relays the same instruction on Basic", () => {
    const ultimate = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const ultimateResult = ownerInstruction(ultimate);
    expect(ultimateResult.ws.taskTickets.some((task) => task.instruction === "Move Wadha into the shaded pen" && task.status === "open")).toBe(true);
    expect(ultimateResult.ws.pendingWorkerCalls.some((call) => call.message === "Move Wadha into the shaded pen")).toBe(true);
    expect(ultimateResult.ws.calls.at(-1)?.kind).toBe("owner_notification");

    const basic = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    const basicResult = ownerInstruction(basic);
    expect(basicResult.ws.taskTickets).toHaveLength(0);
    expect(basicResult.ws.relays.some((relay) => relay.message === "Move Wadha into the shaded pen")).toBe(true);
  });

  it("opens a No Answer Ticket after four unanswered worker calls", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const pending = submitOwnerInstruction(ws, NOW, {
      message: "Move Wadha into the shaded pen",
      actionable: true,
      scheduledFor: null,
    });
    const result = noAnswerFourTimes(pending.ws);
    expect(result.ws.pendingWorkerCalls[0].attempts).toHaveLength(4);
    expect(result.ws.pendingWorkerCalls[0].state).toBe("no_answer_ticket");
    expect(result.ws.noAnswerTickets).toHaveLength(1);
    expect(result.session.notices.some((notice) => notice.en.includes("No Answer Ticket"))).toBe(true);
  });

  it("routes a worker callback to the missed message and closes the ticket without a report", () => {
    const basic = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    const pending = submitOwnerInstruction(basic, NOW, {
      message: "Repair the gate",
      actionable: true,
      scheduledFor: null,
    });
    const missed = noAnswerFourTimes(pending.ws);
    const reportsBefore = missed.ws.reports.length;
    const callback = start(missed.ws, missed.now, "worker_report").session;
    expect(callback.scenario).toBe("worker_callback");
    expect(callback.turns[0].text.en).toContain("Message from the owner");

    const completed = applyAnswer(callback, missed.ws, missed.now, { value: "received" });
    expect(completed.ws.noAnswerTickets[0].status).toBe("closed");
    expect(completed.ws.reports).toHaveLength(reportsBefore);
    expect(completed.ws.calls.at(-1)?.kind).toBe("worker_callback");
  });

  it("politely rejects an owner inquiry after the Basic allowance is used", () => {
    let ws = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    ws.ownerAllowanceUsedAt = NOW.toISOString();
    ws = recordOwnerInquiry(ws, NOW, "weekly");
    const started = start(ws, NOW, "owner_inquiry");
    expect(started.session.done).toBe(true);
    expect(started.session.turns[0].text.en).toContain("already been used this week");
    const updated = started.commit?.(ws) ?? ws;
    expect(updated.calls.at(-1)?.kind).toBe("owner_inquiry_rejected");
    expect(updated.calls.at(-1)?.outcome).toBe("rejected");
  });

  it("uses the Basic owner inquiry allowance when the accepted call is hung up", () => {
    const ws = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    const started = start(ws, NOW, "owner_inquiry");
    let current = started.commit?.(ws) ?? ws;
    const ended = hangUp(started.session, current, NOW);
    current = ended.commit?.(current) ?? current;

    expect(ended.session.done).toBe(true);
    expect(current.calls.filter((call) => call.kind === "owner_inquiry" && call.at === NOW.toISOString())).toHaveLength(1);
    const second = start(current, fromRiyadh(2026, 11, 5, 17, 20), "owner_inquiry");
    expect(second.session.done).toBe(true);
    const afterSecond = second.commit?.(current) ?? current;
    expect(afterSecond.calls.at(-1)?.kind).toBe("owner_inquiry_rejected");
    expect(routeOwnerInboundCall(afterSecond, fromRiyadh(2026, 11, 5, 17, 20))).toEqual({ kind: "rejected", reason: "allowance_used" });
  });

  it("uses the Basic owner allowance as soon as an answered notification is answered", () => {
    const ws = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    const reportId = ws.reports[0].id;
    const started = start(ws, NOW, "owner_notification", { reportId });
    const answered = answer(started.session, ws, NOW, { value: "answer" });
    let current = answered.commit?.(ws) ?? ws;
    const ended = hangUp(answered.session, current, NOW);
    current = ended.commit?.(current) ?? current;

    expect(current.ownerAllowanceUsedAt).toBe(NOW.toISOString());
    expect(current.calls.filter((call) => call.kind === "owner_notification" && call.at === NOW.toISOString())).toHaveLength(1);
    expect(routeOwnerInboundCall(current, fromRiyadh(2026, 11, 5, 17, 20))).toEqual({ kind: "rejected", reason: "allowance_used" });
  });

  it("uses answerText in the matching locale for the owner inquiry last update", () => {
    const ws = createDemoWorkspace("ar", "ultimate", NOW);
    const latest = ws.reports[ws.reports.length - 1];
    latest.answers = [{
      questionId: "herd_health",
      question: { ar: "كيف حال الحلال؟", en: "How is the herd?" },
      answer: "All camels are well",
      answerText: { ar: "الحلال كله بخير", en: "All camels are well" },
      certainty: "reported",
      followUp: false,
    }];
    const started = start(ws, NOW, "owner_inquiry");
    const result = answer(started.session, ws, NOW, { value: "last_update" });

    expect(result.session.turns.some((turn) => turn.speaker === "agent" && turn.text.ar.includes("الحلال كله بخير"))).toBe(true);
  });

  it("records an unspecified herd-health concern when the herd is empty and skips herd count", () => {
    const ws = createEmptyWorkspace("ultimate");
    const session = start(ws, NOW, "worker_report").session;
    expect(session.data.currentQuestionId).toBe("herd_health");
    expect(session.data.queue?.some((item) => item.id === "herd_count")).toBe(false);

    const result = answer(session, ws, NOW, { value: "no" });
    const reportAnswer = result.session.draft.answers.find((item) => item.questionId === "herd_health");
    expect(result.session.step).not.toBe("health_pick");
    expect(reportAnswer).toMatchObject({
      answer: "A camel needs attention (unspecified)",
      answerText: { ar: "فيه ناقة تحتاج متابعة (غير محددة)", en: "A camel needs attention (unspecified)" },
      certainty: "reported",
    });
    const findings = evaluateFindings(ws, result.session.draft);
    expect(ownerBriefing(findings).en).toContain("A camel needs attention (unspecified)");
  });

  it("keeps a confirmed camel report when the worker does not know about another camel", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    let session = start(ws, NOW, "worker_report").session;
    session = answer(session, ws, NOW, { value: "no" }).session;
    session = answer(session, ws, NOW, { value: "camel:" + ws.camels[0].id }).session;
    session = answer(session, ws, NOW, { value: "healthy" }).session;
    session = answer(session, ws, NOW, { value: "skip_note" }).session;
    session = answer(session, ws, NOW, { value: "yes" }).session;
    session = answer(session, ws, NOW, { value: "yes" }).session;
    const result = answer(session, ws, NOW, { value: "unknown" });
    const reportAnswer = result.session.draft.answers.find((item) => item.questionId === "herd_health");

    expect(result.session.step).toBe("report_question");
    expect(reportAnswer?.certainty).toBe("reported");
    expect(reportAnswer?.answer).toContain("Wadha: Healthy");
  });

  it("asks the heat-day question first only for a current hot forecast with farm coordinates", () => {
    const ws = withDemoHeat(createDemoWorkspace("en", "ultimate", NOW), NOW);
    const hot = start(ws, NOW, "worker_report").session;

    expect(hot.data.currentQuestionId).toBe("weather_heat_water");
    expect(hot.turns.at(-2)?.text.en).toContain("Hello Ahmed");
    expect(hot.turns.at(-1)?.text.en).toContain("hot day (46°)");
    expect(hot.replies.map((item) => item.label.en)).toEqual(["Yes", "Not enough", "I don’t know"]);

    const normalWs = structuredClone(ws);
    normalWs.weather!.maxTempC = 39.9;
    expect(start(normalWs, NOW, "worker_report").session.data.currentQuestionId).not.toBe("weather_heat_water");

    const staleWs = structuredClone(ws);
    staleWs.weather!.date = "2026-11-04";
    expect(start(staleWs, NOW, "worker_report").session.data.currentQuestionId).not.toBe("weather_heat_water");

    const noCoordsWs = structuredClone(ws);
    noCoordsWs.settings.farm.coords = null;
    expect(start(noCoordsWs, NOW, "worker_report").session.data.currentQuestionId).not.toBe("weather_heat_water");
  });

  it("stores a heat-day water and shade finding when the worker answers not enough", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.settings.farm.coords = { lat: 24.155, lon: 47.334 };
    ws.resources = ws.resources.map((resource) => ({ ...resource, present: false }));
    const heated = withDemoHeat(ws, NOW);

    let session = start(heated, NOW, "worker_report").session;
    expect(session.data.currentQuestionId).toBe("weather_heat_water");
    session = answer(session, heated, NOW, { value: "not_enough" }).session;
    const heatAnswer = session.draft.answers.find((item) => item.questionId === "weather_heat_water");
    expect(heatAnswer).toMatchObject({
      answer: "Not enough",
      answerText: { en: "Not enough", ar: "ما يكفي" },
      certainty: "reported",
    });

    session = answer(session, heated, NOW, { value: "unknown" }).session;
    expect(session.step).toBe("report_summary");
    expect(session.turns.at(-1)?.text.en).toContain("water or shade may not be enough");
    const saved = answer(session, heated, NOW, { value: "confirm_save" });
    const committed = saved.commit?.(heated) ?? heated;
    const finding = committed.reports.at(-1)?.findings.find((item) => item.criterionId === "weather_heat_day");

    expect(finding?.text.en).toBe("The worker reported that water or shade may not be enough for a hot day");
    expect(finding?.text.ar).toContain("أفاد العامل");
    expect(committed.calls.at(-1)?.summary.en).toBe("Update completed — 1 important finding");
    expect(committed.events.some((event) => event.text.en === "1 finding matches the owner's criteria")).toBe(true);
    expect(committed.taskTickets).toHaveLength(0);
    expect(committed.pendingWorkerCalls).toHaveLength(0);
  });

  it("starts one verification cycle and does not start another after not yet, retries, or a repeated outbound", () => {
    const { ws, task } = scheduledTaskWorkspace();
    const dueAt = fromRiyadh(2026, 11, 5, 19, 0);
    const first = start(ws, dueAt, "worker_outbound");
    const once = first.commit?.(ws) ?? ws;
    const second = start(once, dueAt, "worker_outbound");
    const twice = second.commit?.(once) ?? once;
    expect(twice.pendingWorkerCalls.filter((call) => call.purpose === "task_verification" && call.taskTicketId === task.id)).toHaveLength(1);

    const result = applyAnswer(first.session, once, dueAt, { value: "no_answer" });
    const pending = result.ws.pendingWorkerCalls.find((call) => call.taskTicketId === task.id);
    expect(new Date(pending?.nextAttemptAt ?? 0).getTime() - dueAt.getTime()).toBe(RETRY_DELAY_MS);

    const exhausted = noAnswerFourTimes(once, dueAt);
    expect(exhausted.ws.pendingWorkerCalls.filter((call) => call.purpose === "task_verification")).toHaveLength(1);
    expect(exhausted.ws.pendingWorkerCalls[0]?.state).toBe("no_answer_ticket");
    const afterExhaustion = start(exhausted.ws, exhausted.now, "worker_outbound");
    const stillOne = afterExhaustion.commit?.(exhausted.ws) ?? exhausted.ws;
    expect(stillOne.pendingWorkerCalls.filter((call) => call.purpose === "task_verification")).toHaveLength(1);
    expect(scenarioAvailability(stillOne, exhausted.now).dueTaskVerificationCount).toBe(0);
  });

  it("does not verify a scheduled task before its instruction is delivered", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const due = fromRiyadh(2026, 11, 5, 18, 0);
    const created = submitOwnerInstruction(ws, NOW, {
      message: "Check the shade net",
      actionable: true,
      scheduledFor: due.toISOString(),
    });
    const blocked = start(created.ws, due, "worker_outbound");
    const waiting = blocked.commit?.(created.ws) ?? created.ws;
    expect(waiting.pendingWorkerCalls.filter((call) => call.purpose === "task_verification")).toHaveLength(0);
    expect(waiting.pendingWorkerCalls.filter((call) => call.purpose === "instruction" && call.state === "pending")).toHaveLength(1);

    const delivered = applyAnswer(blocked.session, waiting, due, { value: "answer" });
    const verified = start(delivered.ws, due, "worker_outbound");
    const ready = verified.commit?.(delivered.ws) ?? delivered.ws;
    expect(ready.pendingWorkerCalls.filter((call) => call.purpose === "task_verification")).toHaveLength(1);
  });

  it("asks open Any Time and overdue tasks on a callback, and does not report the farm", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const pending = submitOwnerInstruction(ws, NOW, {
      message: "Refill the trough",
      actionable: true,
      scheduledFor: null,
    });
    const missed = noAnswerFourTimes(pending.ws);
    missed.ws.taskTickets.push(
      {
        id: "overdue-gate",
        instruction: "Fix the gate",
        createdAt: NOW.toISOString(),
        scheduledFor: fromRiyadh(2026, 11, 5, 18, 0).toISOString(),
        status: "open",
        closedAt: null,
        closedVia: null,
      },
      {
        id: "future-barn",
        instruction: "Paint the barn",
        createdAt: NOW.toISOString(),
        scheduledFor: fromRiyadh(2026, 11, 20, 9, 0).toISOString(),
        status: "open",
        closedAt: null,
        closedVia: null,
      },
      {
        id: "closed-old",
        instruction: "Old task",
        createdAt: NOW.toISOString(),
        scheduledFor: null,
        status: "closed",
        closedAt: NOW.toISOString(),
        closedVia: "worker_report",
      },
    );
    const reportsBefore = missed.ws.reports.length;
    const callbackAt = fromRiyadh(2026, 11, 6, 9, 0);
    let session = start(missed.ws, callbackAt, "worker_callback").session;
    expect(session.turns[0].text.en).toContain("not a farm update");
    let result = applyAnswer(session, missed.ws, callbackAt, { value: "received" });
    session = result.session;
    let current = result.ws;
    expect(current.noAnswerTickets.every((ticket) => ticket.status === "closed")).toBe(true);

    const asked: string[] = [];
    let guard = 0;
    while (session.step === "callback_task_confirmation" && guard < 8) {
      guard += 1;
      const text = session.turns.at(-1)?.text.en ?? "";
      asked.push(text);
      const value = text.includes("Refill the trough") ? "unknown" : text.includes("Fix the gate") ? "yes" : "no";
      result = applyAnswer(session, current, callbackAt, { value });
      session = result.session;
      current = result.ws;
    }

    expect(asked.filter((text) => text.includes("Refill the trough"))).toHaveLength(1);
    expect(asked.some((text) => text.includes("Fix the gate"))).toBe(true);
    expect(asked.some((text) => text.includes("Paint the barn") || text.includes("Old task"))).toBe(false);
    expect(current.taskTickets.find((task) => task.instruction === "Refill the trough")?.status).toBe("open");
    expect(current.taskTickets.find((task) => task.instruction === "Fix the gate")?.status).toBe("closed");
    expect(current.events.some((event) => event.text.en.includes("Refill the trough") && event.text.en.toLowerCase().includes("not done"))).toBe(false);
    expect(current.reports).toHaveLength(reportsBefore);
    expect(start(current, callbackAt, "worker_report").session.scenario).toBe("worker_report");
  });

  it("schedules later today, tomorrow, and a future date, and rejects past or unclear input", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const openSchedule = () => {
      let session = start(ws, NOW, "owner_notification").session;
      let result = applyAnswer(session, ws, NOW, { value: "answer" });
      session = result.session;
      const saved = result.ws;
      result = applyAnswer(session, saved, NOW, { value: "instruction_yes" });
      session = result.session;
      result = applyAnswer(session, saved, NOW, { text: "Check the shade net" });
      session = result.session;
      result = applyAnswer(session, saved, NOW, { value: "actionable" });
      return { session: result.session, ws: saved };
    };

    const later = openSchedule();
    let result = applyAnswer(later.session, later.ws, NOW, { value: "later_today" });
    result = applyAnswer(result.session, later.ws, NOW, { text: "20:00" });
    expect(result.ws.taskTickets.at(-1)?.scheduledFor).toBe(fromRiyadh(2026, 11, 5, 20, 0).toISOString());
    expect(result.session.turns.at(-1)?.text.en).toContain("has not started");
    expect(result.session.turns.at(-1)?.text.en.toLowerCase()).not.toContain("calling");

    const tomorrow = openSchedule();
    result = applyAnswer(tomorrow.session, tomorrow.ws, NOW, { value: "tomorrow" });
    result = applyAnswer(result.session, tomorrow.ws, NOW, { text: "08:00" });
    expect(result.ws.taskTickets.at(-1)?.scheduledFor).toBe(fromRiyadh(2026, 11, 6, 8, 0).toISOString());

    const dated = openSchedule();
    result = applyAnswer(dated.session, dated.ws, NOW, { value: "future_date" });
    result = applyAnswer(result.session, dated.ws, NOW, { text: "2026-11-15" });
    expect(result.session.step).toBe("instruction_time");
    result = applyAnswer(result.session, dated.ws, NOW, { text: "18:00" });
    expect(result.ws.taskTickets.at(-1)?.scheduledFor).toBe(fromRiyadh(2026, 11, 15, 18, 0).toISOString());

    const relative = openSchedule();
    result = applyAnswer(relative.session, relative.ws, NOW, { value: "future_date" });
    result = applyAnswer(result.session, relative.ws, NOW, { text: "10 days from now at 18:00" });
    expect(result.ws.taskTickets.at(-1)?.scheduledFor).toBe(fromRiyadh(2026, 11, 15, 18, 0).toISOString());

    const anytime = openSchedule();
    result = applyAnswer(anytime.session, anytime.ws, NOW, { value: "any_time" });
    expect(result.ws.taskTickets.at(-1)?.scheduledFor).toBeNull();

    const past = openSchedule();
    result = applyAnswer(past.session, past.ws, NOW, { value: "future_date" });
    result = applyAnswer(result.session, past.ws, NOW, { text: "2026-11-04" });
    expect(result.session.step).toBe("instruction_date");
    expect(result.ws.taskTickets.some((task) => task.instruction === "Check the shade net")).toBe(false);

    const unclear = openSchedule();
    result = applyAnswer(unclear.session, unclear.ws, NOW, { value: "future_date" });
    result = applyAnswer(result.session, unclear.ws, NOW, { text: "06/11/2026" });
    expect(result.session.step).toBe("instruction_date");
    expect(result.session.turns.at(-1)?.text.en).toContain("not clear");

    const early = openSchedule();
    result = applyAnswer(early.session, early.ws, NOW, { value: "later_today" });
    result = applyAnswer(result.session, early.ws, NOW, { text: "08:00" });
    expect(result.session.step).toBe("instruction_time");
    expect(result.ws.taskTickets.some((task) => task.instruction === "Check the shade net")).toBe(false);
  });

  it("keeps an unknown task answer open and closes a reported yes only when the report is saved", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.resources = ws.resources.map((resource) => ({ ...resource, present: false }));
    ws.taskTickets.push({
      id: "shade-task",
      instruction: "Move the shade",
      createdAt: NOW.toISOString(),
      scheduledFor: null,
      status: "open",
      closedAt: null,
      closedVia: null,
    });
    let session = start(ws, NOW, "worker_report").session;
    session = answer(session, ws, NOW, { value: "unknown" }).session;
    session = answer(session, ws, NOW, { value: "unknown" }).session;
    expect(session.draft.taskConfirmations).toHaveLength(0);
    expect(session.draft.answers.at(-1)?.certainty).toBe("unknown");
    const savedUnknown = answer(session, ws, NOW, { value: "confirm_save" });
    const unknownWs = savedUnknown.commit?.(ws) ?? ws;
    expect(unknownWs.taskTickets[0]?.status).toBe("open");
    expect(unknownWs.events.some((event) => event.text.en.toLowerCase().includes("not done"))).toBe(false);

    session = start(ws, NOW, "worker_report").session;
    session = answer(session, ws, NOW, { value: "unknown" }).session;
    session = answer(session, ws, NOW, { value: "yes" }).session;
    expect(ws.taskTickets[0]?.status).toBe("open");
    const savedYes = answer(session, ws, NOW, { value: "confirm_save" });
    expect((savedYes.commit?.(ws) ?? ws).taskTickets[0]?.status).toBe("closed");
    expect(savedYes.session.turns.at(-1)?.text.en).toContain("Saved");
    expect(savedYes.session.turns.at(-1)?.text.en.toLowerCase()).not.toContain("calling");
  });

  it("does not record an unknown verification answer as not done", () => {
    const { ws, task } = scheduledTaskWorkspace();
    const dueAt = fromRiyadh(2026, 11, 5, 19, 0);
    const started = start(ws, dueAt, "worker_outbound");
    const prepared = started.commit?.(ws) ?? ws;
    let result = applyAnswer(started.session, prepared, dueAt, { value: "answer" });
    result = applyAnswer(result.session, result.ws, dueAt, { value: "unknown" });
    expect(result.ws.taskTickets.find((item) => item.id === task.id)?.status).toBe("open");
    expect(result.ws.events.some((event) => event.text.en.toLowerCase().includes("not done"))).toBe(false);
    expect(result.session.turns.some((turn) => turn.text.en.includes("could not confirm"))).toBe(true);
  });

  it("asks applicable questions, skips absent resources, and keeps plan limits and emergency handling", () => {
    const ultimate = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const queue = start(ultimate, NOW, "worker_report").session.data.queue?.map((item) => item.id) ?? [];
    expect(queue).toEqual(expect.arrayContaining(["herd_health", "herd_count", "feed_level", "water_level", "fences_condition", "medicine_stock"]));
    expect(queue).not.toContain("shelter_condition");

    const bare = createEmptyWorkspace("ultimate");
    bare.resources = bare.resources.map((resource) => ({ ...resource, present: false }));
    const bareQueue = start(bare, NOW, "worker_report").session.data.queue?.map((item) => item.id) ?? [];
    expect(bareQueue).toContain("herd_health");
    for (const id of ["herd_count", "feed_level", "water_level", "fences_condition", "medicine_stock", "shelter_condition"]) {
      expect(bareQueue).not.toContain(id);
    }

    const basic = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    basic.reports[0].at = NOW.toISOString();
    basic.lastUpdateAt = NOW.toISOString();
    const weekly = start(basic, NOW, "worker_report");
    expect(weekly.session.done).toBe(true);
    expect(weekly.session.turns[0].text.en).toContain("this week");

    const dailyWs = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    dailyWs.reports[0].at = NOW.toISOString();
    dailyWs.lastUpdateAt = NOW.toISOString();
    const daily = start(dailyWs, NOW, "worker_report");
    expect(daily.session.done).toBe(true);
    expect(daily.session.turns[0].text.en).toContain("today");

    let session = start(ultimate, NOW, "owner_notification").session;
    let result = applyAnswer(session, ultimate, NOW, { value: "answer" });
    session = result.session;
    const ownerWs = result.ws;
    result = applyAnswer(session, ownerWs, NOW, { value: "instruction_yes" });
    session = result.session;
    result = applyAnswer(session, ownerWs, NOW, { text: "Guests arrive Friday" });
    session = result.session;
    result = applyAnswer(session, ownerWs, NOW, { value: "information" });
    expect(result.ws.taskTickets.some((task) => task.instruction === "Guests arrive Friday")).toBe(false);
    expect(result.ws.relays.some((relay) => relay.message === "Guests arrive Friday")).toBe(true);
    expect(result.session.turns.at(-1)?.text.en).toContain("has not started");

    const emergency = start(ultimate, NOW, "emergency").session;
    expect(emergency.done).toBe(true);
    expect(emergency.turns[0].text.en).toContain("calls you directly");
    expect(emergency.turns[0].text.en).toContain("does not dispatch");
  });
});
