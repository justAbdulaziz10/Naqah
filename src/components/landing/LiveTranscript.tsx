"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

const STEP_MS = 1100;
const HOLD_MS = 3600;

/**
 * The worker's call, set as a timestamped ledger. Rows reveal one by one; every row is
 * always in the layout (no shift) and in the accessibility tree. Reduced motion shows all.
 */
export function LiveTranscript() {
  const { m } = useI18n();
  const call = m.landing.call;
  const total = call.lines.length + 2; // lines, saved facts, owner call
  const [shown, setShown] = useState(total);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.matches) return;
    let step = 1;
    let timer = 0;
    const tick = () => {
      timer = window.setTimeout(
        () => {
          step = step >= total ? 1 : step + 1;
          setShown(step);
          tick();
        },
        step >= total ? HOLD_MS : STEP_MS,
      );
    };
    const onChange = (event: MediaQueryListEvent) => {
      if (!event.matches) return;
      window.clearTimeout(timer);
      setShown(total);
    };
    timer = window.setTimeout(() => {
      setShown(step);
      tick();
    }, 40);
    motion.addEventListener("change", onChange);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener("change", onChange);
    };
  }, [total]);

  const reveal = (index: number) =>
    `transition-[opacity,translate] duration-500 ease-out ${index < shown ? "opacity-100" : "translate-y-1 opacity-0"}`;

  return (
    <figure className="border-t-2 border-espresso">
      <figcaption className="flex items-baseline justify-between gap-4 py-4 text-sm">
        <span className="font-semibold">{call.label}</span>
        <span className="ltr-nums shrink-0 tabular-nums text-faint">17:42</span>
      </figcaption>

      <ol className="border-t border-stone">
        {call.lines.map((line, index) => {
          const naqah = line.who === "naqah";
          return (
            <li
              key={index}
              className={`grid grid-cols-[3rem_1fr] gap-x-4 border-b border-stone py-3.5 sm:grid-cols-[3rem_4.5rem_1fr] ${reveal(index)}`}
            >
              <span className="ltr-nums pt-0.5 text-xs tabular-nums text-faint">{line.time}</span>
              <span className={`text-sm font-semibold ${naqah ? "text-gold" : "text-espresso"} max-sm:hidden`}>
                {naqah ? call.naqah : call.worker}
              </span>
              <p className={`text-[0.95rem] leading-relaxed ${naqah ? "text-muted" : "text-espresso"}`}>
                <span className={`me-2 font-semibold sm:hidden ${naqah ? "text-gold" : ""}`}>
                  {naqah ? call.naqah : call.worker}
                </span>
                {line.text}
              </p>
            </li>
          );
        })}

        <li className={`grid grid-cols-[3rem_1fr] gap-x-4 border-b border-stone py-4 sm:grid-cols-[3rem_4.5rem_1fr] ${reveal(call.lines.length)}`}>
          <span className="ltr-nums pt-0.5 text-xs tabular-nums text-faint">17:44</span>
          <span className="text-sm font-semibold text-ok max-sm:hidden">{call.saved}</span>
          <div className="grid gap-2">
            <span className="text-sm font-semibold text-ok sm:hidden">{call.saved}</span>
            <dl className="grid gap-2">
            {call.facts.map((fact) => (
              <div key={fact.label} className="flex flex-wrap items-baseline gap-x-2">
                <dt className="font-semibold">{fact.label}</dt>
                <dd className="flex flex-wrap items-baseline gap-x-2">
                  <span>{fact.value}</span>
                  <span className="text-sm text-faint">{fact.certainty}</span>
                </dd>
              </div>
            ))}
            </dl>
          </div>
        </li>

        <li className={`grid grid-cols-[3rem_1fr] gap-x-4 py-4 sm:grid-cols-[3rem_4.5rem_1fr] ${reveal(call.lines.length + 1)}`}>
          <span className="ltr-nums pt-0.5 text-xs tabular-nums text-faint">17:44</span>
          <span className="max-sm:hidden" aria-hidden="true" />
          <p className="flex items-center gap-2.5 font-semibold text-brown">
            <span className="relative flex size-2" aria-hidden="true">
              <span className="absolute inset-0 rounded-full bg-brown motion-safe:animate-pulse-ring" />
              <span className="relative size-2 rounded-full bg-brown" />
            </span>
            {call.next}
          </p>
        </li>
      </ol>
    </figure>
  );
}
