"use client";

import { Check, Drop, Eye, PhoneCall, PhoneDisconnect, PhoneIncoming, Plant, Sun, Waveform, type Icon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import type { CallCopy } from "./CallDimension";

/*
 * Four steps beside one flat phone. The active step picks the phone's screen:
 *   0 the incoming call · 1 the transcript · 2 the read-back and Ahmed's yes · 3 the owner's call.
 * A step becomes active on click/focus, and on desktop also when it crosses the middle of the viewport.
 * Only the active screen is rendered; it fades in once (instant under reduced motion).
 */
const FACT_ICONS: Icon[] = [Drop, Plant, Eye, Sun];
const FACT_TONES = ["text-[var(--ok)]", "text-[var(--warn)]", "text-[var(--warn)]", "text-[var(--text)]"];

function CallHeader({ caller }: { caller: string }) {
  return (
    <div className="flex items-center gap-2 border-b border-[var(--line)] pb-2 text-[0.6875rem] text-[var(--text-muted)]">
      <Waveform size={14} className="shrink-0 text-[var(--ember)]" aria-hidden />
      <span className="truncate">{caller}</span>
    </div>
  );
}

function Screen({ step, copy }: { step: number; copy: CallCopy }) {
  if (step === 0) {
    return (
      <div className="absolute inset-0 flex flex-col items-center justify-between px-4 pb-6 pt-12 text-center">
        <p className="text-[0.6875rem] text-[var(--text-faint)]">{copy.incoming.hint}</p>
        <div className="flex flex-col items-center gap-3">
          <span className="grid size-16 place-items-center rounded-full bg-[rgba(216,173,108,0.14)] text-[var(--gold-bright)] ring-1 ring-[var(--line-strong)]">
            <CamelMark className="h-7 w-auto" />
          </span>
          <p className="text-sm font-semibold text-[var(--text)]">{copy.incoming.caller}</p>
          <p className="text-[0.75rem] text-[var(--text-muted)]">{copy.incoming.status}</p>
        </div>
        <div className="flex w-full items-start justify-around">
          <span className="flex flex-col items-center gap-1.5 text-[0.6875rem] text-[var(--text-faint)]">
            <span className="grid size-11 place-items-center rounded-full bg-[rgba(155,53,36,0.45)] text-[var(--text)]">
              <PhoneDisconnect size={20} weight="fill" />
            </span>
            {copy.incoming.decline}
          </span>
          <span className="flex flex-col items-center gap-1.5 text-[0.6875rem] text-[var(--text-faint)]">
            <span className="grid size-11 place-items-center rounded-full bg-[var(--ok)] text-[var(--night-1)]">
              <PhoneIncoming size={20} weight="fill" />
            </span>
            {copy.incoming.answer}
          </span>
        </div>
      </div>
    );
  }

  if (step === 1) {
    return (
      <div className="absolute inset-0 flex flex-col px-3 pb-4 pt-10">
        <CallHeader caller={copy.incoming.caller} />
        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
          {copy.transcript.map((turn, index) => (
            <p key={index} className={`ph-bubble ${turn.who === "ahmed" ? "ph-bubble-ahmed" : "ph-bubble-naqah"}`}>
              {turn.text}
            </p>
          ))}
        </div>
      </div>
    );
  }

  if (step === 2) {
    return (
      <div className="absolute inset-0 flex flex-col px-3 pb-4 pt-10">
        <CallHeader caller={copy.incoming.caller} />
        <p className="mt-3 text-[0.6875rem] text-[var(--text-faint)]">{copy.readback.title}</p>
        <ul className="mt-2 flex flex-col gap-1.5">
          {copy.facts.map((fact, index) => {
            const FactIcon = FACT_ICONS[index] ?? Check;
            return (
              <li key={fact.topic} className="flex items-center gap-2 rounded-lg border border-[var(--line)] px-2.5 py-1.5">
                <FactIcon size={14} className="shrink-0 text-[var(--gold)]" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.6875rem] text-[var(--text-faint)]">{fact.topic}</span>
                  <span className={`block text-[0.75rem] font-semibold leading-4 ${FACT_TONES[index] ?? "text-[var(--text)]"}`}>{fact.value}</span>
                </span>
                <span className="shrink-0 text-end text-[0.6875rem] leading-3 text-[var(--text-faint)]">{fact.certainty}</span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex flex-col gap-1.5">
          <p className="ph-bubble ph-bubble-naqah">{copy.readback.ask}</p>
          <p className="ph-bubble ph-bubble-ahmed">{copy.readback.yes}</p>
        </div>
        <p className="mt-auto flex items-center justify-center gap-1.5 text-center text-[0.6875rem] text-[var(--gold-bright)]">
          <Check size={12} weight="bold" className="shrink-0" />
          <span className="ltr-nums">{copy.readback.saved}</span>
        </p>
        <p className="mt-1 text-center text-[0.6875rem] text-[var(--text-faint)]">{copy.readback.note}</p>
      </div>
    );
  }

  return (
    <div className="absolute inset-0 flex flex-col items-center px-4 pb-6 pt-12 text-center">
      <p className="text-[0.6875rem] text-[var(--text-faint)]">{copy.owner.hint}</p>
      <p className="ltr-nums mt-1 text-sm font-semibold text-[var(--gold-bright)]">{copy.owner.time}</p>
      <span className="mt-6 grid size-16 place-items-center rounded-full bg-[rgba(216,173,108,0.14)] text-[var(--gold-bright)] ring-1 ring-[var(--line-strong)]">
        <CamelMark className="h-7 w-auto" />
      </span>
      <p className="mt-6 text-pretty text-[0.82rem] leading-6 text-[var(--text)]">{copy.owner.summary}</p>
      <p className="mt-3 text-pretty text-[0.6875rem] leading-5 text-[var(--text-faint)]">{copy.owner.none}</p>
      <span className="mt-auto grid size-11 place-items-center rounded-full bg-[var(--ok)] text-[var(--night-1)]">
        <PhoneCall size={20} weight="fill" />
      </span>
    </div>
  );
}

function Phone({ active, copy }: { active: number; copy: CallCopy }) {
  return (
    <div className="ph-phone">
      <div className="ph-screen">
        <div key={active} className="ph-swap absolute inset-0">
          <Screen step={active} copy={copy} />
        </div>
      </div>
      <span className="ph-island" />
    </div>
  );
}

export function PhoneStage({ copy }: { copy: CallCopy }) {
  const [active, setActive] = useState(0);
  const stepsRef = useRef<HTMLOListElement>(null);

  // Desktop only: a step that crosses the middle of the viewport becomes active.
  useEffect(() => {
    const list = stepsRef.current;
    if (!list || typeof IntersectionObserver === "undefined") return;
    const desktop = window.matchMedia("(min-width: 1024px)");
    let observer: IntersectionObserver | null = null;
    const connect = () => {
      observer?.disconnect();
      observer = null;
      if (!desktop.matches) return;
      observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting) setActive(Number((entry.target as HTMLElement).dataset.step));
          }
        },
        { rootMargin: "-45% 0px -45% 0px" },
      );
      list.querySelectorAll<HTMLElement>("[data-step]").forEach((item) => observer?.observe(item));
    };
    connect();
    desktop.addEventListener("change", connect);
    return () => {
      desktop.removeEventListener("change", connect);
      observer?.disconnect();
    };
  }, []);

  return (
    <div className="night-frame mt-10 lg:mt-14">
      <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] lg:gap-16">
        {/* The phone beside the steps on desktop. Decorative: the steps and the hidden text equivalent carry the meaning. */}
        <div aria-hidden className="hidden justify-center lg:sticky lg:top-28 lg:order-2 lg:flex lg:self-start">
          <Phone active={active} copy={copy} />
        </div>

        <ol ref={stepsRef} className="ph-rail relative flex flex-col gap-2 lg:order-1">
          {copy.beats.map((beat, index) => {
            const on = index === active;
            return (
              <li key={beat.title} data-step={index}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => setActive(index)}
                  onFocus={() => setActive(index)}
                  className={`ph-step relative block min-h-11 w-full rounded-xl py-4 pe-3 ps-8 text-start lg:py-5 lg:ps-9 ${on ? "ph-step-on" : ""}`}
                >
                  <span aria-hidden className="absolute start-0 top-[1.45rem] size-[11px] rounded-full border border-[var(--gold)] lg:top-[1.7rem]">
                    {on ? <span className="absolute inset-[2px] rounded-full bg-[var(--gold-bright)]" /> : null}
                  </span>
                  <span className="ph-step-time block text-sm font-semibold text-[var(--gold-bright)]">
                    <span className="ltr-nums">{beat.time}</span>
                  </span>
                  <span className="mt-1.5 block text-xl font-semibold leading-tight text-[var(--text)] lg:text-2xl [html[lang=ar]_&]:leading-[1.35]">
                    {beat.title}
                  </span>
                  <span className="mt-2 block max-w-[30rem] text-pretty text-base leading-7 text-[var(--text-muted)]">{beat.body}</span>
                </button>
                {/* Small screens: the phone sits under the step it belongs to, so a tap is always visible. */}
                {on ? (
                  <div aria-hidden className="flex justify-center pb-4 ps-8 pt-2 lg:hidden">
                    <Phone active={active} copy={copy} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}
