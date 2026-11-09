import { recordOwnerNotification, submitOwnerInstructionBatch } from "../actions";
import { dayKey, fromRiyadh, riyadhParts } from "../clock";
import { ownerBriefing } from "../findings";
import { taskTicketsEnabled } from "../rules";
import type { LocalizedText, Workspace } from "../types";

import { addsNothing, atRiyadh, copy, reply, blank, ask, say, commitTo, workerTurn } from './shared';
import type { CallSession, EngineResult, AnswerInput, InstructionCorrection, PendingInstruction, ProposedInstruction } from './shared';

const INSTRUCTION_QUESTION = copy("Do you have any instructions for the worker?", "هل عندك أي تعليمات تبي أقولها للعامل؟");
const instructionReplies = () => [reply("instruction_yes", "Yes, I do", "إيه"), reply("instruction_no", "No, thanks", "لا، شكراً")];
const REVIEW_STEP = "instruction_review";
/** One call to the worker has to stay something a person can take in, and fit in one saved message. */
export const MAX_INSTRUCTIONS = 10;
const scheduleReplies = () => [
  reply("any_time", "Any time", "في أي وقت"),
  reply("later_today", "Later today", "اليوم لاحقاً"),
  reply("tomorrow", "Tomorrow", "بكرة"),
  reply("future_date", "Another date", "تاريخ ثاني"),
];

/**
 * The real outbound owner call. The owner already answered, so there is no "would you like to answer" step.
 * Basic hears the findings and the call ends. Ultimate is asked for instructions and nothing is saved before confirmation.
 * The status callback records the notification; this start does not.
 */
export function startLiveOwnerBriefing(
  ws: Workspace,
  now: Date,
  reportId: string | null,
  run?: { runId: string; attempt: number },
  summary?: LocalizedText,
): EngineResult {
  const report = reportId ? ws.reports.find((item) => item.id === reportId) : undefined;
  const briefing = summary ?? ownerBriefing(report?.findings ?? []);
  const session = {
    ...blank("owner_notification", now),
    data: { ...(reportId ? { reportId } : {}), ...(run ? { ownerRunId: run.runId, ownerAttempt: run.attempt } : {}) },
  };
  const told = say(session, briefing, now);
  if (!taskTicketsEnabled(ws)) {
    return { session: say(told, copy("That's the update. Thank you.", "هذا التحديث. شكراً لك."), now, true) };
  }
  return { session: ask(told, INSTRUCTION_QUESTION, now, "instruction_yesno", instructionReplies()) };
}

