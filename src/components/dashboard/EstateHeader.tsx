"use client";

import type { ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { ButtonLink } from "@/components/ui";
import { WeatherLine } from "@/components/dashboard/WeatherLine";

export type EstateTone = "calm" | "attention" | "unanswered" | "quiet";

const toneDot: Record<EstateTone, string> = {
  calm: "bg-ok-soft",
  attention: "bg-sand",
  unanswered: "bg-danger-soft",
  quiet: "bg-cream/50",
};

export interface EstateFact {
  key: string;
  label: string;
  content: ReactNode;
}

/**
 * The estate at a glance: its name, how it is, one next step, and the few facts the owner checks
 * every visit (last report, next report call, herd). "Call now" appears inside the next-call fact
 * only where the deployment has real calls switched on (see ReportCallNow).
 */
export function EstateHeader({
  name,
  state,
  tone,
  action,
  facts,
}: {
  name: string;
  state: string;
  tone: EstateTone;
  action: { href: string; label: string };
  facts: EstateFact[];
}) {
  return (
    <section aria-labelledby="estate-name" className="rounded-[var(--radius-card)] bg-espresso px-5 py-6 text-cream sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex items-center gap-3">
            <h1 id="estate-name" className="min-w-0 text-[2rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.25rem]">{name}</h1>
            <CamelMark className="h-8 w-auto shrink-0 sm:h-9" />
          </div>
          <p className="mt-2 flex items-center gap-2.5 text-lg font-medium leading-snug sm:text-xl">
            <span className={`size-2.5 shrink-0 rounded-full ${toneDot[tone]}`} aria-hidden />
            {state}
          </p>
        </div>
        <ButtonLink href={action.href} variant="light" className="w-full sm:w-auto">{action.label}</ButtonLink>
      </div>
      {facts.length ? (
        <dl className="mt-6 flex flex-wrap gap-x-10 gap-y-5 border-t border-cream/15 pt-5">
          {facts.map((fact) => (
            <div key={fact.key} className="min-w-0 flex-1 basis-56">
              <dt className="text-sm text-cream/75">{fact.label}</dt>
              <dd className="mt-1">{fact.content}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      <WeatherLine className="mt-4 text-sm leading-relaxed text-cream/75" />
    </section>
  );
}
