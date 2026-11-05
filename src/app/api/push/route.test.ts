import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const originalPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const originalPrivateKey = process.env.VAPID_PRIVATE_KEY;

afterEach(() => {
  if (originalPublicKey === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = originalPublicKey;
  if (originalPrivateKey === undefined) delete process.env.VAPID_PRIVATE_KEY;
  else process.env.VAPID_PRIVATE_KEY = originalPrivateKey;
});

describe("POST /api/push", () => {
  it("returns a clear not-configured response without VAPID keys", async () => {
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    delete process.env.VAPID_PRIVATE_KEY;

    const response = await POST(new Request("https://naqah.test/api/push", { method: "POST" }));

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ ok: false, reason: "push_not_configured" });
  });
});
