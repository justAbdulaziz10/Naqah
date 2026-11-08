"use client";

import type { CSSProperties, ReactNode } from "react";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

export interface RailEnd {
  at: string | Date;
  label: ReactNode;
  value?: ReactNode;
  detail?: ReactNode;
  extra?: ReactNode;
}

const tones = {
  dark: { line: "bg-cream/70", dash: "border-cream/35", dot: "bg-cream", ring: "border-cream bg-espresso", now: "bg-gold", label: "text-cream/75", value: "text-cream", nowText: "text-gold" },
  light: { line: "bg-brown", dash: "border-brown/45", dot: "bg-brown", ring: "border-brown bg-cream", now: "bg-espresso", label: "text-muted", value: "text-espresso", nowText: "text-espresso" },
} as const;

const ms = (value: string | Date) => new Date(value).getTime();
/** Rail positions leave room for the 12px end dots. */
const at = (p: number) => `calc(6px + (100% - 12px) * ${p})`;

/**
 * Time between two moments, drawn to scale: a solid line for what has happened, a dashed line for
 * what is still to come, and a short upright mark for now. Without `now` the span is finished.
 * `start: null` starts the rail at now (nothing has happened yet). When now is past `end`, the end
 * mark sits inside the rail with `endTone`, so a passed time never looks like it is still ahead.
 */
export function TimeRail({
  start,
  end,
  now,
  tone = "light",
  endTone,
  startValue,
  compact = false,
  label,
  className,
}: {
  start: RailEnd | null;
  end: RailEnd;
  now?: Date;
  tone?: keyof typeof tones;
  endTone?: string;
  /** Shown under "Now" when the rail starts at now. */
  startValue?: ReactNode;
  /** Smaller values, for rails inside a list. */
  compact?: boolean;
  label: string;
  className?: string;
}) {
  const { m } = useI18n();
  const c = tones[tone];
  const nowMs = now?.getTime() ?? null;
  const from = start ? ms(start.at) : nowMs ?? ms(end.at);
  const to = Math.max(ms(end.at), nowMs ?? 0);
  const span = Math.max(1, to - from);
  const pos = (value: number) => Math.min(1, Math.max(0, (value - from) / span));
  const pEnd = pos(ms(end.at));
  const pNow = nowMs === null ? pEnd : pos(nowMs);
  const passed = nowMs !== null && nowMs > ms(end.at);
  // The "now" word sits over its mark, or against the rail's edge when now is close to an end.
  const nowAnchor = pNow < 0.14 ? "start" : pNow > 0.86 ? "end" : "center";

  return (
    <div role="group" aria-label={label} className={cn("min-w-0", className)}>
      <div aria-hidden className="relative">
        {nowMs !== null && start ? (
          <div className={cn("relative mb-1", compact ? "h-4" : "h-5")}>
            <span
              className={cn(
                "absolute top-0 whitespace-nowrap text-xs font-semibold",
                nowAnchor === "center" && "ltr:-translate-x-1/2 rtl:translate-x-1/2",
                nowAnchor === "start" && "start-0",
                nowAnchor === "end" && "end-0",
                c.nowText,
              )}
              style={nowAnchor === "center" ? { insetInlineStart: at(pNow) } : undefined}
            >
              {m.visual.now}
            </span>
          </div>
        ) : null}
        <div className="relative h-4">
          <span className={cn("naqah-draw absolute top-1/2 h-0.5 -translate-y-1/2 rounded-full", c.line)} style={{ insetInlineStart: 6, width: `calc((100% - 12px) * ${pNow})` }} />
          {pEnd > pNow ? (
            <span className={cn("absolute top-1/2 border-t-2 border-dashed", c.dash)} style={{ insetInlineStart: at(pNow), insetInlineEnd: `calc(6px + (100% - 12px) * ${1 - pEnd})` }} />
          ) : null}
          {start ? <span className={cn("absolute start-0 top-1/2 size-3 -translate-y-1/2 rounded-full", c.dot)} /> : null}
          <span
            className={cn(
              "absolute top-1/2 size-3 -translate-y-1/2 rounded-full ltr:-translate-x-1/2 rtl:translate-x-1/2",
              nowMs === null ? c.dot : passed ? cn("border-2 bg-transparent", endTone ?? c.ring) : cn("border-2", c.ring),
            )}
            style={{ insetInlineStart: at(pEnd) } as CSSProperties}
          />
          {nowMs !== null ? (
            <span
              className={cn("naqah-pop absolute top-1/2 h-4 w-[3px] -translate-y-1/2 rounded-full ltr:-translate-x-1/2 rtl:translate-x-1/2", c.now)}
              style={{ insetInlineStart: at(pNow) }}
            />
          ) : null}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4">
        <RailLabel end={start ?? { at: new Date(from), label: m.visual.now, value: startValue }} c={c} compact={compact} />
        <RailLabel end={end} c={c} compact={compact} align="end" />
      </div>
    </div>
  );
}

function RailLabel({ end, c, compact, align = "start" }: { end: RailEnd; c: (typeof tones)[keyof typeof tones]; compact: boolean; align?: "start" | "end" }) {
  return (
    <div className={cn("min-w-0", align === "end" && "text-end")}>
      <p className={cn(compact ? "text-[0.8125rem]" : "text-sm", c.label)}>{end.label}</p>
      {end.value ? <p className={cn("mt-0.5 font-semibold leading-snug", compact ? "text-sm" : "text-lg", c.value)}>{end.value}</p> : null}
      {end.detail ? <p className={cn("mt-0.5", compact ? "text-[0.8125rem]" : "text-sm", c.label)}>{end.detail}</p> : null}
      {end.extra}
    </div>
  );
}
