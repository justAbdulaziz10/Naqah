import type { Locale, PlatformEvent } from "@/domain/types";
import { deliverNotification } from "@/lib/push/client";

export const NOTIFICATION_PREFERENCE_KEY = "naqah-notify-v1"; // gitleaks:allow (localStorage key name, not a secret)
export const NOTIFICATION_PREFERENCE_EVENT = "naqah-notify-preference-change";

export interface NotificationPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

let runtimePreference: boolean | null = null;

export function readNotificationPreference(): boolean {
  if (runtimePreference !== null) return runtimePreference;
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(NOTIFICATION_PREFERENCE_KEY) === "enabled";
  } catch {
    return false;
  }
}

/** Persist the toggle outside the workspace and publish same-tab changes to the notifier. */
export function writeNotificationPreference(enabled: boolean): boolean {
  if (typeof window === "undefined") {
    runtimePreference = false;
    return false;
  }
  let saved = true;
  try {
    if (enabled) window.localStorage.setItem(NOTIFICATION_PREFERENCE_KEY, "enabled");
    else window.localStorage.removeItem(NOTIFICATION_PREFERENCE_KEY);
  } catch {
    saved = false;
  }
  runtimePreference = enabled && saved;
  window.dispatchEvent(new Event(NOTIFICATION_PREFERENCE_EVENT));
  return saved;
}

export function syncNotificationPreference(enabled: boolean): void {
  runtimePreference = enabled;
}

/** Current wording plus the older one still in saved history. */
const OWNER_CALL_EN = ["NAQAH called the owner with the update", "The agent called the owner with the update"];
const OWNER_CALL_AR = ["اتصلت ناقة بالمالك وأبلغته بالتحديث", "اتصل المساعد بالمالك وأبلغه بالتحديث"];

function isOwnerCallSummary(event: PlatformEvent): boolean {
  return OWNER_CALL_EN.includes(event.text.en) || OWNER_CALL_AR.includes(event.text.ar);
}

/** Saved history can still hold these. No Answer Tickets are retired, so the owner is never told of one. */
function isRetiredTicketEvent(event: PlatformEvent): boolean {
  return event.text.en.includes("No Answer Ticket")
    || event.text.ar.includes("تذكرة «عدم رد»")
    || event.text.ar.includes("تذكرة عدم الرد");
}

/**
 * Select important events and remove ids already handled, including duplicates
 * in the same batch. Findings use the attention tone.
 */
export function selectNotificationEvents(
  events: readonly PlatformEvent[],
  seenIds: ReadonlySet<string> = new Set(),
): PlatformEvent[] {
  const encountered = new Set<string>();
  return events.filter((event) => {
    if (seenIds.has(event.id) || encountered.has(event.id)) return false;
    encountered.add(event.id);
    if (isRetiredTicketEvent(event)) return false;
    return event.tone === "attention" || event.tone === "danger" || isOwnerCallSummary(event);
  });
}

export function buildNotification(event: PlatformEvent, locale: Locale, demo = true): NotificationPayload {
  const ownerCall = isOwnerCallSummary(event);
  // Demo events are simulated, so their title says so.
  const brand = locale === "ar" ? (demo ? "ناقة (تجريبي)" : "ناقة") : (demo ? "NAQAH (Demo)" : "NAQAH");
  const title = locale === "ar"
    ? `${brand} | ${ownerCall ? "اتصال المالك" : "مستجد مهم في العزبة"}`
    : `${brand} | ${ownerCall ? "Owner call" : "Important farm update"}`;
  const destination = ownerCall ? "/app/calls" : "/app";

  return {
    title,
    body: event.text[locale],
    url: `/${locale}${destination}`,
    tag: `naqah-${event.id}`,
  };
}

/** Show a system notification through Web Push when configured, or the local worker. */
export async function notify(payload: NotificationPayload): Promise<boolean> {
  if (typeof window === "undefined" || !("serviceWorker" in navigator) || !("Notification" in window)) return false;
  if (!readNotificationPreference() || window.Notification.permission !== "granted") return false;
  try {
    const registration = await navigator.serviceWorker.ready;
    if (!readNotificationPreference() || window.Notification.permission !== "granted") return false;
    return await deliverNotification(registration, payload, readNotificationPreference);
  } catch {
    return false;
  }
}
