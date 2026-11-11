"use client";

import type { Camel, HealthStatus } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { healthMark } from "./HerdMarks";

const ORDER: HealthStatus[] = ["sick", "watch", "unknown", "healthy"];
const mark = healthMark;
/** Past this, one dot per camel stops being readable. */
export const HERD_DOTS_MAX = 150;

/**
 * The whole herd, one dot per camel: named camels in their health colour (most concerning first),
 * the rest of the owner's official count as quiet outlines. The legend says every number in words.
 */
export function HerdDots({ camels, herdCount, className }: { camels: Camel[]; herdCount: number | null | undefined; className?: string }) {
  const { m, fmt, locale } = useI18n();
  const h = m.visual.herd;
  const named = [...camels].sort((a, b) => ORDER.indexOf(a.health) - ORDER.indexOf(b.health));
  const unnamed = Math.max(0, (herdCount ?? 0) - named.length);
  const total = named.length + unnamed;
  if (!total || total > HERD_DOTS_MAX) return null;
  const groups = ORDER.map((health) => ({ health, count: named.filter((camel) => camel.health === health).length })).filter((group) => group.count > 0);
  const words = [
    ...groups.map(({ health, count }) => h[health](fmt.number(count))),
    ...(unnamed ? [h.unnamed(fmt.number(unnamed))] : []),
  ];

  return (
    <figure className={cn("min-w-0", className)}>
      <div role="img" aria-label={`${h.dotsLabel}: ${words.join(locale === "ar" ? "، " : ", ")}`} className="flex flex-wrap gap-1.5">
        {named.map((camel, index) => (
          <span key={camel.id} className={cn("naqah-pop size-2.5 rounded-full", mark[camel.health])} style={{ animationDelay: `${Math.min(index, 40) * 12}ms` }} />
        ))}
        {Array.from({ length: unnamed }, (_, index) => <span key={index} className="size-2.5 rounded-full border border-stone bg-cream" />)}
      </div>
      <figcaption aria-hidden className="mt-2.5 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted">
        {groups.map(({ health }, index) => (
          <span key={health} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className={cn("size-2 shrink-0 rounded-full", mark[health])} />
            <span className={health === "sick" || health === "watch" ? "font-semibold text-espresso" : undefined}>{words[index]}</span>
          </span>
        ))}
        {unnamed ? (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
            <span className="size-2 shrink-0 rounded-full border border-stone bg-cream" />
            {words.at(-1)}
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
