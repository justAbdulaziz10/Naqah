import { completeWorkerCallback, confirmTask } from "../actions";
import { openNoAnswerTickets, routeWorkerInboundCall } from "../rules";
import type { Workspace } from "../types";

import { copy, reply, blank, ask, say, commitTo, workerTurn, tasksToConfirm } from './shared';
import type { CallSession, EngineResult, AnswerInput } from './shared';

export function startWorkerCallback(ws: Workspace, now: Date): EngineResult {
  const route = routeWorkerInboundCall(ws, now);
  if (route.kind !== "callback") {
    const session = say(
      blank("worker_callback", now),
      copy("There are no missed calls to return right now.", "ما فيه مكالمات فائتة تحتاج ترجع لها الآن."),
      now,
      true,
    );
    return { session };
  }
  const tickets = openNoAnswerTickets(ws).filter((ticket) => route.ticketIds.includes(ticket.id));
  const messagesEn = tickets.map((ticket) => ticket.message).join("; ");
  const messagesAr = tickets.map((ticket) => ticket.message).join("؛ ");
  const session = blank("worker_callback", now);
  const text = copy(
    "You missed our call. Message from the owner: " + (messagesEn || "Please call Abdullah back.") + " This is a message delivery call, not a farm update.",
    "فاتتك مكالمتنا. رسالة المالك: " + (messagesAr || "فضلاً تواصل مع عبدالله.") + " هذا اتصال لتسليم رسالة، مو تحديث للعزبة.",
  );
  return {
    session: ask(
      session,
      text,
      now,
      "callback_acknowledge",
      [reply("received", "I understand", "وصلتني الرسالة")],
    ),
  };
}

export function handleWorkerCallback(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (session.step === "callback_acknowledge") {
    const updated = completeWorkerCallback(ws, now);
    // Asked after the message lands: an instruction this call delivered makes its task askable.
    const callbackTaskIds = tasksToConfirm(updated, now).map((task) => task.id);
    const delivered = say(
      { ...current.session, data: { ...current.session.data, callbackTaskIds, callbackTaskIndex: 0 } },
      copy("Thank you. The missed message has been delivered.", "شكراً لك. وصلت رسالة المالك."),
      now,
    );
    return {
      session: askNextCallbackTask(delivered, updated, now),
      commit: commitTo(updated),
    };
  }
  if (session.step === "callback_task_confirmation") {
    const index = session.data.callbackTaskIndex ?? 0;
    const taskId = session.data.callbackTaskIds?.[index];
    const task = taskId ? ws.taskTickets.find((item) => item.id === taskId && item.status === "open") : undefined;
    let updated = ws;
    if (task && (current.value === "yes" || current.value === "no")) {
      updated = confirmTask(ws, now, task.id, current.value === "yes", "worker_callback");
    }
    const next = {
      ...current.session,
      data: { ...current.session.data, callbackTaskIndex: index + 1 },
    };
    return {
      session: askNextCallbackTask(next, updated, now),
      ...(updated !== ws ? { commit: commitTo(updated) } : {}),
    };
  }
  return { session: current.session };
}

function askNextCallbackTask(session: CallSession, ws: Workspace, now: Date): CallSession {
  const taskIds = session.data.callbackTaskIds ?? [];
  let index = session.data.callbackTaskIndex ?? 0;
  while (index < taskIds.length) {
    const taskId = taskIds[index];
    const task = ws.taskTickets.find((item) => item.id === taskId && item.status === "open");
    if (!task) {
      index += 1;
      continue;
    }
    return ask(
      { ...session, data: { ...session.data, callbackTaskIndex: index } },
      copy("Did you finish: " + task.instruction + "?", "خلصت المهمة: " + task.instruction + "؟"),
      now,
      "callback_task_confirmation",
      [reply("yes", "Yes, complete", "إيه، خلصت"), reply("no", "No, not yet", "لا، باقي"), reply("unknown", "I don’t know", "ما أدري")],
    );
  }
  return say(
    { ...session, data: { ...session.data, callbackTaskIndex: index } },
    copy("This call did not create a farm update.", "هذا الاتصال ما أنشأ تحديث للعزبة."),
    now,
    true,
  );
}
