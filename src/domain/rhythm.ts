/**
 * Report rhythm: the recent and upcoming report periods (a day on Ultimate, a week on Basic) and
 * what happened in each, for display only. Built from reports, report-call runs, missed report
 * calls and the call schedule; nothing is invented. Periods before the workspace has any history
 * are left out, so a new ranch shows its upcoming calls instead of empty past.
 */
import { DAY, fromRiyadh, riyadhParts, toMinutes, weekStart } from "./clock";
import { isCompleteCallSchedule } from "./schedule";
import type { Workspace } from "./types";

export type RhythmState =
  /** A report was saved in this period. */
  | "saved"
  /** The report call went unanswered. */
  | "missed"
  /** The period passed with no report and no recorded call. */
  | "quiet"
  /** This period: its call time has passed and no report is in yet. */
  | "open"
  /** The next report call. */
  | "next"
  /** A later report call. */
  | "upcoming";

export interface RhythmSlot {
  key: string;
  /** Start of the period (Riyadh midnight, or Sunday midnight on Basic). */
  start: Date;
  /** The scheduled call time in this period, if the schedule is set. */
  callAt: Date | null;
  /** When the report was saved, for saved periods. */
  reportAt: string | null;
  state: RhythmState;
  current: boolean;
}

function periodStart(date: Date, weekly: boolean): Date {
  if (weekly) return weekStart(date);
  const p = riyadhParts(date);
  return fromRiyadh(p.year, p.month, p.day);
}

function shift(start: Date, weekly: boolean, by: number): Date {
  const p = riyadhParts(start);
  return fromRiyadh(p.year, p.month, p.day + by * (weekly ? 7 : 1));
}

/** Earliest moment this workspace has any record of. */
function historyStart(ws: Workspace): Date {
  const times = [ws.createdAt, ...ws.reports.map((r) => r.at), ...ws.calls.map((c) => c.at), ...(ws.reportCalls ?? []).map((r) => r.occurrence)]
    .map((value) => Date.parse(value))
    .filter((value) => Number.isFinite(value));
  return new Date(Math.min(...times));
}

/**
 * `size` periods in order, oldest first: up to `maxPast` past periods that have history, the
 * current one, then upcoming periods to fill the rest.
 */
export function reportRhythm(ws: Workspace, now: Date, size = 7, maxPast = 4): RhythmSlot[] {
  const { plan, callSchedule } = ws.settings;
  const weekly = plan === "basic";
  const scheduled = isCompleteCallSchedule(plan, callSchedule) && callSchedule ? callSchedule : null;
  const current = periodStart(now, weekly);
  const first = periodStart(historyStart(ws), weekly);
  const available = Math.max(0, Math.round((current.getTime() - first.getTime()) / (weekly ? 7 * DAY : DAY)));
  const past = Math.min(maxPast, available, size - 1);

  const callIn = (start: Date): Date | null => {
    if (!scheduled) return null;
    const minutes = toMinutes(scheduled.time);
    const p = riyadhParts(start);
    const day = weekly ? (scheduled.day ?? 0) : 0;
    return fromRiyadh(p.year, p.month, p.day + day, Math.floor(minutes / 60), minutes % 60);
  };

  let nextGiven = false;
  return Array.from({ length: size }, (_, index) => {
    const start = shift(current, weekly, index - past);
    const end = shift(start, weekly, 1);
    const within = (value: string) => {
      const at = Date.parse(value);
      return at >= start.getTime() && at < end.getTime();
    };
    const report = [...ws.reports].reverse().find((r) => within(r.at)) ?? null;
    const missed =
      (ws.reportCalls ?? []).some((run) => run.state === "missed" && within(run.occurrence)) ||
      ws.calls.some((call) => call.kind === "worker_report_missed" && within(call.at));
    const callAt = callIn(start);
    const isCurrent = start.getTime() === current.getTime();
    const future = start.getTime() > current.getTime();

    let state: RhythmState;
    if (report) state = "saved";
    else if (missed) state = "missed";
    else if (future || (isCurrent && callAt && callAt.getTime() > now.getTime())) state = scheduled ? "upcoming" : "quiet";
    else state = isCurrent ? "open" : "quiet";

    if (state === "upcoming" && !nextGiven) {
      state = "next";
      nextGiven = true;
    }
    return { key: start.toISOString(), start, callAt, reportAt: report?.at ?? null, state, current: isCurrent };
  });
}
