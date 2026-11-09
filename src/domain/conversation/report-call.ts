import { HEALTH_LABELS, PREDEFINED_QUESTIONS, RESOURCE_LABELS, levelLabel } from "../catalog";
import { advanceClock, completeWorkerReport, rejectWorkerReport } from "../actions";
import { RETRY_DELAY_MS } from "../clock";
import { isHerdCount } from "../herd";
import { uid } from "../id";
import { activeReportCall, dueScheduledReportCall, endReportCallWithoutReport, placeReportCallAttempt, reportCallRuns, resolveReportCallAttempt, startReportCall as openReportCallRun } from "../reportCalls";
import type { ReportCallBlock } from "../reportCalls";
import { nextScheduledCall } from "../schedule";
import { heatWaterFinding } from "../weather";
import { plannedQuestions, reportPlanHasContent, routeWorkerInboundCall } from "../rules";
import type { Certainty, HealthStatus, Level, LocalizedText, ResourceKind, Workspace } from "../types";

import { copy, UNKNOWN_ANSWER, HERD_COUNT_QUESTION, REPORT_CALL_ATTEMPTS, LEVELS, reply, blank, ask, status, say, addNotice, commitTo, workerTurn, isUnknown, addsNothing, atRiyadh, tasksToConfirm, heatDayReportItem } from './shared';
import type { ReportItem, CallSession, EngineResult, AnswerInput, OpenFact, Reply } from './shared';

import { startWorkerCallback } from './worker-callback';

const camelsText = (count: number) => copy(count + (count === 1 ? " camel" : " camels"), count + " من الحلال");
const isQuantity = (text: string) => text !== "" && Number.isFinite(Number(text)) && Number(text) >= 0;
const quantityUnit = (resource: ResourceKind) => (resource === "feed" ? copy("bags", "كيس") : copy("litres", "لتر"));

/** Herd size the worker's count is compared with: the owner's official count, else the camel list. */
function expectedHerd(ws: Workspace): number | null {
  if (isHerdCount(ws.settings.herdCount)) return ws.settings.herdCount;
  return ws.camels.length > 0 ? ws.camels.length : null;
}

function reportQueue(ws: Workspace, now: Date): ReportItem[] {
  // Ask the single weather check first, only when today's forecast and farm coordinates exist.
  const heatQuestion = heatDayReportItem(ws, now);
  // The owner's plan, in the owner's order, with their wording.
  const queue: ReportItem[] = plannedQuestions(ws)
    .filter((planned) => planned.question.id !== "herd_count" || expectedHerd(ws) !== null)
    .map((planned) => planned.kind === "predefined"
      ? {
          kind: "predefined",
          id: planned.question.id,
          question: planned.question.id === "herd_count" ? HERD_COUNT_QUESTION : planned.question.text,
          answerKind: planned.question.answerKind,
          resource: planned.question.requires,
          required: planned.required,
        }
      : { kind: "custom", id: planned.question.id, question: copy(planned.question.text, planned.question.text), required: planned.required });
  if (heatQuestion) queue.unshift(heatQuestion);
  queue.push(
    ...tasksToConfirm(ws, now).map((task) => ({
      kind: "task" as const,
      id: "task_" + task.id,
      taskId: task.id,
      question: copy("Did you finish: " + task.instruction + "?", "خلصت المهمة: " + task.instruction + "؟"),
    })),
  );
  return queue;
}

const ONE_AT_A_TIME = copy("We’ll go through the questions one at a time.", "بنمشي على الأسئلة وحدة وحدة.");
const OPEN_ASK = copy("What has happened at the ranch? Tell me everything in your own words.", "وش صار في العزبة؟ قل لي كل اللي عندك بكلامك.");
const OPEN_MORE = copy("Anything else you want to add?", "فيه شي ثاني تبي تضيفه؟");
const MODE_CHOICE = copy(
  "Would you like me to ask one question at a time, or would you rather tell me what happened in your own words?",
  "تبي أسألك سؤال سؤال، ولا تقول لي وش صار بكلامك وأنا أرتبه؟",
);

/** How this call is taken. Open needs the realtime model to sort free speech, so a scripted call is always guided. */
function chosenMode(ws: Workspace, modesAvailable: boolean): "guided" | "open" | "ask" {
  if (!modesAvailable) return "guided";
  const mode = ws.settings.reportMode;
  return mode === "worker_choice" ? "ask" : mode === "open" ? "open" : "guided";
}

function startGuided(session: CallSession, ws: Workspace, now: Date): CallSession {
  return askReportItem({ ...session, data: { ...session.data, reportMode: "guided" } }, ws, now);
}

function startOpen(session: CallSession, now: Date): CallSession {
  return ask({ ...session, data: { ...session.data, reportMode: "open" } }, OPEN_ASK, now, "open_listen", OPEN_REPLIES, "text");
}

/** The worker is on the line: greet, then the report in the way the owner chose, or the worker chooses. */
function beginReportQuestions(session: CallSession, ws: Workspace, now: Date, returning = false, modesAvailable = false): CallSession {
  // The owner may have switched everything off after the call was placed, or before the worker called back.
  if (!reportPlanHasContent(ws, now)) {
    return say(session, copy("There’s nothing to report on this call. Thank you, Ahmed.", "ما فيه شي مطلوب في هالمكالمة. يعطيك العافية يا أحمد."), now, true);
  }
  const withQueue = { ...session, data: { ...session.data, queue: reportQueue(ws, now), reportIndex: 0 } };
  const greeting = returning
    ? copy(
        "Hello Ahmed, I’m NAQAH’s automated assistant. Thanks for calling back about the report call you missed.",
        "هلا أحمد، معك مساعد ناقة الآلي. شكراً إنك رجعت تتصل على مكالمة التقرير اللي فاتتك.",
      )
    : copy(
        "Hello Ahmed, I’m NAQAH’s automated assistant, calling for the farm report.",
        "هلا أحمد، معك مساعد ناقة الآلي، أتصل عشان تقرير العزبة.",
      );
  const mode = chosenMode(ws, modesAvailable);
  if (mode === "ask") {
    return ask(say(withQueue, greeting, now), MODE_CHOICE, now, "report_mode_choice", [
      reply("mode_guided", "One question at a time", "سؤال سؤال"),
      reply("mode_open", "In my own words", "أقول اللي صار"),
    ]);
  }
  if (mode === "open") return startOpen(say(withQueue, greeting, now), now);
  return startGuided(say(withQueue, copy(greeting.en + " " + ONE_AT_A_TIME.en, greeting.ar + " " + ONE_AT_A_TIME.ar), now), ws, now);
}

function blockedReportCallText(reason: ReportCallBlock | "duplicate" | null): LocalizedText {
  if (reason === "no_worker_phone") {
    return copy(
      "NAQAH can’t call Ahmed yet: his phone number needs the country code, for example +966 5X XXX XXXX.",
      "ما تقدر ناقة تتصل بأحمد إلى الآن: رقمه يحتاج رمز الدولة، مثل ‎+966 5X XXX XXXX.",
    );
  }
  if (reason === "already_reported") {
    return copy("This period’s report is already in. NAQAH calls again at the next scheduled time.", "وصل تقرير هذه الفترة. ناقة تتصل مرة ثانية في الموعد الجاي.");
  }
  if (reason === "no_questions") {
    return copy("There is nothing to ask yet. Turn on at least one question in Settings.", "ما فيه شي ينسأل إلى الآن. فعّل سؤال واحد على الأقل من الإعدادات.");
  }
  return copy("A report call is already in progress.", "فيه مكالمة تقرير شغالة الآن.");
}

/**
 * NAQAH → primary worker. With `reportCallId` (a real call the worker picked up) the questions
 * start at once. Without it, the Call Lab simulates the ringing: open or reuse a run, then let the
 * investor choose whether Ahmed answers. Every ringing line says it is a simulation.
 */
