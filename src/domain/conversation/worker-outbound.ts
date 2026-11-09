import { advanceClock, confirmTask, resolveWorkerCallAttempt, startTaskVerification } from "../actions";
import { MAX_RETRIES, RETRY_DELAY_MS } from "../clock";
import { dueTaskVerifications, dueWorkerCalls } from "../rules";
import type { Workspace } from "../types";

import { copy, reply, blank, ask, say, addNotice, commitTo, workerTurn, atRiyadh } from './shared';
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
    startedVerificationCallIds.push(result.pendingCallId);
  }

  const pendingIds = prepared.pendingWorkerCalls
    .filter((call) => call.state === "pending")
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
    return say(
      { ...session, data: { ...session.data, currentCallId: undefined } },
      copy("There are no more worker calls waiting right now.", "ما فيه مكالمات أخرى معلّقة للعامل الآن."),
      now,
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
      const result = resolveWorkerCallAttempt(ws, now, callId, false);
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

    const result = resolveWorkerCallAttempt(ws, now, callId, true);
    const message = call.purpose === "instruction"
      ? copy("Message from Abdullah: " + call.message, "رسالة من عبدالله: " + call.message)
      : copy("Ahmed has the scheduled task: " + call.message + ". Did he finish it?", "المهمة المجدولة لأحمد: " + call.message + ". هل خلصها؟");
    const delivered = say(current.session, message, now);
    if (call.purpose === "task_verification") {
      return {
        session: ask(
          { ...delivered, data: { ...delivered.data, currentCallId: callId } },
          copy("Did Ahmed explicitly confirm the task is complete?", "هل أكد أحمد بشكل واضح إن المهمة خلصت؟"),
          now,
          "outbound_task_confirmation",
          [reply("yes", "Yes, complete", "إيه، خلصت"), reply("no", "No, not yet", "لا، باقي"), reply("unknown", "I don’t know", "ما أدري")],
        ),
        commit: commitTo(result.ws),
      };
    }
    return { session: advanceOutboundIndex(delivered, result.ws, now), commit: commitTo(result.ws) };
  }

  if (session.step === "outbound_task_confirmation") {
    const callId = session.data.currentCallId;
    const call = ws.pendingWorkerCalls.find((item) => item.id === callId);
    if (!call?.taskTicketId) return { session: say(current.session, copy("No task ticket is attached to this call.", "ما فيه تذكرة مهمة مرتبطة بهذا الاتصال."), now, true) };
    if (current.value !== "yes" && current.value !== "no") {
      return {
        session: advanceOutboundIndex(
          say(
            current.session,
            copy("Ahmed could not confirm this task. It stays open.", "ما قدر أحمد يؤكد المهمة. تبقى مفتوحة."),
            now,
          ),
          ws,
          now,
        ),
      };
    }
    const done = current.value === "yes";
    const updated = confirmTask(ws, now, call.taskTicketId, done, "worker_task_verification");
    const response = done
      ? copy("Thank you. The task is marked complete.", "شكراً لك. تم تأكيد إنجاز المهمة.")
      : copy("Understood. The task stays open until Ahmed confirms it is complete.", "واضح. تبقى المهمة مفتوحة إلى أن يؤكد أحمد إنجازها.");
    return { session: advanceOutboundIndex(say(current.session, response, now), updated, now), commit: commitTo(updated) };
  }
  return { session: current.session };
}

function advanceOutboundIndex(session: CallSession, ws: Workspace, now: Date): CallSession {
  const index = (session.data.pendingIndex ?? 0) + 1;
  const next = { ...session, data: { ...session.data, pendingIndex: index } };
  return beginOutboundAttempt(next, ws, now);
}

export function hangUpWorkerOutbound(session: CallSession, ws: Workspace, ended: CallSession): EngineResult {
  const startedIds = new Set(session.data.startedVerificationCallIds ?? []);
  if (!startedIds.size) return { session: ended };
  const pendingWorkerCalls = ws.pendingWorkerCalls.filter(
    (call) => !(startedIds.has(call.id) && call.state === "pending" && call.attempts.length === 0),
  );
  if (pendingWorkerCalls.length === ws.pendingWorkerCalls.length) return { session: ended };
  return { session: ended, commit: commitTo({ ...ws, pendingWorkerCalls }) };
}
