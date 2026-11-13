"use client";

import { DAY, dayKey } from "@/domain/clock";
import type { CallLog } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

const MAX_MARKS = 5;

const mark = (call: CallLog) =>
  call.outcome === "no_answer"
    ? "border-2 border-warn bg-cream"
    : call.outcome === "rejected"
      ? "border-2 border-faint bg-cream"
      : call.kind === "worker_report"
        ? "bg-brown"
        : "bg-sand";

/**
 * Every call of the last two weeks, one mark per call stacked on its day: dark = a report, sand =
 * another connected call, amber ring = not answered, grey ring = not accepted. Days without calls
 * keep their place, so a quiet week looks quiet rather than missing.
 */
export function CallActivity({ calls, now, maxDays = 14, className }: { calls: CallLog[]; now: Date; maxDays?: number; className?: string }) {
  const { m, fmt } = useI18n();
  const v = m.visual.activity;
  // The range follows the record: from the first call, at least a week, at most two.
  const first = calls.reduce((min, call) => Math.min(min, Date.parse(call.at)), now.getTime());
  const days = Math.min(maxDays, Math.max(7, Math.ceil((now.getTime() - first) / DAY) + 1));
  const columns = Array.from({ length: days }, (_, index) => {
    const date = new Date(now.getTime() - (days - 1 - index) * DAY);
    const key = dayKey(date);
    return { key, date, calls: calls.filter((call) => dayKey(new Date(call.at)) === key).sort((a, b) => Date.parse(a.at) - Date.parse(b.at)) };
  });
  const total = columns.reduce((sum, column) => sum + column.calls.length, 0);
  const reports = columns.reduce((sum, column) => sum + column.calls.filter((call) => call.kind === "worker_report").length, 0);
  const missed = columns.reduce((sum, column) => sum + column.calls.filter((call) => call.outcome === "no_answer").length, 0);
  const summary = v.summary(total, reports, missed);
  const populated = columns.filter((column) => column.calls.length).length;

  // One day of calls is a sentence, not a chart: the columns would be mostly empty.
  if (populated <= 1) {
    return (
      <p className={cn("flex flex-wrap items-baseline gap-x-4 gap-y-1", className)}>
        <span className="text-sm font-semibold text-espresso">{v.title(days)}</span>
        <span className="text-sm text-muted">{summary}</span>
      </p>
    );
  }

  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="text-sm font-semibold text-espresso">{v.title(days)}</span>
        <span className="text-sm text-muted">{summary}</span>
      </figcaption>
      <ol aria-hidden className="mt-4 grid auto-cols-fr grid-flow-col items-end gap-1 border-b border-stone pb-0">
        {columns.map((column, index) => {
          const today = index === columns.length - 1;
          const shown = column.calls.slice(-MAX_MARKS);
          const more = column.calls.length - shown.length;
          return (
            <li key={column.key} className={cn("flex h-[5.75rem] flex-col-reverse items-center gap-1 rounded-t-lg pb-1.5", index === columns.length - 1 && "bg-ivory")}>
              {shown.map((call, i) => (
                <span key={call.id} className={cn("naqah-pop size-3 shrink-0 rounded-full", mark(call))} style={{ animationDelay: `${index * 25 + i * 40}ms` }} />
              ))}
              {more > 0 ? <span className="ltr-nums text-[0.625rem] font-semibold leading-none text-muted">+{more}</span> : null}
              {!column.calls.length ? <span className={cn("h-1.5 w-px", today ? "bg-brown" : "bg-stone")} /> : null}
            </li>
          );
        })}
      </ol>
      <div aria-hidden className="mt-1.5 grid auto-cols-fr grid-flow-col gap-1 text-center text-[0.6875rem] text-muted">
        {columns.map((column, index) => (
          <span key={column.key} className={cn("ltr-nums whitespace-nowrap", index === columns.length - 1 && "font-semibold text-espresso")}>
            {index === columns.length - 1 ? v.today : columns.length <= 8 || index % 2 === (columns.length - 1) % 2 ? fmt.dateTime(column.date, { weekday: undefined, month: undefined, hour: undefined, minute: undefined, day: "numeric" }) : ""}
          </span>
        ))}
      </div>
      <p aria-hidden className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[0.8125rem] text-muted">
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-brown" />{v.report}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-sand" />{v.other}</span>
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full border-2 border-warn" />{v.noAnswer}</span>
      </p>
    </figure>
  );
}
