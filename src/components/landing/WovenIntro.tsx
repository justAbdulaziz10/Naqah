"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { CamelMark } from "@/components/brand/CamelMark";

const SEEN_KEY = "naqah-intro-seen";
const SEEN_CHECK = `<script>try{if(sessionStorage.getItem("${SEEN_KEY}")==="1")document.documentElement.setAttribute("data-intro-seen","")}catch(e){}</script>`;
/** When the mark leaves for the navbar, in ms from navigation start (CSS draws the threads before). */
const FLIGHT_AT = 1100;
/** Threads of the woven reveal: colour class and the side each unweaves to (1 = inline end). */
const THREADS = [
  { tone: "fill-brown", dir: -1 },
  { tone: "fill-sand", dir: 1 },
  { tone: "fill-gold", dir: -1 },
  { tone: "fill-crimson-editorial", dir: 1 },
  { tone: "fill-gold", dir: -1 },
  { tone: "fill-sand", dir: 1 },
  { tone: "fill-brown", dir: -1 },
] as const;

/**
 * Woven logo reveal (owner-selected Option B): threads weave across, unweave to reveal the
 * official mark, then the mark moves into the navbar. The mark's shape is never altered; it only
 * fades, scales uniformly and travels. Once per session, skippable by any input, absent under
 * reduced motion, and the CSS failsafe clears it even if this script never runs.
 */
export function WovenIntro({ skipLabel }: { skipLabel: string }) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLDivElement>(null);
  const skipRef = useRef<() => void>(() => undefined);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    const mark = markRef.current;
    if (!overlay || !mark) return;
    const html = document.documentElement;

    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Storage unavailable: play once for this page view.
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elapsed = performance.now();

    const animations: Animation[] = [];
    let timer = 0;
    const events = ["keydown", "wheel", "touchstart", "pointerdown"] as const;
    const finish = () => {
      window.clearTimeout(timer);
      animations.forEach((animation) => animation.cancel());
      overlay.style.display = "none";
      html.removeAttribute("data-intro-playing");
      events.forEach((name) => window.removeEventListener(name, finish));
    };
    skipRef.current = finish;

    // Already seen, reduced motion, or arriving late (e.g. a slow hydration or client navigation).
    if (seen || reduced || elapsed > FLIGHT_AT + 250) {
      finish();
      return finish;
    }

    overlay.style.animation = "none"; // The script owns the ending; the CSS failsafe is not needed.
    html.setAttribute("data-intro-playing", "");
    events.forEach((name) => window.addEventListener(name, finish, { passive: true }));

    timer = window.setTimeout(() => {
      const target = document.querySelector("header [data-brand-mark]");
      if (!target) return finish();
      const from = mark.getBoundingClientRect();
      const to = target.getBoundingClientRect();
      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      const scale = to.width / from.width;
      overlay.style.pointerEvents = "none";
      overlay.querySelector("button")?.style.setProperty("visibility", "hidden");
      // The mark travels; only the ivory ground fades, so the page shows through as it lands.
      const flight = mark.animate(
        [{ transform: "none" }, { transform: `translate(${dx}px, ${dy}px) scale(${scale})` }],
        { duration: 650, easing: "cubic-bezier(0.76, 0, 0.24, 1)", fill: "forwards" },
      );
      const ground = overlay.animate(
        [{ backgroundColor: getComputedStyle(overlay).backgroundColor }, { backgroundColor: "transparent" }],
        { duration: 480, easing: "cubic-bezier(0.33, 1, 0.68, 1)", fill: "forwards" },
      );
      animations.push(flight, ground);
      flight.finished.then(finish, () => undefined);
    }, Math.max(0, FLIGHT_AT - elapsed));

    return finish;
  }, []);

  return (
    <>
      {/*
        Before paint on a full load: hide the intro if it already played this session. Delivered as
        server HTML (not a React <script>), so client navigations neither run nor warn about it;
        the layout effect above covers those.
      */}
      <div hidden dangerouslySetInnerHTML={{ __html: SEEN_CHECK }} />
      <div
        ref={overlayRef}
        className="naqah-intro fixed inset-0 z-[70] grid place-items-center bg-ivory"
        role="presentation"
      >
        <div className="relative grid place-items-center">
          <div ref={markRef} className="naqah-intro-mark">
            <CamelMark className="h-24 w-auto sm:h-32" />
          </div>
          <svg
            viewBox="0 0 320 140"
            className="pointer-events-none absolute w-[min(80vw,26rem)]"
            aria-hidden="true"
            focusable="false"
          >
            {THREADS.map((thread, index) => (
              <rect
                key={index}
                x="0"
                y={8 + index * 18}
                width="320"
                height="10"
                className={`naqah-intro-thread ${thread.tone}`}
                style={{ "--i": index, "--dir": thread.dir } as CSSProperties}
              />
            ))}
          </svg>
        </div>
        <button
          type="button"
          onClick={() => skipRef.current()}
          className="absolute bottom-8 inline-flex min-h-11 items-center rounded-full px-5 text-[0.9375rem] font-semibold text-brown underline decoration-1 underline-offset-4 transition-colors hover:text-espresso"
        >
          {skipLabel}
        </button>
      </div>
    </>
  );
}
