"use client";

import { useEffect } from "react";
import { useInstallPrompt } from "./useInstallPrompt";

/** Register the root-scoped worker only on a production origin, after the page load. */
export function ServiceWorkerRegistrar() {
  // Capture the install event from the root layout, before Settings is opened.
  useInstallPrompt();

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let disposed = false;
    const register = () => {
      if (disposed) return;
      void navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => undefined);
    };

    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
