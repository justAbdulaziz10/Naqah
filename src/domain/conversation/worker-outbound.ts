import { advanceClock, confirmTask, resolveWorkerCallAttempt, startTaskVerification } from "../actions";
import { MAX_RETRIES, RETRY_DELAY_MS } from "../clock";
import { dueTaskVerifications, dueWorkerCalls, openCoveredTasks, taskTicketsEnabled, workerDeliveryResult } from "../rules";
import type { Workspace } from "../types";

import { copy, reply, blank, ask, status, say, addNotice, commitTo, workerTurn, atRiyadh } from './shared';
import type { CallSession, EngineResult, AnswerInput } from './shared';

export function startWorkerOutbound(ws: Workspace, now: Date): EngineResult {
  let prepared = ws;
  let startedVerification = false;
  const startedVerificationCallIds: string[] = [];
  const dueTasks = dueTaskVerifications(prepared, now);
  for (const task of dueTasks) {
    const result = startTaskVerification(prepared, now, task.id);
    prepared = result.ws;
    startedVerification = true;
    if (result.pendingCallId && !startedVerificationCallIds.includes(result.pendingCallId)) startedVerificationCallIds.push(result.pendingCallId);
  }

  const pendingIds = prepared.pendingWorkerCalls
    .filter((call) => call.state === "pending" && taskTicketsEnabled(prepared))
    .slice()
    .sort((a, b) => (a.nextAttemptAt ?? "").localeCompare(b.nextAttemptAt ?? ""))
    .map((call) => call.id);
  let session: CallSession = {
    ...blank("worker_outbound", now),
    data: { pendingCallIds: pendingIds, pendingIndex: 0, startedVerificationCallIds },
  };
  if (!pendingIds.length) {
    session = say(
      session,
      copy("There are no worker calls waiting right now.", "ما فيه مكالمات معلّقة للعامل الآن."),
      now,
      true,
    );
  } else {
    session = beginOutboundAttempt(session, prepared, now);
  }
  return {
    session,
    ...(startedVerification ? { commit: commitTo(prepared) } : {}),
  };
}

function beginOutboundAttempt(session: CallSession, ws: Workspace, now: Date): CallSession {
  const index = session.data.pendingIndex ?? 0;
  const callId = session.data.pendingCallIds?.[index];
  const call = ws.pendingWorkerCalls.find((item) => item.id === callId && item.state === "pending");
  if (!call) {
    // A status line: the worker on a real call has already heard their goodbye.
    return status(
      { ...session, data: { ...session.data, currentCallId: undefined } },
      copy("There are no more worker calls waiting right now.", "ما فيه مكالمات أخرى معلّقة للعامل الآن."),
      now,
      "outbound_done",
      [],
      true,
    );
  }
  const current = { ...session, data: { ...session.data, currentCallId: call.id } };
  const isDue = dueWorkerCalls(ws, now).some((item) => item.id === call.id);
  if (!isDue) {
    const retryAt = call.nextAttemptAt ? atRiyadh(new Date(call.nextAttemptAt), "en", true) : "";
    const retryAtAr = call.nextAttemptAt ? atRiyadh(new Date(call.nextAttemptAt), "ar", true) : "";
    return ask(
      current,
      copy(
        "The next call is scheduled for " + retryAt + " Riyadh time. Move the demo clock forward by 20 minutes to continue.",
        "المكالمة القادمة مجدولة " + retryAtAr + " بتوقيت الرياض. قدّم ساعة العرض 20 دقيقة للمتابعة.",
      ),
      now,
      "outbound_wait",
      [reply("skip_20", "Skip 20 minutes", "تجاوز 20 دقيقة")],
    );
  }
  const attempt = call.attempts.length + 1;
  return ask(
    current,
    copy(
      "NAQAH is calling Ahmed. This is attempt " + attempt + ". Would you like him to answer?",
      "ناقة تتصل بأحمد. هذه المحاولة رقم " + attempt + ". تبي تخليه يرد؟",
    ),
    now,
    "outbound_answer",
    [reply("answer", "Answer", "رد"), reply("no_answer", "No answer", "ما رد")],
  );
}

