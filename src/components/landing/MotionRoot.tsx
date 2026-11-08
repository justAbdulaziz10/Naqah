"use client";

import { useEffect } from "react";

/**
 * Once-only entrances for the landing page, as progressive enhancement. Nothing is hidden ahead of
 * time: an element is set to `pending` only at the moment its top edge reaches the bottom of the
 * screen, then settles in. Anything never observed (full-page captures, print, no script, reduced
 * motion) simply stays as rendered, and an element already in view (first screen, an anchor jump)
 * is left alone rather than hidden while it is being read.
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
          const el = entry.target as HTMLElement;
          observer.unobserve(el);
          if (entry.boundingClientRect.top < window.innerHeight * 0.85) continue;
          if (el.dataset.revealDelay) el.style.setProperty("--reveal-delay", `${el.dataset.revealDelay}ms`);
          el.setAttribute(attribute(el), "pending");
          // Commit the hidden state before transitioning out of it.
          void el.getBoundingClientRect();
          el.setAttribute(attribute(el), "shown");
        }
      },
      { rootMargin: "0px 0px 6% 0px" },
    );

    for (const el of document.querySelectorAll("[data-reveal], [data-weave]")) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return null;
}
