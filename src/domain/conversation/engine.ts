/**
 * Deterministic Call Lab conversation engine.
 *
 * This module owns dialogue state only. Every gate and workspace mutation is
 * delegated to the existing domain rules and actions.
 */
import {
  CERTAINTY_LABELS,
  HEALTH_LABELS,
  RESOURCE_LABELS,
  levelLabel,
} from "../catalog";
import {
  advanceClock,
  completeWorkerCallback,
  completeWorkerReport,
  confirmTask,
  recordOwnerInquiry,
  recordOwnerNotification,
  rejectOwnerInquiry,
  rejectWorkerReport,
  resolveWorkerCallAttempt,
  startTaskVerification,
  submitOwnerInstruction,
} from "../actions";
import { fromRiyadh, MAX_RETRIES, REPORT_CALL_RETRIES, RETRY_DELAY_MS, riyadhParts } from "../clock";
import { evaluateFindings, ownerBriefing, type ReportDraft } from "../findings";
import { isHerdCount } from "../herd";
import { uid } from "../id";
import {
  activeReportCall,
  dueScheduledReportCall,
  endReportCallWithoutReport,
  placeReportCallAttempt,
  reportCallBlock,
  reportCallRuns,
  resolveReportCallAttempt,
  startReportCall as openReportCallRun,
  type ReportCallBlock,
} from "../reportCalls";
import { nextScheduledCall } from "../schedule";
import { heatLevel, heatWaterFinding, weatherForToday } from "../weather";
import {
  applicableQuestions,
  dueTaskVerifications,
  dueWorkerCalls,
  openNoAnswerTickets,
  openTaskTickets,
  overdueScheduledTasks,
  routeOwnerInboundCall,
  routeWorkerInboundCall,
  taskTicketsEnabled,
} from "../rules";
import type {
  Certainty,
  HealthStatus,
  Level,
  LocalizedText,
  PredefinedQuestion,
  ReportCallRun,
  ResourceKind,
  Workspace,
} from "../types";

/**
 * report_call: NAQAH calls the primary worker for the farm report (scheduled or "Call now").
 * worker_inbound: the worker calls NAQAH. That is a No Answer callback, the worker returning a
 * report call they missed, or a polite "NAQAH will call you at <time>".
 */
export type Scenario =
  | "report_call"
  | "worker_inbound"
  | "worker_callback"
  | "owner_notification"
  | "worker_outbound"
  | "owner_inquiry"
  | "emergency";

export type InputMode = "choices" | "text" | "number" | "time" | "none";

export interface Turn {
  speaker: "agent" | "worker" | "owner" | "system";
  text: LocalizedText;
  at: string;
}

export interface Reply {
  id: string;
  value: string;
  label: LocalizedText;
}

type ReportItem =
  | { kind: "weather_heat_day"; id: string; question: LocalizedText }
  | { kind: "predefined"; id: string; question: LocalizedText; answerKind: PredefinedQuestion["answerKind"]; resource: ResourceKind | null }
  | { kind: "custom"; id: string; question: LocalizedText }
  | { kind: "task"; id: string; taskId: string; question: LocalizedText };

interface ConversationData {
  queue?: ReportItem[];
  reportIndex?: number;
  currentQuestionId?: string;
  askedCamelIds?: string[];
  tempCamelId?: string;
  tempHealth?: HealthStatus;
  tempNote?: string | null;
  tempLevel?: Level;
  tempQuantity?: string;
  tempCount?: number;
  /** The NAQAH → worker report call this conversation belongs to (report_call only). */
  reportCallId?: string;
  /** Set when this session opened the run, so hanging up before the first answer can undo it. */
  startedReportCallId?: string;
  reportId?: string;
  instruction?: string;
  actionable?: boolean;
  scheduledFor?: string | null;
  pendingCallIds?: string[];
  startedVerificationCallIds?: string[];
  pendingIndex?: number;
  currentCallId?: string;
  inquiryTopics?: string[];
  callbackTaskIds?: string[];
  callbackTaskIndex?: number;
}

export interface CallSession {
  scenario: Scenario;
  step: string;
  turns: Turn[];
  replies: Reply[];
  inputMode: InputMode;
  done: boolean;
  startedAt: string;
  draft: ReportDraft;
  data: ConversationData;
  notices: LocalizedText[];
  next?: { scenario: "owner_notification"; reportId: string };
}

export interface EngineResult {
  session: CallSession;
  /** Apply only after the engine has returned from the domain action. */
  commit?: (ws: Workspace) => Workspace;
}

export interface AnswerInput {
  value?: string;
  text?: string;
}

export interface ReportCallAvailability {
  /** Why "Call now" can't start, or null. */
  block: ReportCallBlock | null;
  /** The run ringing, waiting for a retry, or in conversation. */
  active: ReportCallRun | null;
  /** The scheduled slot due now, if any. */
  due: Date | null;
  /** The next scheduled slot, or null while the schedule is unfinished. */
  next: Date | null;
}

export interface ScenarioAvailability {
  reportCall: ReportCallAvailability;
  workerInbound: ReturnType<typeof routeWorkerInboundCall>;
  ownerInquiry: ReturnType<typeof routeOwnerInboundCall>;
  pendingWorkerCallCount: number;
  dueWorkerCallCount: number;
  dueTaskVerificationCount: number;
}

