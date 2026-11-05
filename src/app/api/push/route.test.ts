import webPush from "web-push";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("web-push", () => ({ default: { sendNotification: vi.fn() } }));

const subscription = {
  endpoint: "https://fcm.googleapis.com/send/abc",
  keys: { p256dh: "public_key-123", auth: "auth_key-456" },
};
const payload = { title: "NAQAH update", body: "Farm update.", url: "/ar/app", tag: "update-1" };

function request(endpoint = subscription.endpoint) {
  return new Request("https://naqah.test/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: { ...subscription, endpoint }, payload }),
  });
}

const sendNotification = vi.mocked(webPush.sendNotification);

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_VAPID_PUBLIC_KEY", "public-key");
  vi.stubEnv("VAPID_PRIVATE_KEY", "private-key");
  sendNotification.mockResolvedValue({ statusCode: 201, body: "", headers: {} });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/push", () => {
  it("returns a clear not-configured response without VAPID keys", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const response = await POST(new Request("https://naqah.test/api/push", { method: "POST" }));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ ok: false, reason: "push_not_configured" });
  });

  it("rejects an untrusted endpoint before calling the push provider", async () => {
    const response = await POST(request("https://push.example.test/send/abc"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, reason: "invalid_request" });
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("keeps expired status only for allowed push hosts", async () => {
    sendNotification.mockRejectedValueOnce({ statusCode: 404 });
    const allowed = await POST(request());
    expect(allowed.status).toBe(410);
    expect(await allowed.json()).toEqual({ ok: false, reason: "push_subscription_expired" });

    sendNotification.mockClear();
    sendNotification.mockRejectedValueOnce({ statusCode: 410 });
    const disallowed = await POST(request("https://push.example.test/send/abc"));
    expect(disallowed.status).toBe(400);
    expect(await disallowed.json()).toEqual({ ok: false, reason: "invalid_request" });
    expect(sendNotification).not.toHaveBeenCalled();

    sendNotification.mockReset();
    sendNotification.mockRejectedValueOnce({ statusCode: 503 });
    const providerFailure = await POST(request());
    expect(providerFailure.status).toBe(502);
    expect(await providerFailure.json()).toEqual({ ok: false, reason: "push_send_failed" });
  });
});
