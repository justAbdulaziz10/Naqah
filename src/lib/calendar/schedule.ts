import { isValidWindow, toMinutes } from "@/domain/clock";
import { isCompleteCallSchedule } from "@/domain/schedule";
import type { Locale, Plan, ReportingWindow, TaskTicket, Workspace } from "@/domain/types";

export interface CalendarTask {
  id: string;
  title: string;
  at: string;
}

/** Compact, versioned snapshot included in the public subscription URL. */
export interface CalendarSchedule {
  v: 1;
  l: Locale;
  f: string;
  p: Plan;
  /** The report call slot: `start` is the call time, `end` 30 minutes later. Ultimate ignores `day`. */
  w: ReportingWindow | null;
  t: CalendarTask[];
}

export const MAX_SCHEDULE_BYTES = 3 * 1024;
export const MAX_SCHEDULE_TASKS = 50;
const MAX_ENCODED_LENGTH = Math.ceil((MAX_SCHEDULE_BYTES * 4) / 3);
const MAX_FARM_NAME_LENGTH = 160;
const MAX_TASK_ID_LENGTH = 100;
const MAX_TASK_TITLE_LENGTH = 160;
const MAX_DATE_LENGTH = 35;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

function truncate(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  let result = "";
  for (const character of value) {
    if (result.length + character.length > maximum) break;
    result += character;
  }
  return result;
}

function boundedText(value: unknown, maximum: number, allowNewlines = false): string {
  const text = truncate(value, maximum);
  const controls = allowNewlines
    ? /[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/g
    : /[\u0000-\u001f\u007f]/g;
  return text.replace(controls, "");
}

function validText(value: unknown, maximum: number, allowNewlines = false): value is string {
  const invalidCharacters = allowNewlines
    ? /[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/
    : /[\u0000-\u001f\u007f]/;
  return (
    typeof value === "string" &&
    value.length <= maximum &&
    !invalidCharacters.test(value)
  );
}

function validDate(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length <= MAX_DATE_LENGTH &&
    ISO_DATE_PATTERN.test(value) &&
    Number.isFinite(Date.parse(value))
  );
}

function validWindow(value: unknown): value is ReportingWindow {
  if (!value || typeof value !== "object") return false;
  const window = value as Record<string, unknown>;
  return (
    Number.isInteger(window.day) &&
    Number(window.day) >= 0 &&
    Number(window.day) <= 6 &&
    typeof window.start === "string" &&
    TIME_PATTERN.test(window.start) &&
    typeof window.end === "string" &&
    TIME_PATTERN.test(window.end) &&
    isValidWindow(window as unknown as ReportingWindow)
  );
}

/** Validate untrusted route input and return only the fields the feed consumes. */
export function validateSchedule(value: unknown): CalendarSchedule | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (
    input.v !== 1 ||
    (input.l !== "ar" && input.l !== "en") ||
    (input.p !== "basic" && input.p !== "ultimate") ||
    !validText(input.f, MAX_FARM_NAME_LENGTH, true) ||
    !(input.w === null || validWindow(input.w)) ||
    !Array.isArray(input.t) ||
    input.t.length > MAX_SCHEDULE_TASKS
  ) {
    return null;
  }

  const tasks: CalendarTask[] = [];
  for (const item of input.t) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const task = item as Record<string, unknown>;
    if (
      !validText(task.id, MAX_TASK_ID_LENGTH) ||
      task.id.length === 0 ||
      !validText(task.title, MAX_TASK_TITLE_LENGTH, true) ||
      !validDate(task.at)
    ) {
      return null;
    }
    tasks.push({ id: task.id, title: task.title, at: task.at });
  }

  return {
    v: 1,
    l: input.l,
    f: input.f,
    p: input.p,
    w:
      input.w === null
        ? null
        : {
            day: (input.w as ReportingWindow).day,
            start: (input.w as ReportingWindow).start,
            end: (input.w as ReportingWindow).end,
          },
    t: tasks,
  };
}

function makeTask(ticket: TaskTicket): CalendarTask | null {
  if (ticket.status !== "open" || !ticket.scheduledFor || !validDate(ticket.scheduledFor)) return null;
  const id = boundedText(ticket.id, MAX_TASK_ID_LENGTH);
  const title = boundedText(ticket.instruction, MAX_TASK_TITLE_LENGTH, true);
  if (!id || !title) return null;
  return {
    id,
    title,
    at: ticket.scheduledFor,
  };
}

/** Create a single-task schedule for a ticket's Google and .ics actions. */
export function scheduleForTask(
  ws: Workspace,
  ticket: TaskTicket,
  locale: Locale,
): CalendarSchedule | null {
  const task = makeTask(ticket);
  if (!task) return null;
  return {
    v: 1,
    l: locale,
    f: boundedText(ws.settings.farm.name, MAX_FARM_NAME_LENGTH, true),
    p: ws.settings.plan,
    w: null,
    t: [task],
  };
}

const clock = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** The scheduled report call as a 30-minute calendar slot, kept within the day. */
function reportSlot(ws: Workspace): ReportingWindow | null {
  const { plan, callSchedule } = ws.settings;
  if (!callSchedule || !isCompleteCallSchedule(plan, callSchedule)) return null;
  const start = toMinutes(callSchedule.time);
  const end = Math.min(start + 30, 23 * 60 + 59);
  if (end <= start) return null;
  return { day: callSchedule.day ?? 0, start: callSchedule.time, end: clock(end) };
}

/** Snapshot the weekly/daily report rhythm and currently open scheduled tasks. */
export function scheduleFromWorkspace(ws: Workspace, locale: Locale): CalendarSchedule {
  const tasks = ws.taskTickets
    .map(makeTask)
    .filter((task): task is CalendarTask => task !== null)
    .sort((left, right) => Date.parse(left.at) - Date.parse(right.at))
    .slice(0, MAX_SCHEDULE_TASKS);
  const window = reportSlot(ws);

  return {
    v: 1,
    l: locale,
    f: boundedText(ws.settings.farm.name, MAX_FARM_NAME_LENGTH, true),
    p: ws.settings.plan,
    w: window && validWindow(window) ? { ...window } : null,
    t: tasks,
  };
}

function bytesToBinary(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return binary;
}

/** Base64url JSON, capped by UTF-8 byte size so the URL stays bounded. */
export function encodeSchedule(schedule: CalendarSchedule): string {
  const validated = validateSchedule(schedule);
  if (!validated) throw new TypeError("Invalid calendar schedule");

  if (typeof TextEncoder !== "function") throw new Error("UTF-8 encoding is unavailable");
  const bytes = new TextEncoder().encode(JSON.stringify(validated));
  if (bytes.byteLength > MAX_SCHEDULE_BYTES) {
    throw new RangeError("Calendar schedule is too large");
  }
  if (typeof btoa !== "function") throw new Error("Base64 encoding is unavailable");

  return btoa(bytesToBinary(bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** Decode and validate a feed snapshot. Invalid or oversized input returns null. */
export function decodeSchedule(encoded: string | null): CalendarSchedule | null {
  if (
    typeof encoded !== "string" ||
    encoded.length === 0 ||
    encoded.length > MAX_ENCODED_LENGTH ||
    !/^[A-Za-z0-9_-]+$/.test(encoded) ||
    encoded.length % 4 === 1 ||
    typeof atob !== "function"
  ) {
    return null;
  }

  try {
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const binary = atob(padded);
    if (binary.length > MAX_SCHEDULE_BYTES) return null;
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const json = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return validateSchedule(JSON.parse(json) as unknown);
  } catch {
    return null;
  }
}
