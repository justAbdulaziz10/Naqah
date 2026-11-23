"use client";

import { Check, Drop, Eye, PhoneCall, PhoneDisconnect, PhoneIncoming, Plant, Sun, Waveform, type Icon } from "@phosphor-icons/react";
import {
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
  type MotionValue,
} from "motion/react";
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import type { Locale } from "@/domain/types";
import { CamelMark } from "@/components/brand/CamelMark";
import type { CallCopy } from "./CallDimension";

/*
 * One scroll progress (0 → 1) drives the whole stage:
 *   0.00–0.25  the phone rings (ember rings, incoming call)
 *   0.25–0.50  the transcript fills, one line at a time
 *   0.50–0.78  the read-back, then the facts fly out to the ledger; the yes comes last
 *   0.78–1.00  the phone flips to the owner's side and the summary is spoken
 * Desktop pins the stage beside the four beats; phones read the stage as it passes the viewport.
 */
const FROZEN = 0.66; // Reduced motion: the read-back with every fact landed.
const SPRING = { stiffness: 90, damping: 22, mass: 0.6 };
const FACT_ICONS: Icon[] = [Drop, Plant, Eye, Sun];
const FACT_TONES = ["text-[var(--ok)]", "text-[var(--warn)]", "text-[var(--warn)]", "text-[var(--text)]"];

function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** Fades and lifts a line in at one point of the progress. */
function Reveal({ progress, at, span = 0.025, className, children }: { progress: MotionValue<number>; at: number; span?: number; className?: string; children: ReactNode }) {
  const opacity = useTransform(progress, [at, at + span], [0, 1]);
  const y = useTransform(progress, [at, at + span], [10, 0]);
  return (
    <motion.div style={{ opacity, y }} className={className}>
      {children}
    </motion.div>
  );
}

function TranscriptLine({ progress, index, count, who, children }: { progress: MotionValue<number>; index: number; count: number; who: string; children: ReactNode }) {
  const at = 0.27 + index * (0.22 / count);
  return (
    <Reveal progress={progress} at={at} className={`ph-bubble ${who === "ahmed" ? "ph-bubble-ahmed" : "ph-bubble-naqah"}`}>
      {children}
    </Reveal>
  );
}

