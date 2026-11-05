"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { DUNE_RIDGE_Y, DuneLayers, WalkingCamel } from "@/components/heritage/DesertJourney";

/** How far the camel walks across the stage, as a share of its width. */
const TRAVEL = 0.78;

/**
 * The Desert Journey stage (handoff §03, §08): as this band passes through the viewport the
 * independent camel artwork walks along the near ridge and the dune planes drift a few percent.
 * Locked to the scrollbar, no pinning, no hijacking; only runs while visible. Reduced motion
 * keeps a still mid-stride camel in the middle of the scene.
 */
export function JourneyScene() {
  const stageRef = useRef<HTMLDivElement>(null);
  const camelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const stage = stageRef.current;
    const camel = camelRef.current;
    if (!stage || !camel) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Still composition: the camel stands mid-stride in the middle of the scene.
      stage.style.setProperty("--travel", `${(stage.getBoundingClientRect().width * TRAVEL).toFixed(1)}px`);
      return;
    }

    let frame = 0;
    let visible = false;
    const update = () => {
      frame = 0;
      const box = stage.getBoundingClientRect();
      const viewport = window.innerHeight;
      const progress = Math.min(1, Math.max(0, (viewport - box.top) / (viewport + box.height)));
      const travel = box.width * TRAVEL;
      const strides = travel / Math.max(1, camel.offsetWidth * 0.8);
      stage.style.setProperty("--p", progress.toFixed(4));
      stage.style.setProperty("--travel", `${travel.toFixed(1)}px`);
      stage.style.setProperty("--walk", (progress * strides).toFixed(4));
    };
    const request = () => {
      if (visible && !frame) frame = window.requestAnimationFrame(update);
    };
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) request();
    });
    observer.observe(stage);
    window.addEventListener("scroll", request, { passive: true });
    window.addEventListener("resize", request);
    update();
    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", request);
      window.removeEventListener("resize", request);
      window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div
      ref={stageRef}
      aria-hidden="true"
      className="naqah-journey pointer-events-none relative -mt-8 h-[max(34svh,23vw)] min-h-[200px] overflow-hidden lg:-mt-14"
      style={{ "--p": 0.5, "--walk": 0, "--travel": "0px" } as CSSProperties}
    >
      <DuneLayers className="absolute inset-0 h-full w-full" />
      <div
        ref={camelRef}
        className="naqah-journey-camel absolute start-[11%] w-24 text-espresso sm:w-32 lg:w-40"
        style={{ bottom: `${((1 - DUNE_RIDGE_Y) * 100 - 1.5).toFixed(1)}%` }}
      >
        <WalkingCamel className="block h-auto w-full rtl:-scale-x-100" />
      </div>
    </div>
  );
}