export function startOwnerNotification(ws: Workspace, now: Date, requestedReportId?: string): EngineResult {
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

export function handleOwnerNotification(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
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
    const told = say(current.session, briefing, now);
    if (!taskTicketsEnabled(ws)) {
      return {
        session: say(told, copy("That's the update. Thank you.", "هذا التحديث. شكراً لك."), now, true),
        commit: commitTo(updated),
      };
    }
    return {
      session: ask(told, INSTRUCTION_QUESTION, now, "instruction_yesno", instructionReplies()),
      commit: commitTo(updated),
    };
  }
  // Stopping partway counts as an answer: nothing is kept, and the owner isn't called again about it.
  if (current.value === "instructions_cancel" && session.step.startsWith("instruction_")) {
    return session.step === "instruction_yesno" ? declined(current.session, now) : notSaved(current.session, now);
  }
  if (session.step === "instruction_yesno") {
    if (input.instructions?.length) return acceptProposals(current.session, now, input.instructions);
    if (current.value === "instruction_no") return declined(current.session, now);
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
    if (input.instructions?.length) return acceptProposals(current.session, now, input.instructions);
    const instruction = (input.text ?? current.value).trim();
    const editing = current.session.data.correctingIndex;
    // «لا» to "what would you like to say" means nothing, and must not become the instruction.
    if (current.value === "instruction_no" || (instruction && addsNothing(instruction))) {
      return current.session.data.pendingInstructions?.length ? continueInstructions(current.session, now) : declined(current.session, now);
    }
    if (instruction && editing !== undefined) return applyEdit(current.session, now, editing, { message: instruction });
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
        kindReplies(),
      ),
    };
  }
  if (session.step === "instruction_kind") {
    const actionable = current.value === "actionable";
    const editing = current.session.data.correctingIndex;
    // Marked as a task on the phone: its time is asked again, since this is the only way to change it there.
    if (editing !== undefined) return applyEdit(current.session, now, editing, { actionable, kindBy: "owner" }, actionable);
    const next = { ...current.session, data: { ...current.session.data, actionable } };
    if (actionable && taskTicketsEnabled(ws)) {
      return {
        session: ask(next, copy("When should it be done?", "متى ودك تنفذ المهمة؟"), now, "instruction_schedule", scheduleReplies()),
      };
    }
    return rememberInstruction(next, now, actionable, null);
  }
  if (session.step === "instruction_schedule") {
    if (input.instructionCorrection) return applyCorrection(current.session, now, input.instructionCorrection);
    if (current.value === "any_time") return scheduled(current.session, now, null);
    if (current.value === "future_date") {
      return {
        session: ask(
          current.session,
          copy(
            "Enter a future date as YYYY-MM-DD, or a number of days from now. Example: 2026-11-15, or 10 days from now.",
            "أدخل تاريخاً قادماً بصيغة YYYY-MM-DD، أو عدد الأيام من اليوم. مثال: 2026-11-15، أو بعد 10 أيام.",
          ),
          now,
          "instruction_date",
          [reply("any_time", "Any time", "في أي وقت")],
          "text",
        ),
      };
    }
    const addDays = current.value === "tomorrow" ? 1 : 0;
    const day = scheduleDayFrom(now, addDays);
    return { session: askScheduleTime({ ...current.session, data: { ...current.session.data, scheduleDay: day } }, now) };
  }
  if (session.step === "instruction_date") {
    if (input.instructionCorrection) return applyCorrection(current.session, now, input.instructionCorrection);
    if (current.value === "any_time") return scheduled(current.session, now, null);
    const parsed = parseScheduleInput(input.text ?? current.value, now);
    if (!parsed.ok) {
      const text = parsed.reason === "past"
        ? copy("That date has already passed. Choose a later date.", "هذا التاريخ فات. اختر تاريخاً لاحقاً.")
        : copy("That date is not clear. Use YYYY-MM-DD, such as 2026-11-15.", "التاريخ غير واضح. استخدم الصيغة YYYY-MM-DD، مثل 2026-11-15.");
      return {
        session: ask(current.session, text, now, "instruction_date", [reply("any_time", "Any time", "في أي وقت")], "text"),
      };
    }
    const dated = { ...current.session, data: { ...current.session.data, scheduleDay: parsed.day } };
    if (!parsed.time) return { session: askScheduleTime(dated, now) };
    return scheduled(dated, now, fromRiyadh(parsed.year, parsed.month, parsed.date, parsed.time.hours, parsed.time.minutes).toISOString());
  }
  if (session.step === "instruction_time") {
    if (input.instructionCorrection) return applyCorrection(current.session, now, input.instructionCorrection);
    if (current.value === "any_time") return scheduled(current.session, now, null);
    const value = (input.text ?? current.value).trim();
    const parts = value.split(":").map(Number);
    const valid = parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && parts[0] >= 0 && parts[0] <= 23 && parts[1] >= 0 && parts[1] <= 59;
    if (!valid) return { session: askScheduleTime(current.session, now, copy("Enter a valid time such as 18:30.", "أدخل وقتاً صحيحاً مثل 18:30.")) };
    const instant = scheduledInstant(current.session, now, parts[0], parts[1]);
    if (!instant || instant.getTime() < now.getTime()) {
      const today = (current.session.data.scheduleDay ?? dayKey(now)) === dayKey(now);
      const text = today
        ? copy("Choose a later time today.", "اختر وقتاً لاحقاً اليوم.")
        : copy("That time has already passed. Choose a later time.", "هذا الوقت فات. اختر وقتاً لاحقاً.");
      return { session: askScheduleTime(current.session, now, text) };
    }
    return scheduled(current.session, now, instant.toISOString());
  }
  if (session.step === "instruction_more") {
    if (current.value === "instruction_yes") {
      return {
        session: ask(current.session, copy("What else should the worker know or do?", "وش كمان تبي أقول للعامل أو أطلب منه؟"), now, "instruction_text", [], "text"),
      };
    }
    return continueInstructions(current.session, now);
  }
  if (session.step === REVIEW_STEP) {
    if (input.instructionCorrection) return applyCorrection(current.session, now, input.instructionCorrection);
    if (current.value === "instructions_confirm") return confirmInstructions(current.session, ws, now);
    if (current.value === "instructions_correct") return startCorrection(current.session, now);
    return { session: askReview(current.session, now) };
  }
  if (session.step === "instruction_correct_pick") {
    if (input.instructionCorrection) return applyCorrection(current.session, now, input.instructionCorrection);
    if (current.value === "back_to_review") return { session: askReview(current.session, now) };
    const index = pickedIndex(current.value, current.session);
    return index === null ? startCorrection(current.session, now) : { session: askCorrectWhat(current.session, now, index) };
  }
  if (session.step === "instruction_correct_what") {
    if (input.instructionCorrection) return applyCorrection(current.session, now, input.instructionCorrection);
    if (current.value === "back_to_review") return { session: askReview(current.session, now) };
    if (current.value === "correct_text") {
      return { session: ask(current.session, copy("Say it again the way you want it.", "قلها مرة ثانية مثل ما تبيها."), now, "instruction_text", [], "text") };
    }
    if (current.value === "correct_kind") {
      return {
        session: ask(current.session, copy("Should the worker do something, or is this information only?", "هل المطلوب من العامل يسوي شيء، أو هي معلومة فقط؟"), now, "instruction_kind", kindReplies()),
      };
    }
    return { session: askCorrectWhat(current.session, now, current.session.data.correctingIndex ?? 0) };
  }
  return { session: current.session };
}

