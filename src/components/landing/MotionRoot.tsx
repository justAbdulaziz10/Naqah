"use client";

import { useEffect } from "react";

/**
 * Once-only entrances for the landing page. Only elements below the first screen are marked
 * pending (so nothing visible on load flickers), each is revealed as it enters, and without this
 * script or with reduced motion the page simply stays as rendered.
 *
 * Mark elements with `data-reveal` (optionally `data-reveal-kind="picture"`) or `data-weave`, and
 * an optional `data-reveal-delay` in ms for the reading order inside a section.
 */
export function MotionRoot() {
  useEffect(() => {
    if (!("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const attribute = (el: Element) => (el.hasAttribute("data-weave") ? "data-weave" : "data-reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.setAttribute(attribute(entry.target), "shown");
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );

    const firstScreen = window.innerHeight * 0.92;
    for (const el of document.querySelectorAll<HTMLElement>("[data-reveal], [data-weave]")) {
      if (el.getBoundingClientRect().top < firstScreen) continue;
      if (el.dataset.revealDelay) el.style.setProperty("--reveal-delay", `${el.dataset.revealDelay}ms`);
      el.setAttribute(attribute(el), "pending");
      observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  return null;
}
