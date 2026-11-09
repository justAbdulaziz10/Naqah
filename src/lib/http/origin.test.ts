import { describe, expect, it } from "vitest";
import { hasSameOrigin } from "./origin";

function request(headers: Record<string, string> = {}, url = "https://naqah.test/api") {
  return new Request(url, { method: "POST", headers });
}

describe("same-origin request validation", () => {
  it("requires both an Origin and request host", () => {
    expect(hasSameOrigin(request({ host: "naqah.test" }))).toBe(false);
    expect(hasSameOrigin(request({ origin: "https://naqah.test" }))).toBe(false);
  });

  it("rejects mismatched origins and accepts matching forwarded public hosts", () => {
    expect(hasSameOrigin(request({ origin: "https://evil.test", host: "naqah.test" }))).toBe(false);
    expect(hasSameOrigin(request({
      origin: "https://naqah.test",
      host: "internal:3000",
      "x-forwarded-host": "naqah.test, internal:3000",
      "x-forwarded-proto": "https, http",
    }, "http://internal:3000/api"))).toBe(true);
  });

  it("checks the forwarded protocol when it is present", () => {
    expect(hasSameOrigin(request({ origin: "http://naqah.test", host: "naqah.test", "x-forwarded-proto": "https" }))).toBe(false);
    expect(hasSameOrigin(request({ origin: "https://naqah.test", host: "naqah.test", "x-forwarded-proto": "https" }))).toBe(true);
  });
});