export function startReportCallScenario(ws: Workspace, now: Date, reportCallId?: string, modesAvailable = false): EngineResult {
  const session = blank("report_call", now);
  if (reportCallId) {
    const run = reportCallRuns(ws).find((item) => item.id === reportCallId);
    const ringing = run?.state === "calling" && run.attempts.at(-1)?.result === "pending";
    if (!run || (!ringing && run.state !== "answered")) {
      return { session: say(session, copy("This report call is no longer active. Thank you.", "مكالمة التقرير هذه انتهت. يعطيك العافية."), now, true) };
    }
    const prepared = ringing ? resolveReportCallAttempt(ws, now, run.id, true).ws : ws;
    return {
      session: beginReportQuestions({ ...session, data: { reportCallId: run.id } }, prepared, now, false, modesAvailable),
      ...(prepared !== ws ? { commit: commitTo(prepared) } : {}),
    };
  }

  let prepared = ws;
  let run = activeReportCall(ws);
  let startedReportCallId: string | undefined;
  if (!run) {
    const slot = dueScheduledReportCall(ws, now);
    const opened = openReportCallRun(ws, now, slot ? "schedule" : "manual", slot ?? now);
    if (!opened.run) return { session: say(session, blockedReportCallText(opened.blocked), now, true) };
    prepared = opened.ws;
    run = opened.run;
    startedReportCallId = run.id;
  }
  const withRun = { ...session, data: { reportCallId: run.id, startedReportCallId } };
  if (run.state === "answered") {
    return { session: beginReportQuestions(withRun, prepared, now), ...(prepared !== ws ? { commit: commitTo(prepared) } : {}) };
  }
  const rung = ringReportCall(withRun, prepared, now);
  return { session: rung.session, ...(rung.ws !== ws ? { commit: commitTo(rung.ws) } : {}) };
}

/** Lab only: place the due attempt and ask whether Ahmed answers, or show when the retry is due. */
function ringReportCall(session: CallSession, ws: Workspace, now: Date): { session: CallSession; ws: Workspace } {
  const run = reportCallRuns(ws).find((item) => item.id === session.data.reportCallId);
  if (!run || run.state !== "calling") {
    return { session: status(session, copy("This report call is no longer active.", "مكالمة التقرير هذه انتهت."), now, "report_ended", [], true), ws };
  }
  let current = ws;
  let attempt = run.attempts.length;
  if (run.attempts.at(-1)?.result !== "pending") {
    if (run.nextAttemptAt && new Date(run.nextAttemptAt).getTime() > now.getTime()) {
      const at = new Date(run.nextAttemptAt);
      return {
        session: status(
          session,
          copy(
            "Simulation: the next attempt is at " + atRiyadh(at, "en") + " Riyadh time. Move the demo clock forward 20 minutes to continue.",
            "محاكاة: المحاولة الجاية " + atRiyadh(at, "ar") + " بتوقيت الرياض. قدّم ساعة العرض 20 دقيقة للمتابعة.",
          ),
          now,
          "report_wait",
          [reply("skip_20", "Skip 20 minutes", "تجاوز 20 دقيقة")],
        ),
        ws,
      };
    }
    const placed = placeReportCallAttempt(ws, now, run.id);
    current = placed.ws;
    attempt = placed.attempt ?? attempt;
  }
  return {
    session: status(
      session,
      copy(
        "Simulation: NAQAH is calling Ahmed for the report (attempt " + attempt + " of " + REPORT_CALL_ATTEMPTS + "). Does Ahmed answer?",
        "محاكاة: ناقة تتصل بأحمد عشان التقرير (المحاولة " + attempt + " من " + REPORT_CALL_ATTEMPTS + "). يرد أحمد؟",
      ),
      now,
      "report_ring",
      [reply("answer", "Ahmed answers", "أحمد يرد"), reply("no_answer", "No answer", "ما يرد")],
    ),
    ws: current,
  };
}

export function handleReportRinging(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const runId = session.data.reportCallId ?? "";
  if (session.step === "report_wait") {
    const updated = advanceClock(ws, RETRY_DELAY_MS);
    const later = new Date(now.getTime() + RETRY_DELAY_MS);
    const noticed = addNotice(session, copy("Demo clock advanced by 20 minutes.", "تقدمت ساعة العرض 20 دقيقة."));
    const rung = ringReportCall(noticed, updated, later);
    return { session: rung.session, commit: commitTo(rung.ws) };
  }
  const answered = (input.value ?? input.text) === "answer";
  const result = resolveReportCallAttempt(ws, now, runId, answered);
  if (result.outcome === "ignored") {
    return { session: status(session, copy("This report call is no longer active.", "مكالمة التقرير هذه انتهت."), now, "report_ended", [], true) };
  }
  if (answered) {
    const picked = status(session, copy("Simulation: Ahmed answered.", "محاكاة: رد أحمد."), now, "report_answered");
    return { session: beginReportQuestions(picked, result.ws, now), commit: commitTo(result.ws) };
  }
  if (result.outcome === "retry_scheduled") {
    const run = reportCallRuns(result.ws).find((item) => item.id === runId);
    const at = new Date(run?.nextAttemptAt ?? now.getTime() + RETRY_DELAY_MS);
    const text = copy(
      "Ahmed didn’t answer. NAQAH tries again at " + atRiyadh(at, "en") + " Riyadh time.",
      "ما رد أحمد. ناقة تعيد الاتصال " + atRiyadh(at, "ar") + " بتوقيت الرياض.",
    );
    const waiting = status(
      addNotice(session, text),
      copy(
        "Simulation: " + text.en + " Move the demo clock forward 20 minutes to continue.",
        "محاكاة: " + text.ar + " قدّم ساعة العرض 20 دقيقة للمتابعة.",
      ),
      now,
      "report_wait",
      [reply("skip_20", "Skip 20 minutes", "تجاوز 20 دقيقة")],
    );
    return { session: waiting, commit: commitTo(result.ws) };
  }
  const missed = copy(
    "Ahmed didn’t answer after " + REPORT_CALL_ATTEMPTS + " attempts. There is no report for this period yet, and Abdullah sees that on the dashboard. Ahmed can call NAQAH back to give the report.",
    "ما رد أحمد بعد " + REPORT_CALL_ATTEMPTS + " محاولات. ما فيه تقرير لهذه الفترة إلى الآن، ويشوف عبدالله هذا في لوحة العزبة. يقدر أحمد يتصل على ناقة ويعطي التقرير.",
  );
  return { session: status(addNotice(session, missed), missed, now, "report_missed", [], true), commit: commitTo(result.ws) };
}

/** Worker → NAQAH. NAQAH calls for the report, so this is a callback, a returned missed call, or a polite "we'll call". */
export function startWorkerInbound(ws: Workspace, now: Date): EngineResult {
  const route = routeWorkerInboundCall(ws, now);
  if (route.kind === "callback") return startWorkerCallback(ws, now);
  const session = blank("worker_inbound", now);
  if (route.kind === "report") return { session: beginReportQuestions(session, ws, now, true) };

  let text: LocalizedText;
  if (route.reason === "weekly_done") {
    text = copy("We have already received this week’s update. There is no need to repeat it.", "وصلنا تحديث هذا الأسبوع، وما يحتاج تعيده.");
  } else if (route.reason === "daily_done") {
    text = copy("We have already received today’s update. There is no need to repeat it.", "وصلنا تحديث اليوم، وما يحتاج تعيده.");
  } else {
    const next = nextScheduledCall(now, ws.settings.plan, ws.settings.callSchedule);
    text = next
      ? copy(
          "Thanks for calling, Ahmed. NAQAH will call you for the report " + atRiyadh(next, "en", true) + " Riyadh time. There is nothing to report now.",
          "شكراً لاتصالك يا أحمد. ناقة بتتصل عليك عشان التقرير " + atRiyadh(next, "ar", true) + " بتوقيت الرياض. ما فيه شيء مطلوب الآن.",
        )
      : copy(
          "Thanks for calling, Ahmed. Abdullah hasn’t set a report time yet. NAQAH will call you once it is set.",
          "شكراً لاتصالك يا أحمد. عبدالله ما حدد موعد التقرير إلى الآن. ناقة بتتصل عليك أول ما يتحدد.",
        );
  }
  return { session: say(session, text, now, true), commit: commitTo(rejectWorkerReport(ws, now, route.reason)) };
}