const kindReplies = () => [reply("actionable", "A task for Ahmed", "مهمة لأحمد"), reply("information", "Information only", "معلومة فقط")];

function declined(session: CallSession, now: Date): EngineResult {
  return { session: say(session, copy("Thank you. The update is ready on the website.", "شكراً لك. التحديث موجود في الموقع."), now, true) };
}

function notSaved(session: CallSession, now: Date): EngineResult {
  return { session: say(session, copy("Nothing was saved.", "ما انحفظ شيء."), now, true) };
}

type Due = { kind: "any_time" } | { kind: "at"; iso: string } | { kind: "day"; day: string };

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/;
const DAY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_AHEAD_MS = 366 * 24 * 60 * 60 * 1000;

/** A due the model proposed, or null when it can't be used: no time given, unparseable, in the past, or absurdly far off. */
export function readDue(due: unknown, now: Date): Due | null {
  if (due === "any_time") return { kind: "any_time" };
  if (typeof due !== "string") return null;
  if (INSTANT.test(due)) {
    const at = new Date(due);
    if (Number.isNaN(at.getTime()) || at.getTime() < now.getTime() || at.getTime() - now.getTime() > MAX_AHEAD_MS) return null;
    return { kind: "at", iso: at.toISOString() };
  }
  const parts = DAY.exec(due);
  if (!parts) return null;
  const day = calendarDay(Number(parts[1]), Number(parts[2]), Number(parts[3]));
  if (!day || due < dayKey(now) || fromRiyadh(day.year, day.month, day.date).getTime() - now.getTime() > MAX_AHEAD_MS) return null;
  return { kind: "day", day: due };
}

function dueFields(due: unknown, now: Date): Pick<PendingInstruction, "scheduledFor" | "needsSchedule" | "scheduleDay"> {
  const read = readDue(due, now);
  if (read?.kind === "any_time") return { scheduledFor: null, needsSchedule: false, scheduleDay: undefined };
  if (read?.kind === "at") return { scheduledFor: read.iso, needsSchedule: false, scheduleDay: undefined };
  return { scheduledFor: null, needsSchedule: true, scheduleDay: read?.kind === "day" ? read.day : undefined };
}

/** The model's proposals become a draft the owner still has to verify. Its evidence stays behind. */
function acceptProposals(session: CallSession, now: Date, proposals: ProposedInstruction[]): EngineResult {
  const added = proposals.map((item): PendingInstruction => item.kind === "information"
    ? { message: item.message.trim(), actionable: false, scheduledFor: null, kindBy: "proposed" }
    : { message: item.message.trim(), actionable: true, kindBy: "proposed", ...dueFields(item.due, now) });
  return continueInstructions({ ...session, data: { ...session.data, pendingInstructions: [...(session.data.pendingInstructions ?? []), ...added] } }, now);
}

