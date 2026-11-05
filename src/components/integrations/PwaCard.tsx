"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardBody, CardHeader, Switch } from "@/components/ui";
import { useI18n } from "@/i18n/client";
import {
  notify,
  readNotificationPreference,
  writeNotificationPreference,
} from "@/components/pwa/notifications";
import { unsubscribeFromPush, subscribeToPush } from "@/lib/push/client";
import { useInstallPrompt } from "@/components/pwa/useInstallPrompt";

/** Settings → Connections → pwa. Owned by the pwa integration slice. */
export function PwaCard() {
  const { m, href } = useI18n();
  const installPrompt = useInstallPrompt();
  const [notificationSupported, setNotificationSupported] = useState(false);
  const [permission, setPermission] = useState<NotificationPermission | "unsupported">("unsupported");
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const hasNotificationApi = "Notification" in window;
      const hasServiceWorkerApi = "serviceWorker" in navigator;
      const requiresInstall = installPrompt.isIOS && !installPrompt.isInstalled;
      const supported = process.env.NODE_ENV === "production" && hasNotificationApi && hasServiceWorkerApi && !requiresInstall;
      setNotificationSupported(supported);

      if (hasNotificationApi) {
        const currentPermission = window.Notification.permission;
        setPermission(currentPermission);
        const saved = readNotificationPreference();
        setNotificationsEnabled(saved && currentPermission === "granted" && supported);
        if (saved && (currentPermission !== "granted" || !supported)) writeNotificationPreference(false);
        if (currentPermission === "denied") setFeedback(m.integrations.pwa.notificationDenied);
        else if (requiresInstall) setFeedback(m.integrations.pwa.notificationInstallRequired);
        else if (!supported) setFeedback(m.integrations.pwa.notificationUnsupported);
        else setFeedback("");
      } else {
        setPermission("unsupported");
        setNotificationsEnabled(false);
        setFeedback(requiresInstall ? m.integrations.pwa.notificationInstallRequired : m.integrations.pwa.notificationUnsupported);
      }
    });
    return () => { active = false; };
  }, [installPrompt.isIOS, installPrompt.isInstalled, m.integrations.pwa.notificationDenied, m.integrations.pwa.notificationInstallRequired, m.integrations.pwa.notificationUnsupported]);

  async function changeNotifications(next: boolean) {
    if (!next) {
      writeNotificationPreference(false);
      setNotificationsEnabled(false);
      setFeedback(m.integrations.pwa.notificationDisabled);
      void unsubscribeFromPush().catch(() => undefined);
      return;
    }

    if (!notificationSupported || typeof window === "undefined" || !("Notification" in window)) {
      setFeedback(m.integrations.pwa.notificationUnsupported);
      return;
    }

    setBusy(true);
    setFeedback("");
    try {
      let nextPermission = window.Notification.permission;
      if (nextPermission === "default" && typeof window.Notification.requestPermission === "function") {
        nextPermission = await window.Notification.requestPermission();
      }
      setPermission(nextPermission);
      if (nextPermission !== "granted") {
        writeNotificationPreference(false);
        setNotificationsEnabled(false);
        setFeedback(nextPermission === "denied"
          ? m.integrations.pwa.notificationDenied
          : m.integrations.pwa.permissionNeeded);
        return;
      }

      try {
        await subscribeToPush();
      } catch {
        // Local service worker notifications still work when optional server push is unavailable.
      }

      const stored = writeNotificationPreference(true);
      setNotificationsEnabled(stored);
      setFeedback(stored ? m.integrations.pwa.notificationEnabled : m.integrations.pwa.preferenceUnavailable);
    } catch {
      writeNotificationPreference(false);
      setNotificationsEnabled(false);
      setFeedback(m.integrations.pwa.permissionNeeded);
    } finally {
      setBusy(false);
    }
  }

  async function sendTestNotification() {
    setBusy(true);
    try {
      const delivered = await notify({
        title: m.integrations.pwa.testNotificationTitle,
        body: m.integrations.pwa.testNotificationBody,
        url: href("/app"),
        tag: "naqah-test-notification",
      });
      setFeedback(delivered ? m.integrations.pwa.testNotificationSent : m.integrations.pwa.testNotificationFailed);
    } finally {
      setBusy(false);
    }
  }

  async function installApp() {
    setBusy(true);
    const installed = await installPrompt.install();
    setFeedback(installed ? m.integrations.pwa.installed : m.integrations.pwa.installDismissed);
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader title={m.integrations.pwa.title} />
      <CardBody className="space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="font-medium text-espresso">{m.integrations.pwa.installTitle}</p>
            <p className="mt-1 text-sm text-muted">
              {installPrompt.isInstalled
                ? m.integrations.pwa.installed
                : installPrompt.isIOS
                  ? m.integrations.pwa.iosInstallHelp
                  : installPrompt.canInstall
                    ? m.integrations.pwa.installHelp
                    : m.integrations.pwa.browserInstallHelp}
            </p>
          </div>
          {!installPrompt.isInstalled && !installPrompt.isIOS && installPrompt.canInstall ? (
            <Button onClick={installApp} disabled={busy} className="min-h-11 rounded-md" style={{ borderRadius: "0.75rem" }}>
              {m.integrations.pwa.installAction}
            </Button>
          ) : null}
        </div>

        <div className="border-t border-stone/70 pt-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="font-medium text-espresso">{m.integrations.pwa.notificationsTitle}</p>
              <p className="mt-1 text-sm text-muted">{m.integrations.pwa.notificationsHelp}</p>
            </div>
            <Switch
              checked={notificationsEnabled}
              onChange={changeNotifications}
              label={m.integrations.pwa.notificationsTitle}
              disabled={!notificationSupported || permission === "denied" || busy}
              className="h-11 w-16 [&>span]:top-3"
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              onClick={sendTestNotification}
              disabled={!notificationsEnabled || busy}
              className="min-h-11 rounded-md"
              style={{ borderRadius: "0.75rem" }}
            >
              {m.integrations.pwa.testNotification}
            </Button>
            <p aria-live="polite" className="min-h-6 text-sm text-muted">
              {feedback || (!notificationSupported ? m.integrations.pwa.notificationUnsupported : "")}
            </p>
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
