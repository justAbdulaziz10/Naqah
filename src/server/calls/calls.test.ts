import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as cron } from "@/app/api/cron/report-calls/route";
import { POST as outbound } from "@/app/api/voice/outbound/route";
import { POST as outboundStatus } from "@/app/api/voice/outbound/status/route";
import { twilioRequestSignature } from "@/server/twilio/signature";
import { outboundCallMissing, outboundConfig } from "./config";
import { CALL_TOKEN_MAX_AGE_MS, signCallToken, verifyCallToken } from "./token";
import { createTwilioCaller } from "./twilio";

const mock = vi.hoisted(() => ({ client: vi.fn(), scheduler: vi.fn(), answer: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: vi.fn(async () => {}) }));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: mock.client }));
vi.mock("./scheduler", () => ({ runReportCallScheduler: mock.scheduler }));
vi.mock("@/server/voice/farm-call", async (original) => ({
  ...(await original<typeof import("@/server/voice/farm-call")>()),
  answerReportCall: mock.answer,
}));

const SECRET = "unit-test-voice-secret-at-least-32-bytes";
const FARM = "11111111-1111-4111-8111-111111111111";
const RUN = "22222222-2222-4222-8222-222222222222";
const CALL = `CA${"b".repeat(32)}`;
const config = { accountSid: "AC123", authToken: "token", from: "+15550100", baseUrl: "https://naqah.test", allowlist: ["+966501234567"] };

function farmEnv() {
  vi.stubEnv("NAQAH_VOICE_MODE", "farm");
  vi.stubEnv("TWILIO_AUTH_TOKEN", "unit-twilio-token");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "AC123");
  vi.stubEnv("TWILIO_PHONE_NUMBER", "+15550100");
  vi.stubEnv("NAQAH_PUBLIC_BASE_URL", "https://naqah.test");
  vi.stubEnv("NAQAH_VOICE_SECRET", SECRET);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-only");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
}

