"use client";

import { useEffect } from "react";
import { useI18n } from "@/i18n/client";
import { accountLink, useWorkspaceStore } from "@/store/workspace";
import {
  buildNotification,
  NOTIFICATION_PREFERENCE_EVENT,
  NOTIFICATION_PREFERENCE_KEY,
  notify,
  readNotificationPreference,
  selectNotificationEvents,
  syncNotificationPreference,
} from "./notifications";

/** Watch only events created after this workspace-ready mount. */
export function EventNotifier() {
  const { locale } = useI18n();

  useEffect(() => {
    const initial = useWorkspaceStore.getState().workspace;
    const seenIds = new Set(initial?.events.map((event) => event.id) ?? []);
    let enabled = readNotificationPreference();

    const unsubscribe = useWorkspaceStore.subscribe((state) => {
      const workspace = state.workspace;
      if (!workspace) return;

      const freshEvents = workspace.events.filter((event) => !seenIds.has(event.id));
      for (const event of freshEvents) seenIds.add(event.id);
      if (!enabled || freshEvents.length === 0) return;

      for (const event of selectNotificationEvents(freshEvents)) {
        void notify(buildNotification(event, locale, !accountLink.active));
      }
    });

    const onPreferenceChange = () => {
      enabled = readNotificationPreference();
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key !== NOTIFICATION_PREFERENCE_KEY) return;
      syncNotificationPreference(event.newValue === "enabled");
      enabled = event.newValue === "enabled";
    };
    window.addEventListener(NOTIFICATION_PREFERENCE_EVENT, onPreferenceChange);
    window.addEventListener("storage", onStorage);

    return () => {
      unsubscribe();
      window.removeEventListener(NOTIFICATION_PREFERENCE_EVENT, onPreferenceChange);
      window.removeEventListener("storage", onStorage);
    };
  }, [locale]);

  return null;
}
