import { recordOwnerNotification, submitOwnerInstruction } from "../actions";
import { dayKey, fromRiyadh, riyadhParts } from "../clock";
import { ownerBriefing } from "../findings";
import { taskTicketsEnabled } from "../rules";
import type { LocalizedText, Workspace } from "../types";

import { copy, reply, blank, ask, say, addNotice, commitTo, workerTurn } from './shared';
import type { CallSession, EngineResult, AnswerInput } from './shared';

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
          [
            reply("any_time", "Any time", "في أي وقت"),
            reply("later_today", "Later today", "اليوم لاحقاً"),
            reply("tomorrow", "Tomorrow", "بكرة"),
            reply("future_date", "Another date", "تاريخ ثاني"),
          ],
        ),
      };
    }
    return submitInstruction(next, ws, now, actionable, null);
  }
  if (session.step === "instruction_schedule") {
    if (current.value === "any_time") return submitInstruction(current.session, ws, now, true, null);
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
    if (current.value === "any_time") return submitInstruction(current.session, ws, now, true, null);
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
    return submitInstruction(dated, ws, now, true, fromRiyadh(parsed.year, parsed.month, parsed.date, parsed.time.hours, parsed.time.minutes).toISOString());
  }
  if (session.step === "instruction_time") {
    if (current.value === "any_time") return submitInstruction(current.session, ws, now, true, null);
    const value = (input.text ?? current.value).trim();
    const parts = value.split(":").map(Number);
    const valid = parts.length === 2 && Number.isInteger(parts[0]) && Number.isInteger(parts[1]) && parts[0] >= 0 && parts[0] <= 23 && parts[1] >= 0 && parts[1] <= 59;
    if (!valid) return { session: askScheduleTime(current.session, now, copy("Enter a valid time such as 18:30.", "أدخل وقتاً صحيحاً مثل 18:30.")) };
    const scheduled = scheduledInstant(current.session, now, parts[0], parts[1]);
    if (!scheduled || scheduled.getTime() < now.getTime()) {
      const today = (current.session.data.scheduleDay ?? dayKey(now)) === dayKey(now);
      const text = today
        ? copy("Choose a later time today.", "اختر وقتاً لاحقاً اليوم.")
        : copy("That time has already passed. Choose a later time.", "هذا الوقت فات. اختر وقتاً لاحقاً.");
      return { session: askScheduleTime(current.session, now, text) };
    }
    return submitInstruction(current.session, ws, now, true, scheduled.toISOString());
  }
  return { session: current.session };
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

function askScheduleTime(session: CallSession, now: Date, prompt?: LocalizedText): CallSession {
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
    next = addNotice(next, copy("A Task Ticket is open and waiting for Ahmed.", "فُتحت تذكرة مهمة وبانتظار أحمد."));
    next = say(
      next,
      copy("The task is open. The instruction is queued for Ahmed. The call has not started.", "المهمة مفتوحة. التعليمات جاهزة لأحمد، والمكالمة لم تبدأ."),
      now,
      true,
    );
  } else {
    next = say(
      next,
      copy("Your message is queued for Ahmed. The call has not started.", "رسالتك جاهزة لأحمد. المكالمة لم تبدأ."),
      now,
      true,
    );
  }
  return { session: next, commit: commitTo(created.ws) };
}
