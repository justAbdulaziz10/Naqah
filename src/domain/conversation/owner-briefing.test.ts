import { describe, expect, it } from "vitest";
import { fromRiyadh } from "../clock";
import { createDemoWorkspace } from "../seed";
import type { Workspace } from "../types";
import { answer, hangUp, type AnswerInput, type CallSession, type ProposedInstruction } from "./engine";
import { instructionBatchId, readDue, startLiveOwnerBriefing } from "./owner-briefing";

const NOW = fromRiyadh(2026, 11, 5, 17, 10);
const RUN = { runId: "run-1", attempt: 1 };

const farm = (plan: "basic" | "ultimate" = "ultimate"): Workspace => createDemoWorkspace("en", plan, NOW);
const open = (ws = farm()) => startLiveOwnerBriefing(ws, NOW, null, RUN).session;

const task = (message: string, due: ProposedInstruction["due"] = "any_time"): ProposedInstruction => ({ message, kind: "task", due, evidence: message });
const info = (message: string): ProposedInstruction => ({ message, kind: "information", due: null, evidence: message });

function step(session: CallSession, ws: Workspace, input: AnswerInput) {
  const result = answer(session, ws, NOW, input);
  return { session: result.session, ws: result.commit ? result.commit(ws) : ws, committed: Boolean(result.commit) };
}

const review = (session: CallSession) => session.turns.at(-1)?.text.en ?? "";

