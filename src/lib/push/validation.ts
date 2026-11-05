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

export function isPushSubscription(value: unknown): value is PushSubscriptionInput {
  if (!isRecord(value) || !isRecord(value.keys)) return false;
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
  if (!isRecord(value)) return false;
  return typeof value.title === "string" && value.title.length > 0 && value.title.length <= 120
    && typeof value.body === "string" && value.body.length <= 500
    && typeof value.url === "string" && value.url.startsWith("/") && !value.url.startsWith("//")
      && !value.url.includes("\\") && !/[\u0000-\u001f]/.test(value.url) && value.url.length <= 200
    && typeof value.tag === "string" && value.tag.length > 0 && value.tag.length <= 120;
}

export function isPushRequestBody(value: unknown): value is PushRequestBody {
  return isRecord(value) && isPushSubscription(value.subscription) && isPushPayload(value.payload);
}