const SKIP_QUESTION = "skip_question";

/** An optional question can be skipped, which saves it as not reported. A required one takes «ما أدري». */
function askReportItem(session: CallSession, ws: Workspace, now: Date): CallSession {
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  const asked = askItemPrompt(session, ws, now);
  if (!item || asked.step === "report_summary" || (item.kind !== "predefined" && item.kind !== "custom") || item.required !== false) return asked;
  return { ...asked, replies: [...asked.replies, reply(SKIP_QUESTION, "Skip", "تخطي")] };
}

function askItemPrompt(session: CallSession, ws: Workspace, now: Date): CallSession {
  const queue = session.data.queue ?? [];
  const index = session.data.reportIndex ?? 0;
  const item = queue[index];
  if (!item) return askReportSummary(session, ws, now);
  const data = { ...session.data, currentQuestionId: item.id };
  const current = { ...session, data };
  if (item.kind === "weather_heat_day") {
    return ask(
      current,
      item.question,
      now,
      "report_question",
      [reply("yes", "Yes", "إيه"), reply("not_enough", "Not enough", "ما يكفي"), reply("unknown", "I don’t know", "ما أدري")],
    );
  }
  if (item.kind === "task") {
    return ask(
      current,
      item.question,
      now,
      "report_question",
      [reply("yes", "Yes, it’s done", "إيه، خلصت"), reply("no", "Not yet", "باقي"), reply("unknown", "I don’t know", "ما أدري")],
    );
  }
  if (item.kind === "custom") {
    return ask(
      current,
      item.question,
      now,
      "report_question",
      [
        reply("suggest_ok", "All good", "كل شيء تمام"),
        reply("suggest_none", "Nothing new", "ما فيه شيء جديد"),
        reply("unknown", "I don’t know", "ما أدري"),
      ],
      "text",
      true,
    );
  }
  if (item.answerKind === "herd-health") {
    return ask(
      current,
      item.question,
      now,
      "report_question",
      [reply("yes", "All are well", "كلها بخير"), reply("no", "One needs attention", "فيه وحدة تحتاج متابعة"), reply("unknown", "I don’t know", "ما أدري")],
    );
  }
  if (item.id === "herd_count") {
    return ask(current, item.question, now, "report_question", [reply("unknown", "I don’t know", "ما أدري")], "number");
  }
  if (item.answerKind === "yesno") {
    return ask(
      current,
      item.question,
      now,
      "report_question",
      [reply("yes", "Yes", "إيه"), reply("no", "No", "لا"), reply("unknown", "I don’t know", "ما أدري")],
    );
  }
  if (item.answerKind === "level" && item.resource) {
    return ask(
      current,
      item.question,
      now,
      "report_question",
      LEVELS.map((value) => ({
        id: value,
        value,
        label: levelLabel(item.resource as ResourceKind, value),
      })),
    );
  }
  return ask(
    current,
    item.question,
    now,
    "report_question",
    [reply("unknown", "I don’t know", "ما أدري")],
    "text",
  );
}

function reportAnswer(
  session: CallSession,
  item: ReportItem,
  answer: string | LocalizedText,
  certainty: Certainty,
  question = item.question,
): CallSession {
  // Fixed choices keep both languages; free text is stored exactly as said.
  const localized = typeof answer === "string" ? {} : { answerText: answer };
  const text = typeof answer === "string" ? answer : answer.en;
  return {
    ...session,
    draft: {
      ...session.draft,
      answers: [...session.draft.answers, { questionId: item.id, question, answer: text, ...localized, certainty, followUp: false }],
    },
  };
}

function nextReportItem(session: CallSession, ws: Workspace, now: Date): CallSession {
  if (session.data.correcting) {
    return askReportSummary({ ...session, data: { ...session.data, correcting: undefined, currentQuestionId: undefined } }, ws, now);
  }
  const index = (session.data.reportIndex ?? 0) + 1;
  return askReportItem(
    { ...session, data: { ...session.data, reportIndex: index, currentQuestionId: undefined } },
    ws,
    now,
  );
}

function handleReportQuestion(
  session: CallSession,
  ws: Workspace,
  now: Date,
  input: AnswerInput,
): EngineResult {
  const current = workerTurn(session, input, now);
  const value = current.value;
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  if (!item) return { session: session };
  if (value === SKIP_QUESTION) return { session: nextReportItem(current.session, ws, now) };

  if (item.kind === "weather_heat_day") {
    const unknown = isUnknown(value, input.text);
    const notEnough = value === "not_enough";
    const selected = unknown ? UNKNOWN_ANSWER : notEnough ? copy("Not enough", "ما يكفي") : copy("Yes", "إيه");
    const recorded = reportAnswer(current.session, item, selected, unknown ? "unknown" : "reported");
    const draft = notEnough
      ? { ...recorded.draft, extraFindings: [...(recorded.draft.extraFindings ?? []), heatWaterFinding(uid("fnd"))] }
      : recorded.draft;
    return { session: nextReportItem({ ...recorded, draft }, ws, now) };
  }

  if (item.kind === "task") {
    const unknown = isUnknown(value, input.text);
    const done = value === "yes";
    // "I don't know" is neither done nor not done, so the summary must not read it back as either.
    const explicitNo = value === "no";
    const sessionWithConfirmation = !unknown && (done || explicitNo)
      ? {
          ...current.session,
          draft: {
            ...current.session.draft,
            taskConfirmations: [...current.session.draft.taskConfirmations, { taskId: item.taskId, done }],
          },
        }
      : current.session;
    const recorded = reportAnswer(
      sessionWithConfirmation,
      item,
      unknown ? UNKNOWN_ANSWER : done ? copy("Yes, completed", "إيه، خلصت") : explicitNo ? copy("Not yet", "باقي") : (input.text ?? value),
      unknown ? "unknown" : "reported",
    );
    return { session: nextReportItem(recorded, ws, now) };
  }

  if (item.kind === "custom") {
    const unknown = isUnknown(value, input.text);
    const answer = unknown ? UNKNOWN_ANSWER : value === "suggest_ok" ? copy("All good", "كل شيء تمام") : value === "suggest_none" ? copy("Nothing new", "ما فيه شيء جديد") : input.text ?? value;
    const recorded = reportAnswer(current.session, item, answer, unknown ? "unknown" : "reported");
    return { session: nextReportItem(recorded, ws, now) };
  }

  if (item.answerKind === "herd-health") {
    if (value === "yes") {
      const updates = ws.camels.map((camel) => ({
        camelId: camel.id,
        health: "healthy" as const,
        note: null,
        certainty: "reported" as const,
      }));
      const draft = { ...current.session.draft, camelUpdates: [...current.session.draft.camelUpdates, ...updates] };
      const recorded = reportAnswer(
        { ...current.session, draft },
        item,
        copy("All camels appear well", "الحلال كله بخير"),
        "reported",
      );
      return { session: nextReportItem(recorded, ws, now) };
    }
    if (isUnknown(value, input.text)) {
      const recorded = reportAnswer(current.session, item, UNKNOWN_ANSWER, "unknown");
      return { session: nextReportItem(recorded, ws, now) };
    }
    if (ws.camels.length === 0) {
      const recorded = reportAnswer(
        current.session,
        item,
        copy("A camel needs attention (unspecified)", "فيه ناقة تحتاج متابعة (غير محددة)"),
        "reported",
      );
      return { session: nextReportItem(recorded, ws, now) };
    }
    const picking = {
      ...current.session,
      data: { ...current.session.data, askedCamelIds: [], tempCamelId: undefined },
    };
    return {
      session: askCamelToCheck(picking, ws, now, copy("Which camel needs attention?", "أي ناقة تحتاج متابعة؟")),
    };
  }

  if (item.id === "herd_count") return handleHerdCount(current.session, ws, now, item, value, input);

  if (item.answerKind === "level" && item.resource) {
    if (!LEVELS.includes(value as Level)) {
      // "How much is left?" answered with a number: keep it, without inventing a level.
      const count = (input.text ?? value).trim();
      if ((item.resource === "feed" || item.resource === "water") && isQuantity(count)) {
        const quantified = { ...current.session, data: { ...current.session.data, tempLevel: "unknown" as Level } };
        return { session: askQuantityConfirm(quantified, item.resource, count, now) };
      }
      // Never carry a value that isn't a level: the save would refuse the whole report.
      return { session: askReportItem(current.session, ws, now) };
    }
    const level = value as Level;
    const certainty: Certainty = level === "unknown" ? "unknown" : "reported";
    if (item.resource === "feed" || item.resource === "water") {
      const next = { ...current.session, data: { ...current.session.data, tempLevel: level } };
      const quantityQuestion = item.resource === "feed"
        ? copy("Roughly how many bags of feed are left?", "كم باقي تقريباً من أكياس العلف؟")
        : copy("Roughly how many litres of water are left?", "كم باقي تقريباً من الماء باللتر؟");
      return {
        session: ask(
          next,
          quantityQuestion,
          now,
          "quantity_input",
          [reply("quantity_unknown", "I don’t know", "ما أدري"), reply("quantity_skip", "Skip", "تخطي")],
          "number",
        ),
      };
    }
    return { session: nextReportItem(addResourceAnswer(current.session, item, level, null, certainty), ws, now) };
  }

  const unknown = isUnknown(value, input.text);
  const recorded = reportAnswer(current.session, item, unknown ? UNKNOWN_ANSWER : value, unknown ? "unknown" : "reported");
  return { session: nextReportItem(recorded, ws, now) };
}

