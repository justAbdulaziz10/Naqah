import { describe, expect, it } from "vitest";
import { formParameters, twilioRequestSignature, validateTwilioSignature } from "./signature";

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
});
