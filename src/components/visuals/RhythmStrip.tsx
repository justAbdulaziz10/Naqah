"use client";

import { Check, X } from "@phosphor-icons/react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import type { RhythmSlot, RhythmState } from "@/domain/rhythm";
import { DAY } from "@/domain/clock";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { dayWord } from "@/components/dashboard/dayWord";

/** Each state has its own shape, so the strip reads without colour: a tick, a cross, a dot, rings. */
function Mark({ state, size = "lg" }: { state: RhythmState; size?: "lg" | "sm" }) {
  const lg = size === "lg";
  switch (state) {
    case "saved":
      return (
        <span className={cn("flex items-center justify-center rounded-full bg-cream text-espresso", lg ? "size-6" : "size-3.5")}>
          <Check size={lg ? 14 : 9} weight="bold" aria-hidden />
        </span>
      );
    case "missed":
      return (
        <span className={cn("flex items-center justify-center rounded-full border-2 border-sand bg-espresso text-sand", lg ? "size-6" : "size-3.5")}>
          <X size={lg ? 12 : 8} weight="bold" aria-hidden />
        </span>
      );
    case "quiet":
      return <span className={cn("block rounded-full bg-cream/30", lg ? "size-2" : "size-1.5")} />;
    case "open":
      return <span className={cn("block rounded-full border-2 border-dashed border-cream bg-espresso", lg ? "size-6" : "size-3.5")} />;
    case "next":
      return (
        <span className={cn("naqah-beacon relative flex items-center justify-center rounded-full border-2 border-gold bg-espresso", lg ? "size-8" : "size-3.5")}>
          <span className={cn("block rounded-full bg-gold", lg ? "size-2.5" : "size-1.5")} />
        </span>
      );
    default:
      return <span className={cn("block rounded-full border-2 border-cream/35 bg-espresso", lg ? "size-4" : "size-3")} />;
  }
}

/**
 * Recent and upcoming report calls, as a row of days (weeks on Basic) along one track: solid for
 * what has happened, dashed for what is still ahead. Today sits on a lighter band with a gold tick
 * for now; the next call is the gold ring with its time. On a phone the row scrolls sideways and
 * opens on today. A sentence carries the same for screen readers, and the legend names each shape.
 */
