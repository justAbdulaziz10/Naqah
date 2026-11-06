"use client";

import { useLayoutEffect, useRef, type CSSProperties } from "react";
import { CamelMark } from "@/components/brand/CamelMark";
import "./intro.css";

const SEEN_KEY = "naqah-intro-seen";
const SEEN_CHECK = `<script>try{if(sessionStorage.getItem("${SEEN_KEY}")==="1")document.documentElement.setAttribute("data-intro-seen","")}catch(e){}</script>`;
/** When the CSS finishes, in ms from navigation start. */
const CLEARS_AT = 1400;
const STRIPS = 9;
const CENTRE = (STRIPS - 1) / 2;

/**
 * Opening intro: the official mark fades in on a dark warp, then the strips draw apart, centre
 * first, to reveal the hero. The mark is never moved or scaled. Once per session, dismissed by any
 * input, absent under reduced motion, and it never blocks the page beneath it.
 */
export function WovenIntro() {
  const overlayRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;

    // Strict Mode runs this twice: the flag on the node tells that apart from a repeat visit.
    const started = overlay.dataset.started === "1";
    overlay.dataset.started = "1";
    let seen = false;
    try {
      seen = !started && sessionStorage.getItem(SEEN_KEY) === "1";
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      // Storage unavailable: play once for this page view.
    }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const elapsed = performance.now();

    const hide = () => {
      overlay.style.display = "none";
    };
    // Already seen, reduced motion, or arriving late (e.g. a slow hydration or client navigation).
    if (seen || reduced || elapsed > CLEARS_AT + 250) {
      hide();
      return;
    }

    const events = ["keydown", "wheel", "touchstart", "pointerdown"] as const;
    const stopListening = () => events.forEach((name) => window.removeEventListener(name, finish));
    const finish = () => {
      window.clearTimeout(timer);
      stopListening();
      hide();
    };
    const timer = window.setTimeout(finish, Math.max(0, CLEARS_AT - elapsed));
    events.forEach((name) => window.addEventListener(name, finish, { passive: true }));

    return () => {
      window.clearTimeout(timer);
      stopListening();
    };
  }, []);

  return (
    <>
      {/*
        Before paint on a full load: hide the intro if it already played this session. Delivered as
        server HTML (not a React <script>), so client navigations neither run nor warn about it;
        the layout effect above covers those.
      */}
      <div hidden dangerouslySetInnerHTML={{ __html: SEEN_CHECK }} />
      <div ref={overlayRef} className="naqah-opening" role="presentation">
        {Array.from({ length: STRIPS }, (_, index) => (
          <div key={index} className="naqah-opening-strip" style={{ "--d": Math.abs(index - CENTRE) } as CSSProperties} />
        ))}
        <div className="naqah-opening-mark">
          <CamelMark className="h-24 w-auto sm:h-32" />
        </div>
      </div>
    </>
  );
}
