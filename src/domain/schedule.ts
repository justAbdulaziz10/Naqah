/**
 * Scheduled report calls: NAQAH calls the worker, the worker does not call NAQAH.
 * Basic: one call a week (owner picks the day and time). Ultimate: one call every day (owner picks the time).
 * The cadence comes from the plan and is never stored. All times are Asia/Riyadh wall-clock.
 *
 * Owner-facing only for now: nothing here places a call. See docs/integrations/call-schedule.md.
 */
import { fromRiyadh, riyadhParts, toMinutes } from "./clock";
import type { CallSchedule, Plan, Weekday } from "./types";

export const CALL_SCHEDULE_TIME_ZONE = "Asia/Riyadh";

const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isCallTime(value: string): boolean {
  return CLOCK_TIME.test(value);
}

/** Basic needs a day and a time; Ultimate needs only the time. */
export function isCompleteCallSchedule(plan: Plan, schedule: CallSchedule | null | undefined): boolean {
  if (!schedule || !isCallTime(schedule.time)) return false;
  return plan === "ultimate" || schedule.day !== null;
}

/** The next scheduled call strictly after `now`, or null while the schedule is unfinished. */
export function nextScheduledCall(now: Date, plan: Plan, schedule: CallSchedule | null | undefined): Date | null {
  if (!schedule || !isCompleteCallSchedule(plan, schedule)) return null;
  const p = riyadhParts(now);
  const minutes = toMinutes(schedule.time);
  const at = (addDays: number) => fromRiyadh(p.year, p.month, p.day + addDays, Math.floor(minutes / 60), minutes % 60);
  for (let add = 0; add <= 7; add++) {
    const weekday = ((p.weekday + add) % 7) as Weekday;
    if (plan === "basic" && weekday !== schedule.day) continue;
    const candidate = at(add);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null; // Unreachable: day 7 always matches and is in the future.
}

/** The latest scheduled call at or before `now`, or null while the schedule is unfinished. */
export function previousScheduledCall(now: Date, plan: Plan, schedule: CallSchedule | null | undefined): Date | null {
  if (!schedule || !isCompleteCallSchedule(plan, schedule)) return null;
  const p = riyadhParts(now);
  const minutes = toMinutes(schedule.time);
  for (let back = 0; back <= 7; back++) {
    const weekday = (((p.weekday - back) % 7) + 7) % 7;
    if (plan === "basic" && weekday !== schedule.day) continue;
    const candidate = fromRiyadh(p.year, p.month, p.day - back, Math.floor(minutes / 60), minutes % 60);
    if (candidate.getTime() <= now.getTime()) return candidate;
  }
  return null; // Unreachable: day -7 always matches and is in the past.
}