export function RhythmStrip({ slots, weekly, now, planned = false, className }: {
  slots: RhythmSlot[];
  weekly: boolean;
  now: Date;
  /** Scheduled calls are not switched on: the next slot is planned, not promised. */
  planned?: boolean;
  className?: string;
}) {
  const { m, fmt, locale } = useI18n();
  const r = m.visual.rhythm;
  const scroller = useRef<HTMLOListElement>(null);

  // Open on today without moving the page: only the row scrolls, and only when it overflows.
  useEffect(() => {
    const row = scroller.current;
    const today = row?.querySelector<HTMLElement>("[data-current]");
    if (!row || !today || row.scrollWidth <= row.clientWidth) return;
    today.scrollIntoView({ inline: "center", block: "nearest", behavior: "instant" });
  }, [slots.length]);

  const head = (slot: RhythmSlot) =>
    slot.current
      ? weekly ? r.thisWeek : r.today
      : weekly
        ? r.weekOf(fmt.dateTime(slot.callAt ?? slot.start, { weekday: undefined, hour: undefined, minute: undefined, month: "short", day: "numeric" }))
        : dayWord(slot.start, now, r, () => fmt.dateTime(slot.start, { weekday: "long", day: undefined, month: undefined, hour: undefined, minute: undefined }));
  const sub = (slot: RhythmSlot) =>
    weekly
      ? slot.callAt ? fmt.dateTime(slot.callAt, { weekday: "short", day: undefined, month: undefined, hour: undefined, minute: undefined }) : ""
      : fmt.dateTime(slot.start, { weekday: undefined, hour: undefined, minute: undefined, month: "short", day: "numeric" });
  const caption = (slot: RhythmSlot): ReactNode => {
    switch (slot.state) {
      case "saved": return slot.reportAt ? r.savedAt(fmt.time(slot.reportAt)) : r.states.saved;
      case "next": return slot.callAt ? (planned ? r.plannedAt(fmt.time(slot.callAt)) : fmt.time(slot.callAt)) : r.states.next;
      case "open": return r.states.open;
      case "missed": return r.states.missed;
      case "quiet": return r.states.quiet;
      default: return null;
    }
  };
  const summary = slots
    .map((slot) => `${head(slot)}: ${slot.state === "next" && planned ? r.states.planned : r.states[slot.state]}${slot.state === "saved" && slot.reportAt ? ` ${fmt.time(slot.reportAt)}` : slot.state === "next" && slot.callAt ? ` ${fmt.time(slot.callAt)}` : ""}`)
    .join(locale === "ar" ? "، " : ", ");
  const present = new Set(slots.map((slot) => slot.state));
  const legend = (["saved", "missed", "quiet", "next", "upcoming"] as RhythmState[]).filter((state) => present.has(state));
  const lastPast = slots.reduce((last, slot, index) => (slot.state === "saved" || slot.state === "missed" || slot.state === "quiet" || slot.state === "open" || slot.current ? index : last), -1);

  return (
    <figure className={cn("min-w-0", className)}>
      <figcaption className="sr-only">{`${r.stripLabel}. ${summary}`}</figcaption>
      <ol
        ref={scroller}
        aria-hidden
        className="naqah-scroll-x -mx-5 flex snap-x snap-mandatory overflow-x-auto px-5 pb-1 sm:mx-0 sm:grid sm:snap-none sm:overflow-visible sm:px-0"
        style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
      >
        {slots.map((slot, index) => {
          const solid = index < lastPast;
          // Today is drawn to the clock: now, and today's call or report, sit at their time of day.
          const dayAt = (at: Date | string | null) => (at ? Math.min(1, Math.max(0, (new Date(at).getTime() - slot.start.getTime()) / DAY)) : null);
          const nowAt = slot.current && !weekly ? dayAt(now) : null;
          const markAt = slot.current && !weekly ? dayAt(slot.state === "saved" ? slot.reportAt : slot.callAt) : null;
          return (
            <li
              key={slot.key}
              data-current={slot.current || undefined}
              className={cn(
                // Wide enough on a phone for the longest label, "أسبوع 26 نوفمبر" or "Wednesday".
                "naqah-stagger-item relative flex shrink-0 snap-center flex-col items-center rounded-2xl px-1 pb-2 pt-2 text-center sm:w-auto sm:pb-3 sm:pt-3",
                weekly ? "w-32" : "w-28",
                slot.current && "bg-cream/[0.07]",
              )}
              style={{ "--i": index } as CSSProperties}
            >
              <span className={cn("max-w-full truncate text-sm leading-tight", slot.current ? "font-semibold text-cream" : "font-medium text-cream/80")}>{head(slot)}</span>
              <span className="mt-0.5 min-h-4 text-xs leading-4 text-cream/60"><bdi className="ltr-nums">{sub(slot)}</bdi></span>
              <span className="relative mt-2 flex h-8 w-full items-center justify-center sm:mt-3">
                {index < slots.length - 1 ? (
                  <span
                    className={cn(
                      "absolute top-1/2 start-1/2 w-full -translate-y-1/2",
                      solid ? "naqah-draw border-t-2 border-cream/55" : "border-t-2 border-dashed border-cream/20",
                    )}
                  />
                ) : null}
                {nowAt !== null ? (
                  <span
                    className="absolute top-1/2 z-20 h-6 w-[3px] -translate-y-1/2 rounded-full bg-gold ltr:-translate-x-1/2 rtl:translate-x-1/2"
                    style={{ insetInlineStart: `calc(0.5rem + (100% - 1rem) * ${nowAt})` }}
                  />
                ) : null}
                <span
                  className={cn("z-10", markAt === null ? "relative" : "absolute top-1/2 -translate-y-1/2 ltr:-translate-x-1/2 rtl:translate-x-1/2")}
                  style={markAt === null ? undefined : { insetInlineStart: `calc(0.5rem + (100% - 1rem) * ${markAt})` }}
                >
                  <Mark state={slot.state} />
                </span>
              </span>
              <span
                className={cn(
                  "mt-1.5 min-h-5 text-[0.8125rem] font-medium leading-5 sm:mt-2.5",
                  slot.state === "next" ? "font-semibold text-sand" : slot.state === "missed" ? "text-sand" : slot.state === "saved" || slot.state === "open" ? "text-cream" : "text-cream/55",
                )}
              >
                <bdi className="ltr-nums whitespace-nowrap">{caption(slot)}</bdi>
              </span>
            </li>
          );
        })}
      </ol>
      <p aria-hidden className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[0.8125rem] text-cream/70 sm:mt-3 sm:gap-y-1.5">
        {legend.map((state) => (
          <span key={state} className="inline-flex items-center gap-2">
            <Mark state={state} size="sm" />
            {state === "next" && planned ? r.states.planned : r.legend[state as keyof typeof r.legend]}
          </span>
        ))}
        {!weekly && slots.some((slot) => slot.current) ? (
          <span className="inline-flex items-center gap-2">
            <span className="h-3.5 w-[3px] rounded-full bg-gold" />
            {m.visual.now}
          </span>
        ) : null}
      </p>
    </figure>
  );
}
