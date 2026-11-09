import webPush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRateLimitState } from "@/server/rate-limit";
import { POST } from "./route";

const mock = vi.hoisted(() => ({ getOwner: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("web-push", () => ({ default: { sendNotification: vi.fn() } }));
vi.mock("@/lib/supabase/server", () => ({ getOwner: mock.getOwner }));

const subscription = {
  endpoint: "https://fcm.googleapis.com/send/abc",
  keys: { p256dh: "public_key-123", auth: "auth_key-456" },
};
const payload = {
  title: "NAQAH (Demo) | Important farm update",
  body: "Farm update.",
  url: "/en/app",
  tag: "naqah-evt_1234567890",
};
const headers = {
  "Content-Type": "application/json",
  origin: "https://naqah.test",
  host: "naqah.test",
  "x-forwarded-for": "203.0.113.4",
};

function request(body: unknown = { subscription, payload }, extraHeaders: Record<string, string> = {}) {
  return new Request("https://naqah.test/api/push", {
    method: "POST",
    headers: { ...headers, ...extraHeaders },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const sendNotification = vi.mocked(webPush.sendNotification);

beforeEach(() => {
  resetRateLimitState();
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", "");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  mock.getOwner.mockReset().mockResolvedValue({ user: null, unavailable: false });
  sendNotification.mockReset().mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/push", () => {
  it("requires same origin and refuses missing or mismatched origin", async () => {
    expect((await POST(request(undefined, { origin: "https://evil.test" }))).status).toBe(403);
    expect((await POST(request(undefined, { origin: "" }))).status).toBe(403);
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("requires an authenticated owner when account mode is on", async () => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", "1");
    expect((await POST(request())).status).toBe(401);
    expect(sendNotification).not.toHaveBeenCalled();
    mock.getOwner.mockResolvedValueOnce({ user: { id: "owner-1" }, unavailable: false });
    expect((await POST(request())).status).toBe(200);
    expect(mock.getOwner).toHaveBeenCalledTimes(2);
  });

  it("returns a clear not-configured response without VAPID keys", async () => {
    vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "");
    vi.stubEnv("VAPID_PRIVATE_KEY", "");
    const response = await POST(request());
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ ok: false, reason: "push_not_configured" });
  });

  it("rejects oversized and non-app notification payloads before provider work", async () => {
    const oversized = await POST(request(JSON.stringify({ body: "x".repeat(70_000) })));
    expect(oversized.status).toBe(413);
    expect(await oversized.json()).toEqual({ ok: false, reason: "payload_too_large" });
    const invalid = await POST(request({ subscription, payload: { ...payload, title: "arbitrary push" } }));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ ok: false, reason: "invalid_request" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("enforces the demo per-IP limit", async () => {
    for (let index = 0; index < 10; index += 1) expect((await POST(request())).status).toBe(200);
    const limited = await POST(request());
    expect(limited.status).toBe(429);
    expect(await limited.json()).toEqual({ ok: false, reason: "rate_limited" });
    expect(sendNotification).toHaveBeenCalledTimes(10);
  });

  it("preserves expired-subscription and provider-failure responses", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    const expired = await POST(request());
    expect(expired.status).toBe(410);
    expect(await expired.json()).toEqual({ ok: false, reason: "push_subscription_expired" });

    sendNotification.mockRejectedValueOnce({ statusCode: 503 });
    const providerFailure = await POST(request());
    expect(providerFailure.status).toBe(502);
    expect(await providerFailure.json()).toEqual({ ok: false, reason: "push_send_failed" });
  });
});
