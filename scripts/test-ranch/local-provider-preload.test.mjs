// Tests that provider HTTP traffic stays on loopback and OpenAI probes are remapped locally.
import { describe, expect, it } from "vitest";
import { localProviderTarget } from "./local-provider-map.mjs";

describe("local provider fetch map", () => {
  it("maps only OpenAI's HTTP probe to the configured loopback mock", () => {
    expect(localProviderTarget("https://api.openai.com/v1/models?limit=1", { openAi: "http://127.0.0.1:55560/" }).href)
      .toBe("http://127.0.0.1:55560/v1/models?limit=1");
  });

  it("maps only Twilio REST paths and query to the loopback outbound mock", () => {
    expect(localProviderTarget("https://api.twilio.com/2010-04-01/Calls.json?PageSize=1", {
      allowTwilio: true, twilioGateway: "http://127.0.0.1:55562/",
    }).href).toBe("http://127.0.0.1:55562/__test/twilio/2010-04-01/Calls.json?PageSize=1");
    expect(() => localProviderTarget("https://api.twilio.com/2010-04-01/Calls.json"))
      .toThrow("Blocked non-loopback provider request");
    expect(() => localProviderTarget("https://api.twilio.com/2010-04-01/Calls.json", {
      allowTwilio: true, twilioGateway: "http://provider.example.invalid/",
    })).toThrow("Mock Twilio origin must be loopback HTTP");
  });

  it("allows local HTTP services and rejects external origins", () => {
    expect(localProviderTarget("http://127.0.0.1:55561/health").href).toBe("http://127.0.0.1:55561/health");
    expect(() => localProviderTarget("https://example.invalid/secret")).toThrow("Blocked non-loopback provider request");
  });

  it("rejects a non-loopback OpenAI mock origin", () => {
    expect(() => localProviderTarget("https://api.openai.com/v1/models", { openAi: "http://provider.example.invalid/" }))
      .toThrow("Mock OpenAI origin must be loopback HTTP");
  });
});
