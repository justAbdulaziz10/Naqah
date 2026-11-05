import { describe, expect, it } from "vitest";
import { formParameters, twilioRequestSignature, twilioRequestSignatureUrls, validateTwilioRequestSignature, validateTwilioSignature } from "./signature";

describe("Twilio webhook signatures", () => {
  it("validates the published Twilio form POST parameter example", () => {
    const url = "https://mycompany.com/myapp";
    const params = {
      CallSid: "CA1234567890ABCDE", Caller: "+12349013030", Digits: "1234",
      From: "+12349013030", To: "+18005551212",
    };
    const signature = "3KI2uRuYyAdhZIJXcpU0izDUzWI=";
    expect(validateTwilioSignature(url, params, signature, "12345")).toBe(true);
    expect(validateTwilioSignature(url, params, `${signature}x`, "12345")).toBe(false);
    expect(validateTwilioSignature(url, params, null, "12345")).toBe(false);
  });

  it("sorts parameter names and includes each form value", () => {
    const first = twilioRequestSignature("https://example.test/hook", { Z: "last", A: "first" }, "token");
    const second = twilioRequestSignature("https://example.test/hook", { A: "first", Z: "last" }, "token");
    expect(first).toBe(second);
    expect(formParameters(new URLSearchParams("From=%2B966500000000&From=%2B966511111111"))).toEqual({
      From: ["+966500000000", "+966511111111"],
    });
  });

  it("uses the configured public URL or first forwarded values with both default-port forms", () => {
    const originalBase = process.env.NAQAH_PUBLIC_BASE_URL;
    const request = new Request("http://internal:3000/api/voice/turn?s=abc", {
      headers: {
        "x-forwarded-proto": "https, http",
        "x-forwarded-host": "voice.example.test, internal:3000",
      },
    });
    expect(twilioRequestSignatureUrls(request)).toEqual([
      "https://voice.example.test/api/voice/turn?s=abc",
      "https://voice.example.test:443/api/voice/turn?s=abc",
    ]);
    try {
      process.env.NAQAH_PUBLIC_BASE_URL = "https://configured.example.test";
      expect(twilioRequestSignatureUrls(request)).toEqual([
        "https://configured.example.test/api/voice/turn?s=abc",
        "https://configured.example.test:443/api/voice/turn?s=abc",
      ]);
    } finally {
      if (originalBase === undefined) delete process.env.NAQAH_PUBLIC_BASE_URL;
      else process.env.NAQAH_PUBLIC_BASE_URL = originalBase;
    }
  });

  it("accepts Twilio signatures with an explicit default port", () => {
    const request = new Request("https://naqah.test/api/voice/inbound");
    const params = { From: "+966507782190" };
    const signature = twilioRequestSignature("https://naqah.test:443/api/voice/inbound", params, "route-token");
    expect(validateTwilioRequestSignature(request, params, signature, "route-token")).toBe(true);
  });
});
