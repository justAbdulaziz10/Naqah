/**
 * Time helpers. All business rules run on Asia/Riyadh wall-clock time
 * (UTC+3, no daylight saving), regardless of the viewer's device time zone.
 */
import type { ReportingWindow, Weekday, Workspace } from "./types";

export const RIYADH_OFFSET_MS = 3 * 60 * 60 * 1000;
export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** Retry rule for AI → worker calls: wait 20 minutes, up to 3 retries. */
export const RETRY_DELAY_MS = 20 * MINUTE;
export const MAX_RETRIES = 3;

/** Current time as the workspace sees it (includes the demo clock offset). */
export function nowFor(ws: Pick<Workspace, "clockOffsetMs">, realNow = Date.now()): Date {
  return new Date(realNow + ws.clockOffsetMs);
}

export interface RiyadhParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  weekday: Weekday;
  hours: number;
  minutes: number;
}

export function riyadhParts(date: Date): RiyadhParts {
  const shifted = new Date(date.getTime() + RIYADH_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay() as Weekday,
    hours: shifted.getUTCHours(),
    minutes: shifted.getUTCMinutes(),
  };
}

/** Build a real Date from Riyadh wall-clock values. */
export function fromRiyadh(year: number, month: number, day: number, hours = 0, minutes = 0): Date {
  return new Date(Date.UTC(year, month - 1, day, hours, minutes) - RIYADH_OFFSET_MS);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" of the Riyadh calendar day. */
export function dayKey(date: Date): string {
  const p = riyadhParts(date);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Start of the Riyadh week (Sunday 00:00) as a real Date. */
export function weekStart(date: Date): Date {
  const p = riyadhParts(date);
  return fromRiyadh(p.year, p.month, p.day - p.weekday, 0, 0);
}

/** Stable key for the Sunday-start week containing `date`. */
export function weekKey(date: Date): string {
  return dayKey(weekStart(date));
}

export function sameWeek(a: Date | string, b: Date | string): boolean {
  return weekKey(new Date(a)) === weekKey(new Date(b));
}

export function sameDay(a: Date | string, b: Date | string): boolean {
  return dayKey(new Date(a)) === dayKey(new Date(b));
}

/** "HH:MM" → minutes after midnight. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function isValidWindow(w: ReportingWindow): boolean {
  return toMinutes(w.end) > toMinutes(w.start);
}

export function isWithinWindow(date: Date, w: ReportingWindow): boolean {
  const p = riyadhParts(date);
  if (p.weekday !== w.day) return false;
  const m = p.hours * 60 + p.minutes;
  return m >= toMinutes(w.start) && m < toMinutes(w.end);
}

/** Start of the next occurrence of the window (or the current one if we are inside it). */
export function nextWindowStart(date: Date, w: ReportingWindow): Date {
  const p = riyadhParts(date);
  const startMin = toMinutes(w.start);
  for (let add = 0; add <= 7; add++) {
    const weekday = ((p.weekday + add) % 7) as Weekday;
    if (weekday !== w.day) continue;
    const candidate = fromRiyadh(p.year, p.month, p.day + add, Math.floor(startMin / 60), startMin % 60);
    if (add === 0 && isWithinWindow(date, w)) return date;
    if (candidate.getTime() > date.getTime()) return candidate;
  }
  return fromRiyadh(p.year, p.month, p.day + 7, Math.floor(startMin / 60), startMin % 60);
}

/** Riyadh time of day, e.g. 17:05, used to pick a sensible demo "end of workday". */
export function atRiyadhTime(date: Date, hours: number, minutes = 0, addDays = 0): Date {
  const p = riyadhParts(date);
  return fromRiyadh(p.year, p.month, p.day + addDays, hours, minutes);
}