describe("owner instructions on the summary call", () => {
  it("never asks a Basic owner for instructions", () => {
    const session = open(farm("basic"));
    expect(session.done).toBe(true);
    expect(session.turns.map((turn) => turn.text.en).join(" ")).not.toMatch(/instruction/i);
    expect(session.step).not.toBe("instruction_yesno");
  });

  it("ends on a decline without saving anything", () => {
    const ws = farm();
    const result = step(open(ws), ws, { value: "instruction_no" });
    expect(result.session.done).toBe(true);
    expect(result.committed).toBe(false);
  });

  it("reads every proposal back with its kind and time, and saves only on yes, as one batch", () => {
    const ws = farm();
    const at = fromRiyadh(2026, 11, 6, 18, 0).toISOString();
    const proposed = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence", at), info("Guests come Friday"), task("Fill the trough")] });
    expect(proposed.committed).toBe(false);
    expect(proposed.session.step).toBe("instruction_review");
    const text = review(proposed.session);
    expect(text).toContain("I took this as a task, for");
    expect(text).toContain("Fix the fence");
    expect(text).toContain("information only: Guests come Friday");
    expect(text).toContain("a task, any time: Fill the trough");
    expect(proposed.session.replies.map((reply) => reply.value)).toEqual(["instructions_confirm", "instructions_correct", "instructions_add", "instructions_remove", "instructions_cancel"]);

    const tasksBefore = ws.taskTickets.length;
    const saved = step(proposed.session, proposed.ws, { value: "instructions_confirm" });
    expect(saved.session.done).toBe(true);
    expect(saved.committed).toBe(true);
    expect(saved.ws.taskTickets.length - tasksBefore).toBe(2);
    expect(saved.ws.taskTickets.find((item) => item.instruction === "Fix the fence")?.scheduledFor).toBe(at);
    const calls = saved.ws.pendingWorkerCalls.filter((call) => call.batchId === instructionBatchId(proposed.session));
    expect(calls).toHaveLength(1);
    expect(calls[0].message).toBe("Fix the fence\nGuests come Friday\nFill the trough");
    expect(saved.ws.relays.some((relay) => relay.message === "Guests come Friday")).toBe(true);
  });

  it("asks when for a task with no time, one at a time, then reviews", () => {
    const ws = farm();
    let result = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence", null), task("Fill the trough", "2026-11-06")] });
    expect(result.session.step).toBe("instruction_schedule");
    expect(review(result.session)).toContain("Fix the fence");
    result = step(result.session, result.ws, { value: "any_time" });
    expect(result.session.step).toBe("instruction_time");
    expect(review(result.session)).toContain("Fill the trough");
    result = step(result.session, result.ws, { text: "07:30" });
    expect(result.session.step).toBe("instruction_review");
    expect(result.session.data.pendingInstructions?.[0].scheduledFor).toBeNull();
    expect(result.session.data.pendingInstructions?.[1].scheduledFor).toBe(fromRiyadh(2026, 11, 6, 7, 30).toISOString());
  });

  it("treats a past or unusable due as no time at all", () => {
    expect(readDue("2020-01-01T10:00:00+03:00", NOW)).toBeNull();
    expect(readDue("2026-11-06T18:00", NOW)).toBeNull();
    expect(readDue("tomorrow", NOW)).toBeNull();
    expect(readDue("2099-01-01", NOW)).toBeNull();
    expect(readDue("any_time", NOW)).toEqual({ kind: "any_time" });
    const ws = farm();
    const result = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence", "2020-01-01T10:00:00+03:00")] });
    expect(result.session.step).toBe("instruction_schedule");
  });

  it("re-classifies one item and reads the whole list again, under a new revision", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence"), info("Guests come Friday")] });
    const revision = first.session.data.draftRevision ?? 0;
    const fixed = step(first.session, first.ws, { text: "the fence is only information", instructionCorrection: { index: 0, kind: "information" } });
    expect(fixed.session.step).toBe("instruction_review");
    expect(fixed.session.data.draftRevision).toBe(revision + 1);
    expect(review(fixed.session)).toContain("information only: Fix the fence");
    expect(review(fixed.session)).toContain("Guests come Friday");
    const saved = step(fixed.session, fixed.ws, { value: "instructions_confirm" });
    expect(saved.ws.taskTickets.some((item) => item.instruction === "Fix the fence")).toBe(false);
  });

  it("keeps a task's time when only its words change, and asks when it becomes a task", () => {
    const ws = farm();
    const at = fromRiyadh(2026, 11, 6, 18, 0).toISOString();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence", at), info("Guests come Friday")] });
    const reworded = step(first.session, first.ws, { instructionCorrection: { index: 0, message: "Fix the east fence" } });
    expect(reworded.session.data.pendingInstructions?.[0]).toMatchObject({ message: "Fix the east fence", scheduledFor: at, actionable: true });
    const nowTask = step(reworded.session, reworded.ws, { instructionCorrection: { index: 1, kind: "task" } });
    expect(nowTask.session.step).toBe("instruction_schedule");
    expect(review(nowTask.session)).toContain("Guests come Friday");
  });

  it("asks what should change when a correction names only the item", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence"), info("Guests come Friday")] });
    const asked = step(first.session, first.ws, { instructionCorrection: { index: 1 } });
    expect(asked.session.step).toBe("instruction_correct_what");
    expect(review(asked.session)).toContain("Guests come Friday");
  });

  it("adds to the list at review and reads all of it again under a new revision", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence")] });
    const revision = first.session.data.draftRevision ?? 0;
    const asked = step(first.session, first.ws, { value: "instructions_add" });
    expect(asked.session.step).toBe("instruction_text");
    expect(asked.committed).toBe(false);
    const added = step(asked.session, asked.ws, { text: "said", instructions: [info("Guests come Friday")] });
    expect(added.session.step).toBe("instruction_review");
    expect(added.session.data.draftRevision).toBe(revision + 1);
    expect(added.session.data.pendingInstructions?.map((item) => item.message)).toEqual(["Fix the fence", "Guests come Friday"]);
    expect(review(added.session)).toContain("Fix the fence");
    expect(review(added.session)).toContain("Guests come Friday");
    const direct = step(added.session, added.ws, { text: "said", instructions: [task("Fill the trough")] });
    expect(direct.session.data.pendingInstructions).toHaveLength(3);
    expect(direct.session.data.draftRevision).toBe(revision + 2);
  });

  it("asks which to remove, reads the rest back and saves one batch", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence"), task("Fill the trough")] });
    const revision = first.session.data.draftRevision ?? 0;
    const pick = step(first.session, first.ws, { value: "instructions_remove" });
    expect(pick.session.step).toBe("instruction_remove_pick");
    expect(pick.session.replies.map((reply) => reply.value)).toEqual(["remove:0", "remove:1", "back_to_review"]);
    const back = step(pick.session, pick.ws, { value: "back_to_review" });
    expect(back.session.step).toBe("instruction_review");
    expect(back.session.data.draftRevision ?? 0).toBe(revision);

    const removed = step(pick.session, pick.ws, { value: "remove:0" });
    expect(removed.session.step).toBe("instruction_review");
    expect(removed.session.data.draftRevision).toBe(revision + 1);
    expect(review(removed.session)).not.toContain("Fix the fence");
    expect(review(removed.session)).toContain("Fill the trough");

    const tasksBefore = ws.taskTickets.length;
    const saved = step(removed.session, removed.ws, { value: "instructions_confirm" });
    expect(saved.committed).toBe(true);
    expect(saved.ws.taskTickets.length - tasksBefore).toBe(1);
    expect(saved.ws.pendingWorkerCalls.filter((call) => call.batchId === instructionBatchId(removed.session))).toHaveLength(1);
  });

  it("asks afresh after the last one is removed, and saves nothing on no", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence")] });
    const emptied = step(first.session, first.ws, { value: "instructions_remove" });
    expect(emptied.session.step).toBe("instruction_yesno");
    expect(emptied.session.data.pendingInstructions).toEqual([]);
    expect(emptied.committed).toBe(false);
    const ended = step(emptied.session, emptied.ws, { value: "instruction_no" });
    expect(ended.session.done).toBe(true);
    expect(ended.committed).toBe(false);
    expect(ended.ws.taskTickets).toEqual(ws.taskTickets);
  });

  it("ignores a removal outside the list", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence")] });
    const same = step(first.session, first.ws, { instructionRemove: 4 });
    expect(same.session.step).toBe("instruction_review");
    expect(same.session.data.pendingInstructions).toHaveLength(1);
    expect(same.session.data.draftRevision).toBe(first.session.data.draftRevision);
  });

  it("cancels without saving, and a bad reply never saves", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence")] });
    const unclear = step(first.session, first.ws, { value: "maybe" });
    expect(unclear.committed).toBe(false);
    expect(unclear.session.step).toBe("instruction_review");
    const cancelled = step(unclear.session, unclear.ws, { value: "instructions_cancel" });
    expect(cancelled.session.done).toBe(true);
    expect(cancelled.committed).toBe(false);
    expect(cancelled.ws.taskTickets).toEqual(ws.taskTickets);
  });

  it("saves nothing when the call is interrupted before confirmation", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence")] });
    const ended = hangUp(first.session, first.ws, NOW);
    expect(ended.session.done).toBe(true);
    expect(ended.commit).toBeUndefined();
  });

  it("does not save the same run's batch twice", () => {
    const ws = farm();
    const first = step(open(ws), ws, { text: "said", instructions: [task("Fix the fence")] });
    const saved = step(first.session, first.ws, { value: "instructions_confirm" });
    const again = step(first.session, saved.ws, { value: "instructions_confirm" });
    expect(again.committed).toBe(false);
    expect(again.session.done).toBe(true);
    expect(review(again.session)).toMatch(/saved earlier/);
    expect(saved.ws.pendingWorkerCalls.filter((call) => call.batchId === instructionBatchId(first.session))).toHaveLength(1);
  });
});

