"use client";

import { useEffect, useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * The record a deep link points at (`#camel-<id>` → the id), brought into view once the list has
 * rendered. Records carry `data-hash-target`, not an id: a list can render twice, as a table and
 * as phone rows, with only one on screen.
 */
export function useHashTarget(prefix: string, ready: boolean): string | null {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const target = hash.startsWith(`#${prefix}`) ? hash.slice(prefix.length + 1) : null;

  useEffect(() => {
    if (!ready || !target) return;
    const element = [...document.querySelectorAll<HTMLElement>(`[data-hash-target="${prefix}${target}"]`)]
      .find((candidate) => candidate.getClientRects().length > 0);
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    element.focus({ preventScroll: true });
  }, [prefix, ready, target]);

  return target;
}
