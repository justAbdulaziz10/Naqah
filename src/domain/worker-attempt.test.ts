import { describe, expect, it } from "vitest";
import { resolveWorkerCallAttempt, submitOwnerInstructionBatch } from "./actions";
import { fromRiyadh } from "./clock";
import { startLiveOwnerBriefing } from "./conversation/owner-briefing";
import { answer } from "./conversation/engine";
import { startLiveWorkerDelivery } from "./conversation/worker-outbound";
import { createEmptyWorkspace } from "./seed";
import type { PendingWorkerCall, Workspace } from "./types";

const now = fromRiyadh(2026, 11, 12, 18, 0);

function pending(id: string, purpose: PendingWorkerCall["purpose"] = "instruction"): PendingWorkerCall {
  return {
    id,
    purpose,
    message: "Move Wadha to the shade",
    taskTicketId: purpose === "task_verification" ? "tsk_1" : null,
    relayId: "rel_1",
    attempts: [],
    nextAttemptAt: now.toISOString(),
    state: "pending",
  };
}

function farm(): Workspace {
  const ws = createEmptyWorkspace("ultimate");
  ws.relays.push({ id: "rel_1", at: now.toISOString(), message: "Move Wadha to the shade", delivered: false });
  ws.taskTickets.push({
    id: "tsk_1",
    instruction: "Move Wadha to the shade",
    createdAt: now.toISOString(),
    scheduledFor: null,
    status: "open",
    closedAt: null,
    closedVia: null,
  });
  ws.pendingWorkerCalls.push(pending("pwc_1"));
  return ws;
}

describe("answering is not delivery", () => {
  it("keeps the instruction undelivered when the call ends halfway", () => {
    const first = resolveWorkerCallAttempt(farm(), now, "pwc_1", "interrupted");
    expect(first.outcome).toBe("retry_scheduled");
    const call = first.ws.pendingWorkerCalls[0];
    expect(call.state).toBe("pending");
    expect(call.attempts).toEqual([{ at: now.toISOString(), answered: true }]);
    expect(first.ws.relays[0].delivered).toBe(false);
    expect(first.ws.taskTickets[0].status).toBe("open");
    expect(first.ws.noAnswerTickets).toHaveLength(0);
  });

  it("stops after three unsuccessful attempts and does not open a ticket", () => {
    let ws = farm();
    let at = now;
    for (let i = 0; i < 3; i += 1) {
      const result = resolveWorkerCallAttempt(ws, at, "pwc_1", i === 1 ? "interrupted" : "unanswered");
      ws = result.ws;
      at = new Date(at.getTime() + 20 * 60_000);
    }
    expect(ws.pendingWorkerCalls[0].state).toBe("no_answer_ticket");
    expect(ws.pendingWorkerCalls[0].attempts).toHaveLength(3);
    expect(ws.noAnswerTickets).toHaveLength(0);
    expect(ws.relays[0].delivered).toBe(false);
    const again = resolveWorkerCallAttempt(ws, at, "pwc_1", "unanswered");
    expect(again.ws.pendingWorkerCalls[0].attempts).toHaveLength(3);
  });

  it("does not complete a task when the worker only picks up", () => {
    const ws = farm();
    ws.pendingWorkerCalls[0] = pending("pwc_1", "task_verification");
    const heard = startLiveWorkerDelivery(ws, now, "pwc_1");
    expect(heard.session.step).toBe("outbound_task_confirmation");
    expect(heard.commit).toBeUndefined();
    expect(ws.taskTickets[0].status).toBe("open");
    const yes = answer(heard.session, ws, now, { value: "yes" });
    const saved = yes.commit?.(ws) ?? ws;
    expect(saved.taskTickets[0].status).toBe("closed");
    expect(saved.pendingWorkerCalls[0].state).toBe("delivered");
  });
});

describe("live owner briefing", () => {
  it("ends a Basic summary without asking for instructions", () => {
    const ws = createEmptyWorkspace("basic");
    ws.reports.push({ id: "rep_1", at: now.toISOString(), callId: "c", answers: [], findings: [] });
    const started = startLiveOwnerBriefing(ws, now, "rep_1");
    expect(started.session.done).toBe(true);
    expect(started.session.step).not.toBe("instruction_yesno");
    expect(started.commit).toBeUndefined();
  });

  it("saves an Ultimate batch only after confirmation, with one worker call", () => {
    const ws = createEmptyWorkspace("ultimate");
    ws.settings.worker.name = "Ahmed";
    ws.reports.push({ id: "rep_1", at: now.toISOString(), callId: "c", answers: [], findings: [] });
    let session = startLiveOwnerBriefing(ws, now, "rep_1").session;
    expect(session.step).toBe("instruction_yesno");
    session = answer(session, ws, now, { value: "instruction_yes" }).session;
    session = answer(session, ws, now, { text: "The vet is coming tomorrow" }).session;
    session = answer(session, ws, now, { value: "information" }).session;
    session = answer(session, ws, now, { value: "instruction_no" }).session;
    const confirmed = answer(session, ws, now, { value: "instruction_yes" });
    const saved = confirmed.commit?.(ws) ?? ws;
    expect(saved.taskTickets).toHaveLength(0);
    expect(saved.pendingWorkerCalls).toHaveLength(1);
    expect(saved.pendingWorkerCalls[0].message).toContain("The vet is coming tomorrow");
    const replay = submitOwnerInstructionBatch(saved, now, [{ message: "The vet is coming tomorrow", actionable: false, scheduledFor: null }], "owner-instructions:rep_1");
    expect(replay.created).toBe(false);
    expect(replay.ws.pendingWorkerCalls).toHaveLength(1);
  });
});