describe("the scripted path, with no model", () => {
  const captured = (ws: Workspace) => {
    const yes = step(open(ws), ws, { value: "instruction_yes" });
    expect(yes.session.step).toBe("instruction_text");
    return step(yes.session, yes.ws, { text: "Move Wadha to the shade" });
  };

  it("captures the words, asks the owner the kind, and labels it as their choice", () => {
    const ws = farm();
    const said = captured(ws);
    expect(said.session.step).toBe("instruction_kind");
    const kind = step(said.session, said.ws, { value: "actionable" });
    const when = step(kind.session, kind.ws, { value: "any_time" });
    expect(when.session.step).toBe("instruction_more");
    const list = step(when.session, when.ws, { value: "instruction_no" });
    expect(list.session.step).toBe("instruction_review");
    expect(review(list.session)).toContain("You marked this as a task, any time: Move Wadha to the shade");
  });

  it("does not take «لا» as the instruction", () => {
    const ws = farm();
    const yes = step(open(ws), ws, { value: "instruction_yes" });
    const none = step(yes.session, yes.ws, { text: "لا والله" });
    expect(none.session.done).toBe(true);
    expect(none.committed).toBe(false);
  });

  it("lets the owner say one again and re-mark another, then reads the list again", () => {
    const ws = farm();
    const said = captured(ws);
    const kind = step(said.session, said.ws, { value: "information" });
    const more = step(kind.session, kind.ws, { value: "instruction_yes" });
    const second = step(more.session, more.ws, { text: "Check the gate" });
    const secondKind = step(second.session, second.ws, { value: "actionable" });
    const secondWhen = step(secondKind.session, secondKind.ws, { value: "any_time" });
    let list = step(secondWhen.session, secondWhen.ws, { value: "instruction_no" });
    expect(list.session.data.pendingInstructions).toHaveLength(2);

    let pick = step(list.session, list.ws, { value: "instructions_correct" });
    expect(pick.session.step).toBe("instruction_correct_pick");
    expect(pick.session.replies.map((reply) => reply.value)).toEqual(["correct:0", "correct:1", "back_to_review"]);
    let what = step(pick.session, pick.ws, { value: "correct:0" });
    expect(what.session.step).toBe("instruction_correct_what");
    let again = step(what.session, what.ws, { value: "correct_text" });
    expect(again.session.step).toBe("instruction_text");
    list = step(again.session, again.ws, { text: "Move Wadha to the north pen" });
    expect(list.session.step).toBe("instruction_review");
    expect(review(list.session)).toContain("Move Wadha to the north pen");
    expect(review(list.session)).toContain("Check the gate");

    pick = step(list.session, list.ws, { value: "instructions_correct" });
    what = step(pick.session, pick.ws, { value: "correct:1" });
    again = step(what.session, what.ws, { value: "correct_kind" });
    expect(again.session.step).toBe("instruction_kind");
    list = step(again.session, again.ws, { value: "information" });
    expect(list.session.step).toBe("instruction_review");
    expect(review(list.session)).toContain("You marked this as information only: Check the gate");
  });

  it("goes back to the list without changing anything", () => {
    const ws = farm();
    const said = captured(ws);
    const kind = step(said.session, said.ws, { value: "information" });
    const list = step(kind.session, kind.ws, { value: "instruction_no" });
    const what = step(list.session, list.ws, { value: "instructions_correct" });
    expect(what.session.step).toBe("instruction_correct_what");
    const back = step(what.session, what.ws, { value: "back_to_review" });
    expect(back.session.step).toBe("instruction_review");
    expect(back.session.data.draftRevision ?? 0).toBe(list.session.data.draftRevision ?? 0);
  });
});

describe("saved words on the phone", () => {
  it("reads the summary as written, so a neighbour named like the sample worker stays that person", () => {
    const { session } = startLiveOwnerBriefing(farm(), NOW, null, RUN, { ar: "أحمد الجار أخذ كيسين", en: "Ahmed the neighbour took two bags" });
    expect(session.turns[0].literal).toBe(true);
  });
});