/** Asks for the next missing time, or reads the whole list back. */
function continueInstructions(session: CallSession, now: Date): EngineResult {
  const items = session.data.pendingInstructions ?? [];
  const index = items.findIndex((item) => item.needsSchedule);
  if (index === -1) return { session: askReview({ ...session, data: { ...session.data, schedulingIndex: undefined, scheduleDay: undefined, correctingIndex: undefined } }, now) };
  const item = items[index];
  const next = { ...session, data: { ...session.data, schedulingIndex: index, scheduleDay: item.scheduleDay, correctingIndex: undefined } };
  if (item.scheduleDay) {
    return { session: askScheduleTime(next, now, copy(`What time on ${item.scheduleDay} for: ${item.message}?`, `أي ساعة بتاريخ ${item.scheduleDay} لهذي المهمة: ${item.message}؟`), true) };
  }
  return { session: ask(next, copy(`When should this be done: ${item.message}?`, `متى ودك تنفذ هذي المهمة: ${item.message}؟`), now, "instruction_schedule", scheduleReplies(), "choices", true) };
}

/** A time was chosen: for the one being asked about, or for the scripted capture still in progress. */
function scheduled(session: CallSession, now: Date, scheduledFor: string | null): EngineResult {
  const index = session.data.schedulingIndex;
  if (index === undefined) return rememberInstruction(session, now, true, scheduledFor);
  const items = (session.data.pendingInstructions ?? []).map((item, at) => at === index ? { ...item, scheduledFor, needsSchedule: false, scheduleDay: undefined } : item);
  return continueInstructions({ ...session, data: { ...session.data, pendingInstructions: items, scheduleDay: undefined, schedulingIndex: undefined } }, now);
}

function reviewLine(item: PendingInstruction, number: number): LocalizedText {
  const chosen = item.kindBy === "owner";
  if (!item.actionable) {
    return copy(
      `${number}. ${chosen ? "You marked this as" : "I took this as"} information only: ${item.message}`,
      `${number}. ${chosen ? "حددتها" : "فهمتها"} معلومة فقط: ${item.message}`,
    );
  }
  const at = item.scheduledFor ? new Date(item.scheduledFor) : null;
  return copy(
    `${number}. ${chosen ? "You marked this as" : "I took this as"} a task, ${at ? `for ${atRiyadh(at, "en", true)}` : "any time"}: ${item.message}`,
    `${number}. ${chosen ? "حددتها" : "فهمتها"} مهمة، ${at ? `موعدها ${atRiyadh(at, "ar", true)}` : "في أي وقت"}: ${item.message}`,
  );
}

/** The whole list, every time: what the owner verifies is exactly what would be saved. */
function askReview(session: CallSession, now: Date): CallSession {
  const lines = (session.data.pendingInstructions ?? []).map((item, index) => reviewLine(item, index + 1));
  return ask(
    session,
    copy(
      `I'll tell the worker:\n${lines.map((line) => line.en).join("\n")}\nShall I save these, change one, or cancel?`,
      `بقول للعامل:\n${lines.map((line) => line.ar).join("\n")}\nأحفظها، ولا تبي تعدل وحدة، ولا ألغيها؟`,
    ),
    now,
    REVIEW_STEP,
    [reply("instructions_confirm", "Yes, save them", "إيه، احفظها"), reply("instructions_correct", "Change one", "عدل وحدة"), reply("instructions_cancel", "Cancel", "ألغها")],
    "choices",
    true,
  );
}

function startCorrection(session: CallSession, now: Date): EngineResult {
  const items = session.data.pendingInstructions ?? [];
  if (items.length <= 1) return { session: askCorrectWhat(session, now, 0) };
  return {
    session: ask(
      session,
      copy("Which one should change?", "أي وحدة تبي تعدلها؟"),
      now,
      "instruction_correct_pick",
      [...items.map((item, index) => reply(`correct:${index}`, `${index + 1}. ${item.message}`, `${index + 1}. ${item.message}`)), reply("back_to_review", "Back to the list", "ارجع للقائمة")],
      "choices",
      true,
    ),
  };
}

function pickedIndex(value: string, session: CallSession): number | null {
  const match = /^correct:(\d+)$/.exec(value);
  const index = match ? Number(match[1]) : -1;
  return index >= 0 && index < (session.data.pendingInstructions ?? []).length ? index : null;
}

