import { REPORT_CALL_RETRIES } from "../clock";
import type { ReportDraft } from "../findings";
import type { ReportCallBlock } from "../reportCalls";
import { heatLevel, weatherForToday } from "../weather";
import { confirmableTasks, routeOwnerInboundCall, routeWorkerInboundCall } from "../rules";
import type { HealthStatus, Level, LocalizedText, PredefinedQuestion, ReportCallRun, ResourceKind, Workspace } from "../types";

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
  /** The owner's own words or the worker's, spoken as written: no sample names to swap. */
  literal?: boolean;
}

export interface Reply {
  id: string;
  value: string;
  label: LocalizedText;
}

export type ReportItem =
  | { kind: "weather_heat_day"; id: string; question: LocalizedText }
  | { kind: "predefined"; id: string; question: LocalizedText; answerKind: PredefinedQuestion["answerKind"]; resource: ResourceKind | null; required?: boolean }
  | { kind: "custom"; id: string; question: LocalizedText; required?: boolean }
  | { kind: "task"; id: string; taskId: string; question: LocalizedText };

export interface ConversationData {
  queue?: ReportItem[];
  reportIndex?: number;
  currentQuestionId?: string;
  askedCamelIds?: string[];
  tempCamelId?: string;
  tempHealth?: HealthStatus;
  /** The NAQAH → worker report call this conversation belongs to (report_call only). */
  reportCallId?: string;
  /** Set when this session opened the run, so hanging up before the first answer can undo it. */
  startedReportCallId?: string;
  reportId?: string;
  instruction?: string;
  pendingInstructions?: PendingInstruction[];
  /** The owner run this summary call belongs to, so the call can report that it completed. */
  ownerRunId?: string;
  ownerAttempt?: number;
  /** The instruction whose time is being asked. Absent while the scripted path captures one at a time. */
  schedulingIndex?: number;
  /** The instruction being re-classified or said again. */
  correctingIndex?: number;
  actionable?: boolean;
  scheduledFor?: string | null;
  /** Riyadh calendar day (YYYY-MM-DD) chosen for a scheduled task. */
  scheduleDay?: string;
  pendingCallIds?: string[];
  startedVerificationCallIds?: string[];
  pendingIndex?: number;
  currentCallId?: string;
  /** The task a live verification call is asking about. */
  currentTaskId?: string;
  /** Open tasks this verification attempt asks about, in order. */
  verificationTaskIds?: string[];
  /** Tasks that got an explicit yes or no on this attempt. */
  answeredTaskIds?: string[];
  /** This turn recorded the attempt's result, so a later status callback cannot record it again. */
  attemptResolved?: boolean;
  /** Set once this telephone call confirmed delivery, so a later status callback cannot record it again. */
  deliveryCompleted?: boolean;
  inquiryTopics?: string[];
  callbackTaskIds?: string[];
  callbackTaskIndex?: number;
  /** Bumped by every correction, so a confirmation can only apply to the draft the worker heard. */
  draftRevision?: number;
  /** Re-asking one item from the summary: the next step goes back to the summary. */
  correcting?: boolean;
  /** How this report was taken. Absent on a call still choosing, which is read as guided. */
  reportMode?: "guided" | "open";
  /** Open mode: camel observations whose camel the worker hasn't named yet. */
  openClarify?: { status: HealthStatus; note: string | null }[];
  openNotes?: number;
  /** Guided mode: questions the worker already answered while answering an earlier one. They are not asked again. */
  answeredAhead?: string[];
  /** Guided mode: the herd answer said the rest are well, so once the unwell camel is named nothing more is asked. */
  restWell?: boolean;
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
  /** Open mode: what the worker reported, already checked against their words. */
  facts?: OpenFact[];
  /** What the owner asked for on a realtime call, already checked against their words. */
  instructions?: ProposedInstruction[];
  /** Realtime: the camel the worker already named while answering how the herd is. */
  camelId?: string;
  /** Realtime: every camel the worker named as needing attention in that answer. */
  camelIds?: string[];
  /** Realtime: the same answer said the rest are well («كلهم بخير بس نورة تعبانة»). */
  restWell?: boolean;
  /** Guided mode: later questions this answer already covered («الحلال بخير والعلف قليل»), checked against the worker's words. */
  heardAhead?: OpenFact[];
  /** Realtime: the owner removed this instruction, by its place in the list. */
  instructionRemove?: number;
  /** A change to one instruction under review, already checked against the owner's words. */
  instructionCorrection?: InstructionCorrection;
}

/** `due`: "any_time", an ISO instant, a YYYY-MM-DD day, or null when the owner gave no time. `evidence` is checked, then never stored. */
export interface ProposedInstruction {
  message: string;
  kind: "task" | "information";
  due: "any_time" | string | null;
  evidence: string;
}

export interface InstructionCorrection {
  index: number;
  kind?: "task" | "information";
  message?: string;
  due?: "any_time" | string | null;
}

export interface PendingInstruction {
  message: string;
  actionable: boolean;
  scheduledFor: string | null;
  /** Who said what kind this is. Read back, so the owner knows what they are verifying. */
  kindBy?: "owner" | "proposed";
  /** A task with no time yet: NAQAH asks when before the review. */
  needsSchedule?: boolean;
  /** The day the owner gave, when only the time is missing. */
  scheduleDay?: string;
}

