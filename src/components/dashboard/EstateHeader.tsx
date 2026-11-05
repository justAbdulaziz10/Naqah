"use client";

import { PhoneSlash } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import { buttonClass, ButtonLink } from "@/components/ui";
import { WeatherLine } from "@/components/dashboard/WeatherLine";
import { useI18n } from "@/i18n/client";

export type EstateTone = "calm" | "attention" | "unanswered" | "quiet";

const toneDot: Record<EstateTone, string> = {
  calm: "bg-ok-soft",
  attention: "bg-sand",
  unanswered: "bg-danger-soft",
  quiet: "bg-cream/50",
};

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0 flex-1 basis-56">
      <p className="text-sm text-cream/75">{label}</p>
      <div className="mt-1">{children}</div>
    </div>
  );
}

/**
 * Calling the worker from NAQAH needs the real phone line. Until it is connected this stays a
 * visibly disabled control that says so; replace it with the real action then.
 */
function CallWorkerUnavailable({ worker }: { worker: string }) {
  const { m } = useI18n();
  return (
    <button
      type="button"
      disabled
      className={buttonClass({
        variant: "ghost",
        className: "w-full border border-dashed border-cream/35 text-cream! disabled:opacity-100! sm:w-auto lg:w-full",
      })}
    >
      <PhoneSlash size={18} aria-hidden />
      <span>{m.app.overview.callWorkerAction(worker)}</span>
      <span className="font-normal text-cream/75">{m.app.overview.callNotConnected}</span>
    </button>
  );
}

export function EstateHeader({
  name,
  greeting,
  state,
  tone,
  worker,
  action,
  lastUpdate,
  nextUpdate,
}: {
  name: string;
  greeting: string;
  state: string;
  tone: EstateTone;
  worker: string;
  action: { href: string; label: string };
  lastUpdate: ReactNode;
  nextUpdate: ReactNode;
}) {
  const { m } = useI18n();
  return (
    <section aria-labelledby="estate-name" className="rounded-[var(--radius-card)] bg-espresso px-5 py-6 text-cream sm:px-8 sm:py-7">
      <div className="flex flex-wrap items-start justify-between gap-x-8 gap-y-5">
        <div className="min-w-0 flex-1 basis-80">
          <div className="flex items-center gap-3">
            <h1 id="estate-name" className="min-w-0 text-[2rem] font-semibold leading-tight tracking-[-0.02em] sm:text-[2.25rem]">{name}</h1>
            <CamelMark className="h-8 w-auto shrink-0 sm:h-9" />
          </div>
          <p className="mt-2 text-cream/75">{greeting}</p>
          <p className="mt-1 flex items-center gap-2.5 text-lg font-medium leading-snug sm:text-xl">
            <span className={`size-2.5 shrink-0 rounded-full ${toneDot[tone]}`} aria-hidden />
            {state}
          </p>
        </div>
        <div className="flex w-full flex-col gap-2.5 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center lg:w-72 lg:flex-col lg:items-stretch">
          <ButtonLink href={action.href} variant="light" className="w-full sm:w-auto lg:w-full">{action.label}</ButtonLink>
          <CallWorkerUnavailable worker={worker} />
        </div>
      </div>
      <div className="mt-6 flex flex-wrap gap-x-10 gap-y-4 border-t border-cream/15 pt-5">
        {lastUpdate ? <Fact label={m.app.overview.lastUpdateLabel}>{lastUpdate}</Fact> : null}
        <Fact label={m.app.overview.nextExpected}>{nextUpdate}</Fact>
        <WeatherLine className="min-w-0 flex-1 basis-56 self-end leading-relaxed text-cream/75" />
      </div>
    </section>
  );
}
