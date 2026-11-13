"use client";

import type { CSSProperties } from "react";
import type { Camel, HealthStatus } from "@/domain/types";
import { HEALTH_LABELS } from "@/domain/catalog";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

const ORDER: HealthStatus[] = ["sick", "watch", "unknown", "healthy"];

/**
 * One mark per health state, told apart by shape as well as colour: sick is solid with a halo, under watch is a
 * thick ring, not reported is a dashed outline, healthy is a plain solid dot.
 */
export const healthMark: Record<HealthStatus, string> = {
  sick: "bg-danger ring-2 ring-danger/25",
  watch: "border-[3px] border-warn bg-cream",
  unknown: "border border-dashed border-faint bg-cream",
  healthy: "bg-ok",
};

/** Past this many named camels, labels stop fitting and the plain dots take over. */
export const HERD_MARKS_MAX = 60;

/**
 * The herd as a field of named marks, most concerning first. Each named camel opens its record; the rest of the
 * owner's official count stays as quiet unnamed outlines (in the legend only when there are too many). The legend says every count in words.
 */
export function HerdMarks({ camels, herdCount, activeId, onOpen, className }: {
  camels: Camel[];
  herdCount: number | null | undefined;
  activeId?: string | null;
  onOpen: (id: string) => void;
  className?: string;
}) {
  const { m, t, fmt, locale } = useI18n();
  const h = m.visual.herd;
  const named = [...camels].sort((a, b) => ORDER.indexOf(a.health) - ORDER.indexOf(b.health));
  const unnamed = Math.max(0, (herdCount ?? 0) - named.length);
  const unnamedMarks = named.length + unnamed <= HERD_MARKS_MAX ? unnamed : 0;
  const groups = ORDER.map((health) => ({ health, count: named.filter((camel) => camel.health === health).length })).filter((group) => group.count > 0);

  return (
    <figure className={cn("min-w-0", className)}>
      <ul aria-label={h.dotsLabel} className="naqah-stagger grid grid-cols-[repeat(auto-fill,minmax(4.25rem,1fr))] gap-1">
        {named.map((camel, index) => {
          const concern = camel.health === "sick" || camel.health === "watch";
          return (
            <li key={camel.id} style={{ "--i": Math.min(index, 24) } as CSSProperties} className="min-w-0">
              <button
                type="button"
                aria-haspopup="dialog"
                aria-label={`${camel.name}${locale === "ar" ? "، " : ", "}${t(HEALTH_LABELS[camel.health])}`}
                onClick={() => onOpen(camel.id)}
                className={cn(
                  "flex min-h-14 w-full flex-col items-center justify-center gap-1.5 rounded-xl px-1 py-2 transition-colors duration-200 hover:bg-ivory focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brown",
                  activeId === camel.id && "bg-ivory",
                )}
              >
                <span aria-hidden className={cn("size-3.5 shrink-0 rounded-full", healthMark[camel.health])} />
                <span className={cn("max-w-full truncate text-[0.8125rem] leading-tight", concern ? "font-semibold text-espresso" : "text-muted")}>{camel.name}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {unnamedMarks ? (
        <div aria-hidden className="mt-3 flex flex-wrap gap-1.5 px-1">
          {Array.from({ length: unnamedMarks }, (_, index) => (
            <span key={`unnamed-${index}`} className="size-3 rounded-full border border-stone bg-cream" />
          ))}
        </div>
      ) : null}
      <figcaption className="mt-4 flex flex-wrap gap-x-5 gap-y-1.5 text-sm text-muted">
        {groups.map(({ health, count }) => (
          <span key={health} className="inline-flex items-center gap-2 whitespace-nowrap">
            <span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", healthMark[health])} />
            <span className={health === "sick" || health === "watch" ? "font-semibold text-espresso" : undefined}>{h[health](fmt.number(count))}</span>
          </span>
        ))}
        {unnamed ? (
          <span className="inline-flex items-center gap-2 whitespace-nowrap">
            <span aria-hidden className="size-2.5 shrink-0 rounded-full border border-stone bg-cream" />
            {h.unnamed(fmt.number(unnamed))}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
