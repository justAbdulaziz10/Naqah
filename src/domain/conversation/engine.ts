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
import { fromRiyadh, MAX_RETRIES, RETRY_DELAY_MS, riyadhParts, nextWindowStart } from "../clock";
import { evaluateFindings, ownerBriefing, type ReportDraft } from "../findings";
import { uid } from "../id";
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
  ResourceKind,
  Workspace,
} from "../types";

export type Scenario =
  | "worker_report"
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

export interface ScenarioAvailability {
  workerReport: ReturnType<typeof routeWorkerInboundCall>;
  ownerInquiry: ReturnType<typeof routeOwnerInboundCall>;
  pendingWorkerCallCount: number;
  dueWorkerCallCount: number;
  dueTaskVerificationCount: number;
}

const copy = (en: string, ar: string): LocalizedText => ({ en, ar });
const UNKNOWN_ANSWER = copy("I don’t know", "ما أدري");
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
  return {
    session: turn(session, session.scenario === "owner_notification" || session.scenario === "owner_inquiry" ? "owner" : "worker", selected.text, now),
    value: selected.value,
  };
}

function isUnknown(value: string, text = ""): boolean {
  const normalized = (value + " " + text).trim().toLowerCase();
  return value === "unknown" || value === "dont_know" || normalized === "i don't know" || normalized === "i do not know" || normalized === "ما أدري";
}

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
    workerReport: routeWorkerInboundCall(ws, now),
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
  scenario: Scenario = "worker_report",
  options: { reportId?: string } = {},
): EngineResult {
  switch (scenario) {
    case "worker_report":
      return startWorkerReport(ws, now);
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

function startWorkerReport(ws: Workspace, now: Date): EngineResult {
  const route = routeWorkerInboundCall(ws, now);
  if (route.kind === "callback") return startWorkerCallback(ws, now);
  if (route.kind === "rejected") {
    const session = blank("worker_report", now);
    let text: LocalizedText;
    if (route.reason === "outside_window" && ws.settings.window) {
      const next = nextWindowStart(now, ws.settings.window);
      const at = atRiyadh(next, "en", true);
      const atAr = atRiyadh(next, "ar", true);
      text = copy(
        "Our weekly reporting window is closed. The next window begins " + at + " Riyadh time.",
        "نافذة التقرير الأسبوعية مقفلة. تفتح النافذة القادمة " + atAr + " بتوقيت الرياض.",
      );
    } else if (route.reason === "weekly_done") {
      text = copy(
        "We have already received this week’s update. There is no need to repeat it.",
        "وصلنا تحديث هذا الأسبوع، وما يحتاج تعيده.",
      );
    } else if (route.reason === "daily_done") {
      text = copy(
        "We have already received today’s update. There is no need to repeat it.",
        "وصلنا تحديث اليوم، وما يحتاج تعيده.",
      );
    } else {
      text = copy(
        "A weekly reporting window has not been set yet. Please check with Abdullah.",
        "ما تحددت نافذة التقرير الأسبوعية إلى الآن. فضلاً تواصل مع عبدالله.",
      );
    }
    const completed = say(session, text, now, true);
    return { session: completed, commit: commitTo(rejectWorkerReport(ws, now, route.reason)) };
  }

  // Ask the single weather check first, only when today's forecast and farm coordinates exist.
  const heatQuestion = heatDayReportItem(ws, now);
  const queue: ReportItem[] = applicableQuestions(ws)
    .filter((question) => question.id !== "herd_count" || ws.camels.length > 0)
    .map((question) => ({
      kind: "predefined",
      id: question.id,
      question: question.text,
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

  const session = {
    ...blank("worker_report", now),
    data: { queue, reportIndex: 0 },
  };
  const introduced = say(
    session,
    copy(
      "Hello Ahmed, I’m NAQAH’s automated assistant. We’ll go through today’s questions one at a time.",
      "هلا أحمد، معك مساعد ناقة الآلي. بنمشي على أسئلة اليوم وحدة وحدة.",
    ),
    now,
  );
  return { session: askReportItem(introduced, ws, now) };
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
    "فاتتك مكالمتنا. رسالة المالك: " + (messagesAr || "فضلاً تواصل مع عبدالله.") + " هذا اتصال لتسليم رسالة، وليس تحديثاً للمزرعة.",
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
  if (item.answerKind === "yesno") {
    const question = item.id === "herd_count"
      ? copy(
          "Are all " + ws.camels.length + " camels accounted for?",
          "الحلال كله موجود وكامل العدد؟ (" + ws.camels.length + " نوق)",
        )
      : item.question;
    const updated = { ...current, data: { ...current.data, currentQuestionId: item.id }, };
    return ask(
      updated,
      question,
      now,
      "report_question",
      [reply("yes", "Yes", "إيه"), reply("no", "No", "لا"), reply("unknown", "I don’t know", "ما أدري")],
    );
  }
  if (item.answerKind === "level" && item.resource) {
    const values: Level[] = ["good", "medium", "low", "critical", "unknown"];
    return ask(
      current,
      item.question,
      now,
      "report_question",
      values.map((value) => ({
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
    const draft = {
      ...current.session.draft,
      taskConfirmations: [...current.session.draft.taskConfirmations, { taskId: item.taskId, done }],
    };
    const recorded = reportAnswer(
      { ...current.session, draft },
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

  if (item.answerKind === "yesno") {
    if (item.id === "herd_count") {
      if (value === "yes") {
        const draft = { ...current.session.draft, herdAccountedFor: true };
        const recorded = reportAnswer({ ...current.session, draft }, item, copy("All camels are accounted for", "الحلال كامل العدد"), "reported");
        return { session: nextReportItem(recorded, ws, now) };
      }
      if (value === "no") {
        const draft = { ...current.session.draft, herdAccountedFor: false };
        const counted = { ...current.session, draft };
        return {
          session: ask(
            counted,
            copy("Which camel is missing, or how many are missing?", "أي ناقة ناقصة؟ أو كم ناقة ناقصة؟"),
            now,
            "herd_count_detail",
            [reply("unknown", "I don’t know", "ما أدري")],
            "text",
          ),
        };
      }
      const draft = { ...current.session.draft, herdAccountedFor: null };
      const recorded = reportAnswer({ ...current.session, draft }, item, UNKNOWN_ANSWER, "unknown");
      return { session: nextReportItem(recorded, ws, now) };
    }
  }

  if (item.answerKind === "level" && item.resource) {
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
    const recorded = reportAnswer(current.session, item, UNKNOWN_ANSWER, "unknown");
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
  const note = current.value === "skip_note" || !input.text?.trim() ? null : input.text.trim();
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
  quantity: string | null,
  certainty: Certainty,
): CallSession {
  if (item.kind !== "predefined" || !item.resource) return session;
  const resourceUpdate = { kind: item.resource, level, quantity, note: null, certainty };
  const label = levelLabel(item.resource, level);
  const quantityEn = quantity ? " (" + quantity + ")" : "";
  const answerEn = label.en + quantityEn;
  const answerText = { en: answerEn, ar: label.ar + quantityEn };
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
  if (!quantity || !Number.isFinite(Number(quantity)) || Number(quantity) < 0) {
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
  const next = { ...current.session, data: { ...current.session.data, tempQuantity: quantity } };
  const unitEn = item.resource === "feed" ? "bags" : "litres";
  const unitAr = item.resource === "feed" ? "كيس" : "لتر";
  return {
    session: ask(
      next,
      copy(
        "You mentioned about " + quantity + " " + unitEn + ". The quantity is approximate, correct?",
        "ذكرت إن باقي تقريباً " + quantity + " " + unitAr + ". للتأكيد، الكمية تقديرية، صحيح؟",
      ),
      now,
      "quantity_confirm",
      [reply("yes", "Yes, approximate", "إيه، تقريبية"), reply("no", "Change it", "أبي أغيّرها")],
    ),
  };
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
  const unit = item.resource === "feed" ? "bags" : "litres";
  const quantity = (session.data.tempQuantity ?? "") + " " + unit;
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
  if (session.draft.herdAccountedFor === false) {
    factsEn.push("not all camels are accounted for");
    factsAr.push("الحلال غير مكتمل العدد");
  }
  const baseEn = factsEn.length ? factsEn.join("; ") : "no additional farm facts";
  const baseAr = factsAr.length ? factsAr.join("، ") : "ما فيه معلومات إضافية عن المزرعة";
  const findingEn = findings.length ? " The owner will hear: " + findings[0].text.en : "";
  const findingAr = findings.length ? " والمالك بيوصله: " + findings[0].text.ar : "";
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
  const completed = completeWorkerReport(ws, now, session.draft);
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
    copy("This call did not create a farm update.", "هذا الاتصال ما أنشأ تحديثاً للمزرعة."),
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
  if (!latest) return copy("No farm update has been saved yet.", "ما انحفظ تحديث للمزرعة إلى الآن.");
  const answers = latest.answers.slice(0, 3);
  const dateEn = atRiyadh(new Date(latest.at), "en", true);
  const dateAr = atRiyadh(new Date(latest.at), "ar", true);
  if (!answers.length) {
    return copy(
      "The last farm update was saved " + dateEn + ". Its full details are on the website.",
      "آخر تحديث للمزرعة حُفظ " + dateAr + ". تفاصيله كاملة موجودة في الموقع.",
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
    case "worker_report":
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
      if (session.step === "herd_count_detail") {
        const current = workerTurn(session, input, now);
        const item = session.data.queue?.[session.data.reportIndex ?? 0];
        if (!item) return { session: current.session };
        const unknown = isUnknown(current.value, input.text);
        const recorded = reportAnswer(
          current.session,
          item,
          unknown ? UNKNOWN_ANSWER : (input.text ?? current.value).trim(),
          unknown ? "unknown" : "reported",
        );
        return { session: nextReportItem(recorded, ws, now) };
      }
      if (session.step === "quantity_input") return handleQuantityInput(session, ws, now, input);
      if (session.step === "quantity_confirm") return handleQuantityConfirm(session, ws, now, input);
      if (session.step === "report_summary") {
        const current = workerTurn(session, input, now);
        if (current.value === "confirm_save") return completeReport(current.session, ws, now);
        return {
          session: say(
            current.session,
            copy("The update was not saved. End this call and start a new one to record it again.", "ما انحفظ التحديث. أنهِ الاتصال وابدأ مكالمة جديدة لتسجيله من جديد."),
            now,
            true,
          ),
        };
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
  if (session.scenario !== "worker_outbound") return { session: ended };

  const startedIds = new Set(session.data.startedVerificationCallIds ?? []);
  if (!startedIds.size) return { session: ended };
  const pendingWorkerCalls = ws.pendingWorkerCalls.filter(
    (call) => !(startedIds.has(call.id) && call.state === "pending" && call.attempts.length === 0),
  );
  if (pendingWorkerCalls.length === ws.pendingWorkerCalls.length) return { session: ended };
  return { session: ended, commit: commitTo({ ...ws, pendingWorkerCalls }) };
}
