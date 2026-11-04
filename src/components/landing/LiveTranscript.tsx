"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

/** A short conversation reveals line by line; reduced-motion users see the full exchange. */
export function LiveTranscript() {
  const { m } = useI18n();
  const lines = m.landing.hero.transcript;
  const [visibleCount, setVisibleCount] = useState(lines.length);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    let timer = 0;

    if (preference.matches) {
      return;
    }

    let current = 1;

    const revealNext = () => {
      timer = window.setTimeout(() => {
        if (preference.matches) {
          setVisibleCount(lines.length);
          return;
        }

        if (current < lines.length) {
          current += 1;
          setVisibleCount(current);
          revealNext();
          return;
        }

        timer = window.setTimeout(() => {
          current = 1;
          setVisibleCount(current);
          revealNext();
        }, 3200);
      }, 1150);
    };

    const onMotionChange = (event: MediaQueryListEvent) => {
      if (event.matches) {
        window.clearTimeout(timer);
        setVisibleCount(lines.length);
      }
    };

    preference.addEventListener("change", onMotionChange);
    timer = window.setTimeout(() => {
      setVisibleCount(current);
      revealNext();
    }, 40);
    return () => {
      window.clearTimeout(timer);
      preference.removeEventListener("change", onMotionChange);
    };
  }, [lines.length]);

  return (
    <div className="rounded-[1.25rem] bg-espresso p-5 text-cream sm:p-7">
      <div className="mb-6 flex items-center justify-between gap-4 border-b border-cream/10 pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="inline-flex size-2.5 shrink-0 rounded-full bg-ok ring-2 ring-ok/25" aria-hidden="true" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-cream">{m.landing.hero.callLabel}</p>
            <p className="mt-0.5 text-xs text-cream/60">{m.landing.hero.callStatus}</p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-cream/15 px-3 py-1.5 text-xs text-cream/75">
          {m.common.demo.badge}
        </span>
      </div>

      <div className="mb-4 flex items-center gap-3">
        <span className="inline-flex size-10 items-center justify-center rounded-full bg-cream/10 text-sm font-semibold text-cream" aria-hidden="true">
          {m.landing.hero.worker.slice(0, 1)}
        </span>
        <div>
          <p className="text-sm font-semibold text-cream">{m.landing.hero.worker}</p>
          <p className="mt-0.5 text-xs text-cream/60">{m.landing.hero.ordinaryPhone}</p>
        </div>
      </div>

      <ol aria-label={m.landing.hero.callLabel} className="flex flex-col gap-2.5">
        {lines.map((line, index) => {
          const isAgent = index % 2 === 1;
          if (index >= visibleCount) return null;
          return (
            <li
              key={`${index}-${line}`}
              className={`motion-safe:animate-fade-up max-w-[92%] rounded-2xl px-4 py-3 text-sm leading-relaxed sm:max-w-[84%] ${
                isAgent
                  ? "self-end bg-sand-soft text-espresso"
                  : "self-start bg-white/10 text-cream"
              } ${isAgent ? "ms-auto" : "me-auto"}`}
            >
              <span className="mb-1 block text-[0.68rem] font-semibold text-current/65">
                {isAgent ? m.landing.hero.naqah : m.landing.hero.worker}
              </span>
              {line}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
