"use client";

import { Check } from "@phosphor-icons/react";
import Image from "next/image";
import { Logo } from "@/components/brand/Logo";
import { useCallSentence } from "@/components/schedule/ReportCallSection";
import { LANDING_PHOTOS } from "@/components/landing/photos";
import type { Workspace } from "@/domain/types";
import { useI18n } from "@/i18n/client";
import { cn } from "@/lib/cn";
import { stepNeedsFixing, WIZARD_STEPS, type WizardStepKey } from "./WizardSteps";
import "./onboarding.css";

/** What the owner has given each step so far, in a few words; nothing when the step is untouched. */
function useRecaps(ws: Workspace): Record<WizardStepKey, string | null> {
  const { m, fmt } = useI18n();
  const call = useCallSentence(ws);
  const { farm, worker, herdCount } = ws.settings;
  const ranch = [farm.name.trim(), farm.location.trim()].filter(Boolean).join(" · ");
  const herd = herdCount === null || herdCount === undefined ? "" : m.setup.flow.recapCamels(fmt.number(herdCount));
  const team = [worker.name.trim(), herd].filter(Boolean).join(" · ");
  return { ranch: ranch || null, team: team || null, call: call?.sentence ?? null, ready: null };
}

/**
 * Setup as a journey on the product's time line: filled dots for finished steps, a gold ring for the
 * step in hand, open rings ahead. Finished steps carry what was entered, so the owner sees the ranch
 * take shape. Wide screens only; phones get `JourneyBar`.
 */