/** The worker's count is a proposal for the owner. Confirmed back before it is kept, like any quantity. */
function handleHerdCount(session: CallSession, ws: Workspace, now: Date, item: ReportItem, value: string, input: AnswerInput): EngineResult {
  if (isUnknown(value, input.text)) {
    const draft = { ...session.draft, herdAccountedFor: null };
    return { session: nextReportItem(reportAnswer({ ...session, draft }, item, UNKNOWN_ANSWER, "unknown"), ws, now) };
  }
  const count = Number((input.text ?? value).trim());
  if (!isHerdCount(count)) {
    return {
      session: ask(
        session,
        copy("Please say the number of camels, for example 42.", "قل عدد الحلال بالأرقام، مثل 42."),
        now,
        "report_question",
        [reply("unknown", "I don’t know", "ما أدري")],
        "number",
      ),
    };
  }
  return {
    session: ask(
      { ...session, data: { ...session.data, tempCount: count } },
      copy("You counted " + count + " camels in total. Is that right?", "عدّيت " + count + " من الحلال. صحيح؟"),
      now,
      "herd_count_confirm",
      [reply("yes", "Yes, that’s right", "إيه، صحيح"), reply("no", "Change it", "أبي أغيّره")],
    ),
  };
}

function handleHerdCountConfirm(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  const count = session.data.tempCount;
  if (!item || count === undefined) return { session: current.session };
  if (current.value !== "yes") {
    return {
      session: ask(
        { ...current.session, data: { ...current.session.data, tempCount: undefined } },
        item.question,
        now,
        "report_question",
        [reply("unknown", "I don’t know", "ما أدري")],
        "number",
      ),
    };
  }
  const expected = expectedHerd(ws);
  const short = expected !== null && count < expected;
  const draft = { ...current.session.draft, herdCount: count, herdAccountedFor: expected === null ? null : !short };
  const counted = { ...current.session, draft };
  if (short) {
    return {
      session: ask(
        counted,
        copy(
          "That’s fewer than the " + expected + " on record. Do you know which camels are missing?",
          "هذا أقل من " + expected + " المسجلة. تعرف أي النوق ناقصة؟",
        ),
        now,
        "herd_count_detail",
        [reply("unknown", "I don’t know", "ما أدري")],
        "text",
      ),
    };
  }
  return { session: nextReportItem(reportAnswer(counted, item, camelsText(count), "reported"), ws, now) };
}

function handleHerdCountDetail(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  if (!item) return { session: current.session };
  const count = current.session.draft.herdCount;
  const base = typeof count === "number" ? camelsText(count) : null;
  const said = (input.text ?? current.value).trim();
  const detail = isUnknown(current.value, input.text) || addsNothing(said) ? "" : said;
  // Free text stays exactly as said; the count keeps both languages when nothing was added.
  const answer: string | LocalizedText = !detail ? (base ?? UNKNOWN_ANSWER) : base ? copy(base.en + " — " + detail, base.ar + " — " + detail) : detail;
  return { session: nextReportItem(reportAnswer(current.session, item, answer, "reported"), ws, now) };
}

function askCamelToCheck(session: CallSession, ws: Workspace, now: Date, question: LocalizedText): CallSession {
  const asked = new Set(session.data.askedCamelIds ?? []);
  const candidates = ws.camels.filter((camel) => !asked.has(camel.id));
  if (!candidates.length) return finishCamelHealth(session, ws, now);
  return ask(
    session,
    question,
    now,
    "health_pick",
    [
      ...candidates.map((camel) => reply("camel:" + camel.id, camel.name, camel.name)),
      reply("unknown", "I don’t know", "ما أدري"),
    ],
  );
}

function handleHealthPick(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (current.value === "unknown" || isUnknown(current.value, input.text)) {
    const item = session.data.queue?.[session.data.reportIndex ?? 0];
    if (!item) return { session: current.session };
    if ((session.data.askedCamelIds ?? []).length > 0) {
      return { session: finishCamelHealth(current.session, ws, now) };
    }
    // The worker already said one needs attention, and not knowing which must not erase that.
    const recorded = reportAnswer(current.session, item, copy("A camel needs attention (unspecified)", "فيه ناقة تحتاج متابعة (غير محددة)"), "reported");
    return { session: nextReportItem(recorded, ws, now) };
  }
  const camelId = current.value.startsWith("camel:") ? current.value.slice("camel:".length) : "";
  const camel = ws.camels.find((entry) => entry.id === camelId);
  if (!camel) return { session: askCamelToCheck(current.session, ws, now, copy("Choose a camel from the herd.", "اختر ناقة من الحلال.")) };
  const withCamel = { ...current.session, data: { ...current.session.data, tempCamelId: camel.id } };
  return {
    session: ask(
      withCamel,
      copy("How is " + camel.name + " today?", "كيف حال " + camel.name + " اليوم؟"),
      now,
      "health_status",
      (["healthy", "watch", "sick", "unknown"] as HealthStatus[]).map((status) => ({
        id: status,
        value: status,
        label: HEALTH_LABELS[status],
      })),
    ),
  };
}

function handleHealthStatus(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const status = current.value as HealthStatus;
  const camel = ws.camels.find((entry) => entry.id === session.data.tempCamelId);
  if (!camel || !["healthy", "watch", "sick", "unknown"].includes(status)) {
    return { session: askCamelToCheck(current.session, ws, now, copy("Choose a camel from the herd.", "اختر ناقة من الحلال.")) };
  }
  const next = { ...current.session, data: { ...current.session.data, tempHealth: status } };
  return {
    session: ask(
      next,
      copy("Add a short note about " + camel.name + ", if useful.", "إذا فيه تفاصيل، اذكر ملاحظة قصيرة عن " + camel.name + "."),
      now,
      "health_note",
      [reply("skip_note", "No note", "بدون ملاحظة")],
      "text",
    ),
  };
}

