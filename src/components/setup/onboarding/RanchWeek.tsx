"use client";

import { WEEKDAY_LABELS } from "@/domain/catalog";
import { riyadhParts } from "@/domain/clock";
import { isCallTime } from "@/domain/schedule";
import type { CallSchedule, Workspace } from "@/domain/types";
import { useCallSentence, useOwnerCallSentence } from "@/components/schedule/ReportCallSection";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { useNow } from "@/store/workspace";
import { isCallDay, weekdayForms } from "@/components/visuals/weekdays";

/**
 * The finished setup as the ranch's week, Sunday first in Riyadh time: one row for the worker's report
 * call, one for the owner's summary call, a filled mark on each day the call lands and the row's time at
 * its start. Today's column is tinted. The sentences underneath say the same for screen readers, with
 * a per-day list behind the drawing.
 */
export function RanchWeek({ ws }: { ws: Workspace }) {
  const { m, t, fmt, locale } = useI18n();
  const now = useNow();
  const r = m.setup.ready;
  const { plan, callSchedule, ownerCallSchedule, farm } = ws.settings;
  const call = useCallSentence(ws);
  const ownerCall = useOwnerCallSentence(ws);
  const today = riyadhParts(now).weekday;
  const timeOf = (schedule: CallSchedule | null | undefined) =>
    schedule && isCallTime(schedule.time) ? fmt.time(new Date(`2026-01-01T${schedule.time}:00+03:00`)) : null;
  const workerTime = call ? timeOf(callSchedule) : null;
  const ownerTime = ownerCall ? timeOf(ownerCallSchedule) : null;
  const days = WEEKDAY_LABELS.map((label, day) => ({
    day,
    label: t(label),
    ...weekdayForms(locale, day),
    worker: Boolean(workerTime) && isCallDay(plan, callSchedule?.day, day),
    owner: Boolean(ownerTime) && isCallDay(plan, ownerCallSchedule?.day, day),
  }));
  const rows: { key: string; time: string | null; dot: string; on: (d: Day) => boolean }[] = [
    { key: "worker", time: workerTime, dot: "bg-sand", on: (d) => d.worker },
    { key: "owner", time: ownerTime, dot: "bg-gold", on: (d) => d.owner },
  ];
  const separator = locale === "ar" ? "، " : ", ";

  return (
    <section aria-labelledby="ranch-week" className="overflow-hidden rounded-2xl bg-espresso text-cream">
      <div className="px-5 pt-6 sm:px-8 sm:pt-8">
        {farm.name.trim() ? <p className="text-[0.9375rem] text-sand [overflow-wrap:anywhere]">{farm.name.trim()}</p> : null}
        <h2 id="ranch-week" className="mt-1 text-2xl font-semibold sm:text-[1.75rem]">{r.weekTitle}</h2>
      </div>

      {/* Text equivalent of the drawing: every day, what lands on it. */}
      <ul className="sr-only">
        {days.map((d) => {
          const calls = [d.worker && workerTime ? r.weekWorker(workerTime) : null, d.owner && ownerTime ? r.weekOwner(ownerTime) : null].filter(Boolean);
          return <li key={d.day}>{(d.day === today ? `${r.weekToday}${separator}` : "") + r.weekDay(d.label, calls.length ? calls.join(separator) : r.weekNone)}</li>;
        })}
      </ul>

      <div aria-hidden className="@container mt-6 px-4 sm:px-7">
        <div className="grid grid-cols-[auto_repeat(7,minmax(0,1fr))] items-center gap-y-1">
          {/* Day headers; the one-letter Arabic forms keep seven columns readable on a phone. */}
          <span />
          {days.map((d) => (
            <span
              key={d.day}
              className={cn(
                "flex h-9 items-center justify-center rounded-t-lg text-[0.8125rem]",
                d.day === today ? "bg-cream/10 font-bold text-cream" : d.worker || d.owner ? "font-semibold text-cream/90" : "text-cream/55",
              )}
            >
              {locale === "en" ? d.short.slice(0, 3) : (
                <>
                  <span className="@md:hidden">{d.narrow}</span>
                  <span className="hidden @md:inline">{d.label.replace(/^ال/, "")}</span>
                </>
              )}
            </span>
          ))}
          {rows.map((row, index) => (
            <RowCells key={row.key} row={row} days={days} today={today} last={index === rows.length - 1} />
          ))}
        </div>
      </div>

      {/* Legend: the two calls with their times, and today's column. */}
      <div className="mt-5 grid gap-2 border-t border-cream/15 px-5 py-5 text-[1.0625rem] sm:px-8">
        <p className="flex items-start gap-3">
          <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-sand" />
          <span>{call ? call.sentence : r.noCall}</span>
        </p>
        <p className="flex items-start gap-3">
          <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-gold" />
          <span>{ownerCall ?? r.noOwnerCall}</span>
        </p>
        <p aria-hidden className="flex items-center gap-3 text-[0.9375rem] text-cream/70">
          <span className="size-2.5 shrink-0 rounded-sm bg-cream/20" />
          <span>{r.weekToday}</span>
        </p>
      </div>
    </section>
  );
}

type Day = { day: number; worker: boolean; owner: boolean };

function RowCells({ row, days, today, last }: {
  row: { time: string | null; dot: string; on: (d: Day) => boolean };
  days: Day[];
  today: number;
  last: boolean;
}) {
  return (
    <>
      <span className={cn("ltr-nums pe-3 text-[0.8125rem] font-semibold tabular-nums", row.time ? "text-cream" : "text-cream/40")}>
        {row.time ?? "—"}
      </span>
      {days.map((d, index) => (
        <span
          key={d.day}
          className={cn("flex h-10 items-center justify-center", d.day === today && cn("bg-cream/10", last && "rounded-b-lg"))}
        >
          {row.on(d) ? (
            <span className={cn("naqah-pop size-3.5 rounded-full", row.dot)} style={{ animationDelay: `${index * 50 + (last ? 120 : 0)}ms` }} />
          ) : (
            <span className="h-px w-3 bg-cream/20" />
          )}
        </span>
      ))}
    </>
  );
}
