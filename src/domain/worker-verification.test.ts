import { describe, expect, it } from "vitest";
import { claimDueWorkerCall, completeWorkerReport, confirmTask, resolveWorkerCallAttempt, startTaskVerification, submitOwnerInstruction, submitOwnerInstructionBatch } from "./actions";
import { fromRiyadh, RETRY_DELAY_MS } from "./clock";
import { answer, hangUp, start } from "./conversation/engine";
import type { AnswerInput, CallSession } from "./conversation/engine";
import { tasksToConfirm } from "./conversation/shared";
import { startLiveWorkerDelivery } from "./conversation/worker-outbound";
import { dueTaskVerifications, dueWorkerCalls, reportPlanHasContent } from "./rules";
import { createEmptyWorkspace } from "./seed";
import type { PendingWorkerCall, Plan, Workspace } from "./types";

const dueAt = fromRiyadh(2026, 11, 12, 18, 0);
const later = fromRiyadh(2026, 11, 12, 21, 0);
const verify = (ws: Workspace) => ws.pendingWorkerCalls.filter((call) => call.purpose === "task_verification");

function farm(plan: Plan = "ultimate", tasks: [string, Date | null][] = [["t1", dueAt], ["t2", dueAt]]): Workspace {
  const ws = createEmptyWorkspace(plan);
  ws.settings.worker.name = "Ahmed";
  ws.settings.owner.name = "Abdullah";
  for (const [id, at] of tasks) {
    ws.taskTickets.push({ id, instruction: `Do ${id}`, createdAt: dueAt.toISOString(), scheduledFor: at?.toISOString() ?? null, status: "open", closedAt: null, closedVia: null });
  }
  return ws;
}

/** One claim per pass, and every call it opens in that pass. */
function claimed(ws: Workspace, now = dueAt): { ws: Workspace; call: PendingWorkerCall; attempt: number } {
  const claim = claimDueWorkerCall(ws, now);
  return { ws: claim.ws, call: claim.ws.pendingWorkerCalls.find((item) => item.id === claim.pendingCallId)!, attempt: claim.attempt };
}

function say(session: CallSession, ws: Workspace, now: Date, input: AnswerInput) {
  const result = answer(session, ws, now, input);
  return { session: result.session, ws: result.commit?.(ws) ?? ws };
}

const task = (ws: Workspace, id: string) => ws.taskTickets.find((item) => item.id === id)!;
const lastAgent = (session: CallSession) => session.turns.filter((turn) => turn.speaker === "agent").at(-1)!.text.en;

describe("verification calls group by exact due time", () => {
  it("puts tasks due at the same moment on one call", () => {
    const { ws, call } = claimed(farm());
    expect(verify(ws)).toHaveLength(1);
    expect(call).toMatchObject({ purpose: "task_verification", coveredTaskIds: ["t1", "t2"], taskTicketId: null });
  });

  it("keeps a single task's existing link", () => {
    const { call } = claimed(farm("ultimate", [["t1", dueAt]]));
    expect(call).toMatchObject({ coveredTaskIds: ["t1"], taskTicketId: "t1" });
  });

  it("gives different due times their own call, one claimed per pass", () => {
    const first = claimed(farm("ultimate", [["t1", dueAt], ["t2", later]]), later);
    expect(verify(first.ws).map((call) => call.coveredTaskIds)).toEqual([["t1"], ["t2"]]);
    const second = claimed(first.ws, later);
    expect(second.call.id).not.toBe(first.call.id);
  });

  it("compares due times, not their spelling", () => {
    const ws = farm();
    task(ws, "t2").scheduledFor = "2026-11-12T18:00:00+03:00";
    expect(verify(claimed(ws).ws)).toHaveLength(1);
  });

  it("starts one group however many times it is asked", () => {
    let ws = farm();
    for (let pass = 0; pass < 3; pass += 1) ws = claimDueWorkerCall(ws, dueAt).ws;
    expect(verify(ws)).toHaveLength(1);
    expect(dueTaskVerifications(ws, dueAt)).toEqual([]);
    expect(dueWorkerCalls(ws, dueAt)).toEqual([]);
  });

  it("gives a task that became due after dialling its own call", () => {
    const ws = farm("ultimate", [["t1", dueAt]]);
    const first = claimed(ws);
    first.ws.taskTickets.push({ ...task(ws, "t1"), id: "t2", instruction: "Do t2" });
    const started = startTaskVerification(first.ws, dueAt, "t2");
    expect(verify(started.ws).map((call) => call.coveredTaskIds)).toEqual([["t1"], ["t2"]]);
  });

  it("does not start while the task's instruction has not reached the worker", () => {
    const batch = submitOwnerInstructionBatch(farm("ultimate", []), dueAt, [
      { message: "One", actionable: true, scheduledFor: dueAt.toISOString() },
      { message: "Two", actionable: true, scheduledFor: dueAt.toISOString() },
    ], "batch-1");
    expect(dueTaskVerifications(batch.ws, later)).toEqual([]);
    const delivered = resolveWorkerCallAttempt(batch.ws, later, batch.pendingCallId!, "delivered").ws;
    expect(dueTaskVerifications(delivered, later).map((item) => item.id).sort()).toEqual([...batch.taskIds].sort());
  });
});

