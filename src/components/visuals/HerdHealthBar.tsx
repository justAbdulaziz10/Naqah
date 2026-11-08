"use client";

import type { Camel, HealthStatus } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

/** Most concerning first, so the eye lands on what needs care. */
const ORDER: HealthStatus[] = ["sick", "watch", "unknown", "healthy"];

const fill: Record<HealthStatus, string> = {
  sick: "bg-danger",
  watch: "bg-warn",
  unknown: "border border-dashed border-faint bg-transparent",
  healthy: "bg-ok",
};

const dot: Record<HealthStatus, string> = {
  sick: "bg-danger",
  watch: "bg-warn",
  unknown: "border border-dashed border-faint",
  healthy: "bg-ok",
};

/**
 * The named camels as one bar, split by health in proportion, with a legend that says each count
 * in words (status is never colour alone). Only the camels registered by name are counted.
 */
export function HerdHealthBar({ camels, className }: { camels: Camel[]; className?: string }) {
  const { m, fmt, locale } = useI18n();
  const h = m.visual.herd;
  const groups = ORDER.map((health) => ({ health, count: camels.filter((camel) => camel.health === health).length })).filter((group) => group.count > 0);
  if (!groups.length) return null;
  const words = groups.map(({ health, count }) => h[health](fmt.number(count)));

  return (
    <figure className={cn("min-w-0", className)}>
      <div role="img" aria-label={`${h.label}: ${words.join(locale === "ar" ? "، " : ", ")}`} className="naqah-draw flex h-2.5 gap-0.5">
        {groups.map(({ health, count }) => (
          <span key={health} className={cn("min-w-1.5 rounded-[3px]", fill[health])} style={{ flexGrow: count, flexBasis: 0 }} />
        ))}
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted" aria-hidden>
        {groups.map(({ health }, index) => (
          <span key={health} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className={cn("size-2 shrink-0 rounded-full", dot[health])} />
            <span className={health === "healthy" || health === "unknown" ? undefined : "font-semibold text-espresso"}>{words[index]}</span>
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
