"use client";

import { CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react";
import type { CSSProperties, ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { WeatherLine } from "@/components/dashboard/WeatherLine";
import { cn } from "@/lib/cn";

export type EstateTone = "calm" | "attention" | "unanswered" | "quiet";

const step = (i: number) => ({ "--i": i }) as CSSProperties;

/** Each tone has its own shape as well as colour: a tick, a warning, a clock. */
function ToneMark({ tone }: { tone: EstateTone }) {
  const className = "shrink-0 translate-y-[0.12em]";
  if (tone === "calm") return <CheckCircle size="1em" weight="fill" className={cn(className, "text-ok-soft")} aria-hidden />;
  if (tone === "quiet") return <Clock size="1em" weight="bold" className={cn(className, "text-cream/60")} aria-hidden />;
  return <WarningCircle size="1em" weight="fill" className={cn(className, tone === "unanswered" ? "text-[#f0a493]" : "text-sand")} aria-hidden />;
}

/**
 * The estate at a glance, on the page's one espresso field: its name, the answer to "is my ranch
 * alright" in one sentence with where it comes from, and the rhythm of report calls with the next
 * one. Every other fact lives once, further down the page.
 */
export function EstateHeader({ name, answer, tone, provenance, rhythm, next }: {
  name: string;
  answer: string;
  tone: EstateTone;
  provenance: ReactNode;
  /** The report rhythm strip. */
  rhythm: ReactNode | null;
  /** The next report call, said plainly, with any real action beside it. */
  next: ReactNode;
}) {
  const title = (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <CamelMark className="naqah-enter h-8 w-auto shrink-0 sm:h-10" />
        <WeatherLine className="naqah-enter mt-1 text-end text-sm leading-snug text-cream/70" />
      </div>
      <h1 id="estate-name" className="naqah-enter naqah-name mt-4 text-[2.25rem] font-semibold leading-[1.05] tracking-[-0.025em] text-balance sm:text-[3rem] xl:text-[3.5rem]" style={step(1)}>
        {name}
      </h1>
      <p className="naqah-enter mt-4 flex items-start gap-3 text-[1.375rem] font-semibold leading-snug text-cream sm:text-[1.75rem]" style={step(2)}>
        <ToneMark tone={tone} />
        <span className="naqah-name min-w-0">{answer}</span>
      </p>
      <p className="naqah-enter mt-2 ps-[calc(1.375rem+0.75rem)] text-[0.9375rem] leading-relaxed text-cream/70 sm:ps-[calc(1.75rem+0.75rem)]" style={step(3)}>
        {provenance}
      </p>
    </div>
  );

  return (
    <section aria-labelledby="estate-name" className="overflow-hidden rounded-[var(--radius-card)] bg-espresso px-5 py-7 text-cream sm:px-9 sm:py-9">
      {title}
      {rhythm ? <div className="mt-8 border-t border-cream/15 pt-6">{rhythm}</div> : null}
      <div className={cn("naqah-enter", rhythm ? "mt-5" : "mt-7 border-t border-cream/15 pt-5")} style={step(5)}>{next}</div>
    </section>
  );
}
