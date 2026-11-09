import { describe, expect, it } from "vitest";
import { isPushPayload, isPushRequestBody, isPushSubscription } from "./validation";

const subscription = {
  endpoint: "https://fcm.googleapis.com/send/abc",
  keys: { p256dh: "public_key-123", auth: "auth_key-456" },
};

const payload = {
  title: "NAQAH (Demo) | Important farm update",
  body: "A farm event needs attention.",
  url: "/en/app/tickets",
  tag: "naqah-evt_1234567890",
};

describe("push request validation", () => {
  it("accepts an HTTPS subscription and a local notification payload", () => {
    expect(isPushSubscription(subscription)).toBe(true);
    expect(isPushPayload(payload)).toBe(true);
    expect(isPushRequestBody({ subscription, payload })).toBe(true);
  });

  it("allows the supported push service host families", () => {
    const hosts = [
      "fcm.googleapis.com",
      "updates.push.services.mozilla.com",
      "web.push.apple.com",
      "api.push.apple.com",
      "wns1.notify.windows.com",
      "client.wns.windows.com",
    ];
    for (const host of hosts) {
      expect(isPushSubscription({ ...subscription, endpoint: `https://${host}/send/abc` }), host).toBe(true);
    }
  });

  it("rejects non-push hosts and suffix lookalikes", () => {
    const hosts = [
      "push.example.test",
      "fcm.googleapis.com.attacker.test",
      "push.services.mozilla.com",
      "evilpush.services.mozilla.com",
      "push.apple.com",
      "push.apple.com.attacker.test",
      "notify.windows.com",
      "notify.windows.com.attacker.test",
      "wns.windows.com",
      "wns.windows.com.attacker.test",
    ];
    for (const host of hosts) {
      expect(isPushSubscription({ ...subscription, endpoint: `https://${host}/send/abc` }), host).toBe(false);
    }
    expect(isPushSubscription({ ...subscription, endpoint: "https://fcm.googleapis.com:8443/send/abc" })).toBe(false);
  });

  it("rejects malformed subscriptions and non-local notification URLs", () => {
    expect(isPushSubscription({ ...subscription, endpoint: "http://push.example.test/send/abc" })).toBe(false);
    expect(isPushSubscription({ ...subscription, keys: { ...subscription.keys, auth: "!invalid" } })).toBe(false);
    expect(isPushPayload({ ...payload, url: "https://example.test/" })).toBe(false);
    expect(isPushPayload({ ...payload, url: "//example.test/" })).toBe(false);
    expect(isPushRequestBody({ subscription, payload: { ...payload, url: "/\\example.test" } })).toBe(false);
  });

  it("accepts only notifications shaped by the app's builder", () => {
    expect(isPushPayload({ ...payload, title: "NAQAH update" })).toBe(false);
    expect(isPushPayload({ ...payload, url: "/ar/app/tickets" })).toBe(false);
    expect(isPushPayload({ ...payload, title: "NAQAH (Demo) | Owner call" })).toBe(false);
    expect(isPushPayload({ ...payload, url: "/ar/app/settings" })).toBe(false);
    expect(isPushPayload({ ...payload, extra: "unsupported" })).toBe(false);
    expect(isPushSubscription({ ...subscription, expirationTime: null })).toBe(true);
    expect(isPushSubscription({ ...subscription, expirationTime: "later" })).toBe(false);
    expect(isPushRequestBody({ subscription, payload: { ...payload, extra: true } })).toBe(false);
    expect(isPushPayload({
      title: "NAQAH | Test notification",
      body: "Notifications are ready for important ranch updates.",
      url: "/en/app",
      tag: "naqah-test-notification",
    })).toBe(true);
    expect(isPushPayload({
      title: "NAQAH | Test notification",
      body: "A different notification",
      url: "/en/app",
      tag: "naqah-test-notification",
    })).toBe(false);
  });
});