describe("a grouped verification call", () => {
  function live() {
    const { ws, call } = claimed(farm("ultimate", [["t1", dueAt], ["t2", dueAt], ["t3", dueAt]]));
    return { ws, callId: call.id, session: startLiveWorkerDelivery(ws, dueAt, call.id).session };
  }

  it("asks each open task in turn, one at a time", () => {
    const { session, ws } = live();
    expect(lastAgent(session)).toContain("Do t1");
    expect(session.turns.filter((turn) => turn.speaker === "agent")).toHaveLength(1);
    const next = say(session, ws, dueAt, { value: "no" });
    expect(lastAgent(next.session)).toContain("Do t2");
  });

  it("saves each yes and no as given, and delivers only when all are answered", () => {
    let { session, ws } = live();
    const callId = ws.pendingWorkerCalls[0].id;
    ({ session, ws } = say(session, ws, dueAt, { value: "yes" }));
    expect(task(ws, "t1").status).toBe("closed");
    expect(ws.pendingWorkerCalls[0]).toMatchObject({ id: callId, state: "pending", attempts: [] });
    ({ session, ws } = say(session, ws, dueAt, { value: "no" }));
    expect(task(ws, "t2").status).toBe("open");
    ({ session, ws } = say(session, ws, dueAt, { value: "yes" }));
    expect(task(ws, "t3").status).toBe("closed");
    expect(session.data).toMatchObject({ attemptResolved: true, deliveryCompleted: true });
    expect(ws.pendingWorkerCalls[0]).toMatchObject({ state: "delivered", nextAttemptAt: null, attempts: [{ at: dueAt.toISOString(), answered: true }] });
    expect(session.done).toBe(true);
  });

  it("treats I don't know as leaving the task open and the attempt unfinished", () => {
    let { session, ws } = live();
    ({ session, ws } = say(session, ws, dueAt, { value: "yes" }));
    ({ session, ws } = say(session, ws, dueAt, { value: "unknown" }));
    ({ session, ws } = say(session, ws, dueAt, { value: "yes" }));
    expect(task(ws, "t2").status).toBe("open");
    expect(task(ws, "t3").status).toBe("closed");
    expect(session.data).toMatchObject({ attemptResolved: true });
    expect(session.data.deliveryCompleted).toBeUndefined();
    expect(ws.pendingWorkerCalls[0]).toMatchObject({ state: "pending", attempts: [{ answered: true }], nextAttemptAt: new Date(dueAt.getTime() + RETRY_DELAY_MS).toISOString() });
  });

  it("asks a retry only what is still open, and a no stays open to be asked", () => {
    let { session, ws } = live();
    ({ session, ws } = say(session, ws, dueAt, { value: "yes" }));
    ({ session, ws } = say(session, ws, dueAt, { value: "no" }));
    // The line drops before the third answer.
    ws = resolveWorkerCallAttempt(ws, dueAt, ws.pendingWorkerCalls[0].id, "interrupted").ws;
    const retryAt = new Date(dueAt.getTime() + RETRY_DELAY_MS);
    const claim = claimDueWorkerCall(ws, retryAt);
    expect(claim).toMatchObject({ attempt: 2 });
    let retry = startLiveWorkerDelivery(claim.ws, retryAt, claim.pendingCallId!).session;
    expect(retry.data.verificationTaskIds).toEqual(["t2", "t3"]);
    expect(lastAgent(retry)).toContain("Do t2");
    let state = claim.ws;
    ({ session: retry, ws: state } = say(retry, state, retryAt, { value: "no" }));
    ({ session: retry, ws: state } = say(retry, state, retryAt, { value: "yes" }));
    expect(state.pendingWorkerCalls[0]).toMatchObject({ state: "delivered" });
    expect(state.pendingWorkerCalls[0].attempts).toHaveLength(2);
    expect(task(state, "t2").status).toBe("open");
  });

  it("stops after three unsuccessful attempts and opens no ticket", () => {
    let { ws } = claimed(farm());
    const id = ws.pendingWorkerCalls[0].id;
    let at = dueAt;
    for (const result of ["unanswered", "interrupted", "interrupted"] as const) {
      ws = resolveWorkerCallAttempt(ws, at, id, result).ws;
      at = new Date(at.getTime() + RETRY_DELAY_MS);
    }
    expect(ws.pendingWorkerCalls[0]).toMatchObject({ state: "no_answer_ticket", nextAttemptAt: null });
    expect(ws.noAnswerTickets).toEqual([]);
    expect(ws.taskTickets.every((item) => item.status === "open")).toBe(true);
  });

  it("ends the call when its last open task is closed elsewhere, and not before", () => {
    let { ws } = claimed(farm());
    ws = confirmTask(ws, dueAt, "t1", true, "worker_report");
    expect(ws.pendingWorkerCalls[0].state).toBe("pending");
    ws = confirmTask(ws, dueAt, "t2", true, "worker_report");
    expect(ws.pendingWorkerCalls[0]).toMatchObject({ state: "delivered", nextAttemptAt: null });
  });

  it("works the same in the Call Lab, including a hang-up partway through", () => {
    const ws = farm();
    const started = start(ws, dueAt, "worker_outbound");
    let state = started.commit?.(ws) ?? ws;
    expect(verify(state)).toHaveLength(1);
    let { session } = say(started.session, state, dueAt, { value: "answer" });
    ({ session, ws: state } = say(session, state, dueAt, { value: "yes" }));
    expect(task(state, "t1").status).toBe("closed");
    const ended = hangUp(session, state, dueAt);
    state = ended.commit?.(state) ?? state;
    expect(verify(state)[0]).toMatchObject({ state: "pending", attempts: [{ answered: true }] });
    expect(task(state, "t2").status).toBe("open");
  });
});