function handleHealthNote(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const note = current.value === "skip_note" || !input.text?.trim() || addsNothing(input.text) ? null : input.text.trim();
  const camel = ws.camels.find((entry) => entry.id === session.data.tempCamelId);
  if (!camel) return { session: askCamelToCheck(current.session, ws, now, copy("Choose a camel from the herd.", "اختر ناقة من الحلال.")) };
  const next = { ...current.session, data: { ...current.session.data, tempNote: note } };
  return {
    session: ask(
      next,
      copy("You said " + camel.name + ". Is that the right camel?", "ذكرت " + camel.name + ". هل الاسم صحيح؟"),
      now,
      "health_name_confirm",
      [reply("yes", "Yes", "إيه"), reply("no", "No", "لا"), reply("unknown", "I don’t know", "ما أدري")],
    ),
  };
}

function handleHealthNameConfirm(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (current.value !== "yes") {
    return {
      session: askCamelToCheck(
        { ...current.session, data: { ...current.session.data, tempCamelId: undefined, tempHealth: undefined, tempNote: undefined } },
        ws,
        now,
        copy("No problem. Choose the camel again.", "ما يخالف. اختر الناقة مرة ثانية."),
      ),
    };
  }
  const camelId = session.data.tempCamelId;
  const camel = ws.camels.find((entry) => entry.id === camelId);
  const health = session.data.tempHealth ?? "unknown";
  if (!camelId || !camel) return { session: current.session };
  const asked = [...new Set([...(session.data.askedCamelIds ?? []), camelId])];
  const certainty: Certainty = health === "unknown" ? "unknown" : "reported";
  const update = { camelId, health, note: session.data.tempNote ?? null, certainty };
  const oldIndex = current.session.draft.camelUpdates.findIndex((entry) => entry.camelId === camelId);
  const updates = [...current.session.draft.camelUpdates];
  if (oldIndex >= 0) updates[oldIndex] = update;
  else updates.push(update);
  const saved = {
    ...current.session,
    draft: { ...current.session.draft, camelUpdates: updates },
    data: { ...current.session.data, askedCamelIds: asked },
  };
  return {
    session: ask(
      saved,
      copy("Any other camel to mention?", "فيه ناقة ثانية تبي تذكرها؟"),
      now,
      "health_more",
      [reply("yes", "Yes, another", "إيه، فيه غيرها"), reply("no", "No, that’s all", "لا، بس")],
    ),
  };
}

function finishCamelHealth(session: CallSession, ws: Workspace, now: Date): CallSession {
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  if (!item) return askReportSummary(session, ws, now);
  const updates = session.draft.camelUpdates.filter((entry) => (session.data.askedCamelIds ?? []).includes(entry.camelId));
  return nextReportItem(withCamelAnswer(session, ws, item, updates), ws, now);
}

/** The herd-health answer, in both languages, from what was recorded about each camel. */
function withCamelAnswer(session: CallSession, ws: Workspace, item: ReportItem, updates: CallSession["draft"]["camelUpdates"]): CallSession {
  const line = (locale: "en" | "ar", join: string) => updates.map((update) => {
    const name = ws.camels.find((entry) => entry.id === update.camelId)?.name ?? "";
    return name + ": " + HEALTH_LABELS[update.health][locale] + (update.note ? " — " + update.note : "");
  }).join(join);
  const answer = updates.length ? copy(line("en", "; "), line("ar", "؛ ")) : UNKNOWN_ANSWER;
  return reportAnswer(session, item, answer, updates.length === 0 || updates.some((update) => update.certainty === "unknown") ? "unknown" : "reported");
}

function addResourceAnswer(
  session: CallSession,
  item: ReportItem,
  level: Level,
  quantity: { stored: string; text: LocalizedText } | null,
  certainty: Certainty,
): CallSession {
  if (item.kind !== "predefined" || !item.resource) return session;
  const resourceUpdate = { kind: item.resource, level, quantity: quantity?.stored ?? null, note: null, certainty };
  const label = levelLabel(item.resource, level);
  // A number with no level is just the number: "unknown (222 litres)" contradicts itself.
  const onlyQuantity = quantity !== null && level === "unknown";
  const answerEn = onlyQuantity ? quantity.text.en : label.en + (quantity ? " (" + quantity.text.en + ")" : "");
  const answerText = { en: answerEn, ar: onlyQuantity ? quantity.text.ar : label.ar + (quantity ? " (" + quantity.text.ar + ")" : "") };
  const next = {
    ...session,
    draft: {
      ...session.draft,
      resourceUpdates: [...session.draft.resourceUpdates, resourceUpdate],
      answers: [
        ...session.draft.answers,
        {
          questionId: item.id,
          question: item.question,
          answer: answerEn,
          answerText,
          certainty,
          followUp: false,
        },
      ],
    },
  };
  return { ...next, data: { ...next.data, tempLevel: undefined, tempQuantity: undefined, quantityClarified: undefined } };
}

function handleQuantityInput(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  const level = session.data.tempLevel ?? "unknown";
  if (!item || item.kind !== "predefined" || !item.resource) return { session: current.session };
  if (current.value === "quantity_skip" || current.value === "quantity_unknown" || isUnknown(current.value, input.text)) {
    const certainty: Certainty = level === "unknown" ? "unknown" : "reported";
    return { session: nextReportItem(addResourceAnswer(current.session, item, level, null, certainty), ws, now) };
  }
  const quantity = (input.text ?? current.value).trim();
  if (!isQuantity(quantity)) {
    return {
      session: ask(
        current.session,
        item.resource === "feed"
          ? copy("Enter a number of bags, or choose Skip.", "أدخل عدد الأكياس، أو اختر تخطي.")
          : copy("Enter a number of litres, or choose Skip.", "أدخل كمية باللتر، أو اختر تخطي."),
        now,
        "quantity_input",
        [reply("quantity_unknown", "I don’t know", "ما أدري"), reply("quantity_skip", "Skip", "تخطي")],
        "number",
      ),
    };
  }
  // "Enough" followed by "none left" can't both stand: ask once, then keep the zero without the level.
  if (Number(quantity) === 0 && (level === "good" || level === "medium")) {
    if (!session.data.quantityClarified) {
      return {
        session: ask(
          { ...current.session, data: { ...current.session.data, quantityClarified: true } },
          item.resource === "feed"
            ? copy("You said there was enough, then that there’s none. Roughly how many bags are left?", "قلت إنه كافي، وبعدها إن ما فيه شي. كم باقي تقريباً من أكياس العلف؟")
            : copy("You said there was enough, then that there’s none. Roughly how many litres are left?", "قلت إنه كافي، وبعدها إن ما فيه شي. كم باقي تقريباً من الماء باللتر؟"),
          now,
          "quantity_input",
          [reply("quantity_unknown", "I don’t know", "ما أدري"), reply("quantity_skip", "Skip", "تخطي")],
          "number",
        ),
      };
    }
    const unsure = { ...current.session, data: { ...current.session.data, tempLevel: "unknown" as Level } };
    return { session: askQuantityConfirm(unsure, item.resource, quantity, now) };
  }
  return { session: askQuantityConfirm(current.session, item.resource, quantity, now) };
}

function askQuantityConfirm(session: CallSession, resource: ResourceKind, quantity: string, now: Date): CallSession {
  const unit = quantityUnit(resource);
  return ask(
    { ...session, data: { ...session.data, tempQuantity: quantity } },
    copy(
      "You mentioned about " + quantity + " " + unit.en + ". The quantity is approximate, correct?",
      "ذكرت إن باقي تقريباً " + quantity + " " + unit.ar + ". للتأكيد، الكمية تقديرية، صحيح؟",
    ),
    now,
    "quantity_confirm",
    [reply("yes", "Yes, approximate", "إيه، تقريبية"), reply("no", "Change it", "أبي أغيّرها")],
  );
}

