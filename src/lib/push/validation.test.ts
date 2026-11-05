import { describe, expect, it } from "vitest";
import { isPushPayload, isPushRequestBody, isPushSubscription } from "./validation";

const subscription = {
  endpoint: "https://push.example.test/send/abc",
  keys: { p256dh: "public_key-123", auth: "auth_key-456" },
};

const payload = {
  title: "NAQAH | Important update",
  body: "A farm event needs attention.",
  url: "/ar/app/tickets",
  tag: "naqah-event-1",
};

describe("push request validation", () => {
  it("accepts an HTTPS subscription and a local notification payload", () => {
    expect(isPushSubscription(subscription)).toBe(true);
    expect(isPushPayload(payload)).toBe(true);
    expect(isPushRequestBody({ subscription, payload })).toBe(true);
  });

  it("rejects malformed subscriptions and non-local notification URLs", () => {
    expect(isPushSubscription({ ...subscription, endpoint: "http://push.example.test/send/abc" })).toBe(false);
    expect(isPushSubscription({ ...subscription, keys: { ...subscription.keys, auth: "!invalid" } })).toBe(false);
    expect(isPushPayload({ ...payload, url: "https://example.test/" })).toBe(false);
    expect(isPushPayload({ ...payload, url: "//example.test/" })).toBe(false);
    expect(isPushRequestBody({ subscription, payload: { ...payload, url: "/\\example.test" } })).toBe(false);
  });
});