describe("tasks asked during the report", () => {
  it("skips a task whose instruction has not been delivered", () => {
    const made = submitOwnerInstruction(farm("ultimate", []), dueAt, { message: "Fix the gate", actionable: true, scheduledFor: null });
    expect(tasksToConfirm(made.ws, dueAt)).toEqual([]);
    const delivered = resolveWorkerCallAttempt(made.ws, dueAt, made.pendingCallId!, "delivered").ws;
    expect(tasksToConfirm(delivered, dueAt).map((item) => item.id)).toEqual([made.taskId]);
  });

  it("skips a task while a verification call is still asking, covering grouped calls too", () => {
    const { ws } = claimed(farm());
    expect(tasksToConfirm(ws, dueAt)).toEqual([]);
    const done = resolveWorkerCallAttempt(ws, dueAt, ws.pendingWorkerCalls[0].id, "delivered").ws;
    expect(tasksToConfirm(done, dueAt).map((item) => item.id)).toEqual(["t1", "t2"]);
  });

  it("does not ask a future task", () => {
    expect(tasksToConfirm(farm("ultimate", [["t1", later]]), dueAt)).toEqual([]);
  });

  it("has nothing to call about when the only tasks are held back", () => {
    const { ws } = claimed(farm());
    expect(reportPlanHasContent({ ...ws, settings: { ...ws.settings, questionPlan: allOff(ws) } }, dueAt)).toBe(false);
  });
});

function allOff(ws: Workspace) {
  return ["herd_health", "herd_count", "feed_level", "water_level", "fences_condition", "shelter_condition", "medicine_stock"]
    .concat(ws.settings.customQuestions.map((question) => question.id))
    .map((id) => ({ id, enabled: false, required: true }));
}

describe("Basic has no instructions, tasks or follow-up calls", () => {
  it("does not create instructions", () => {
    const ws = farm("basic", []);
    const single = submitOwnerInstruction(ws, dueAt, { message: "m", actionable: true, scheduledFor: null });
    expect(single).toMatchObject({ pendingCallId: null, taskId: null });
    const batch = submitOwnerInstructionBatch(ws, dueAt, [{ message: "m", actionable: false, scheduledFor: null }], "b");
    expect(batch).toMatchObject({ created: false, pendingCallId: null, taskIds: [] });
    expect(batch.ws.relays).toEqual([]);
  });

  it("starts no verification and dials nothing, even for rows left from Ultimate", () => {
    const ws = farm("basic");
    expect(dueTaskVerifications(ws, dueAt)).toEqual([]);
    expect(startTaskVerification(ws, dueAt, "t1")).toMatchObject({ pendingCallId: null });
    ws.pendingWorkerCalls.push({ id: "old", purpose: "instruction", message: "m", taskTicketId: null, relayId: null, attempts: [], nextAttemptAt: dueAt.toISOString(), state: "pending" });
    expect(dueWorkerCalls(ws, dueAt)).toEqual([]);
    expect(claimDueWorkerCall(ws, dueAt)).toMatchObject({ pendingCallId: null, attempt: 0 });
    expect(start(ws, dueAt, "worker_outbound").session.done).toBe(true);
  });

  it("neither asks about nor closes tasks", () => {
    const ws = farm("basic", [["t1", null]]);
    expect(tasksToConfirm(ws, dueAt)).toEqual([]);
    expect(task(confirmTask(ws, dueAt, "t1", true, "worker_report"), "t1").status).toBe("open");
    const draft = { answers: [{ questionId: "q", question: { ar: "س", en: "q" }, answer: "a", certainty: "reported" as const, followUp: false }], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [{ taskId: "t1", done: true }] };
    expect(task(completeWorkerReport(ws, dueAt, draft).ws, "t1").status).toBe("open");
  });
});
