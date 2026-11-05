"use client";

import { useEffect, useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/**
 * The record a deep link points at (`#camel-<id>` → the id), brought into view once the list has
 * rendered. Lists wait for the workspace, so the browser's own anchor scroll can miss them.
 */
export function useHashTarget(prefix: string, ready: boolean): string | null {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash, () => "");
  const target = hash.startsWith(`#${prefix}`) ? hash.slice(prefix.length + 1) : null;

  useEffect(() => {
    if (!ready || !target) return;
    const element = document.getElementById(`${prefix}${target}`);
    if (!element) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "center", behavior: reducedMotion ? "auto" : "smooth" });
    element.focus({ preventScroll: true });
  }, [prefix, ready, target]);

  return target;
}
