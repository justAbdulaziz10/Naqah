"use client";

import { CaretDown, CheckCircle, Clock, WarningCircle } from "@phosphor-icons/react";
import { useState, type CSSProperties, type ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { WeatherLine } from "@/components/dashboard/WeatherLine";
import { useI18n } from "@/i18n/client";
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
export function EstateHeader({ name, answer, tone, provenance, call, rhythm, next, summary }: {
  name: string;
  answer: string;
  tone: EstateTone;
  provenance: ReactNode;
  /** Who NAQAH calls and the call button, first after the answer so it is easy to find. */
  call?: ReactNode;
  /** The report rhythm strip. */
  rhythm: ReactNode | null;
  /** The next report call, said plainly, with any real action beside it. */
  next: ReactNode;
  /**
   * The next calls in one line. On a phone it stands in for the strip and the call details, which
   * open under it, so what needs the owner's attention stays on the first screen.
   */
  summary?: ReactNode;
}) {
  const { m } = useI18n();
  const [open, setOpen] = useState(false);
  const fold = Boolean(summary);
  const title = (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-4">
        <CamelMark className="naqah-enter h-8 w-auto shrink-0 sm:h-10" />
        <WeatherLine className="naqah-enter mt-1 text-end text-sm leading-snug text-cream/70" />
      </div>
      <h1 id="estate-name" className="naqah-enter naqah-name mt-3 text-[1.875rem] font-semibold leading-[1.05] tracking-[-0.025em] text-balance sm:mt-4 sm:text-[3rem] xl:text-[3.5rem]" style={step(1)}>
        {name}
      </h1>
      <p className="naqah-enter mt-2 flex items-start gap-3 text-[1.25rem] font-semibold leading-snug text-cream sm:mt-4 sm:text-[1.75rem]" style={step(2)}>
        <ToneMark tone={tone} />
        <span className="naqah-name min-w-0">{answer}</span>
      </p>
      <p className="naqah-enter mt-1 text-[0.8125rem] leading-snug text-cream/70 sm:mt-2 sm:ps-[calc(1.75rem+0.75rem)] sm:text-[0.9375rem] sm:leading-relaxed" style={step(3)}>
        {provenance}
      </p>
    </div>
  );

  return (
    <section aria-labelledby="estate-name" className="overflow-hidden rounded-[var(--radius-card)] bg-espresso px-5 py-5 text-cream sm:px-9 sm:py-9">
      {/* Wide screens: the name, answer and call row on one side, the next calls on the other. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-x-10">
        <div className="min-w-0">
          {title}
          {call ? <div className="naqah-enter mt-3 sm:mt-7" style={step(4)}>{call}</div> : null}
        </div>
        {fold ? (
          <div className="naqah-enter mt-2.5 border-t border-cream/15 pt-2.5 sm:hidden" style={step(5)}>
            <button
              type="button"
              aria-expanded={open}
              aria-controls="estate-week"
              onClick={() => setOpen((value) => !value)}
              className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center justify-between gap-3 rounded-md px-2 text-start text-sm leading-snug transition hover:bg-cream/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cream"
            >
              <span className="min-w-0">{summary}</span>
              <span className="sr-only">{open ? m.app.overview.compact.hide : m.app.overview.compact.show}</span>
              <CaretDown size={16} weight="bold" className={cn("shrink-0 text-cream/70 transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} aria-hidden />
            </button>
          </div>
        ) : null}
        <div id="estate-week" className={cn("min-w-0 lg:contents", fold && !open && "max-sm:hidden")}>
          {rhythm ? <div className="mt-2.5 border-t border-cream/15 pt-2 sm:mt-8 sm:pt-6 lg:order-last lg:col-span-2">{rhythm}</div> : null}
          <div
            className={cn("naqah-enter lg:mt-0 lg:border-s lg:border-t-0 lg:ps-10 lg:pt-1", rhythm ? "mt-1.5 border-t border-cream/15 pt-2.5 sm:mt-5 sm:border-0 sm:pt-0" : "mt-5 border-t border-cream/15 pt-4 sm:mt-7 sm:pt-5")}
            style={step(5)}
          >
            {next}
          </div>
        </div>
      </div>
    </section>
  );
}
