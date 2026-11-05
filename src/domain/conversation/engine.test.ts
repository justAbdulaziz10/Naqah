import { describe, expect, it } from "vitest";
import { recordOwnerInquiry, submitOwnerInstruction } from "../actions";
import { fromRiyadh, RETRY_DELAY_MS } from "../clock";
import { ownerBriefing } from "../findings";
import { createDemoWorkspace } from "../seed";
import type { Workspace } from "../types";
import { answer, start, type CallSession } from "./engine";

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
});
