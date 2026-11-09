"use client";

import { useEffect, useMemo } from "react";
import { useI18n } from "@/i18n/client";
import { getMessages } from "@/i18n/messages";
import { useInstallPrompt } from "./useInstallPrompt";

const OFFLINE_TRANSLATIONS = {
  ar: {
    title: getMessages("ar").integrations.pwa.offlineTitle,
    body: getMessages("ar").integrations.pwa.offlineBody,
  },
  en: {
    title: getMessages("en").integrations.pwa.offlineTitle,
    body: getMessages("en").integrations.pwa.offlineBody,
  },
};

/** Register the root-scoped worker only on a production origin, after the page load. */
export function ServiceWorkerRegistrar() {
  // Capture the install event from the root layout, before Settings is opened.
  useInstallPrompt();
  const { locale, m } = useI18n();
  const offlineTitle = m.integrations.pwa.offlineTitle;
  const offlineBody = m.integrations.pwa.offlineBody;
  const offlineCopy = useMemo(() => ({
    type: "naqah:offline-copy",
    activeLocale: locale,
    copies: {
      ar: locale === "ar"
        ? { title: offlineTitle, body: offlineBody }
        : OFFLINE_TRANSLATIONS.ar,
      en: locale === "en"
        ? { title: offlineTitle, body: offlineBody }
        : OFFLINE_TRANSLATIONS.en,
    },
  }), [locale, offlineTitle, offlineBody]);

  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;

    let disposed = false;
    const syncOfflineCopy = () => {
      if (disposed) return;
      void navigator.serviceWorker.ready.then((registration) => {
        const worker = registration.active ?? navigator.serviceWorker.controller;
        worker?.postMessage(offlineCopy);
      }).catch(() => undefined);
    };
    const register = () => {
      if (disposed) return;
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then(syncOfflineCopy)
        .catch(() => undefined);
    };

    navigator.serviceWorker.addEventListener("controllerchange", syncOfflineCopy);
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      disposed = true;
      window.removeEventListener("load", register);
      navigator.serviceWorker.removeEventListener("controllerchange", syncOfflineCopy);
    };
  }, [offlineCopy]);

  return null;
}
