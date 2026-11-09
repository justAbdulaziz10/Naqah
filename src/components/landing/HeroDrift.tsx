"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Ties the hero photograph to the scroll: the further the page is scrolled, the more the herd moves
 * (it drifts, sinks behind the page and draws closer). Writes one CSS variable, `--hero-drift`
 * (0 at the top → 1 once the hero has left the screen); landing.css turns it into motion.
 * Progressive enhancement: without script or under reduced motion the photograph stays still.
 */
export function HeroDrift({ className, children }: { className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;

    const apply = () => {
      frame = 0;
      if (reduce.matches) {
        el.style.removeProperty("--hero-drift");
        return;
      }
      const height = el.offsetHeight || window.innerHeight;
      const progress = Math.min(Math.max(window.scrollY / height, 0), 1);
      el.style.setProperty("--hero-drift", progress.toFixed(4));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    reduce.addEventListener("change", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      reduce.removeEventListener("change", schedule);
    };
  }, []);

  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
