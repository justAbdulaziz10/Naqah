"use client";

import type { Camel, HealthStatus } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";

interface Part {
  key: string;
  count: number;
  label: string;
  fill: string;
  strong?: boolean;
}

const HEALTH: HealthStatus[] = ["sick", "watch", "unknown", "healthy"];
const healthFill: Record<HealthStatus, string> = {
  sick: "bg-danger",
  watch: "bg-warn",
  unknown: "border border-dashed border-faint bg-transparent",
  healthy: "bg-ok",
};

export type AgeBand = "young" | "adult" | "older" | "unknown";
export function ageBand(age: number | null): AgeBand {
  if (age === null) return "unknown";
  return age < 3 ? "young" : age <= 8 ? "adult" : "older";
}

function Row({ title, parts, separator }: { title: string; parts: Part[]; separator: string }) {
  const shown = parts.filter((part) => part.count > 0);
  return (
    <div className="grid gap-x-6 gap-y-2 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
      <p className="text-sm font-semibold text-espresso">{title}</p>
      <div className="min-w-0">
        <p className="sr-only">{`${title}: ${shown.map((part) => part.label).join(separator)}`}</p>
        <div aria-hidden className="flex h-2.5 gap-0.5">
          {shown.map((part) => (
            <span key={part.key} className={cn("naqah-fill min-w-1.5 rounded-[3px]", part.fill)} style={{ flexGrow: part.count, flexBasis: 0 }} />
          ))}
        </div>
        <p aria-hidden className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-[0.8125rem] text-muted">
          {shown.map((part) => (
            <span key={part.key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <span className={cn("size-2 shrink-0 rounded-full", part.fill)} />
              <span className={part.strong ? "font-semibold text-espresso" : undefined}>{part.label}</span>
            </span>
          ))}
        </p>
      </div>
    </div>
  );
}

/**
 * The named camels three ways: health, type and age band. Each row is one proportional bar with
 * its counts in words beside it, so nothing relies on colour. Unknown ages are counted, not hidden.
 */
export function HerdComposition({ camels, rows = ["health", "type", "age"], className }: { camels: Camel[]; rows?: ("health" | "type" | "age")[]; className?: string }) {
  const { m, fmt, locale } = useI18n();
  const h = m.visual.herd;
  const c = m.visual.composition;
  if (!camels.length) return null;
  const count = (test: (camel: Camel) => boolean) => camels.filter(test).length;
  const separator = locale === "ar" ? "، " : ", ";
  const bands: AgeBand[] = ["young", "adult", "older", "unknown"];
  const bandFill: Record<AgeBand, string> = { young: "bg-sand", adult: "bg-brown", older: "bg-espresso", unknown: "border border-dashed border-faint bg-transparent" };

  return (
    <div className={cn("space-y-5", className)}>
      {rows.includes("health") ? <Row
        title={c.health}
        separator={separator}
        parts={HEALTH.map((health) => {
          const n = count((camel) => camel.health === health);
          return { key: health, count: n, label: h[health](fmt.number(n)), fill: healthFill[health], strong: health === "sick" || health === "watch" };
        })}
      /> : null}
      {rows.includes("type") ? <Row
        title={c.type}
        separator={separator}
        parts={[
          { key: "female", count: count((camel) => camel.sex === "female"), label: c.female(count((camel) => camel.sex === "female")), fill: "bg-brown" },
          { key: "male", count: count((camel) => camel.sex === "male"), label: c.male(count((camel) => camel.sex === "male")), fill: "bg-sand" },
        ]}
      /> : null}
      {rows.includes("age") ? <Row
        title={c.age}
        separator={separator}
        parts={bands.map((band) => {
          const n = count((camel) => ageBand(camel.ageYears) === band);
          return { key: band, count: n, label: c.bands[band](fmt.number(n)), fill: bandFill[band] };
        })}
      /> : null}
    </div>
  );
}
