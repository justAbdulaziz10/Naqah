import { describe, expect, it } from "vitest";
import { recordOwnerInquiry, submitOwnerInstruction } from "../actions";
import { fromRiyadh, RETRY_DELAY_MS } from "../clock";
import { evaluateFindings, ownerBriefing } from "../findings";
import { herdCountProposal } from "../herd";
import { placeReportCallAttempt, startReportCall } from "../reportCalls";
import { dueTaskVerifications, routeOwnerInboundCall, routeWorkerInboundCall } from "../rules";
import { createDemoWorkspace, createEmptyWorkspace } from "../seed";
import { withDemoHeat } from "../weather";
import type { Workspace } from "../types";
import { answer, hangUp, start, type CallSession } from "./engine";

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

/** NAQAH calls Ahmed for the report and he picks up on the first ring. */
function reportCall(ws: Workspace, now = NOW) {
  const started = start(ws, now, "report_call");
  expect(started.session.step).toBe("report_ring");
  const ringing = started.commit?.(ws) ?? ws;
  return applyAnswer(started.session, ringing, now, { value: "answer" });
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
    let { ws, session } = reportCall(createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0)));
    let guard = 0;

    while (session.step !== "report_summary" && guard < 40) {
      guard += 1;
      let input: { value?: string; text?: string };
      if (session.step === "report_question") {
        const questionId = session.data.currentQuestionId;
        if (questionId === "herd_health") input = { value: "no" };
        else if (questionId === "herd_count") input = { text: "42" };
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
      } else if (session.step === "herd_count_confirm") {
        input = { value: "yes" };
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
    expect(ws.reports[1].herdCountReported).toBe(42);
    expect(ws.reportCalls?.at(-1)).toMatchObject({ state: "completed", reportId: ws.reports[1].id });
    expect(ws.calls.find((call) => call.reportId === ws.reports[1].id)?.direction).toBe("outbound");
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
    const { ws, session } = reportCall(createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0)));
    const next = answer(session, ws, NOW, { value: "unknown" }).session;
    expect(next.draft.answers[0].certainty).toBe("unknown");
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
    expect(dueTaskVerifications(current, tomorrow).map((item) => item.id)).toContain(task.id);
    const report = reportCall(current, tomorrow).session;
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

    result = applyAnswer(session, current, callbackAt, { value: "yes" });
    current = result.ws;
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

  it("does not save an unfinished report when hung up, and marks the answered call ended", () => {
    const { ws, session } = reportCall(createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0)));
    const partial = answer(session, ws, NOW, { value: "no" }).session;
    const ended = hangUp(partial, ws, NOW);
    const after = ended.commit?.(ws) ?? ws;

    expect(ended.session.done).toBe(true);
    expect(after.reports).toHaveLength(1);
    expect(after.reportCalls?.at(-1)?.state).toBe("missed");
  });

  it("undoes a report call hung up on its first ring", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const started = start(ws, NOW, "report_call");
    const ringing = started.commit!(ws);
    expect(ringing.reportCalls).toHaveLength(1);
    const ended = hangUp(started.session, ringing, NOW);
    expect(ended.commit!(ringing).reportCalls).toEqual([]);
  });

  it("says every ringing line is a simulation and never speaks it as the agent", () => {
    const ws = createDemoWorkspace("ar", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const ringing = start(ws, NOW, "report_call").session;
    expect(ringing.turns).toHaveLength(1);
    expect(ringing.turns[0].speaker).toBe("system");
    expect(ringing.turns[0].text.en).toMatch(/^Simulation:/);
    expect(ringing.turns[0].text.ar).toMatch(/^محاكاة:/);
  });

  it("retries an unanswered report call 20 minutes apart, then marks it missed", () => {
    let ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const started = start(ws, NOW, "report_call");
    let session = started.session;
    ws = started.commit!(ws);
    let now = NOW;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      expect(session.step).toBe("report_ring");
      expect(session.turns.at(-1)?.text.en).toContain(`attempt ${attempt} of 3`);
      let result = applyAnswer(session, ws, now, { value: "no_answer" });
      session = result.session;
      ws = result.ws;
      if (attempt < 3) {
        expect(session.step).toBe("report_wait");
        expect(ws.reportCalls?.[0].nextAttemptAt).toBe(new Date(now.getTime() + RETRY_DELAY_MS).toISOString());
        result = applyAnswer(session, ws, now, { value: "skip_20" });
        session = result.session;
        ws = result.ws;
        now = new Date(now.getTime() + RETRY_DELAY_MS);
      }
    }
    expect(session.done).toBe(true);
    expect(session.step).toBe("report_missed");
    expect(ws.reportCalls?.[0].state).toBe("missed");
    expect(ws.calls.filter((call) => call.kind === "worker_report_missed")).toHaveLength(3);
    expect(ws.clockOffsetMs).toBe(2 * RETRY_DELAY_MS);
    expect(ws.reports).toHaveLength(1);

    // Ahmed returns the missed call: the report is taken on his call, not as a callback.
    expect(routeWorkerInboundCall(ws, now)).toEqual({ kind: "report" });
    const returned = start(ws, now, "worker_inbound").session;
    expect(returned.scenario).toBe("worker_inbound");
    expect(returned.turns[0].text.en).toContain("calling back about the report call you missed");
    expect(returned.step).toBe("report_question");
  });

  it("starts at the questions when a real report call is answered", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    const opened = startReportCall(ws, NOW, "schedule");
    const placed = placeReportCallAttempt(opened.ws, NOW, opened.run!.id).ws;
    const result = start(placed, NOW, "report_call", { reportCallId: opened.run!.id });
    expect(result.session.step).toBe("report_question");
    expect(result.session.turns.every((item) => item.speaker === "agent")).toBe(true);
    expect(result.commit!(placed).reportCalls?.[0].state).toBe("answered");

    const stale = start(ws, NOW, "report_call", { reportCallId: "rcl_gone" });
    expect(stale.session.done).toBe(true);
    expect(stale.commit).toBeUndefined();
  });

  it("refuses a report call when the worker number can't be dialled", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    ws.settings.worker.phone = "0501234567";
    const result = start(ws, NOW, "report_call");
    expect(result.session.done).toBe(true);
    expect(result.session.turns[0].text.en).toContain("country code");
    expect(result.commit).toBeUndefined();
  });

  it("keeps the worker's herd count as a proposal and asks about missing camels", () => {
    const { ws, session: first } = reportCall(createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0)));
    let session = answer(first, ws, NOW, { value: "yes" }).session;
    expect(session.data.currentQuestionId).toBe("herd_count");
    expect(session.turns.at(-1)?.text.en).toBe("How many camels are there in total today?");
    expect(session.inputMode).toBe("number");
    session = answer(session, ws, NOW, { text: "lots" }).session;
    expect(session.turns.at(-1)?.text.en).toContain("for example 42");
    session = answer(session, ws, NOW, { text: "40" }).session;
    expect(session.step).toBe("herd_count_confirm");
    expect(session.turns.at(-1)?.text.en).toContain("You counted 40 camels");
    session = answer(session, ws, NOW, { value: "yes" }).session;
    expect(session.step).toBe("herd_count_detail");
    expect(session.turns.at(-1)?.text.en).toContain("fewer than the 42 on record");
    session = answer(session, ws, NOW, { text: "Wadha and Shaha" }).session;
    expect(session.draft).toMatchObject({ herdCount: 40, herdAccountedFor: false });
    expect(session.draft.answers.at(-1)).toMatchObject({ questionId: "herd_count", answer: "40 camels — Wadha and Shaha", certainty: "reported" });
  });

  it("saves the counted herd as a proposal without touching the official count", () => {
    let { ws, session } = reportCall(createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0)));
    for (let guard = 0; session.step !== "report_summary" && guard < 40; guard += 1) {
      const input = session.data.currentQuestionId === "herd_count" && session.step === "report_question"
        ? { text: "45" }
        : session.inputMode === "choices" ? { value: session.replies[0].value } : session.inputMode === "number" ? { value: "quantity_skip" } : { text: "Nothing new" };
      ({ ws, session } = applyAnswer(session, ws, NOW, input));
    }
    expect(session.turns.at(-1)?.text.en).toContain("camels counted: 45");
    ({ ws, session } = applyAnswer(session, ws, NOW, { value: "confirm_save" }));
    expect(ws.reports.at(-1)?.herdCountReported).toBe(45);
    expect(ws.settings.herdCount).toBe(42);
    expect(herdCountProposal(ws)).toMatchObject({ reported: 45, official: 42 });
  });

  it("tells a worker who calls in without a missed report call when NAQAH will call", () => {
    const ws = createDemoWorkspace("en", "basic", fromRiyadh(2026, 11, 3, 9, 0));
    const session = start(ws, fromRiyadh(2026, 11, 5, 18, 30), "worker_inbound");
    expect(session.session.done).toBe(true);
    expect(session.session.turns[0].text.en).toContain("NAQAH will call you for the report");
    expect(session.session.turns[0].text.en).toContain("12 Nov");
    const updated = session.commit?.(ws) ?? ws;
    expect(updated.calls.at(-1)?.kind).toBe("worker_report_rejected");
    expect(updated.calls.at(-1)?.outcome).toBe("rejected");
  });

  it("says no report time is set yet when the owner hasn't chosen one", () => {
    const ws = createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0));
    ws.settings.callSchedule = null;
    const session = start(ws, NOW, "worker_inbound").session;
    expect(session.turns[0].text.en).toContain("hasn’t set a report time yet");
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
    const callback = start(missed.ws, missed.now, "worker_inbound").session;
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
    const empty = createEmptyWorkspace("ultimate");
    empty.settings.worker.phone = "+966507782190";
    const { ws, session } = reportCall(empty);
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
    const called = reportCall(createDemoWorkspace("en", "ultimate", fromRiyadh(2026, 11, 4, 9, 0)));
    const ws = called.ws;
    let session = answer(called.session, ws, NOW, { value: "no" }).session;
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
    const hot = reportCall(ws).session;

    expect(hot.data.currentQuestionId).toBe("weather_heat_water");
    expect(hot.turns.at(-2)?.text.en).toContain("Hello Ahmed");
    expect(hot.turns.at(-1)?.text.en).toContain("hot day (46°)");
    expect(hot.replies.map((item) => item.label.en)).toEqual(["Yes", "Not enough", "I don’t know"]);

    const normalWs = structuredClone(ws);
    normalWs.weather!.maxTempC = 39.9;
    expect(reportCall(normalWs).session.data.currentQuestionId).not.toBe("weather_heat_water");

    const staleWs = structuredClone(ws);
    staleWs.weather!.date = "2026-11-04";
    expect(reportCall(staleWs).session.data.currentQuestionId).not.toBe("weather_heat_water");

    const noCoordsWs = structuredClone(ws);
    noCoordsWs.settings.farm.coords = null;
    expect(reportCall(noCoordsWs).session.data.currentQuestionId).not.toBe("weather_heat_water");
  });

  it("stores a heat-day water and shade finding when the worker answers not enough", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.settings.worker.phone = "+966507782190";
    ws.settings.farm.coords = { lat: 24.155, lon: 47.334 };
    ws.resources = ws.resources.map((resource) => ({ ...resource, present: false }));
    const called = reportCall(withDemoHeat(ws, NOW));
    const heated = called.ws;

    let session = called.session;
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
});
