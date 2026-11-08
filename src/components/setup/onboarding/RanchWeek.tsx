"use client";

import { WEEKDAY_LABELS } from "@/domain/catalog";
import { isCallTime } from "@/domain/schedule";
import type { Workspace } from "@/domain/types";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

/**
 * The finished setup as the ranch's week: which days NAQAH calls the worker, at what time, and that
 * the owner's call follows each report. The sentence underneath says the same for screen readers.
 */
export function RanchWeek({ ws }: { ws: Workspace }) {
  const { m, t, fmt, locale } = useI18n();
  const r = m.setup.ready;
  const { plan, callSchedule, farm, owner } = ws.settings;
  const call = useCallSentence(ws);
  const time = callSchedule && isCallTime(callSchedule.time) ? fmt.time(new Date(`2026-01-01T${callSchedule.time}:00+03:00`)) : null;
  const days = WEEKDAY_LABELS.map((label, day) => ({
    label: t(label),
    call: Boolean(time) && (plan === "ultimate" || callSchedule?.day === day),
  }));

  return (
    <section aria-labelledby="ranch-week" className="overflow-hidden rounded-2xl bg-espresso text-cream">
      <div className="px-5 pt-6 sm:px-8 sm:pt-8">
        {farm.name.trim() ? <p className="text-[0.9375rem] text-sand [overflow-wrap:anywhere]">{farm.name.trim()}</p> : null}
        <h2 id="ranch-week" className="mt-1 text-2xl font-semibold sm:text-[1.75rem]">{r.weekTitle}</h2>
      </div>
      <ol aria-hidden className="mt-6 grid grid-cols-7 px-3 sm:px-6">
        {days.map((day, index) => (
          <li key={day.label} className={cn("flex flex-col items-center gap-3 rounded-xl py-3", day.call && plan === "basic" && "bg-cream/10")}>
            <span className={cn("text-[0.8125rem]", day.call ? "font-semibold text-cream" : "text-cream/60")}>
              {locale === "en" ? day.label.slice(0, 3) : day.label.replace(/^ال/, "")}
            </span>
            {day.call ? (
              <span className="flex flex-col items-center">
                <span className="naqah-pop size-3.5 rounded-full bg-sand" style={{ animationDelay: `${index * 60}ms` }} />
                <span className="h-5 w-0.5 bg-sand/50" />
                <span className="naqah-pop size-3.5 rounded-full bg-gold" style={{ animationDelay: `${index * 60 + 120}ms` }} />
              </span>
            ) : (
              <span className="flex h-[3.25rem] items-center">
                <span className="h-0.5 w-3 bg-cream/20" />
              </span>
            )}
          </li>
        ))}
      </ol>
      <div className="mt-5 grid gap-2 border-t border-cream/15 px-5 py-5 text-[1.0625rem] sm:px-8">
        <p className="flex items-start gap-3">
          <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-sand" />
          <span>{call ? call.sentence : r.noCall}</span>
        </p>
        <p className="flex items-start gap-3">
          <span aria-hidden className="mt-2 size-2.5 shrink-0 rounded-full bg-gold" />
          <span>{r.callsYou(owner.name.trim())}</span>
        </p>
      </div>
    </section>
  );
}
