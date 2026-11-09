export interface PushPayload {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export interface PushSubscriptionInput {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

export interface PushRequestBody {
  subscription: PushSubscriptionInput;
  payload: PushPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && expected.every((key) => Object.hasOwn(value, key));
}

export function isPushSubscription(value: unknown): value is PushSubscriptionInput {
  if (!isRecord(value) || !(hasExactKeys(value, ["endpoint", "keys"]) || hasExactKeys(value, ["endpoint", "expirationTime", "keys"])) || !isRecord(value.keys) || !hasExactKeys(value.keys, ["p256dh", "auth"])) return false;
  if (Object.hasOwn(value, "expirationTime") && value.expirationTime !== null && (typeof value.expirationTime !== "number" || !Number.isFinite(value.expirationTime) || value.expirationTime < 0)) return false;
  if (typeof value.endpoint !== "string" || value.endpoint.length > 4096) return false;

  try {
    const endpoint = new URL(value.endpoint);
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port) return false;
    if (!isAllowedPushHost(endpoint.hostname)) return false;
  } catch {
    return false;
  }

  return typeof value.keys.p256dh === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value.keys.p256dh)
    && typeof value.keys.auth === "string" && /^[A-Za-z0-9_-]{1,512}$/.test(value.keys.auth);
}

function isAllowedPushHost(hostname: string): boolean {
  return hostname === "fcm.googleapis.com"
    || isSubdomainOf(hostname, "push.services.mozilla.com")
    || isSubdomainOf(hostname, "push.apple.com")
    || isSubdomainOf(hostname, "notify.windows.com")
    || isSubdomainOf(hostname, "wns.windows.com");
}

function isSubdomainOf(hostname: string, domain: string): boolean {
  const suffix = `.${domain}`;
  if (!hostname.endsWith(suffix)) return false;
  const prefix = hostname.slice(0, -suffix.length);
  return prefix.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
}

export function isPushPayload(value: unknown): value is PushPayload {
  if (!isRecord(value) || !hasExactKeys(value, ["title", "body", "url", "tag"])) return false;
  if (typeof value.title !== "string" || typeof value.body !== "string" || typeof value.url !== "string" || typeof value.tag !== "string") return false;
  if (!value.body.trim() || value.body.length > 500 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value.body)) return false;
  if (!/^naqah-[A-Za-z0-9_-]{1,120}$/.test(value.tag)) return false;

  const titles: Record<string, { locale: "ar" | "en"; kind: "owner" | "update" | "test" }> = {
    "NAQAH (Demo) | Owner call": { locale: "en", kind: "owner" },
    "NAQAH (Demo) | Important farm update": { locale: "en", kind: "update" },
    "NAQAH | Owner call": { locale: "en", kind: "owner" },
    "NAQAH | Important farm update": { locale: "en", kind: "update" },
    "ناقة (تجريبي) | اتصال المالك": { locale: "ar", kind: "owner" },
    "ناقة (تجريبي) | مستجد مهم في العزبة": { locale: "ar", kind: "update" },
    "ناقة | اتصال المالك": { locale: "ar", kind: "owner" },
    "ناقة | مستجد مهم في العزبة": { locale: "ar", kind: "update" },
    "NAQAH | Test notification": { locale: "en", kind: "test" },
    "ناقة | تنبيه تجريبي": { locale: "ar", kind: "test" },
  };
  const title = titles[value.title];
  const match = /^\/(ar|en)\/app(?:\/(calls|tickets))?$/.exec(value.url);
  if (!title || !match || match[1] !== title.locale) return false;
  if (title.kind === "owner") return match[2] === "calls";
  if (title.kind === "test") {
    const expectedBody = title.locale === "en"
      ? "Notifications are ready for important ranch updates."
      : "التنبيهات جاهزة لمستجدات العزبة المهمة.";
    return value.url === `/${title.locale}/app` && value.tag === "naqah-test-notification" && value.body === expectedBody;
  }
  return match[2] === undefined || match[2] === "tickets";
}

export function isPushRequestBody(value: unknown): value is PushRequestBody {
  return isRecord(value) && hasExactKeys(value, ["subscription", "payload"])
    && isPushSubscription(value.subscription) && isPushPayload(value.payload);
}
