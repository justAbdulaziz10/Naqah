import type { NotificationPayload } from "@/components/pwa/notifications";

const PUBLIC_VAPID_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

function decodeVapidKey(value: string): ArrayBuffer {
  const base64 = `${value}${"=".repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return buffer;
}

function canSubscribeToPush(): boolean {
  return typeof window !== "undefined"
    && "serviceWorker" in navigator
    && "PushManager" in window
    && Boolean(PUBLIC_VAPID_KEY);
}

export async function subscribeToPush(): Promise<boolean> {
  if (!canSubscribeToPush() || !PUBLIC_VAPID_KEY) return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeVapidKey(PUBLIC_VAPID_KEY),
    });
  }
  return Boolean(subscription);
}

export async function unsubscribeFromPush(): Promise<void> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("PushManager" in window)) return;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (subscription) await subscription.unsubscribe();
}

/** Use Web Push when a subscription exists, then fall back to the active worker. */
export async function deliverNotification(
  registration: ServiceWorkerRegistration,
  payload: NotificationPayload,
  shouldDeliver: () => boolean = () => true,
): Promise<boolean> {
  if (!shouldDeliver()) return false;
  if (typeof window !== "undefined" && PUBLIC_VAPID_KEY && "PushManager" in window) {
    try {
      const subscription = await registration.pushManager.getSubscription();
      if (subscription && shouldDeliver()) {
        const response = await fetch("/api/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ subscription: subscription.toJSON(), payload }),
        });
        if (response.ok) return true;
      }
    } catch {
      // A missing server key or an offline request falls back to the local worker.
    }
  }

  if (!shouldDeliver() || typeof Notification === "undefined" || Notification.permission !== "granted") return false;
  if (typeof registration.showNotification !== "function") return false;

  await registration.showNotification(payload.title, {
    body: payload.body,
    tag: payload.tag,
    icon: "/pwa-icons/192.png",
    data: { url: payload.url },
  });
  return true;
}