/** One thing the worker said in open mode. `evidence` is their words; it is checked, then never stored. */
export type OpenFact =
  | { type: "camel_health"; camelId: string | null; scope: "one" | "all"; status: HealthStatus; note: string | null; evidence: string }
  | { type: "herd_count"; count: number; evidence: string }
  | { type: "resource"; resource: ResourceKind; level: Level | null; quantity: number | null; evidence: string }
  | { type: "custom"; questionId: string; answer: string; evidence: string }
  | { type: "other"; note: string; evidence: string };

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

export const copy = (en: string, ar: string): LocalizedText => ({ en, ar });

export const UNKNOWN_ANSWER = copy("I don’t know", "ما أدري");

export const HERD_COUNT_QUESTION = copy("How many camels are there today?", "كم الحلال عندكم اليوم؟");

export const REPORT_CALL_ATTEMPTS = REPORT_CALL_RETRIES + 1;

export const LEVELS: readonly Level[] = ["good", "medium", "low", "critical", "unknown"];

export const noDraft = (): ReportDraft => ({
  answers: [],
  camelUpdates: [],
  resourceUpdates: [],
  herdAccountedFor: null,
  taskConfirmations: [],
});

export const reply = (value: string, en: string, ar: string): Reply => ({
  id: value,
  value,
  label: copy(en, ar),
});

export function blank(scenario: Scenario, now: Date): CallSession {
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

export function turn(session: CallSession, speaker: Turn["speaker"], text: LocalizedText, now: Date, literal = false): CallSession {
  return { ...session, turns: [...session.turns, { speaker, text, at: now.toISOString(), ...(literal ? { literal } : {}) }] };
}

export function ask(
  session: CallSession,
  text: LocalizedText,
  now: Date,
  step: string,
  replies: Reply[] = [],
  inputMode: InputMode = "choices",
  literal = false,
): CallSession {
  return {
    ...turn(session, "agent", text, now, literal),
    step,
    replies,
    inputMode,
    done: false,
  };
}

/** A call-status line (ringing, retries). Shown in the Call Lab, never spoken on a real call. */
export function status(
  session: CallSession,
  text: LocalizedText,
  now: Date,
  step: string,
  replies: Reply[] = [],
  done = false,
): CallSession {
  return { ...turn(session, "system", text, now), step, replies, inputMode: replies.length ? "choices" : "none", done };
}

export function say(session: CallSession, text: LocalizedText, now: Date, done = false, literal = false): CallSession {
  return {
    ...turn(session, "agent", text, now, literal),
    replies: [],
    inputMode: "none",
    done,
  };
}

export function addNotice(session: CallSession, text: LocalizedText): CallSession {
  return { ...session, notices: [...session.notices, text] };
}

export function commitTo(next: Workspace): (ws: Workspace) => Workspace {
  return () => next;
}

export function selectedAnswer(session: CallSession, input: AnswerInput): { value: string; text: LocalizedText } {
  const value = input.value ?? input.text ?? "";
  const choice = session.replies.find((item) => item.value === value);
  if (choice) return { value, text: choice.label };
  const text = input.text ?? input.value ?? "";
  return { value, text: copy(text, text) };
}

export function workerTurn(session: CallSession, input: AnswerInput, now: Date): { session: CallSession; value: string } {
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

export const UNKNOWN_PHRASES = new Set(["ما ادري", "ماادري", "مدري", "ما اعرف", "لا اعرف", "i don't know", "i do not know", "i dont know"]);

export const NOTHING_TO_ADD = new Set(["لا", "لاء", "لا والله", "لا شكرا", "ما فيه", "مافيه", "ما في", "مافي", "ما فيه شي", "مافيه شي", "ما في شي", "مافي شي", "ما عندي شي", "بدون ملاحظه", "بدون ملاحظة", "no", "none", "nothing", "no note"]);

export function isUnknown(value: string, text = ""): boolean {
  return value === "unknown" || value === "dont_know" || UNKNOWN_PHRASES.has(plainWords(text || value));
}

/** «لا» to "any note?" means there is no note. It must not be saved as the note. */
export const addsNothing = (text: string) => NOTHING_TO_ADD.has(plainWords(text)) || isUnknown("", text);

export function atRiyadh(date: Date, locale: "ar" | "en", includeDate = false): string {
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB", {
    timeZone: "Asia/Riyadh",
    ...(includeDate ? { weekday: "short", day: "numeric", month: "short" } : { weekday: "short" }),
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

/** What the report queue and a callback may ask about: the rule lives in `confirmableTasks`. */
export function tasksToConfirm(ws: Workspace, now: Date) {
  return confirmableTasks(ws, now);
}

export function heatDayReportItem(ws: Workspace, now: Date): ReportItem | null {
  if (!ws.settings.farm.coords) return null;
  const forecast = weatherForToday(ws, now);
  if (!forecast || heatLevel(forecast.maxTempC) === "none") return null;
  const maxTemp = Math.round(forecast.maxTempC);
  return {
    kind: "weather_heat_day",
    id: "weather_heat_water",
    question: copy(
      `It's a hot day (${maxTemp}°). Do the camels have enough water and shade?`,
      `الجو حار اليوم (${maxTemp} درجة). الموية والظل كافيين للحلال؟`,
    ),
  };
}