function FactCard({
  progress,
  index,
  fromX,
  icon: FactIcon,
  tone,
  topic,
  value,
  certainty,
  emphasis = false,
}: {
  progress: MotionValue<number>;
  index: number;
  fromX: number;
  icon: Icon;
  tone: string;
  topic: string;
  value: string;
  certainty?: string;
  emphasis?: boolean;
}) {
  const at = 0.57 + index * 0.04;
  const x = useTransform(progress, [at, at + 0.05], [fromX, 0]);
  const scale = useTransform(progress, [at, at + 0.05], [0.6, 1]);
  const opacity = useTransform(progress, [at, at + 0.04], [0, 1]);
  return (
    <motion.li
      style={{ x, scale, opacity }}
      className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${emphasis ? "border-[rgba(216,173,108,0.5)] bg-[rgba(216,173,108,0.08)]" : "border-[var(--line)] bg-[rgba(253,250,243,0.04)]"}`}
    >
      <FactIcon size={18} weight={emphasis ? "bold" : "regular"} className={`shrink-0 ${emphasis ? "text-[var(--gold-bright)]" : "text-[var(--gold)]"}`} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block text-[0.7rem] text-[var(--text-faint)]">{topic}</span>
        <span className={`block text-sm font-semibold leading-5 ${tone}`}>{value}</span>
      </span>
      {certainty ? <span className="shrink-0 text-[0.7rem] text-[var(--text-faint)]">{certainty}</span> : null}
    </motion.li>
  );
}

function Beat({ progress, index, time, title, body }: { progress: MotionValue<number>; index: number; time: string; title: string; body: string }) {
  const start = index / 4;
  const end = (index + 1) / 4;
  const opacity = useTransform(progress, [start - 0.08, start, end - 0.03, end + 0.05], [0.38, 1, 1, 0.38]);
  const dot = useTransform(progress, [start - 0.03, start, end - 0.03, end + 0.03], [0, 1, 1, 0]);
  return (
    <motion.li style={{ opacity }} className="relative flex flex-col justify-center py-10 ps-7 lg:min-h-[85svh] lg:py-0 lg:ps-9">
      <span aria-hidden className="absolute start-0 top-1/2 size-[11px] -translate-y-1/2 rounded-full border border-[var(--gold)] max-lg:top-[3.65rem]">
        <motion.span style={{ opacity: dot }} className="absolute inset-[2px] rounded-full bg-[var(--gold-bright)]" />
      </span>
      <p className="ltr-nums text-sm font-semibold text-[var(--gold-bright)]">{time}</p>
      <h3 className="mt-2 text-2xl font-semibold leading-tight text-[var(--text)] lg:text-3xl [html[lang=ar]_&]:leading-[1.3]">{title}</h3>
      <p className="mt-3 max-w-[28rem] text-pretty text-base leading-7 text-[var(--text-muted)] lg:text-lg lg:leading-8">{body}</p>
    </motion.li>
  );
}

export function PhoneStage({ locale, copy }: { locale: Locale; copy: CallCopy }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const desktop = useMediaQuery("(min-width: 1024px)");
  const reduced = useReducedMotion() ?? false;

  const progress = useMotionValue(0);
  const pinned = useScroll({ target: containerRef, offset: ["start start", "end end"] });
  const passing = useScroll({ target: stageRef, offset: ["start 0.9", "end 0.15"] });
  useMotionValueEvent(pinned.scrollYProgress, "change", (value) => {
    if (desktop && !reduced) progress.set(value);
  });
  useMotionValueEvent(passing.scrollYProgress, "change", (value) => {
    if (!desktop && !reduced) progress.set(value);
  });
  useEffect(() => {
    if (reduced) progress.set(FROZEN);
    else progress.set(desktop ? pinned.scrollYProgress.get() : passing.scrollYProgress.get());
  }, [desktop, reduced, progress, pinned.scrollYProgress, passing.scrollYProgress]);

  // The ledger sits on the end side of the phone, so the facts fly toward it from the phone.
  const fromX = locale === "ar" ? 160 : -160;

  const rotateY = useSpring(useTransform(progress, [0, 0.24, 0.5, 0.76, 0.9, 1], [-14, 10, -8, -8, 180, 180]), SPRING);
  const rotateX = useSpring(useTransform(progress, [0, 0.5, 1], [7, -5, 3]), SPRING);
  const ringsOpacity = useTransform(progress, [0, 0.2, 0.26], [1, 1, 0]);
  const rimOpacity = useTransform(progress, [0, 0.22, 0.3, 0.8, 0.9, 1], [1, 0.9, 0.25, 0.25, 1, 1]);
  const incomingOpacity = useTransform(progress, [0, 0.22, 0.27], [1, 1, 0]);
  const transcriptOpacity = useTransform(progress, [0.22, 0.27, 0.5, 0.55], [0, 1, 1, 0]);
  const readbackOpacity = useTransform(progress, [0.5, 0.55, 1], [0, 1, 1]);
  const ledgerOpacity = useTransform(progress, [0.76, 0.86], [1, 0.55]);

  const transcriptHeader = (
    <div className="flex items-center gap-2 border-b border-[var(--line)] pb-2 text-[0.65rem] text-[var(--text-muted)]">
      <Waveform size={14} className="shrink-0 text-[var(--ember)]" aria-hidden />
      <span className="truncate">{copy.incoming.caller}</span>
    </div>
  );

  return (
    <div ref={containerRef} className="night-frame relative mt-10 lg:mt-4">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:gap-16">
        {/* The stage. Decorative: the beats and the hidden text equivalent carry the meaning. */}
        <div ref={stageRef} aria-hidden className="ph-stage relative flex items-center justify-center py-6 lg:sticky lg:top-0 lg:order-2 lg:h-svh lg:py-0">
          <div className="flex w-full flex-col items-center gap-10 lg:flex-row lg:items-center lg:justify-center lg:gap-12">
            <div className="relative shrink-0">
              <motion.div style={{ opacity: ringsOpacity }} className="pointer-events-none absolute inset-0">
                {[0, 1, 2].map((ring) => (
                  <span key={ring} className="ph-ring" style={{ animationDelay: `${ring * 0.9}s` }} />
                ))}
              </motion.div>

              <div className="ph-float">
                <motion.div className="ph-phone" style={{ rotateY, rotateX }}>
                  <motion.span className="ph-rim" style={{ opacity: rimOpacity }} />
                  {[1, 2, 3, 4, 5, 6, 7].map((slice) => (
                    <span key={slice} className="ph-depth" style={{ transform: `translateZ(${-slice * 2}px)` }} />
                  ))}

                  {/* Front: the worker's phone. */}
                  <div className="ph-face ph-front">
                    <div className="ph-screen">
                      <motion.div style={{ opacity: incomingOpacity }} className="absolute inset-0 flex flex-col items-center justify-between px-4 pb-6 pt-12 text-center">
                        <p className="text-[0.65rem] text-[var(--text-faint)]">{copy.incoming.hint}</p>
                        <div className="flex flex-col items-center gap-3">
                          <span className="grid size-16 place-items-center rounded-full bg-[rgba(216,173,108,0.14)] text-[var(--gold-bright)] ring-1 ring-[var(--line-strong)]">
                            <CamelMark className="h-7 w-auto" />
                          </span>
                          <p className="text-sm font-semibold text-[var(--text)]">{copy.incoming.caller}</p>
                          <p className="text-[0.7rem] text-[var(--text-muted)]">{copy.incoming.status}</p>
                        </div>
                        <div className="flex w-full items-start justify-around">
                          <span className="flex flex-col items-center gap-1.5 text-[0.6rem] text-[var(--text-faint)]">
                            <span className="grid size-11 place-items-center rounded-full bg-[rgba(155,53,36,0.45)] text-[var(--text)]">
                              <PhoneDisconnect size={20} weight="fill" />
                            </span>
                            {copy.incoming.decline}
                          </span>
                          <span className="flex flex-col items-center gap-1.5 text-[0.6rem] text-[var(--text-faint)]">
                            <span className="grid size-11 place-items-center rounded-full bg-[var(--ok)] text-[var(--night-1)]">
                              <PhoneIncoming size={20} weight="fill" />
                            </span>
                            {copy.incoming.answer}
                          </span>
                        </div>
                      </motion.div>

                      <motion.div style={{ opacity: transcriptOpacity }} className="absolute inset-0 flex flex-col px-3 pb-4 pt-10">
                        {transcriptHeader}
                        <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
                          {copy.transcript.map((turn, index) => (
                            <TranscriptLine key={index} progress={progress} index={index} count={copy.transcript.length} who={turn.who}>
                              {turn.text}
                            </TranscriptLine>
                          ))}
                        </div>
                      </motion.div>

                      <motion.div style={{ opacity: readbackOpacity }} className="absolute inset-0 flex flex-col px-3 pb-4 pt-10">
                        {transcriptHeader}
                        <p className="mt-3 text-[0.65rem] text-[var(--text-faint)]">{copy.readback.title}</p>
                        <ul className="mt-2 flex flex-col gap-1.5">
                          {copy.readback.lines.map((line, index) => (
                            <li key={line}>
                              <Reveal progress={progress} at={0.56 + index * 0.03} className="flex items-center gap-2 text-[0.72rem] leading-5 text-[var(--text)]">
                                <Check size={12} weight="bold" className="shrink-0 text-[var(--gold-bright)]" />
                                <span>{line}</span>
                              </Reveal>
                            </li>
                          ))}
                        </ul>
                        <div className="mt-3 flex flex-col gap-1.5">
                          <Reveal progress={progress} at={0.69} className="ph-bubble ph-bubble-naqah">
                            {copy.readback.ask}
                          </Reveal>
                          <Reveal progress={progress} at={0.72} className="ph-bubble ph-bubble-ahmed">
                            {copy.readback.yes}
                          </Reveal>
                        </div>
                        <Reveal progress={progress} at={0.755} className="mt-auto text-center text-[0.65rem] text-[var(--text-faint)]">
                          <span className="ltr-nums">{copy.readback.saved}</span>
                        </Reveal>
                      </motion.div>
                    </div>
                    <span className="ph-island" />
                  </div>

                  {/* Back: the owner's phone, revealed by the flip. */}
                  <div className="ph-face ph-back">
                    <div className="ph-screen">
                      <div className="absolute inset-0 flex flex-col items-center px-4 pb-6 pt-12 text-center">
                        <p className="text-[0.65rem] text-[var(--text-faint)]">{copy.owner.hint}</p>
                        <p className="ltr-nums mt-1 text-sm font-semibold text-[var(--gold-bright)]">{copy.owner.time}</p>
                        <span className="mt-6 grid size-16 place-items-center rounded-full bg-[rgba(216,173,108,0.14)] text-[var(--gold-bright)] ring-1 ring-[var(--line-strong)]">
                          <CamelMark className="h-7 w-auto" />
                        </span>
                        <Reveal progress={progress} at={0.9} span={0.06} className="mt-6">
                          <p className="text-pretty text-[0.82rem] leading-6 text-[var(--text)]">{copy.owner.summary}</p>
                        </Reveal>
                        <Reveal progress={progress} at={0.95} span={0.04} className="mt-3">
                          <p className="text-pretty text-[0.65rem] leading-5 text-[var(--text-faint)]">{copy.owner.none}</p>
                        </Reveal>
                        <span className="mt-auto grid size-11 place-items-center rounded-full bg-[var(--ok)] text-[var(--night-1)]">
                          <PhoneCall size={20} weight="fill" />
                        </span>
                      </div>
                    </div>
                    <span className="ph-island" />
                  </div>
                </motion.div>
              </div>
            </div>

            {/* The ledger: what NAQAH kept, each fact labelled in words. */}
            <motion.div style={{ opacity: ledgerOpacity }} className="night-glass w-full max-w-[21rem] p-4 lg:p-5">
              <p className="text-sm font-semibold text-[var(--text)]">{copy.kept.title}</p>
              <p className="mt-0.5 text-xs text-[var(--text-faint)]">{copy.kept.note}</p>
              <ul className="mt-4 flex flex-col gap-2">
                {copy.facts.map((fact, index) => (
                  <FactCard
                    key={fact.topic}
                    progress={progress}
                    index={index}
                    fromX={fromX}
                    icon={FACT_ICONS[index] ?? Check}
                    tone={FACT_TONES[index] ?? "text-[var(--text)]"}
                    topic={fact.topic}
                    value={fact.value}
                    certainty={fact.certainty}
                  />
                ))}
                <FactCard progress={progress} index={copy.facts.length} fromX={fromX} icon={Check} tone="text-[var(--gold-bright)]" topic={copy.readback.title} value={copy.kept.yes} emphasis />
              </ul>
              <Reveal progress={progress} at={0.77} className="mt-3 text-xs text-[var(--text-faint)]">
                {copy.kept.savedAfter}
              </Reveal>
            </motion.div>
          </div>
        </div>

        {/* The four beats. On desktop they scroll past the pinned stage and drive it. */}
        <ol className="ph-rail relative flex flex-col lg:order-1">
          {copy.beats.map((beat, index) => (
            <Beat key={beat.title} progress={progress} index={index} time={beat.time} title={beat.title} body={beat.body} />
          ))}
        </ol>
      </div>
    </div>
  );
}