export function handleWorkerOutbound(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  if (session.step === "outbound_wait") {
    const updated = advanceClock(ws, RETRY_DELAY_MS);
    const later = new Date(now.getTime() + RETRY_DELAY_MS);
    const sessionWithNotice = addNotice(
      session,
      copy("Demo clock advanced by 20 minutes.", "تقدمت ساعة العرض 20 دقيقة."),
    );
    return {
      session: beginOutboundAttempt(sessionWithNotice, updated, later),
      commit: commitTo(updated),
    };
  }

  const current = workerTurn(session, input, now);
  if (session.step === "outbound_answer") {
    const callId = session.data.currentCallId;
    const call = ws.pendingWorkerCalls.find((item) => item.id === callId && item.state === "pending");
    if (!call || !callId) return { session: say(current.session, copy("This call is no longer waiting.", "هذه المكالمة لم تعد معلّقة."), now, true) };
    if (current.value === "no_answer") {
      const result = resolveWorkerCallAttempt(ws, now, callId, "unanswered");
      if (result.outcome === "retry_scheduled") {
        const nextAttempt = (result.ws.pendingWorkerCalls.find((item) => item.id === callId)?.attempts.length ?? 1) + 1;
        const retryAt = new Date(now.getTime() + RETRY_DELAY_MS);
        const text = copy(
          "Ahmed did not answer. Attempt " + nextAttempt + " of " + (MAX_RETRIES + 1) + " is scheduled for " + atRiyadh(retryAt, "en", true) + " Riyadh time.",
          "ما رد أحمد. المحاولة " + nextAttempt + " من " + (MAX_RETRIES + 1) + " في " + atRiyadh(retryAt, "ar", true) + " بتوقيت الرياض.",
        );
        const waiting = ask(
          addNotice(current.session, text),
          text,
          now,
          "outbound_wait",
          [reply("skip_20", "Skip 20 minutes", "تجاوز 20 دقيقة")],
        );
        return { session: waiting, commit: commitTo(result.ws) };
      }
      const ticketText = copy(
        "Ahmed did not answer after three attempts. Automatic calls have stopped. The instructions were not delivered.",
        "ما رد أحمد بعد ثلاث محاولات. توقفت المكالمات التلقائية، والتعليمات ما وصلت.",
      );
      const next = addNotice(say(current.session, ticketText, now), ticketText);
      return { session: advanceOutboundIndex(next, result.ws, now), commit: commitTo(result.ws) };
    }

    if (call.purpose === "task_verification") {
      const verifying = {
        ...current.session,
        data: { ...current.session.data, currentCallId: callId, verificationTaskIds: openCoveredTasks(ws, call), answeredTaskIds: [] },
      };
      return { session: askVerificationTask(verifying, ws, now, 0) };
    }
    const spoken = say(current.session, copy("Message from Abdullah: " + call.message, "رسالة من عبدالله: " + call.message), now);
    return {
      session: ask(
        { ...spoken, data: { ...spoken.data, currentCallId: callId } },
        copy("Did you hear every instruction?", "سمعت كل التعليمات؟"),
        now,
        "outbound_receipt",
        [reply("received", "Yes, I heard them", "إيه، سمعتها")],
      ),
    };
  }

  if (session.step === "outbound_receipt") {
    const callId = session.data.currentCallId;
    if (!callId || current.value !== "received") {
      return { session: say(current.session, copy("The instructions were not confirmed.", "ما تأكد وصول التعليمات."), now, true) };
    }
    const result = resolveWorkerCallAttempt(ws, now, callId, "delivered");
    const delivered = { ...current.session, data: { ...current.session.data, deliveryCompleted: true } };
    return { session: advanceOutboundIndex(delivered, result.ws, now), commit: commitTo(result.ws) };
  }

  if (session.step === "outbound_task_confirmation") return handleVerificationAnswer(session, current, ws, now);
  return { session: current.session };
}

/** Ask the task at `index`, skipping any closed since the call began. Null when none is left. */
function nextVerificationTask(session: CallSession, ws: Workspace, index: number): { id: string; instruction: string } | null {
  for (const id of (session.data.verificationTaskIds ?? []).slice(index)) {
    const task = ws.taskTickets.find((item) => item.id === id && item.status === "open");
    if (task) return { id: task.id, instruction: task.instruction };
  }
  return null;
}

function askVerificationTask(session: CallSession, ws: Workspace, now: Date, index: number): CallSession {
  const task = nextVerificationTask(session, ws, index);
  if (!task) return advanceOutboundIndex(session, ws, now);
  return ask(
    { ...session, data: { ...session.data, currentTaskId: task.id } },
    copy("Did you finish: " + task.instruction + "?", "خلصت المهمة: " + task.instruction + "؟"),
    now,
    "outbound_task_confirmation",
    [reply("yes", "Yes, complete", "إيه، خلصت"), reply("no", "No, not yet", "لا، باقي"), reply("unknown", "I don’t know", "ما أدري")],
  );
}