const copy = (en: string, ar: string): LocalizedText => ({ en, ar });
const UNKNOWN_ANSWER = copy("I don’t know", "ما أدري");
const HERD_COUNT_QUESTION = copy("How many camels are there in total today?", "كم عدد الحلال كله اليوم؟");
const REPORT_CALL_ATTEMPTS = REPORT_CALL_RETRIES + 1;
const LEVELS: readonly Level[] = ["good", "medium", "low", "critical", "unknown"];
const noDraft = (): ReportDraft => ({
  answers: [],
  camelUpdates: [],
  resourceUpdates: [],
  herdAccountedFor: null,
  taskConfirmations: [],
});

const reply = (value: string, en: string, ar: string): Reply => ({
  id: value,
  value,
  label: copy(en, ar),
});

function blank(scenario: Scenario, now: Date): CallSession {
  return {
    scenario,
    step: "idle",
    turns: [],
    replies: [],
    inputMode: "none",
    done: false,
    startedAt: now.toISOString(),
    draft: noDraft(),
    data: {},
    notices: [],
  };
}

function turn(session: CallSession, speaker: Turn["speaker"], text: LocalizedText, now: Date): CallSession {
  return { ...session, turns: [...session.turns, { speaker, text, at: now.toISOString() }] };
}

function ask(
  session: CallSession,
  text: LocalizedText,
  now: Date,
  step: string,
  replies: Reply[] = [],
  inputMode: InputMode = "choices",
): CallSession {
  return {
    ...turn(session, "agent", text, now),
    step,
    replies,
    inputMode,
    done: false,
  };
}

/** A call-status line (ringing, retries). Shown in the Call Lab, never spoken on a real call. */
function status(
  session: CallSession,
  text: LocalizedText,
  now: Date,
  step: string,
  replies: Reply[] = [],
  done = false,
): CallSession {
  return { ...turn(session, "system", text, now), step, replies, inputMode: replies.length ? "choices" : "none", done };
}

function say(session: CallSession, text: LocalizedText, now: Date, done = false): CallSession {
  return {
    ...turn(session, "agent", text, now),
    replies: [],
    inputMode: "none",
    done,
  };
}

function addNotice(session: CallSession, text: LocalizedText): CallSession {
  return { ...session, notices: [...session.notices, text] };
}

function commitTo(next: Workspace): (ws: Workspace) => Workspace {
  return () => next;
}

function selectedAnswer(session: CallSession, input: AnswerInput): { value: string; text: LocalizedText } {
  const value = input.value ?? input.text ?? "";
  const choice = session.replies.find((item) => item.value === value);
  if (choice) return { value, text: choice.label };
  const text = input.text ?? input.value ?? "";
  return { value, text: copy(text, text) };
}

function workerTurn(session: CallSession, input: AnswerInput, now: Date): { session: CallSession; value: string } {
  const selected = selectedAnswer(session, input);
  // The Lab's "Answer / No answer" choice is the simulation's, not something the worker said.
  if (session.step === "report_ring" || session.step === "report_wait") return { session, value: selected.value };
  return {
    session: turn(session, session.scenario === "owner_notification" || session.scenario === "owner_inquiry" ? "owner" : "worker", selected.text, now),
    value: selected.value,
  };
}

export const isReportScenario = (scenario: Scenario) => scenario === "report_call" || scenario === "worker_inbound";

/** Spelling a recogniser or a keyboard may vary: tashkeel, hamza forms, curly apostrophes. */
const plainWords = (text: string) =>
  text.replace(/[\u064B-\u065F\u0670\u0640]/g, "").replace(/[أإآ]/g, "ا").replace(/[’‘]/g, "'").replace(/[.,!?؟،]/g, " ").replace(/\s+/g, " ").trim().toLowerCase();

const UNKNOWN_PHRASES = new Set(["ما ادري", "ماادري", "مدري", "ما اعرف", "لا اعرف", "i don't know", "i do not know", "i dont know"]);
const NOTHING_TO_ADD = new Set(["لا", "لاء", "لا والله", "لا شكرا", "ما فيه", "مافيه", "ما في", "مافي", "ما فيه شي", "مافيه شي", "ما في شي", "مافي شي", "ما عندي شي", "بدون ملاحظه", "بدون ملاحظة", "no", "none", "nothing", "no note"]);

function isUnknown(value: string, text = ""): boolean {
  return value === "unknown" || value === "dont_know" || UNKNOWN_PHRASES.has(plainWords(text || value));
}

/** «لا» to "any note?" means there is no note. It must not be saved as the note. */
const addsNothing = (text: string) => NOTHING_TO_ADD.has(plainWords(text)) || isUnknown("", text);

