import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callOwnerWithSummary } from "./rest";
import { callTimeLimitSeconds } from "@/server/calls/config";

const accepted = () => Response.json({ sid: `CA${"a".repeat(32)}` }, { status: 201 });

describe("Twilio owner summary calls", () => {
  beforeEach(() => {
    vi.stubEnv("NAQAH_CALL_OWNER", "1");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "AC-test");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "test-token");
    vi.stubEnv("TWILIO_PHONE_NUMBER", "+966500000000");
    vi.stubEnv("NAQAH_OWNER_PHONE", "+966511111111");
    vi.stubEnv("NAQAH_VOICE_ARABIC_VOICE", "Polly.Zeina");
    vi.stubEnv("NAQAH_CALL_ALLOWLIST_FILE", "");
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", process.env.NAQAH_OWNER_PHONE);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("posts a form-encoded TwiML call with Basic authentication", async () => {
    const fetchMock = vi.fn(async () => accepted());
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
    expect(fields.get("TimeLimit")).toBe(String(callTimeLimitSeconds()));
    expect(fields.get("Record")).toBe("false");
    expect(fields.get("Twiml")!.length).toBeLessThan(4_000);
  });

  it("caps the spoken payload before building TwiML", async () => {
    const fetchMock = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", fetchMock);
    expect(await callOwnerWithSummary("&".repeat(5_000), "en")).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const twiml = new URLSearchParams(String(init.body)).get("Twiml")!;
    expect(twiml.length).toBeLessThan(4_000);
    expect(twiml).toContain("&amp;");
  });

  it("normalizes a formatted owner destination before checking the allowlist", async () => {
    const fetchMock = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", fetchMock);
    const compact = process.env.NAQAH_OWNER_PHONE!;
    vi.stubEnv("NAQAH_OWNER_PHONE", `${compact.slice(0, 4)} ${compact.slice(4, 7)}-${compact.slice(7)}`);
    expect(await callOwnerWithSummary("summary", "en")).toBe(true);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(new URLSearchParams(String(init.body)).get("To") === compact).toBe(true);
  });

  it("blocks sample summary calls to unlisted and non-Saudi destinations", async () => {
    const fetchMock = vi.fn(async () => accepted());
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", "");
    expect(await callOwnerWithSummary("summary", "en")).toBe(false);
    const foreign = process.env.NAQAH_OWNER_PHONE!.replace(/^\+966/, "+44");
    vi.stubEnv("NAQAH_OWNER_PHONE", foreign);
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", foreign);
    expect(await callOwnerWithSummary("summary", "en")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not call Twilio unless explicitly enabled and fully configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("NAQAH_CALL_OWNER", "0");
    expect(await callOwnerWithSummary("summary", "en")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
