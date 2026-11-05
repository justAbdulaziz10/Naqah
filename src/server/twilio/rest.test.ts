import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callOwnerWithSummary } from "./rest";

describe("Twilio owner summary calls", () => {
  beforeEach(() => {
    vi.stubEnv("NAQAH_CALL_OWNER", "1");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC-test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+966500000000");
    vi.stubEnv("NAQAH_OWNER_PHONE", "+966511111111");
    vi.stubEnv("NAQAH_VOICE_ARABIC_VOICE", "Polly.Zeina");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts a form-encoded TwiML call with Basic authentication", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await callOwnerWithSummary("تم حفظ التقرير", "ar")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.twilio.com/2010-04-01/Accounts/AC-test/Calls.json");
    expect(new Headers(init.headers).get("Authorization")).toBe(`Basic ${Buffer.from("AC-test:test-token").toString("base64")}`);
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/x-www-form-urlencoded");
    const fields = new URLSearchParams(String(init.body));
    expect(fields.get("From")).toBe("+966500000000");
    expect(fields.get("To")).toBe("+966511111111");
    expect(fields.get("Twiml")).toContain("تم حفظ التقرير");
  });

  it("does not call Twilio unless explicitly enabled and fully configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NAQAH_CALL_OWNER", "0");
    expect(await callOwnerWithSummary("summary", "en")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
