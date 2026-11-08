import { fromRiyadh, riyadhParts } from "@/domain/clock";
import { calendar } from "@/i18n/messages/integrations/calendar";
import type { CalendarSchedule } from "./schedule";

const DAY_CODES = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
const RECURRENCE_SUNDAY = { year: 2000, month: 1, day: 2 };

function utf8Length(character: string): number {
  const codePoint = character.codePointAt(0) ?? 0;
  if (codePoint <= 0x7f) return 1;
  if (codePoint <= 0x7ff) return 2;
  if (codePoint <= 0xffff) return 3;
  return 4;
}

function pad(value: number, size = 2): string {
  return String(value).padStart(size, "0");
}

function utcDateTime(date: Date): string {
  if (!Number.isFinite(date.getTime())) throw new RangeError("Invalid calendar date");
  return (
    pad(date.getUTCFullYear(), 4) +
    pad(date.getUTCMonth() + 1) +
    pad(date.getUTCDate()) +
    "T" +
    pad(date.getUTCHours()) +
    pad(date.getUTCMinutes()) +
    pad(date.getUTCSeconds()) +
    "Z"
  );
}

function localDateTime(date: Date): string {
  const parts = riyadhParts(date);
  return (
    pad(parts.year, 4) +
    pad(parts.month) +
    pad(parts.day) +
    "T" +
    pad(parts.hours) +
    pad(parts.minutes) +
    "00"
  );
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold by UTF-8 octets and never split a Unicode code point. */
function foldLine(value: string): string {
  const parts: string[] = [];
  let segment = "";
  let byteCount = 0;
  let capacity = 75;

  for (const character of value) {
    const characterBytes = utf8Length(character);
    if (byteCount + characterBytes > capacity) {
      parts.push(segment);
      segment = character;
      byteCount = characterBytes;
      capacity = 74;
    } else {
      segment += character;
      byteCount += characterBytes;
    }
  }
  parts.push(segment);
  return parts.join("\r\n ");
}

function reportStart(schedule: CalendarSchedule): Date | null {
  if (schedule.p === "basic") {
    if (!schedule.w) return null;
    const [hour, minute] = schedule.w.start.split(":").map(Number);
    return fromRiyadh(
      RECURRENCE_SUNDAY.year,
      RECURRENCE_SUNDAY.month,
      RECURRENCE_SUNDAY.day + schedule.w.day,
      hour,
      minute,
    );
  }

  // Daily: the chosen call time (older links carry none and keep 17:00).
  const [hour, minute] = (schedule.w?.start ?? "17:00").split(":").map(Number);
  return fromRiyadh(
    RECURRENCE_SUNDAY.year,
    RECURRENCE_SUNDAY.month,
    RECURRENCE_SUNDAY.day,
    hour,
    minute,
  );
}

function reportEvent(schedule: CalendarSchedule, now: Date): string[] {
  const start = reportStart(schedule);
  if (!start) return [];
  const parts = riyadhParts(start);
  const weekly = schedule.p === "basic";
  const endText = schedule.w?.end ?? "17:30";
  const [endHour, endMinute] = endText.split(":").map(Number);
  const end = fromRiyadh(parts.year, parts.month, parts.day, endHour, endMinute);
  const text = calendar[schedule.l];
  const title = text.reportTitle;
  const reminder = text.reportReminder;
  const farmDetails = text.farmDetails(schedule.f);
  const uid = weekly ? "report-weekly@naqah.app" : "report-daily@naqah.app";

  return [
    "BEGIN:VEVENT",
    "UID:" + uid,
    "DTSTAMP:" + utcDateTime(now),
    "DTSTART;TZID=Asia/Riyadh:" + localDateTime(start),
    "DTEND;TZID=Asia/Riyadh:" + localDateTime(end),
    weekly ? "RRULE:FREQ=WEEKLY;BYDAY=" + DAY_CODES[schedule.w!.day] : "RRULE:FREQ=DAILY",
    "SUMMARY:" + escapeText(title),
    "DESCRIPTION:" + escapeText(farmDetails),
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    "TRIGGER:-PT15M",
    "DESCRIPTION:" + escapeText(reminder),
    "END:VALARM",
    "END:VEVENT",
  ];
}

function taskEvent(task: CalendarSchedule["t"][number], schedule: CalendarSchedule, now: Date): string[] {
  const start = new Date(task.at);
  if (!Number.isFinite(start.getTime())) return [];
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return [
    "BEGIN:VEVENT",
    "UID:" + escapeText(task.id) + "@naqah.app",
    "DTSTAMP:" + utcDateTime(now),
    "DTSTART:" + utcDateTime(start),
    "DTEND:" + utcDateTime(end),
    "SUMMARY:" + escapeText(task.title),
    "DESCRIPTION:" + escapeText(calendar[schedule.l].taskDetails(schedule.f)),
    "END:VEVENT",
  ];
}

function renderIcs(schedule: CalendarSchedule, now: Date, includeReport: boolean): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//NAQAH//Farm Calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:" + escapeText(schedule.f),
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
    "BEGIN:VTIMEZONE",
    "TZID:Asia/Riyadh",
    "X-LIC-LOCATION:Asia/Riyadh",
    "BEGIN:STANDARD",
    "DTSTART:19700101T000000",
    "TZOFFSETFROM:+0300",
    "TZOFFSETTO:+0300",
    "TZNAME:+03",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...(includeReport ? reportEvent(schedule, now) : []),
    ...schedule.t.flatMap((task) => taskEvent(task, schedule, now)),
    "END:VCALENDAR",
  ];

  return lines.map(foldLine).join("\r\n") + "\r\n";
}

/** Generate a publishable RFC 5545 feed. Report slots use Riyadh time and tickets use UTC. */
export function generateIcs(schedule: CalendarSchedule, now = new Date()): string {
  return renderIcs(schedule, now, true);
}

/** Generate a standalone ticket calendar without the recurring farm report event. */
export function generateTaskIcs(schedule: CalendarSchedule, now = new Date()): string {
  return renderIcs(schedule, now, false);
}