function atRiyadh(date: Date, locale: "ar" | "en", includeDate = false): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    timeZone: "Asia/Riyadh",
    ...(includeDate ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function scenarioAvailability(ws: Workspace, now: Date): ScenarioAvailability {
  return {
    reportCall: {
      block: reportCallBlock(ws, now),
      active: activeReportCall(ws),
      due: dueScheduledReportCall(ws, now),
      next: nextScheduledCall(now, ws.settings.plan, ws.settings.callSchedule),
    },
    workerInbound: routeWorkerInboundCall(ws, now),
    ownerInquiry: routeOwnerInboundCall(ws, now),
    pendingWorkerCallCount: ws.pendingWorkerCalls.filter((call) => call.state === "pending").length,
    dueWorkerCallCount: dueWorkerCalls(ws, now).length,
    dueTaskVerificationCount: dueTaskVerifications(ws, now).length,
  };
}

function heatDayReportItem(ws: Workspace, now: Date): ReportItem | null {
  if (!ws.settings.farm.coords) return null;
  const forecast = weatherForToday(ws, now);
  if (!forecast || heatLevel(forecast.maxTempC) === "none") return null;
  const maxTemp = Math.round(forecast.maxTempC);
  return {
    kind: "weather_heat_day",
    id: "weather_heat_water",
    question: copy(
      `It's a hot day (${maxTemp}°). Do the camels have enough water and shade?`,
      `الجو حار اليوم (${maxTemp} درجة). عند النوق ماء وظل كافيين؟`,
    ),
  };
}

export function start(
  ws: Workspace,
  now: Date,
  scenario: Scenario = "report_call",
  options: { reportId?: string; reportCallId?: string } = {},
): EngineResult {
  switch (scenario) {
    case "report_call":
      return startReportCallScenario(ws, now, options.reportCallId);
    case "worker_inbound":
      return startWorkerInbound(ws, now);
    case "worker_callback":
      return startWorkerCallback(ws, now);
    case "owner_notification":
      return startOwnerNotification(ws, now, options.reportId);
    case "worker_outbound":
      return startWorkerOutbound(ws, now);
    case "owner_inquiry":
      return startOwnerInquiry(ws, now);
    case "emergency":
      return startEmergency(ws, now);
  }
}

/** Herd size the worker's count is compared with: the owner's official count, else the camel list. */
function expectedHerd(ws: Workspace): number | null {
  if (isHerdCount(ws.settings.herdCount)) return ws.settings.herdCount;
  return ws.camels.length > 0 ? ws.camels.length : null;
}

function reportQueue(ws: Workspace, now: Date): ReportItem[] {
  // Ask the single weather check first, only when today's forecast and farm coordinates exist.
  const heatQuestion = heatDayReportItem(ws, now);
  const queue: ReportItem[] = applicableQuestions(ws)
    .filter((question) => question.id !== "herd_count" || expectedHerd(ws) !== null)
    .map((question) => ({
      kind: "predefined",
      id: question.id,
      question: question.id === "herd_count" ? HERD_COUNT_QUESTION : question.text,
      answerKind: question.answerKind,
      resource: question.requires,
    }));
  if (heatQuestion) queue.unshift(heatQuestion);
  queue.push(
    ...ws.settings.customQuestions.map((question) => ({
      kind: "custom" as const,
      id: question.id,
      question: copy(question.text, question.text),
    })),
  );
  if (taskTicketsEnabled(ws)) {
    const overdueIds = new Set(overdueScheduledTasks(ws, now).map((task) => task.id));
    queue.push(
      ...openTaskTickets(ws)
        .filter((task) => task.scheduledFor === null || overdueIds.has(task.id))
        .map((task) => ({
          kind: "task" as const,
          id: "task_" + task.id,
          taskId: task.id,
          question: copy("Did you finish: " + task.instruction + "?", "خلصت المهمة: " + task.instruction + "؟"),
        })),
    );
  }
  return queue;
}

/** The worker is on the line: greet, then the report questions one at a time. */
function beginReportQuestions(session: CallSession, ws: Workspace, now: Date, returning = false): CallSession {
  const withQueue = { ...session, data: { ...session.data, queue: reportQueue(ws, now), reportIndex: 0 } };
  const introduced = say(
    withQueue,
    returning
      ? copy(
          "Hello Ahmed, I’m NAQAH’s automated assistant. Thanks for calling back about the report call you missed. We’ll go through the questions one at a time.",
          "هلا أحمد، معك مساعد ناقة الآلي. شكراً إنك رجعت تتصل على مكالمة التقرير اللي فاتتك. بنمشي على الأسئلة وحدة وحدة.",
        )
      : copy(
          "Hello Ahmed, I’m NAQAH’s automated assistant, calling for the farm report. We’ll go through the questions one at a time.",
          "هلا أحمد، معك مساعد ناقة الآلي، أتصل عشان تقرير العزبة. بنمشي على الأسئلة وحدة وحدة.",
        ),
    now,
  );
  return askReportItem(introduced, ws, now);
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
  return copy("A report call is already in progress.", "فيه مكالمة تقرير شغالة الآن.");
}

/**
 * NAQAH → primary worker. With `reportCallId` (a real call the worker picked up) the questions
 * start at once. Without it, the Call Lab simulates the ringing: open or reuse a run, then let the
 * investor choose whether Ahmed answers. Every ringing line says it is a simulation.
 */
function startReportCallScenario(ws: Workspace, now: Date, reportCallId?: string): EngineResult {
  const session = blank("report_call", now);
  if (reportCallId) {
    const run = reportCallRuns(ws).find((item) => item.id === reportCallId);
    const ringing = run?.state === "calling" && run.attempts.at(-1)?.result === "pending";
    if (!run || (!ringing && run.state !== "answered")) {
      return { session: say(session, copy("This report call is no longer active. Thank you.", "مكالمة التقرير هذه انتهت. يعطيك العافية."), now, true) };
    }
    const prepared = ringing ? resolveReportCallAttempt(ws, now, run.id, true).ws : ws;
    return {
      session: beginReportQuestions({ ...session, data: { reportCallId: run.id } }, prepared, now),
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

function handleReportRinging(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
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
function startWorkerInbound(ws: Workspace, now: Date): EngineResult {
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

function startWorkerCallback(ws: Workspace, now: Date): EngineResult {
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
  const callbackTaskIds = overdueScheduledTasks(ws, now).map((task) => task.id);
  const session = {
    ...blank("worker_callback", now),
    data: { callbackTaskIds, callbackTaskIndex: 0 },
  };
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

function startOwnerNotification(ws: Workspace, now: Date, requestedReportId?: string): EngineResult {
  const report = requestedReportId
    ? ws.reports.find((item) => item.id === requestedReportId)
    : ws.reports[ws.reports.length - 1];
  const reportId = report?.id ?? requestedReportId ?? "";
  const session = {
    ...blank("owner_notification", now),
    data: { reportId },
  };
  return {
    session: ask(
      session,
      copy(
        "NAQAH is calling Abdullah after Ahmed’s update. Would you like to answer?",
        "ناقة تتصل بعبدالله بعد تحديث أحمد. تبي ترد على المكالمة؟",
      ),
      now,
      "notification_answer",
      [reply("answer", "Answer", "رد"), reply("miss", "Miss this call", "خلها فائتة")],
    ),
  };
}

function startWorkerOutbound(ws: Workspace, now: Date): EngineResult {
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

function startOwnerInquiry(ws: Workspace, now: Date): EngineResult {
  const route = routeOwnerInboundCall(ws, now);
  const session = blank("owner_inquiry", now);
  if (route.kind === "rejected") {
    const text = copy(
      "I’m sorry, the Basic plan’s owner call has already been used this week. The latest details are available on the website.",
      "عذراً، مكالمة المالك الأسبوعية في الباقة الأساسية استُخدمت. تقدر تراجع آخر التفاصيل في الموقع.",
    );
    return { session: say(session, text, now, true), commit: commitTo(rejectOwnerInquiry(ws, now)) };
  }
  const next = {
    ...session,
    data: { ...session.data, inquiryTopics: [] },
  };
  return {
    session: askInquiryTopics(
      say(next, copy("Hello Abdullah. What would you like to check?", "هلا عبدالله. وش تحب تعرف عنه؟"), now),
      now,
    ),
    commit: commitTo(recordOwnerInquiry(ws, now, route.mode)),
  };
}

function startEmergency(ws: Workspace, now: Date): EngineResult {
  const categories = ws.settings.emergencies.map((item) => item.label ?? item.kind.replaceAll("_", " "));
  const text = copy(
    "For an emergency, Ahmed calls you directly. NAQAH does not dispatch emergencies. The configured categories are: " +
      (categories.join(", ") || "none configured") +
      ".",
    "في الطوارئ، أحمد يتصل بك مباشرة. ناقة ما ترسل استجابة للطوارئ. الفئات المحددة: " +
      (categories.join("، ") || "ما فيه فئات محددة") +
      ".",
  );
  return {
    session: say(blank("emergency", now), text, now, true),
  };
}

function askReportItem(session: CallSession, ws: Workspace, now: Date): CallSession {
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
    const confirmed = unknown
      ? current.session
      : {
          ...current.session,
          draft: {
            ...current.session.draft,
            taskConfirmations: [...current.session.draft.taskConfirmations, { taskId: item.taskId, done }],
          },
        };
    const recorded = reportAnswer(
      confirmed,
      item,
      unknown ? UNKNOWN_ANSWER : done ? copy("Yes, completed", "إيه، خلصت") : copy("Not yet", "باقي"),
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


const camelsText = (count: number) => copy(count + (count === 1 ? " camel" : " camels"), count + " من الحلال");

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
  const answer: string | LocalizedText = !detail ? (base ?? UNKNOWN_ANSWER) : base ? base.en + " — " + detail : detail;
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
  const answer = updates.length
    ? updates.map((update) => {
        const camel = ws.camels.find((entry) => entry.id === update.camelId);
        const name = camel?.name ?? "";
        const state = HEALTH_LABELS[update.health];
        return name + ": " + state.en + (update.note ? " — " + update.note : "");
      }).join("; ")
    : "I don’t know";
  const arAnswer = updates.length
    ? updates.map((update) => {
        const camel = ws.camels.find((entry) => entry.id === update.camelId);
        const name = camel?.name ?? "";
        const state = HEALTH_LABELS[update.health];
        return name + ": " + state.ar + (update.note ? " — " + update.note : "");
      }).join("؛ ")
    : "ما أدري";
  const unknown = updates.length === 0 || updates.some((update) => update.certainty === "unknown");
  const recorded = reportAnswer(session, item, answer, unknown ? "unknown" : "reported", item.question);
  const lastAnswer = recorded.draft.answers[recorded.draft.answers.length - 1];
  const localizedAnswer = copy(answer, arAnswer);
  const localizedRecorded = {
    ...recorded,
    draft: {
      ...recorded.draft,
      answers: recorded.draft.answers.map((entry, index) =>
        index === recorded.draft.answers.length - 1 ? { ...lastAnswer, answer: localizedAnswer.en, answerText: localizedAnswer } : entry,
      ),
    },
  };
  return nextReportItem(localizedRecorded, ws, now);
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
  const answerEn = label.en + (quantity ? " (" + quantity.text.en + ")" : "");
  const answerText = { en: answerEn, ar: label.ar + (quantity ? " (" + quantity.text.ar + ")" : "") };
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
  return { ...next, data: { ...next.data, tempLevel: undefined, tempQuantity: undefined } };
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
  return { session: askQuantityConfirm(current.session, item.resource, quantity, now) };
}

const isQuantity = (text: string) => text !== "" && Number.isFinite(Number(text)) && Number(text) >= 0;

const quantityUnit = (resource: ResourceKind) => (resource === "feed" ? copy("bags", "كيس") : copy("litres", "لتر"));

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

function askReportSummary(session: CallSession, ws: Workspace, now: Date): CallSession {
  const findings = evaluateFindings(ws, session.draft);
  const factsEn: string[] = [];
  const factsAr: string[] = [];
  for (const update of session.draft.camelUpdates) {
    const camel = ws.camels.find((entry) => entry.id === update.camelId);
    const label = HEALTH_LABELS[update.health];
    factsEn.push((camel?.name ?? "Camel") + ": " + label.en + (update.note ? " — " + update.note : ""));
    factsAr.push((camel?.name ?? "ناقة") + ": " + label.ar + (update.note ? " — " + update.note : ""));
  }
  for (const update of session.draft.resourceUpdates) {
    const label = RESOURCE_LABELS[update.kind];
    const level = levelLabel(update.kind, update.level);
    factsEn.push(label.en + ": " + level.en + (update.quantity ? " (" + update.quantity + ")" : ""));
    factsAr.push(label.ar + ": " + level.ar + (update.quantity ? " (" + update.quantity + ")" : ""));
  }
  if (typeof session.draft.herdCount === "number") {
    factsEn.push("camels counted: " + session.draft.herdCount);
    factsAr.push("عدد الحلال: " + session.draft.herdCount);
  }
  if (session.draft.herdAccountedFor === false) {
    factsEn.push("not all camels are accounted for");
    factsAr.push("الحلال غير مكتمل العدد");
  }
  // A task closes on this confirmation, so the worker must hear it before saving.
  for (const confirmation of session.draft.taskConfirmations) {
    const instruction = ws.taskTickets.find((task) => task.id === confirmation.taskId)?.instruction ?? "";
    factsEn.push((confirmation.done ? "task finished: " : "task still open: ") + instruction);
    factsAr.push((confirmation.done ? "مهمة خلصت: " : "مهمة باقية: ") + instruction);
  }
  // Free-text answers aren't read back, but they are in the report, so never say there is nothing.
  const answered = session.draft.answers.length > 0;
  const baseEn = factsEn.length ? factsEn.join("; ") : answered ? "your answers" : "no additional farm facts";
  const baseAr = factsAr.length ? factsAr.join("، ") : answered ? "إجاباتك" : "ما فيه معلومات إضافية عن العزبة";
  const findingEn = findings.length ? " Important for the owner: " + findings[0].text.en : "";
  const findingAr = findings.length ? " أهم ملاحظة للمالك: " + findings[0].text.ar : "";
  const text = copy(
    "Here’s the summary: " + baseEn + "." + findingEn + " Confirm and save this update?",
    "هذا ملخص التحديث: " + baseAr + "." + findingAr + " أحفظه؟",
  );
  return ask(
    session,
    text,
    now,
    "report_summary",
    [reply("confirm_save", "Confirm and save", "تأكيد وحفظ"), reply("end_without_save", "End without saving", "إنهاء بدون حفظ")],
  );
}

function completeReport(session: CallSession, ws: Workspace, now: Date): EngineResult {
  const reportCallId = session.scenario === "report_call" ? session.data.reportCallId : undefined;
  const completed = completeWorkerReport(ws, now, session.draft, reportCallId);
  const next = say(
    {
      ...session,
      next: { scenario: "owner_notification", reportId: completed.report.id },
    },
    copy("Saved, thank you. NAQAH is now calling Abdullah with the update.", "تم حفظ التحديث، شكراً لك. ناقة تتصل الآن بعبدالله وتبلغه."),
    now,
    true,
  );
  return { session: next, commit: commitTo(completed.ws) };
}

function handleOwnerNotification(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  const reportId = session.data.reportId ?? "";
  if (session.step === "notification_answer") {
    if (current.value === "miss") {
      const updated = recordOwnerNotification(ws, now, reportId, false);
      return {
        session: say(
          current.session,
          copy("The call is marked missed. Abdullah can review the update on the website or call back.", "سُجلت المكالمة فائتة. يقدر عبدالله يراجع التحديث في الموقع أو يتصل بنا."),
          now,
          true,
        ),
        commit: commitTo(updated),
      };
    }
    const updated = recordOwnerNotification(ws, now, reportId, true);
    const report = ws.reports.find((item) => item.id === reportId);
    const briefing = ownerBriefing(report?.findings ?? []);
    return {
      session: ask(
        say(current.session, briefing, now),
        copy("Do you have any instructions for Ahmed?", "عندك أي تعليمات لأحمد؟"),
        now,
        "instruction_yesno",
        [reply("instruction_yes", "Yes, I do", "إيه"), reply("instruction_no", "No, thanks", "لا، شكراً")],
      ),
      commit: commitTo(updated),
    };
  }
  if (session.step === "instruction_yesno") {
    if (current.value === "instruction_no") {
      return {
        session: say(current.session, copy("Thank you. The update is ready on the website.", "شكراً لك. التحديث موجود في الموقع."), now, true),
      };
    }
    return {
      session: ask(
        current.session,
        copy("What would you like Ahmed to know or do?", "وش تحب توصل لأحمد أو تطلب منه؟"),
        now,
        "instruction_text",
        [],
        "text",
      ),
    };
  }
  if (session.step === "instruction_text") {
    const instruction = (input.text ?? current.value).trim();
    if (!instruction) {
      return {
        session: ask(current.session, copy("Write a short instruction for Ahmed.", "اكتب تعليمات قصيرة لأحمد."), now, "instruction_text", [], "text"),
      };
    }
    const next = { ...current.session, data: { ...current.session.data, instruction } };
    return {
      session: ask(
        next,
        copy("Should Ahmed do something, or is this information only?", "هل المطلوب من أحمد يسوي شيء، أو هي معلومة فقط؟"),
        now,
        "instruction_kind",
        [reply("actionable", "A task for Ahmed", "مهمة لأحمد"), reply("information", "Information only", "معلومة فقط")],
      ),
    };
  }
  if (session.step === "instruction_kind") {
    const actionable = current.value === "actionable";
    const next = { ...current.session, data: { ...current.session.data, actionable } };
    if (actionable && taskTicketsEnabled(ws)) {
      return {
        session: ask(
          next,
          copy("When should it be done?", "متى ودك تنفذ المهمة؟"),
          now,
          "instruction_schedule",
          [reply("any_time", "Any time", "في أي وقت"), reply("pick_time", "Choose a time today", "حدد وقت اليوم")],
        ),
      };
    }
    return submitInstruction(next, ws, now, actionable, null);
  }
  if (session.step === "instruction_schedule") {
    if (current.value === "any_time") return submitInstruction(current.session, ws, now, true, null);
    return {
      session: ask(
        current.session,
        copy("Choose a time today in Riyadh, for example 18:30.", "حدد وقت اليوم بتوقيت الرياض، مثل 18:30."),
        now,
        "instruction_time",
        [reply("any_time", "Any time", "في أي وقت")],
        "time",
      ),
    };
  }
  if (session.step === "instruction_time") {
    const value = (input.text ?? current.value).trim();
    const parts = value.split(":").map(Number);
    const valid = parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && parts[0] >= 0 && parts[0] <= 23 && parts[1] >= 0 && parts[1] <= 59;
    if (!valid) {
      return {
        session: ask(current.session, copy("Enter a valid time such as 18:30.", "أدخل وقتاً صحيحاً مثل 18:30."), now, "instruction_time", [reply("any_time", "Any time", "في أي وقت")], "time"),
      };
    }
    const p = riyadhParts(now);
    const scheduled = fromRiyadh(p.year, p.month, p.day, parts[0], parts[1]);
    if (scheduled.getTime() < now.getTime()) {
      return {
        session: ask(current.session, copy("Choose a later time today.", "اختر وقتاً لاحقاً اليوم."), now, "instruction_time", [reply("any_time", "Any time", "في أي وقت")], "time"),
      };
    }
    return submitInstruction(current.session, ws, now, true, scheduled.toISOString());
  }
  return { session: current.session };
}

function submitInstruction(
  session: CallSession,
  ws: Workspace,
  now: Date,
  actionable: boolean,
  scheduledFor: string | null,
): EngineResult {
  const created = submitOwnerInstruction(ws, now, {
    message: session.data.instruction ?? "",
    actionable,
    scheduledFor,
  });
  let next: CallSession = {
    ...session,
    data: { ...session.data, scheduledFor, actionable },
  };
  if (created.taskId) {
    next = addNotice(next, copy("A Task Ticket was opened and is waiting for Ahmed.", "فُتحت تذكرة مهمة وبانتظار أحمد."));
    next = say(
      next,
      copy("I’ve opened a task for Ahmed and will call him now with your instruction.", "فتحت مهمة لأحمد، وباتصل عليه الآن وأوصل له تعليماتك."),
      now,
      true,
    );
  } else {
    next = say(
      next,
      copy("Your message is ready. I’ll call Ahmed now.", "وصلت رسالتك. باتصل على أحمد الآن."),
      now,
      true,
    );
  }
  return { session: next, commit: commitTo(created.ws) };
}

function handleWorkerCallback(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (session.step === "callback_acknowledge") {
    const updated = completeWorkerCallback(ws, now);
    const delivered = say(
      current.session,
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
  const overdueIds = new Set(overdueScheduledTasks(ws, now).map((task) => task.id));
  let index = session.data.callbackTaskIndex ?? 0;
  while (index < taskIds.length) {
    const taskId = taskIds[index];
    const task = ws.taskTickets.find((item) => item.id === taskId && item.status === "open");
    if (!task || !overdueIds.has(taskId)) {
      index += 1;
      continue;
    }
    return ask(
      { ...session, data: { ...session.data, callbackTaskIndex: index } },
      copy("Did you finish the overdue task: " + task.instruction + "?", "خلصت المهمة المتأخرة: " + task.instruction + "؟"),
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

function handleWorkerOutbound(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
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
          "Ahmed did not answer. Retry " + Math.max(1, nextAttempt - 1) + " of " + MAX_RETRIES + " is scheduled for " + atRiyadh(retryAt, "en", true) + " Riyadh time.",
          "ما رد أحمد. أُعيدت المحاولة " + Math.max(1, nextAttempt - 1) + " من " + MAX_RETRIES + " في " + atRiyadh(retryAt, "ar", true) + " بتوقيت الرياض.",
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
        "Ahmed did not answer after four attempts. A No Answer Ticket is open. He can call NAQAH back to receive the message.",
        "ما رد أحمد بعد أربع محاولات. فُتحت تذكرة عدم رد، ويقدر يتصل بنا عشان توصله الرسالة.",
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

const TOPICS = [
  { value: "herd", label: copy("Herd status", "حالة الحلال") },
  { value: "resources", label: copy("Feed and water", "العلف والماء") },
  { value: "tasks", label: copy("Open tasks", "المهام المفتوحة") },
  { value: "last_update", label: copy("Last update", "آخر تحديث") },
];

function askInquiryTopics(session: CallSession, now: Date): CallSession {
  const selected = new Set(session.data.inquiryTopics ?? []);
  const choices = TOPICS
    .filter((topic) => !selected.has(topic.value))
    .map((topic) => ({ id: topic.value, value: topic.value, label: topic.label }));
  choices.push(reply("inquiry_done", "No, thanks", "لا، شكراً"));
  return ask(
    session,
    copy("What else would you like to know?", "وش بعد تحب تعرف؟"),
    now,
    "inquiry_topics",
    choices,
  );
}

function inquiryTopicAnswer(ws: Workspace, topic: string): LocalizedText {
  const reports = ws.reports;
  const latest = reports[reports.length - 1];
  if (topic === "herd") {
    const lines = ws.camels.slice(0, 4).map((camel) => {
      if (!camel.updatedAt) return { en: camel.name + ": no saved update.", ar: camel.name + ": ما فيه تحديث محفوظ." };
      const atEn = atRiyadh(new Date(camel.updatedAt), "en", true);
      const atAr = atRiyadh(new Date(camel.updatedAt), "ar", true);
      const health = HEALTH_LABELS[camel.health];
      const certainty = CERTAINTY_LABELS[camel.certainty];
      return {
        en: "As of " + atEn + ", " + camel.name + " was " + health.en.toLowerCase() + " (" + certainty.en.toLowerCase() + ").",
        ar: "حتى " + atAr + "، كانت " + camel.name + " " + health.ar + " (" + certainty.ar + ").",
      };
    });
    if (!lines.length && latest) {
      return copy(
        "As of " + atRiyadh(new Date(latest.at), "en", true) + ", Ahmed’s last report is stored on the website.",
        "في " + atRiyadh(new Date(latest.at), "ar", true) + " وصل آخر تقرير من أحمد، وتفاصيله محفوظة في الموقع.",
      );
    }
    if (!lines.length) return copy("No herd update has been saved yet.", "ما انحفظ تحديث للحلال إلى الآن.");
    return copy(lines.map((line) => line.en).join(" "), lines.map((line) => line.ar).join(" "));
  }
  if (topic === "resources") {
    const resources = ws.resources.filter((item) => item.present && (item.kind === "feed" || item.kind === "water"));
    if (!resources.length) return copy("Feed and water details are not set up.", "تفاصيل العلف والماء غير موجودة.");
    const lines = resources.map((item) => {
      if (!item.updatedAt) {
        return {
          en: RESOURCE_LABELS[item.kind].en + ": no report has been saved.",
          ar: RESOURCE_LABELS[item.kind].ar + ": ما وصل عنها تقرير.",
        };
      }
      const level = levelLabel(item.kind, item.level);
      const certainty = CERTAINTY_LABELS[item.certainty];
      const quantity = item.quantity ? " (" + item.quantity + ")" : "";
      return {
        en: "As of " + atRiyadh(new Date(item.updatedAt), "en", true) + ", " + RESOURCE_LABELS[item.kind].en + " was " + level.en.toLowerCase() + quantity + " (" + certainty.en.toLowerCase() + ").",
        ar: "حتى " + atRiyadh(new Date(item.updatedAt), "ar", true) + "، كان " + RESOURCE_LABELS[item.kind].ar + " " + level.ar + quantity + " (" + certainty.ar + ").",
      };
    });
    return copy(lines.map((line) => line.en).join(" "), lines.map((line) => line.ar).join(" "));
  }
  if (topic === "tasks") {
    const tasks = openTaskTickets(ws);
    if (!tasks.length) return copy("There are no open task tickets.", "ما فيه تذاكر مهام مفتوحة.");
    const lines = tasks.map((task) => ({
      en: "Opened " + atRiyadh(new Date(task.createdAt), "en", true) + ": " + task.instruction + " (still open).",
      ar: "فُتحت " + atRiyadh(new Date(task.createdAt), "ar", true) + ": " + task.instruction + " (ما زالت مفتوحة).",
    }));
    return copy(lines.map((line) => line.en).join(" "), lines.map((line) => line.ar).join(" "));
  }
  if (!latest) return copy("No farm update has been saved yet.", "ما انحفظ تحديث للعزبة إلى الآن.");
  const answers = latest.answers.slice(0, 3);
  const dateEn = atRiyadh(new Date(latest.at), "en", true);
  const dateAr = atRiyadh(new Date(latest.at), "ar", true);
  if (!answers.length) {
    return copy(
      "The last farm update was saved " + dateEn + ". Its full details are on the website.",
      "آخر تحديث للعزبة انحفظ " + dateAr + ". تفاصيله كاملة موجودة في الموقع.",
    );
  }
  const lines = answers.map((answer) => {
    const certainty = CERTAINTY_LABELS[answer.certainty];
    return {
      en: "Ahmed reported “" + (answer.answerText?.en ?? answer.answer) + "” (" + certainty.en.toLowerCase() + ").",
      ar: "أفاد أحمد: «" + (answer.answerText?.ar ?? answer.answer) + "» (" + certainty.ar + ").",
    };
  });
  return copy(
    "As of " + dateEn + ", " + lines.map((line) => line.en).join(" "),
    "بحسب تقرير " + dateAr + "، " + lines.map((line) => line.ar).join(" "),
  );
}

function handleOwnerInquiry(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  const current = workerTurn(session, input, now);
  if (session.step !== "inquiry_topics") return { session: current.session };
  if (current.value === "inquiry_done") {
    return {
      session: say(current.session, copy("Thank you. No tasks were created during this inquiry.", "شكراً لك. ما أنشأنا أي مهام خلال هذا الاستفسار."), now, true),
    };
  }
  const topic = TOPICS.find((item) => item.value === current.value);
  if (!topic) return { session: askInquiryTopics(current.session, now) };
  const topics = [...new Set([...(session.data.inquiryTopics ?? []), topic.value])];
  const answered = {
    ...current.session,
    data: { ...current.session.data, inquiryTopics: topics },
  };
  return {
    session: askInquiryTopics(
      say(answered, inquiryTopicAnswer(ws, topic.value), now),
      now,
    ),
  };
}

export function answer(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  if (session.done) return { session };
  switch (session.scenario) {
    case "report_call":
    case "worker_inbound":
      if (session.step === "report_ring" || session.step === "report_wait") return handleReportRinging(session, ws, now, input);
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
        const final = finishCamelHealth(current.session, ws, now);
        return { session: final };
      }
      if (session.step === "herd_count_confirm") return handleHerdCountConfirm(session, ws, now, input);
      if (session.step === "herd_count_detail") return handleHerdCountDetail(session, ws, now, input);
      if (session.step === "quantity_input") return handleQuantityInput(session, ws, now, input);
      if (session.step === "quantity_confirm") return handleQuantityConfirm(session, ws, now, input);
      if (session.step === "report_summary") {
        const current = workerTurn(session, input, now);
        if (current.value === "confirm_save") return completeReport(current.session, ws, now);
        const ended = say(
          current.session,
          copy("The update was not saved. Thank you, Ahmed.", "ما انحفظ التحديث. يعطيك العافية يا أحمد."),
          now,
          true,
        );
        const runId = session.scenario === "report_call" ? session.data.reportCallId : undefined;
        const updated = runId ? endReportCallWithoutReport(ws, now, runId) : ws;
        return { session: ended, ...(updated !== ws ? { commit: commitTo(updated) } : {}) };
      }
      return { session };
    case "owner_notification":
      return handleOwnerNotification(session, ws, now, input);
    case "worker_outbound":
      return handleWorkerOutbound(session, ws, now, input);
    case "worker_callback":
      return handleWorkerCallback(session, ws, now, input);
    case "owner_inquiry":
      return handleOwnerInquiry(session, ws, now, input);
    case "emergency":
      return { session };
  }
}

/** End an active call while retaining only state already committed by answered steps. */
export function hangUp(session: CallSession, ws: Workspace, now: Date): EngineResult {
  if (session.done) return { session };
  const ended = say(session, copy("This call has ended.", "انتهى الاتصال."), now, true);
  if (session.scenario === "report_call") return { session: ended, ...hangUpReportCall(session, ws, now) };
  if (session.scenario !== "worker_outbound") return { session: ended };

  const startedIds = new Set(session.data.startedVerificationCallIds ?? []);
  if (!startedIds.size) return { session: ended };
  const pendingWorkerCalls = ws.pendingWorkerCalls.filter(
    (call) => !(startedIds.has(call.id) && call.state === "pending" && call.attempts.length === 0),
  );
  if (pendingWorkerCalls.length === ws.pendingWorkerCalls.length) return { session: ended };
  return { session: ended, commit: commitTo({ ...ws, pendingWorkerCalls }) };
}

/**
 * Ending a report call. Ringing on the attempt this session opened: undo the run, nothing was
 * said. Ringing on a later attempt: nobody answered it. Mid-questions: the call ended unsaved.
 */
function hangUpReportCall(session: CallSession, ws: Workspace, now: Date): Pick<EngineResult, "commit"> {
  const run = reportCallRuns(ws).find((item) => item.id === session.data.reportCallId);
  if (!run) return {};
  if (run.state === "answered") return { commit: commitTo(endReportCallWithoutReport(ws, now, run.id)) };
  if (session.step !== "report_ring" || run.attempts.at(-1)?.result !== "pending") return {};
  if (session.data.startedReportCallId === run.id && run.attempts.length === 1) {
    return { commit: commitTo({ ...ws, reportCalls: reportCallRuns(ws).filter((item) => item.id !== run.id) }) };
  }
  return { commit: commitTo(resolveReportCallAttempt(ws, now, run.id, false).ws) };
}