beforeEach(() => {
  for (const name of ["NAQAH_VOICE_MODE", "TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID", "TWILIO_PHONE_NUMBER", "NAQAH_PUBLIC_BASE_URL", "NAQAH_VOICE_SECRET", "CRON_SECRET", "SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY", "NAQAH_SCHEDULED_CALLS", "NAQAH_CALL_ALLOWLIST"]) {
    vi.stubEnv(name, "");
  }
  mock.client.mockReturnValue({});
  mock.scheduler.mockResolvedValue({ farms: 1, placed: 1, failed: 0, errors: 0 });
  mock.answer.mockResolvedValue("<Response><Say>questions</Say></Response>");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("Twilio outbound client", () => {
  it("never pretends a call was placed without credentials", async () => {
    const fetchMock = vi.fn();
    expect(outboundConfig()).toBeNull();
    expect(outboundCallMissing()).toEqual(expect.arrayContaining(["TWILIO_ACCOUNT_SID", "TWILIO_PHONE_NUMBER", "NAQAH_PUBLIC_BASE_URL", "NAQAH_VOICE_SECRET"]));
    expect(await createTwilioCaller(null, fetchMock).place({ to: "+966501234567", url: "https://naqah.test/x", statusCallback: "https://naqah.test/y" }))
      .toEqual({ placed: false, reason: "not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("refuses a plain-http public origin", () => {
    farmEnv();
    vi.stubEnv("NAQAH_PUBLIC_BASE_URL", "http://naqah.test");
    expect(outboundConfig()).toBeNull();
  });
  it("creates the call with the TwiML URL, a status callback and recording off", async () => {
    const fetchMock = vi.fn(async () => Response.json({ sid: CALL }, { status: 201 }));
    const result = await createTwilioCaller(config, fetchMock as typeof fetch).place({
      to: "+966501234567", url: "https://naqah.test/api/voice/outbound?s=t", statusCallback: "https://naqah.test/api/voice/outbound/status?s=t",
    });
    expect(result).toEqual({ placed: true, sid: CALL });
    const [endpoint, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(endpoint).toBe("https://api.twilio.com/2010-04-01/Accounts/AC123/Calls.json");
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toMatchObject({
      To: "+966501234567", From: "+15550100", Url: "https://naqah.test/api/voice/outbound/status?s=t&amd=1", Method: "POST", MachineDetection: "Enable", AsyncAmd: "false",
      StatusCallback: "https://naqah.test/api/voice/outbound/status?s=t", StatusCallbackMethod: "POST", Record: "false",
    });
  });
  it.each(["outbound", "worker", "owner"])("enables synchronous AMD for the %s answer gate", async (path) => {
    const fetchMock = vi.fn(async () => Response.json({ sid: CALL }, { status: 201 }));
    await createTwilioCaller(config, fetchMock as typeof fetch).place({
      to: "+966501234567", url: `https://naqah.test/api/voice/${path}?s=t`, statusCallback: `https://naqah.test/api/voice/${path}/status?s=t`,
    });
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body;
    expect(body.get("MachineDetection")).toBe("Enable");
    expect(body.get("AsyncAmd")).toBe("false");
    expect(body.get("Url")).toBe(`https://naqah.test/api/voice/${path}/status?s=t&amd=1`);
  });
  it.each([
    [async () => new Response("{}", { status: 400 }), { placed: false, reason: "rejected", status: 400 }],
    [async () => Response.json({ sid: "nope" }), { placed: false, reason: "network_error", status: 200 }],
    [async () => new Response("bad json", { status: 201 }), { placed: false, reason: "network_error" }],
    [async () => new Response("bad json", { status: 400 }), { placed: false, reason: "rejected", status: 400 }],
    [async () => Response.json({ code: 20500 }, { status: 500 }), { placed: false, reason: "network_error", status: 500, code: 20500 }],
    [async () => { throw new TypeError("offline"); }, { placed: false, reason: "network_error" }],
  ])("reports a failed placement honestly", async (impl, expected) => {
    expect(await createTwilioCaller(config, vi.fn(impl) as unknown as typeof fetch).place({ to: "+966501234567", url: "https://x", statusCallback: "https://y" })).toEqual(expected);
  });
  it("won't dial a number without a country code", async () => {
    const fetchMock = vi.fn();
    expect(await createTwilioCaller(config, fetchMock).place({ to: "0501234567", url: "https://x", statusCallback: "https://y" })).toMatchObject({ placed: false, reason: "invalid_number" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("controlled-test allowlist", () => {
  const request = (to: string) => ({ to, url: "https://naqah.test/x", statusCallback: "https://naqah.test/y" });
  const ok = () => vi.fn(async () => Response.json({ sid: `CA${"a".repeat(32)}` }));
  it("dials only numbers on the allowlist, and never reaches Twilio otherwise", async () => {
    const fetchMock = ok();
    const caller = createTwilioCaller({ ...config, allowlist: ["+966501234567"] }, fetchMock as unknown as typeof fetch);
    expect(await caller.place(request("+966509999999"))).toEqual({ placed: false, reason: "not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await caller.place(request("+966501234567"))).toMatchObject({ placed: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("reads the allowlist from the environment and fails closed on a typo", () => {
    farmEnv();
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", "+966 50 123 4567, +44 7700 900123");
    expect(outboundConfig()?.allowlist).toEqual(["+966501234567"]);
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", "0501234567");
    expect(outboundConfig()?.allowlist).toEqual([]);
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", "");
    expect(outboundConfig()?.allowlist).toEqual([]);
  });
  it("refuses every call when the allowlist is empty or unset", async () => {
    const fetchMock = ok();
    const caller = createTwilioCaller({ ...config, allowlist: [] }, fetchMock as unknown as typeof fetch);
    expect(await caller.place(request("+966501234567"))).toEqual({ placed: false, reason: "not_allowed" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("dials Saudi mobiles only, even when another number is allowlisted", async () => {
    const fetchMock = ok();
    const caller = createTwilioCaller({ ...config, allowlist: ["+447700900123", "+966112345678"] }, fetchMock as unknown as typeof fetch);
    expect(await caller.place(request("+447700900123"))).toEqual({ placed: false, reason: "invalid_number" });
    expect(await caller.place(request("+966112345678"))).toEqual({ placed: false, reason: "invalid_number" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("gives Twilio thirty seconds beyond the bridge cap; the setting can only lower that cap", async () => {
    const limitFor = async (value: string | undefined) => {
      vi.stubEnv("NAQAH_CALL_TIME_LIMIT_SECONDS", value ?? "");
      const fetchMock = ok();
      await createTwilioCaller(config, fetchMock as unknown as typeof fetch).place(request("+966501234567"));
      return (fetchMock.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body.get("TimeLimit");
    };
    expect(await limitFor(undefined)).toBe("330");
    expect(await limitFor("120")).toBe("150");
    expect(await limitFor("900")).toBe("330");
    expect(await limitFor("abc")).toBe("330");
  });
  it("always asks Twilio not to record", async () => {
    const fetchMock = ok();
    await createTwilioCaller(config, fetchMock as unknown as typeof fetch).place(request("+966501234567"));
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body;
    expect(body.get("Record")).toBe("false");
    expect(body.get("StatusCallback")).toBe("https://naqah.test/y");
  });
  it("requests each progress event separately when asked", async () => {
    const fetchMock = ok();
    await createTwilioCaller(config, fetchMock as unknown as typeof fetch).place({ ...request("+966501234567"), timeoutSeconds: 60, statusEvents: ["initiated", "ringing", "answered", "completed"] });
    const body = (fetchMock.mock.calls[0] as unknown as [string, { body: URLSearchParams }])[1].body;
    expect(body.get("Timeout")).toBe("60");
    expect(body.getAll("StatusCallbackEvent")).toEqual(["initiated", "ringing", "answered", "completed"]);
  });
});

describe("signed call tokens", () => {
  const now = Date.parse("2026-11-08T06:00:00.000Z");
  const token = { k: "report" as const, f: FARM, r: RUN, n: 2, l: "ar" as const, t: now };
  it("round-trips and binds farm, run and attempt", () => {
    expect(verifyCallToken(signCallToken(token, SECRET), SECRET, now)).toEqual(token);
  });
  it("rejects tampering, another secret, expiry and the voice-state signature", () => {
    const signed = signCallToken(token, SECRET);
    const [payload, signature] = signed.split(".");
    const forged = Buffer.from(JSON.stringify({ ...token, f: RUN })).toString("base64url");
    expect(verifyCallToken(`${forged}.${signature}`, SECRET, now)).toBeNull();
    expect(verifyCallToken(`${payload}.${signature}x`, SECRET, now)).toBeNull();
    expect(verifyCallToken(signed, "another-secret-another-secret-123", now)).toBeNull();
    expect(verifyCallToken(signed, SECRET, now + CALL_TOKEN_MAX_AGE_MS + 1)).toBeNull();
    expect(verifyCallToken(signCallToken({ ...token, r: "rcl_1" }, SECRET), SECRET, now)).toBeNull();
  });
  it("binds an owner call to its run and attempt, and allows a call with no report", () => {
    const owner = { k: "owner" as const, f: FARM, o: RUN, r: "", n: 3, l: "ar" as const, t: now };
    expect(verifyCallToken(signCallToken(owner, SECRET), SECRET, now)).toEqual(owner);
    expect(verifyCallToken(signCallToken({ ...owner, r: RUN }, SECRET), SECRET, now)).toEqual({ ...owner, r: RUN });
    expect(verifyCallToken(signCallToken({ ...owner, r: "rep_1" }, SECRET), SECRET, now)).toBeNull();
    expect(verifyCallToken(signCallToken({ ...owner, o: "ocr_1" }, SECRET), SECRET, now)).toBeNull();
    expect(verifyCallToken(signCallToken({ ...owner, n: 4 }, SECRET), SECRET, now)).toBeNull();
  });
});

describe("report-call scheduler route", () => {
  const get = (authorization?: string) =>
    cron(new Request("https://naqah.test/api/cron/report-calls", { headers: authorization ? { authorization } : {} }));
  it("refuses everything while CRON_SECRET is unset", async () => {
    farmEnv();
    const response = await get("Bearer anything");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, reason: "cron_secret_missing" });
    expect(mock.scheduler).not.toHaveBeenCalled();
  });
  it("refuses a missing or wrong bearer token", async () => {
    farmEnv();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect((await get()).status).toBe(401);
    expect((await get("Bearer wrong")).status).toBe(401);
    expect(mock.scheduler).not.toHaveBeenCalled();
  });
  it("places nothing on the sample line", async () => {
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(await (await get("Bearer cron-secret")).json()).toEqual({ ok: true, placed: 0, skipped: "sample_mode" });
    expect(mock.scheduler).not.toHaveBeenCalled();
  });
  it("names what is missing instead of placing calls", async () => {
    farmEnv();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("TWILIO_ACCOUNT_SID", "");
    const response = await get("Bearer cron-secret");
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, placed: 0, reason: "not_configured", missing: ["TWILIO_ACCOUNT_SID"] });
    expect(mock.scheduler).not.toHaveBeenCalled();
  });
  it("places nothing until unattended calls are switched on", async () => {
    farmEnv();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    expect(await (await get("Bearer cron-secret")).json()).toEqual({ ok: true, placed: 0, skipped: "scheduled_calls_off" });
    expect(mock.scheduler).not.toHaveBeenCalled();
  });
  it("runs the scheduler with the public origin when everything is set", async () => {
    farmEnv();
    vi.stubEnv("CRON_SECRET", "cron-secret");
    vi.stubEnv("NAQAH_SCHEDULED_CALLS", "1");
    const response = await get("Bearer cron-secret");
    expect(await response.json()).toEqual({ ok: true, farms: 1, placed: 1, failed: 0, errors: 0 });
    expect(mock.scheduler).toHaveBeenCalledWith({}, expect.anything(), expect.objectContaining({ baseUrl: "https://naqah.test" }));
  });
});

describe("outbound answer and status webhooks", () => {
  function hook(path: string, fields: Record<string, string>) {
    const url = `https://naqah.test${path}`;
    return new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioRequestSignature(url, fields, "unit-twilio-token") },
      body: new URLSearchParams(fields),
    });
  }
  const signed = () => encodeURIComponent(signCallToken({ k: "report", f: FARM, r: RUN, n: 1, l: "en", t: Date.now() }, SECRET));

  it("says the line is off on the sample line and touches nothing", async () => {
    const response = await outbound(hook(`/api/voice/outbound?s=${signed()}`, { CallSid: CALL }));
    expect(await response.text()).toContain("<Hangup/>");
    expect(mock.answer).not.toHaveBeenCalled();
    expect((await outboundStatus(hook(`/api/voice/outbound/status?s=${signed()}`, { CallSid: CALL, CallStatus: "no-answer" }))).status).toBe(204);
  });
  it("takes farm and run from the signed token, never from caller ID", async () => {
    farmEnv();
    const response = await outbound(hook(`/api/voice/outbound?s=${signed()}`, { CallSid: CALL, From: "+15550100", To: "+966500000009" }));
    expect(await response.text()).toContain("questions");
    expect(mock.answer).toHaveBeenCalledWith({}, expect.objectContaining({ callSid: CALL, token: expect.objectContaining({ f: FARM, r: RUN, n: 1 }) }));
  });
  it("refuses a request whose Twilio signature doesn't match", async () => {
    farmEnv();
    const url = `https://naqah.test/api/voice/outbound?s=${signed()}`;
    const forged = new Request(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioRequestSignature(url, { CallSid: CALL }, "another-token") },
      body: new URLSearchParams({ CallSid: CALL }),
    });
    expect((await outbound(forged)).status).toBe(403);
    expect(mock.answer).not.toHaveBeenCalled();
  });
  it("refuses an owner-call token or a missing token on the report-call webhook", async () => {
    farmEnv();
    const owner = encodeURIComponent(signCallToken({ k: "owner", f: FARM, o: RUN, r: "", n: 1, l: "en", t: Date.now() }, SECRET));
    expect((await outbound(hook(`/api/voice/outbound?s=${owner}`, { CallSid: CALL }))).status).toBe(403);
    expect((await outbound(hook("/api/voice/outbound", { CallSid: CALL }))).status).toBe(403);
    expect(mock.answer).not.toHaveBeenCalled();
  });
});
