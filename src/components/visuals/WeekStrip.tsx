"use client";

import { WEEKDAY_LABELS } from "@/domain/catalog";
import { riyadhParts } from "@/domain/clock";
import { isCallTime } from "@/domain/schedule";
import type { CallSchedule, Plan } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { isCallDay, weekdayForms } from "./weekdays";

/**
 * The report call across a Riyadh week, Sunday first: Basic marks its one weekday, Ultimate marks
 * every day. A filled mark is a set call; an outline means the day is chosen but the time is not.
 */
export function WeekStrip({ plan, schedule, now, className }: { plan: Plan; schedule: CallSchedule | null | undefined; now: Date; className?: string }) {
  const { m, t, fmt, locale } = useI18n();
  const v = m.visual.week;
  const hasTime = isCallTime(schedule?.time ?? "");
  const today = riyadhParts(now).weekday;
  const time = hasTime && schedule ? fmt.time(new Date(`2026-01-01T${schedule.time}:00+03:00`)) : null;
  const days = WEEKDAY_LABELS.map((label, day) => {
    const call = Boolean(schedule) && isCallDay(plan, schedule?.day, day);
    return { day, label: t(label), ...weekdayForms(locale, day), call };
  });

  return (
    <figure className={cn("@container min-w-0", className)}>
      <ol aria-label={v.label} className="grid grid-cols-7 gap-1">
        {days.map((d, index) => (
          <li key={d.day} className="flex flex-col items-center gap-2 text-center">
            <span className="sr-only">
              {d.day === today ? `${v.today}, ` : ""}
              {d.call && time ? v.call(d.label, time) : d.call ? d.label : v.noCall(d.label)}
            </span>
            <span aria-hidden className={cn("text-xs", d.day === today ? "font-bold text-espresso underline decoration-2 underline-offset-[6px]" : "text-muted")}>
              {locale === "en" ? (
                d.short.slice(0, 3)
              ) : (
                <>
                  <span className="@md:hidden">{d.narrow}</span>
                  <span className="hidden @md:inline">{d.short}</span>
                </>
              )}
            </span>
            <span aria-hidden className="flex h-6 items-center">
              {d.call ? (
                <span className={cn("naqah-pop size-3.5 rounded-full", time ? "bg-brown" : "border-2 border-brown")} style={{ animationDelay: `${index * 40}ms` }} />
              ) : (
                <span className="h-px w-3 bg-stone" />
              )}
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}