/** An explicit yes or no is saved as given; anything else leaves that task open. The last open task settles the attempt. */
function handleVerificationAnswer(session: CallSession, current: { session: CallSession; value: string }, ws: Workspace, now: Date): EngineResult {
  const callId = session.data.currentCallId;
  const taskId = session.data.currentTaskId;
  const call = ws.pendingWorkerCalls.find((item) => item.id === callId && item.state === "pending");
  if (!call || !callId || !taskId) return { session: say(current.session, copy("This call is no longer waiting.", "هذه المكالمة لم تعد معلّقة."), now, true) };
  const explicit = current.value === "yes" || current.value === "no";
  const done = current.value === "yes";
  const answeredTaskIds = [...(session.data.answeredTaskIds ?? []), ...(explicit ? [taskId] : [])];
  const response = done
    ? copy("Thank you. The task is marked complete.", "شكراً لك. تم تأكيد إنجاز المهمة.")
    : explicit
      ? copy("Understood. The task stays open until you confirm it is complete.", "واضح. تبقى المهمة مفتوحة إلى أن تأكد إنجازها.")
      : copy("All right. This task stays open.", "طيب. تبقى هذه المهمة مفتوحة.");
  const spoken = say({ ...current.session, data: { ...current.session.data, answeredTaskIds } }, response, now);
  const index = (session.data.verificationTaskIds ?? []).indexOf(taskId) + 1;
  if (nextVerificationTask(session, ws, index)) {
    const updated = explicit ? confirmTask(ws, now, taskId, done, "worker_task_verification") : ws;
    return { session: askVerificationTask(spoken, updated, now, index), ...(explicit ? { commit: commitTo(updated) } : {}) };
  }
  const result = workerDeliveryResult(ws, call, answeredTaskIds);
  const heard = resolveWorkerCallAttempt(ws, now, callId, result);
  const updated = explicit ? confirmTask(heard.ws, now, taskId, done, "worker_task_verification") : heard.ws;
  const settled = { ...spoken, data: { ...spoken.data, attemptResolved: true, ...(result === "delivered" ? { deliveryCompleted: true } : {}) } };
  const closing = heard.outcome === "retry_scheduled"
    ? say(settled, copy("I’ll call again in 20 minutes about what’s left.", "بتصل عليك بعد ٢٠ دقيقة عشان الباقي."), now)
    : settled;
  return { session: advanceOutboundIndex(closing, updated, now), commit: commitTo(updated) };
}

function advanceOutboundIndex(session: CallSession, ws: Workspace, now: Date): CallSession {
  const index = (session.data.pendingIndex ?? 0) + 1;
  const next = { ...session, data: { ...session.data, pendingIndex: index } };
  return beginOutboundAttempt(next, ws, now);
}

/** The worker already picked up. Speak this claimed call; do not ask the lab whether they answer. */
export function startLiveWorkerDelivery(ws: Workspace, now: Date, pendingCallId: string): EngineResult {
  const call = ws.pendingWorkerCalls.find((item) => item.id === pendingCallId && item.state === "pending");
  if (!call) {
    return { session: say(blank("worker_outbound", now), copy("This call is no longer waiting.", "هذه المكالمة لم تعد معلّقة."), now, true) };
  }
  const waiting = {
    ...blank("worker_outbound", now),
    step: "outbound_answer",
    data: { pendingCallIds: [call.id], pendingIndex: 0, currentCallId: call.id, currentTaskId: call.taskTicketId ?? undefined },
  };
  return handleWorkerOutbound(waiting, ws, now, { value: "answer" });
}

export function hangUpWorkerOutbound(session: CallSession, ws: Workspace, ended: CallSession, now: Date): EngineResult {
  const delivering = session.step === "outbound_receipt" || session.step === "outbound_task_confirmation";
  const callId = session.data.currentCallId;
  if (delivering && callId && ws.pendingWorkerCalls.some((call) => call.id === callId && call.state === "pending")) {
    const interrupted = resolveWorkerCallAttempt(ws, now, callId, "interrupted");
    return { session: ended, commit: commitTo(interrupted.ws) };
  }
  const startedIds = new Set(session.data.startedVerificationCallIds ?? []);
  if (!startedIds.size) return { session: ended };
  const pendingWorkerCalls = ws.pendingWorkerCalls.filter(
    (call) => !(startedIds.has(call.id) && call.state === "pending" && call.attempts.length === 0),
  );
  if (pendingWorkerCalls.length === ws.pendingWorkerCalls.length) return { session: ended };
  return { session: ended, commit: commitTo({ ...ws, pendingWorkerCalls }) };
}