function handleQuantityConfirm(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  if (!item || item.kind !== "predefined" || !item.resource) return { session: current.session };
  if (current.value === "no") {
    const next = { ...current.session, data: { ...current.session.data, tempQuantity: undefined } };
    const question = item.resource === "feed"
      ? copy("Roughly how many bags of feed are left?", "كم باقي تقريباً من أكياس العلف؟")
      : copy("Roughly how many litres of water are left?", "كم باقي تقريباً من الماء باللتر؟");
    return {
      session: ask(next, question, now, "quantity_input", [reply("quantity_unknown", "I don’t know", "ما أدري"), reply("quantity_skip", "Skip", "تخطي")], "number"),
    };
  }
  const count = session.data.tempQuantity ?? "";
  const unit = quantityUnit(item.resource);
  const text = copy(count + " " + unit.en, count + " " + unit.ar);
  // Like the seed and every free-text answer, the stored quantity is in the worker's language.
  const quantity = { stored: ws.settings.worker.language === "en" ? text.en : text.ar, text };
  return { session: nextReportItem(addResourceAnswer(current.session, item, session.data.tempLevel ?? "unknown", quantity, "approximate"), ws, now) };
}

/** One spoken line for each recorded item. Answers that name their own subject need no label. */
function summaryLine(item: ReportItem, answer: CallSession["draft"]["answers"][number], ws: Workspace): LocalizedText {
  const said = answer.answerText ?? copy(answer.answer, answer.answer);
  const labelled = (label: LocalizedText) => copy(label.en + ": " + said.en, label.ar + ": " + said.ar);
  if (isOpenNote(item)) return labelled(NOTE_LABEL);
  if (item.kind === "custom" || item.kind === "weather_heat_day") return copy(item.question.en + " " + said.en, item.question.ar + " " + said.ar);
  if (item.kind === "task") {
    const instruction = ws.taskTickets.find((task) => task.id === item.taskId)?.instruction ?? "";
    return labelled(copy("Task: " + instruction, "مهمة: " + instruction));
  }
  if (item.resource) return labelled(RESOURCE_LABELS[item.resource]);
  return answer.certainty === "unknown" ? labelled(TOPIC_LABELS[item.id] ?? item.question) : said;
}

const TOPIC_LABELS: Record<string, LocalizedText> = {
  herd_health: copy("Camel health", "حال الحلال"),
  herd_count: copy("Camel count", "عدد الحلال"),
};

const OPEN_NOTE = "open_note_";
const NOTE_LABEL = copy("Note", "ملاحظة");
const UNSPECIFIED_CAMEL = copy("A camel needs attention (unspecified)", "فيه ناقة تحتاج متابعة (غير محددة)");
const isOpenNote = (item: ReportItem) => item.id.startsWith(OPEN_NOTE);
const answersFor = (session: CallSession, item: ReportItem) => session.draft.answers.filter((answer) => answer.questionId === item.id);

/** The worker confirms what they hear, so every recorded detail is read back, in the order it was asked. */
function askReportSummary(session: CallSession, ws: Workspace, now: Date): CallSession {
  const lines = (session.data.queue ?? []).flatMap((item) => answersFor(session, item).map((answer) => summaryLine(item, answer, ws)));
  if (session.draft.herdAccountedFor === false) lines.push(copy("not all camels are accounted for", "الحلال غير مكتمل العدد"));
  if (session.draft.urgentNote) lines.push(copy("Urgent, as you said: " + session.draft.urgentNote, "أمر عاجل ذكرته: " + session.draft.urgentNote));
  const body = (locale: "en" | "ar", join: string, none: string) => lines.length ? lines.map((line) => line[locale]).join(join) : none;
  const text = copy(
    "Here’s the summary: " + body("en", "; ", "no additional farm facts") + ". Shall I save it, or would you like to correct something?",
    "هذا ملخص التحديث: " + body("ar", "، ", "ما فيه معلومات إضافية عن العزبة") + ". أحفظه، ولا تبي تعدل شي؟",
  );
  return ask(
    session,
    text,
    now,
    "report_summary",
    [reply("confirm_save", "Confirm and save", "تأكيد وحفظ"), reply(CORRECT, "Correct something", "أبي أعدل"), reply("end_without_save", "End without saving", "إنهاء بدون حفظ")],
    "choices",
    true,
  );
}

/** Stable while the summary is unchanged, and different after any correction. Pure: the domain runs in the browser too. */
export function reportSummaryId(session: CallSession, locale: "ar" | "en"): string {
  const text = [...session.turns].reverse().find((entry) => entry.speaker === "agent")?.text[locale] ?? "";
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) hash = (hash * 33 + text.charCodeAt(index)) >>> 0;
  return `${session.data.draftRevision ?? 0}:${hash.toString(36)}`;
}

function reportCoverage(session: CallSession): NonNullable<CallSession["draft"]["coverage"]> {
  return (session.data.queue ?? [])
    .filter((item) => (item.kind === "predefined" || item.kind === "custom") && !isOpenNote(item))
    .map((item) => {
      const answers = answersFor(session, item);
      return { questionId: item.id, status: answers.length === 0 ? "not_reported" : answers.every((answer) => answer.certainty === "unknown") ? "unknown" : "reported" };
    });
}

function completeReport(session: CallSession, ws: Workspace, now: Date): EngineResult {
  const reportCallId = session.scenario === "report_call" ? session.data.reportCallId : undefined;
  const finalized = { ...session, draft: { ...session.draft, mode: session.data.reportMode ?? "guided", coverage: reportCoverage(session) } };
  const completed = completeWorkerReport(ws, now, finalized.draft, reportCallId);
  const next = say(
    {
      ...finalized,
      next: { scenario: "owner_notification", reportId: completed.report.id },
    },
    copy(
      "Saved, thank you. The update is ready for Abdullah. The call to him has not started.",
      "تم حفظ التحديث، شكراً لك. التحديث جاهز لعبدالله، ومكالمته لم تبدأ بعد.",
    ),
    now,
    true,
  );
  return { session: next, commit: commitTo(completed.ws) };
}

const CORRECT = "correct";
const CORRECT_PREFIX = "correct:";

function endWithoutSaving(current: CallSession, session: CallSession, ws: Workspace, now: Date): EngineResult {
  const ended = say(current, copy("The update was not saved. Thank you, Ahmed.", "ما انحفظ التحديث. يعطيك العافية يا أحمد."), now, true);
  const runId = session.scenario === "report_call" ? session.data.reportCallId : undefined;
  const updated = runId ? endReportCallWithoutReport(ws, now, runId) : ws;
  return { session: ended, ...(updated !== ws ? { commit: commitTo(updated) } : {}) };
}

function correctionLabel(item: ReportItem): LocalizedText {
  if (isOpenNote(item)) return NOTE_LABEL;
  if (item.kind === "predefined" && item.resource) return RESOURCE_LABELS[item.resource];
  return TOPIC_LABELS[item.id] ?? item.question;
}

function askWhatToCorrect(session: CallSession, now: Date): CallSession {
  const replies: Reply[] = (session.data.queue ?? [])
    .filter((item) => answersFor(session, item).length > 0)
    .map((item) => {
      const label = correctionLabel(item);
      return reply(CORRECT_PREFIX + item.id, label.en, label.ar);
    });
  return ask(session, copy("What would you like to correct?", "وش اللي تبي تعدله؟"), now, "report_correct_pick", [
    ...replies,
    reply("back_to_summary", "Nothing, go back", "ولا شي، ارجع"),
    reply("end_without_save", "End without saving", "إنهاء بدون حفظ"),
  ]);
}

/** Forget one item entirely and ask it again the normal way, so a correction passes the same checks as an answer. */
function startCorrection(session: CallSession, ws: Workspace, now: Date, itemId: string): CallSession {
  const queue = session.data.queue ?? [];
  const index = queue.findIndex((item) => item.id === itemId);
  if (index < 0) return askWhatToCorrect(session, now);
  const item = queue[index];
  const draft = clearItem(session.draft, item);
  return askReportItem({
    ...session,
    draft,
    data: {
      ...session.data,
      reportIndex: index,
      correcting: true,
      draftRevision: (session.data.draftRevision ?? 0) + 1,
      askedCamelIds: [],
      tempCamelId: undefined,
      tempHealth: undefined,
      tempNote: undefined,
      tempLevel: undefined,
      tempQuantity: undefined,
      tempCount: undefined,
      quantityClarified: undefined,
    },
  }, ws, now);
}