function askCorrectWhat(session: CallSession, now: Date, index: number): CallSession {
  const item = session.data.pendingInstructions?.[index];
  return ask(
    { ...session, data: { ...session.data, correctingIndex: index } },
    copy(`What should change: ${item?.message ?? ""}?`, `وش تبي تغير في هذي: ${item?.message ?? ""}؟`),
    now,
    "instruction_correct_what",
    [reply("correct_text", "Say it again", "أقولها من جديد"), reply("correct_kind", "Task, information or time", "مهمة أو معلومة أو الوقت"), reply("back_to_review", "Back to the list", "ارجع للقائمة")],
    "choices",
    true,
  );
}

/** Changes one instruction. Every change starts a new revision, so a yes can't apply to a list nobody heard. */
function applyEdit(session: CallSession, now: Date, index: number, changes: Partial<PendingInstruction>, askTime = false): EngineResult {
  const items = (session.data.pendingInstructions ?? []).map((item, at) => {
    if (at !== index) return item;
    const edited = { ...item, ...changes };
    if (!edited.actionable) return { ...edited, scheduledFor: null, needsSchedule: false, scheduleDay: undefined };
    return askTime ? { ...edited, scheduledFor: null, needsSchedule: true, scheduleDay: undefined } : edited;
  });
  return continueInstructions({
    ...session,
    data: { ...session.data, pendingInstructions: items, correctingIndex: undefined, draftRevision: (session.data.draftRevision ?? 0) + 1 },
  }, now);
}

/** A realtime correction. Bare index: the owner hasn't said what should change, so ask. */
function applyCorrection(session: CallSession, now: Date, correction: InstructionCorrection): EngineResult {
  const { index, kind, message, due } = correction;
  const item = session.data.pendingInstructions?.[index];
  if (!item) return continueInstructions(session, now);
  if (kind === undefined && message === undefined && due === undefined) return { session: askCorrectWhat(session, now, index) };
  const actionable = kind === undefined ? item.actionable : kind === "task";
  const becameTask = actionable && !item.actionable;
  return applyEdit(session, now, index, {
    actionable,
    ...(kind ? { kindBy: "proposed" as const } : {}),
    ...(message !== undefined ? { message: message.trim() } : {}),
    ...(actionable && due !== undefined ? dueFields(due, now) : {}),
    ...(becameTask && due === undefined ? { needsSchedule: true, scheduledFor: null } : {}),
  });
}

function scheduleDayFrom(now: Date, addDays: number): string {
  const p = riyadhParts(now);
  return dayKey(fromRiyadh(p.year, p.month, p.day + addDays));
}

function scheduledInstant(session: CallSession, now: Date, hours: number, minutes: number): Date | null {
  const day = session.data.scheduleDay ?? dayKey(now);
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  return fromRiyadh(year, month, date, hours, minutes);
}

function askScheduleTime(session: CallSession, now: Date, prompt?: LocalizedText, literal = false): CallSession {
  const day = session.data.scheduleDay ?? dayKey(now);
  return ask(
    session,
    prompt ?? copy(
      "Choose a Riyadh time for " + day + ", for example 18:30.",
      "حدد الوقت بتوقيت الرياض لتاريخ " + day + "، مثل 18:30.",
    ),
    now,
    "instruction_time",
    [reply("any_time", "Any time", "في أي وقت")],
    "time",
    literal,
  );
}

type ParsedSchedule =
  | { ok: true; day: string; year: number; month: number; date: number; time?: { hours: number; minutes: number } }
  | { ok: false; reason: "past" | "ambiguous" };

function clockParts(hours: string, minutes: string): { hours: number; minutes: number } | null {
  const h = Number(hours);
  const m = Number(minutes);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return { hours: h, minutes: m };
}

function calendarDay(year: number, month: number, date: number): { year: number; month: number; date: number } | null {
  if (month < 1 || month > 12 || date < 1 || date > 31) return null;
  const parts = riyadhParts(fromRiyadh(year, month, date));
  if (parts.year !== year || parts.month !== month || parts.day !== date) return null;
  return { year, month, date };
}