export function JourneyPanel({ ws, step, onGo }: { ws: Workspace; step: number; onGo: (index: number) => void }) {
  const { m, locale, href } = useI18n();
  const f = m.setup.flow;
  const recaps = useRecaps(ws);
  const photo = LANDING_PHOTOS.herder;

  return (
    <aside className="relative flex h-dvh flex-col overflow-hidden bg-espresso text-cream lg:sticky lg:top-0">
      <div className="relative z-10 flex flex-1 flex-col px-10 py-9">
        <Logo locale={locale} href={href("/")} tone="light" />
        <nav aria-label={f.stepsNav} className="mt-14">
          <p className="text-2xl font-semibold leading-snug">{f.title}</p>
          <p className="mt-2 max-w-[18rem] text-balance text-[0.9375rem] leading-relaxed text-cream/70">{m.onboarding.flow.panelLine}</p>
          <ol className="relative mt-10">
            {WIZARD_STEPS.map((key, index) => {
              const done = index < step && !stepNeedsFixing(key, ws);
              const here = index === step;
              const last = index === WIZARD_STEPS.length - 1;
              const recap = recaps[key];
              return (
                <li key={key} className="relative pb-7 ps-9 last:pb-0">
                  {last ? null : (
                    <span
                      aria-hidden
                      className={cn(
                        "absolute start-[7px] top-6 -bottom-1 w-0",
                        done ? "border-s-2 border-gold" : "border-s-2 border-dashed border-cream/25",
                      )}
                    />
                  )}
                  <span
                    aria-hidden
                    className={cn(
                      "absolute start-0 top-1 flex size-4 items-center justify-center rounded-full transition-colors duration-300",
                      done ? "naqah-done bg-gold text-espresso" : here ? "naqah-ring border-2 border-gold bg-gold" : "border-2 border-cream/35 bg-espresso",
                    )}
                  >
                    {done ? <Check size={10} weight="bold" /> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => onGo(index)}
                    aria-current={here ? "step" : undefined}
                    className={cn(
                      "-mx-2 -my-1.5 flex min-h-11 w-full flex-col items-start rounded-lg px-2 py-1.5 text-start transition-colors focus-visible:outline-2 focus-visible:outline-gold",
                      here ? "text-cream" : "text-cream/70 hover:bg-cream/5 hover:text-cream",
                    )}
                  >
                    <span className={cn("text-[1.0625rem]", here && "font-semibold")}>{f.steps[key]}</span>
                    {recap && (done || here) ? (
                      <span className="mt-0.5 line-clamp-2 text-[0.875rem] leading-snug text-sand [overflow-wrap:anywhere]">{recap}</span>
                    ) : null}
                    {done ? <span className="sr-only">({f.stepDone})</span> : null}
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>
      </div>
      {/* The kind of evening call NAQAH makes: a herder and his camel. */}
      {photo ? (
        <div className="relative h-[34%] min-h-48 shrink-0">
          <Image src={photo.src} alt="" fill sizes="25rem" className="object-cover" style={{ objectPosition: photo.focus }} />
          <div aria-hidden className={"absolute inset-x-0 top-0 h-1/2 bg-linear-to-b from-espresso to-transparent" /* taste-skill-ignore: scrim joining photo to panel */} />
        </div>
      ) : null}
    </aside>
  );
}

/** Phones and tablets: the same journey as a compact line of dots with the current step named. */
export function JourneyBar({ step }: { step: number }) {
  const { m } = useI18n();
  const f = m.setup.flow;
  const current = WIZARD_STEPS[step];
  const upcoming = WIZARD_STEPS[step + 1];
  // The heading below names this step, so the bar says where it stands and what comes next.
  return (
    <div className="mx-auto w-full max-w-[44rem] px-4 pt-5 sm:px-6 lg:hidden">
      <div className="flex items-baseline justify-between gap-4 text-[0.9375rem]">
        {/* Not .ltr-nums: in Arabic the whole phrase reads right to left («1 من 4»). */}
        <span className="font-semibold tabular-nums text-espresso">{f.stepOf(step + 1, WIZARD_STEPS.length)}</span>
        {upcoming ? <span className="text-muted">{m.onboarding.flow.next(f.steps[upcoming])}</span> : null}
      </div>
      <div
        className="relative mt-3 flex items-center justify-between"
        role="progressbar"
        aria-label={f.progressLabel}
        aria-valuemin={1}
        aria-valuemax={WIZARD_STEPS.length}
        aria-valuenow={step + 1}
        aria-valuetext={`${f.stepOf(step + 1, WIZARD_STEPS.length)} · ${f.steps[current]}`}
      >
        <span aria-hidden className="absolute inset-x-1.5 top-1/2 h-0.5 -translate-y-1/2 bg-stone" />
        <span
          aria-hidden
          className="absolute start-1.5 top-1/2 h-0.5 -translate-y-1/2 bg-brown transition-[width] duration-500"
          style={{ width: `calc((100% - 0.75rem) * ${step / (WIZARD_STEPS.length - 1)})` }}
        />
        {WIZARD_STEPS.map((key, index) => (
          <span
            key={key}
            aria-hidden
            className={cn(
              "relative size-3 rounded-full transition-colors duration-300",
              index < step ? "naqah-done bg-brown" : index === step ? "naqah-ring border-2 border-brown bg-brown" : "border-2 border-stone bg-ivory",
            )}
          />
        ))}
      </div>
    </div>
  );
}

/** The calm moment after the last step, shown while the dashboard opens. The logo stays still. */
export function FinishMoment() {
  const { m } = useI18n();
  const f = m.setup.flow;
  return (
    <div role="status" className="flex min-h-dvh flex-col items-center justify-center bg-espresso px-6 text-center text-cream">
      <span className="naqah-finish-mark relative flex size-20 items-center justify-center rounded-full border-2 border-gold text-gold">
        <Check size={34} weight="bold" aria-hidden />
      </span>
      <p className="naqah-finish-text mt-8 text-[clamp(2rem,5vw,3rem)] font-semibold leading-tight">{f.finishTitle}</p>
      <p className="naqah-finish-text mt-3 max-w-md text-lg leading-8 text-cream/80 [animation-delay:120ms]">{f.finishLine}</p>
      <p className="naqah-finish-text mt-10 text-[0.9375rem] text-sand [animation-delay:240ms]">{f.opening}</p>
    </div>
  );
}