function clearItem(draft: CallSession["draft"], item: ReportItem): CallSession["draft"] {
  const cleared = { ...draft, answers: draft.answers.filter((answer) => answer.questionId !== item.id) };
  if (item.kind === "task") return { ...cleared, taskConfirmations: cleared.taskConfirmations.filter((entry) => entry.taskId !== item.taskId) };
  if (item.kind === "weather_heat_day") return { ...cleared, extraFindings: undefined };
  if (item.kind !== "predefined") return cleared;
  if (item.resource) return { ...cleared, resourceUpdates: cleared.resourceUpdates.filter((entry) => entry.kind !== item.resource) };
  if (item.id === "herd_health") return { ...cleared, camelUpdates: [] };
  if (item.id === "herd_count") return { ...cleared, herdCount: undefined, herdAccountedFor: null };
  return cleared;
}

const hasContent = (session: CallSession) => session.draft.answers.length > 0 || session.draft.taskConfirmations.length > 0 || Boolean(session.draft.urgentNote);

function handleSummary(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  // Nothing recorded is not a report: it must not use up this period's call.
  if (current.value === "confirm_save") return hasContent(session) ? completeReport(current.session, ws, now) : endWithoutSaving(current.session, session, ws, now);
  if (current.value === CORRECT) return { session: askWhatToCorrect(current.session, now) };
  if (current.value.startsWith(CORRECT_PREFIX)) return { session: startCorrection(current.session, ws, now, current.value.slice(CORRECT_PREFIX.length)) };
  return endWithoutSaving(current.session, session, ws, now);
}

function handleCorrectPick(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (current.value === "end_without_save") return endWithoutSaving(current.session, session, ws, now);
  if (current.value.startsWith(CORRECT_PREFIX)) return { session: startCorrection(current.session, ws, now, current.value.slice(CORRECT_PREFIX.length)) };
  return { session: askReportSummary(current.session, ws, now) };
}

function handleModeChoice(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (current.value === "mode_open") return { session: startOpen(current.session, now) };
  return { session: startGuided(say(current.session, ONE_AT_A_TIME, now), ws, now) };
}

const OPEN_DONE = "open_done";
const OPEN_REPLIES = [reply(OPEN_DONE, "Nothing to add", "ما عندي شي")];

/** Open mode never asks about a topic the worker left out. Only due tasks are still asked, because they close on an explicit yes. */
function finishOpen(session: CallSession, ws: Workspace, now: Date): CallSession {
  // An update with nothing in it isn't a report, so the questions get their turn.
  if (!hasContent(session)) return startGuided(say(session, copy("Let’s go through it one question at a time.", "خلنا نمشي سؤال سؤال."), now), ws, now);
  const first = (session.data.queue ?? []).findIndex((item) => item.kind === "task");
  if (first < 0) return askReportSummary(session, ws, now);
  return askReportItem({ ...session, data: { ...session.data, reportIndex: first } }, ws, now);
}

function afterFacts(session: CallSession, ws: Workspace, now: Date): CallSession {
  const pending = session.data.openClarify?.[0];
  if (!pending) return ask(session, OPEN_MORE, now, "open_more", OPEN_REPLIES, "text");
  const state = HEALTH_LABELS[pending.status];
  return ask(
    session,
    copy("You mentioned a camel: " + state.en + ". Which camel is it?", "ذكرت ناقة حالتها " + state.ar + ". أي ناقة تقصد؟"),
    now,
    "open_clarify",
    [...ws.camels.map((camel) => reply("camel:" + camel.id, camel.name, camel.name)), reply("unknown", "I don’t know", "ما أدري")],
  );
}

function handleOpen(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  if (input.value === OPEN_DONE) return { session: finishOpen(workerTurn(session, input, now).session, ws, now) };
  if (!input.facts?.length) {
    return { session: ask(session, session.step === "open_more" ? OPEN_MORE : OPEN_ASK, now, session.step, OPEN_REPLIES, "text") };
  }
  return { session: afterFacts(input.facts.reduce((current, fact) => applyFact(current, ws, fact), session), ws, now) };
}

/** Facts about a topic the owner turned off still count: the worker said them. They are added before any task. */
function itemFor(session: CallSession, id: string, build: () => ReportItem | null): { session: CallSession; item: ReportItem | null } {
  const queue = session.data.queue ?? [];
  const found = queue.find((item) => item.id === id);
  if (found) return { session, item: found };
  const item = build();
  if (!item) return { session, item: null };
  const firstTask = queue.findIndex((entry) => entry.kind === "task");
  const at = firstTask < 0 ? queue.length : firstTask;
  return { session: { ...session, data: { ...session.data, queue: [...queue.slice(0, at), item, ...queue.slice(at)] } }, item };
}

function predefinedItem(session: CallSession, id: string) {
  return itemFor(session, id, () => {
    const question = PREDEFINED_QUESTIONS.find((entry) => entry.id === id);
    return question ? { kind: "predefined", id, question: question.id === "herd_count" ? HERD_COUNT_QUESTION : question.text, answerKind: question.answerKind, resource: question.requires, required: false } : null;
  });
}

const replaced = (session: CallSession, item: ReportItem): CallSession => ({ ...session, draft: clearItem(session.draft, item) });

function addNote(session: CallSession, note: string | LocalizedText): CallSession {
  const count = (session.data.openNotes ?? 0) + 1;
  const made = itemFor({ ...session, data: { ...session.data, openNotes: count } }, OPEN_NOTE + count, () => ({ kind: "custom", id: OPEN_NOTE + count, question: copy("What should the note say?", "وش الملاحظة الصحيحة؟"), required: false }));
  return reportAnswer(made.session, made.item!, note, "reported");
}

function recordCamel(session: CallSession, ws: Workspace, update: CallSession["draft"]["camelUpdates"][number]): CallSession {
  const { session: withItem, item } = predefinedItem(session, "herd_health");
  if (!item) return session;
  const updates = [...withItem.draft.camelUpdates.filter((entry) => entry.camelId !== update.camelId), update];
  const cleared = replaced(withItem, item);
  const named = { ...cleared, draft: { ...cleared.draft, camelUpdates: updates }, data: { ...cleared.data, askedCamelIds: [...new Set([...(cleared.data.askedCamelIds ?? []), update.camelId])] } };
  return withCamelAnswer(named, ws, item, updates);
}

/** "The rest are fine" must not overwrite a camel the worker has just named. */
function recordWholeHerd(session: CallSession, ws: Workspace, fact: Extract<OpenFact, { type: "camel_health" }>, certainty: Certainty): CallSession {
  const { session: withItem, item } = predefinedItem(session, "herd_health");
  if (!item) return session;
  const namedIds = new Set(withItem.data.askedCamelIds ?? []);
  const named = withItem.draft.camelUpdates.filter((update) => namedIds.has(update.camelId));
  const rest = ws.camels.filter((camel) => !namedIds.has(camel.id)).map((camel) => ({ camelId: camel.id, health: fact.status, note: fact.note, certainty }));
  const state = HEALTH_LABELS[fact.status];
  const note = fact.note ? " — " + fact.note : "";
  const herd = fact.status === "healthy"
    ? (named.length ? copy("The rest are well", "الباقي بخير") : copy("All camels appear well", "الحلال كله بخير"))
    : (named.length ? copy("The rest: " + state.en, "الباقي: " + state.ar) : copy("All camels: " + state.en, "الحلال كله: " + state.ar));
  const cleared = replaced(withItem, item);
  const namedLines = named.length ? withCamelAnswer(cleared, ws, item, named).draft.answers.at(-1)!.answerText! : null;
  const answer = namedLines ? copy(namedLines.en + "; " + herd.en + note, namedLines.ar + "؛ " + herd.ar + note) : copy(herd.en + note, herd.ar + note);
  return reportAnswer({ ...cleared, draft: { ...cleared.draft, camelUpdates: [...named, ...rest] } }, item, answer, certainty);
}