/** Accept a year-first date, or a clear day count. Slash dates stay ambiguous. */
function parseScheduleInput(text: string, now: Date): ParsedSchedule {
  const value = text.trim().replace(/\s+/g, " ");
  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{1,2}):(\d{2}))?$/);
  const relative = value.match(/^(?:in\s+)?(\d+)\s+days?\s+from\s+now(?:\s+at\s+(\d{1,2}):(\d{2}))?$/i)
    ?? value.match(/^in\s+(\d+)\s+days?(?:\s+at\s+(\d{1,2}):(\d{2}))?$/i);
  const arabic = value.match(/^بعد\s+(\d+)\s+(?:يوم|أيام|يوماً?)(?:\s+الساعة\s+(\d{1,2}):(\d{2}))?$/);
  let day: { year: number; month: number; date: number } | null = null;
  let time: { hours: number; minutes: number } | undefined;
  if (iso) {
    day = calendarDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    if (!day) return { ok: false, reason: "ambiguous" };
    if (iso[4]) {
      const parsed = clockParts(iso[4], iso[5]);
      if (!parsed) return { ok: false, reason: "ambiguous" };
      time = parsed;
    }
  } else if (relative || arabic) {
    const match = (relative ?? arabic)!;
    const add = Number(match[1]);
    if (!Number.isInteger(add) || add < 0 || add > 366) return { ok: false, reason: "ambiguous" };
    const parts = riyadhParts(fromRiyadh(riyadhParts(now).year, riyadhParts(now).month, riyadhParts(now).day + add));
    day = { year: parts.year, month: parts.month, date: parts.day };
    if (match[2]) {
      const parsed = clockParts(match[2], match[3]);
      if (!parsed) return { ok: false, reason: "ambiguous" };
      time = parsed;
    }
  } else {
    return { ok: false, reason: "ambiguous" };
  }
  const stamp = dayKey(fromRiyadh(day.year, day.month, day.date));
  if (stamp < dayKey(now)) return { ok: false, reason: "past" };
  if (time && fromRiyadh(day.year, day.month, day.date, time.hours, time.minutes).getTime() < now.getTime()) {
    return { ok: false, reason: "past" };
  }
  return { ok: true, day: stamp, year: day.year, month: day.month, date: day.date, ...(time ? { time } : {}) };
}

function rememberInstruction(
  session: CallSession,
  now: Date,
  actionable: boolean,
  scheduledFor: string | null,
): EngineResult {
  const message = session.data.instruction ?? "";
  const pendingInstructions = [...(session.data.pendingInstructions ?? []), { message, actionable, scheduledFor, kindBy: "owner" as const }];
  const next = { ...session, data: { ...session.data, pendingInstructions, instruction: undefined, actionable, scheduledFor } };
  if (pendingInstructions.length >= MAX_INSTRUCTIONS) return continueInstructions(next, now);
  return {
    session: ask(
      next,
      copy("Any other instruction?", "فيه تعليمات ثانية؟"),
      now,
      "instruction_more",
      [reply("instruction_yes", "Yes", "إيه"), reply("instruction_no", "No, that's all", "لا، خلاص")],
    ),
  };
}

/** The batch and its event share this id: one owner run saves one batch, however many times it is retried. */
export function instructionBatchId(session: CallSession, fallback = "call"): string {
  return `owner-instructions:${session.data.ownerRunId ?? session.data.reportId ?? fallback}`;
}

function confirmInstructions(session: CallSession, ws: Workspace, now: Date): EngineResult {
  const items = (session.data.pendingInstructions ?? []).map(({ message, actionable, scheduledFor }) => ({ message, actionable, scheduledFor }));
  if (!taskTicketsEnabled(ws) || !items.length) return notSaved(session, now);
  const saved = submitOwnerInstructionBatch(ws, now, items, instructionBatchId(session), items.map((item) => item.message).join("\n"));
  if (!saved.created) {
    return { session: say(session, copy("These instructions were saved earlier on this call, so nothing changed.", "هذي التعليمات انحفظت قبل، وما تغير شيء."), now, true) };
  }
  const tasks = saved.taskIds.length;
  const text = copy(
    `Saved. ${tasks} task ticket${tasks === 1 ? "" : "s"}, one call for the worker. The call has not started.`,
    `انحفظ. ${tasks} تذكرة مهمة، ومكالمة واحدة للعامل. المكالمة لم تبدأ.`,
  );
  return { session: say(session, text, now, true), commit: commitTo(saved.ws) };
}