function applyFact(session: CallSession, ws: Workspace, fact: OpenFact): CallSession {
  if (fact.type === "other") return addNote(session, fact.note);
  if (fact.type === "custom") {
    const item = session.data.queue?.find((entry) => entry.id === fact.questionId && entry.kind === "custom");
    return item ? reportAnswer(replaced(session, item), item, fact.answer, "reported") : session;
  }
  if (fact.type === "herd_count") {
    const { session: withItem, item } = predefinedItem(session, "herd_count");
    if (!item) return session;
    const cleared = replaced(withItem, item);
    const expected = expectedHerd(ws);
    const draft = { ...cleared.draft, herdCount: fact.count, herdAccountedFor: expected === null ? null : fact.count >= expected };
    return reportAnswer({ ...cleared, draft }, item, camelsText(fact.count), "reported");
  }
  if (fact.type === "resource") {
    // A resource the ranch doesn't have can't be updated, but what the worker said isn't thrown away.
    if (!ws.resources.some((resource) => resource.kind === fact.resource && resource.present)) return addNote(session, fact.evidence);
    const { session: withItem, item } = predefinedItem(session, PREDEFINED_QUESTIONS.find((question) => question.requires === fact.resource)?.id ?? "");
    if (!item) return session;
    const level = fact.level ?? "unknown";
    const unit = fact.resource === "feed" || fact.resource === "water" ? quantityUnit(fact.resource) : null;
    const text = fact.quantity !== null && unit ? copy(fact.quantity + " " + unit.en, fact.quantity + " " + unit.ar) : null;
    const quantity = text ? { stored: ws.settings.worker.language === "en" ? text.en : text.ar, text } : null;
    return addResourceAnswer(replaced(withItem, item), item, level, quantity, quantity ? "approximate" : level === "unknown" ? "unknown" : "reported");
  }
  const certainty: Certainty = fact.status === "unknown" ? "unknown" : "reported";
  if (fact.scope === "all") return recordWholeHerd(session, ws, fact, certainty);
  if (fact.camelId && ws.camels.some((camel) => camel.id === fact.camelId)) return recordCamel(session, ws, { camelId: fact.camelId, health: fact.status, note: fact.note, certainty });
  // An unnamed camel doing fine tells the owner nothing; one that isn't must not be lost.
  if (fact.status === "healthy" || fact.status === "unknown") return session;
  return { ...session, data: { ...session.data, openClarify: [...(session.data.openClarify ?? []), { status: fact.status, note: fact.note }] } };
}

/** The owner still needs to hear a camel is unwell when nobody can say which: this wording raises the finding. */
function recordUnidentified(session: CallSession, note: string | null): CallSession {
  const { session: withItem, item } = predefinedItem(session, "herd_health");
  if (!item) return session;
  const earlier = answersFor(withItem, item).at(-1);
  const said = earlier?.answerText ?? (earlier ? copy(earlier.answer, earlier.answer) : null);
  const suffix = note ? " — " + note : "";
  const answer = said ? copy(said.en + "; " + UNSPECIFIED_CAMEL.en + suffix, said.ar + "؛ " + UNSPECIFIED_CAMEL.ar + suffix) : copy(UNSPECIFIED_CAMEL.en + suffix, UNSPECIFIED_CAMEL.ar + suffix);
  const cleared = { ...withItem, draft: { ...withItem.draft, answers: withItem.draft.answers.filter((entry) => entry.questionId !== item.id) } };
  return reportAnswer(cleared, item, answer, "reported");
}

/** An urgent concern joins the draft. At the summary it must be read back, so the summary is read again. */
export function addUrgentNote(session: CallSession, ws: Workspace, now: Date, note: string): CallSession {
  const urgentNote = (session.draft.urgentNote ? session.draft.urgentNote + "؛ " + note : note).slice(0, 500);
  const withNote = { ...session, draft: { ...session.draft, urgentNote } };
  if (session.step !== "report_summary") return withNote;
  return askReportSummary({ ...withNote, data: { ...withNote.data, draftRevision: (withNote.data.draftRevision ?? 0) + 1 } }, ws, now);
}

function handleOpenClarify(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const [pending, ...rest] = session.data.openClarify ?? [];
  const next = { ...current.session, data: { ...current.session.data, openClarify: rest } };
  if (!pending) return { session: afterFacts(next, ws, now) };
  const camelId = current.value.startsWith("camel:") ? current.value.slice("camel:".length) : "";
  if (ws.camels.some((camel) => camel.id === camelId)) {
    return { session: afterFacts(recordCamel(next, ws, { camelId, health: pending.status, note: pending.note, certainty: "reported" }), ws, now) };
  }
  return { session: afterFacts(recordUnidentified(next, pending.note), ws, now) };
}

/**
 * The model is gone, so free speech can't be sorted any more. What was captured stands and only due tasks
 * remain. If nothing was captured, the script asks the questions so the worker can still report.
 */
export function resumeOpenAsGuided(session: CallSession, ws: Workspace, now: Date): CallSession {
  if (session.step !== "open_listen" && session.step !== "open_more") return session;
  if (session.draft.answers.length > 0) return finishOpen(session, ws, now);
  return startGuided(session, ws, now);
}

export function answerReportScenario(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  if (session.step === "report_ring" || session.step === "report_wait") return handleReportRinging(session, ws, now, input);
  if (session.step === "report_mode_choice") return handleModeChoice(session, ws, now, input);
  if (session.step === "open_listen" || session.step === "open_more") return handleOpen(session, ws, now, input);
  if (session.step === "open_clarify") return handleOpenClarify(session, ws, now, input);
  if (session.step === "report_correct_pick") return handleCorrectPick(session, ws, now, input);
  if (session.step === "report_question") return handleReportQuestion(session, ws, now, input);
  if (session.step === "health_pick") return handleHealthPick(session, ws, now, input);
  if (session.step === "health_status") return handleHealthStatus(session, ws, now, input);
  if (session.step === "health_note") return handleHealthNote(session, ws, now, input);
  if (session.step === "health_name_confirm") return handleHealthNameConfirm(session, ws, now, input);
  if (session.step === "health_more") {
    const current = workerTurn(session, input, now);
    if (current.value === "yes") {
      return {
        session: askCamelToCheck(current.session, ws, now, copy("Which other camel needs attention?", "أي ناقة ثانية تحتاج متابعة؟")),
      };
    }
    return { session: finishCamelHealth(current.session, ws, now) };
  }
  if (session.step === "herd_count_confirm") return handleHerdCountConfirm(session, ws, now, input);
  if (session.step === "herd_count_detail") return handleHerdCountDetail(session, ws, now, input);
  if (session.step === "quantity_input") return handleQuantityInput(session, ws, now, input);
  if (session.step === "quantity_confirm") return handleQuantityConfirm(session, ws, now, input);
  if (session.step === "report_summary") return handleSummary(session, ws, now, input);
  return { session };
}

/**
 * Ending a report call. Ringing on the attempt this session opened: undo the run, nothing was
 * said. Ringing on a later attempt: nobody answered it. Mid-questions: the call ended unsaved.
 */
export function hangUpReportCall(session: CallSession, ws: Workspace, now: Date): Pick<EngineResult, "commit"> {
  const run = reportCallRuns(ws).find((item) => item.id === session.data.reportCallId);
  if (!run) return {};
  if (run.state === "answered") return { commit: commitTo(endReportCallWithoutReport(ws, now, run.id)) };
  if (session.step !== "report_ring" || run.attempts.at(-1)?.result !== "pending") return {};
  if (session.data.startedReportCallId === run.id && run.attempts.length === 1) {
    return { commit: commitTo({ ...ws, reportCalls: reportCallRuns(ws).filter((item) => item.id !== run.id) }) };
  }
  return { commit: commitTo(resolveReportCallAttempt(ws, now, run.id, false).ws) };
}
