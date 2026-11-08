import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as inbound } from "@/app/api/voice/inbound/route";
import { POST as voiceStatus } from "@/app/api/voice/status/route";
import { POST as turn } from "@/app/api/voice/turn/route";
import { twilioRequestSignature } from "@/server/twilio/signature";

const mock = vi.hoisted(() => ({ client: vi.fn(), start: vi.fn(), answer: vi.fn(), end: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: mock.client }));
vi.mock("./farm-call", async (original) => ({
  ...(await original<typeof import("./farm-call")>()),
  startFarmCall: mock.start,
  answerFarmCall: mock.answer,
  endFarmCall: mock.end,
}));

const BASE = "https://naqah.test";
const TOKEN = "unit-test-token";
const CALL = `CA${"a".repeat(32)}`;

function hook(path: string, fields: Record<string, string>, token = TOKEN) {
  const url = `${BASE}${path}`;
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "X-Twilio-Signature": twilioRequestSignature(url, fields, token) },
    body: new URLSearchParams(fields),
  });
}

beforeEach(() => {
  vi.stubEnv("NAQAH_VOICE_MODE", "farm");
  vi.stubEnv("TWILIO_AUTH_TOKEN", TOKEN);
  vi.stubEnv("NAQAH_PUBLIC_BASE_URL", BASE);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-only");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  vi.stubEnv("NAQAH_VOICE_LOCALE", "en");
  mock.client.mockReturnValue({});
  mock.start.mockResolvedValue("<Response><Say>started</Say></Response>");
  mock.answer.mockResolvedValue("<Response><Say>answered</Say></Response>");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("farm webhooks", () => {
  it.each(["/api/voice/inbound", "/api/voice/turn"])("validates a read-only probe on %s without starting a call", async (path) => {
    const handler = path.endsWith("inbound") ? inbound : turn;
    const response = await handler(hook(`${path}?preflight=1`, { Preflight: "1", CallSid: CALL }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ preflight: true, recording: false, transcription: false });
    expect(mock.start).not.toHaveBeenCalled();
    expect(mock.answer).not.toHaveBeenCalled();
    expect(mock.end).not.toHaveBeenCalled();
    expect((await handler(hook(`${path}?preflight=1`, { Preflight: "1" }, "wrong"))).status).toBe(403);
  });
  it("passes final recognition confidence and ignores unstable partial speech", async () => {
    await turn(hook("/api/voice/turn?n=0", { CallSid: CALL, UnstableSpeechResult: "ايوه", Confidence: "0.1" }));
    expect(mock.answer).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ speech: "", confidence: "0.1" }));
  });
  it("passes a signed call through", async () => {
    const response = await inbound(hook("/api/voice/inbound", { CallSid: CALL, From: "+966500000001" }));
    expect(await response.text()).toContain("started");
    expect(mock.start).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ callSid: CALL, from: "+966500000001" }));
  });
  it("rejects a wrong signature before touching the farm", async () => {
    const response = await inbound(hook("/api/voice/inbound", { CallSid: CALL }, "wrong"));
    expect(response.status).toBe(403);
    expect(mock.start).not.toHaveBeenCalled();
  });
  it.each(["TWILIO_AUTH_TOKEN", "NAQAH_PUBLIC_BASE_URL", "SUPABASE_SECRET_KEY"])("closes the line without %s", async (name) => {
    vi.stubEnv(name, "");
    const xml = await (await inbound(hook("/api/voice/inbound", { CallSid: CALL }))).text();
    expect(xml).toContain("not configured");
    expect(mock.start).not.toHaveBeenCalled();
  });
  it("ignores the unsigned override: it belongs to the sample line", async () => {
    vi.stubEnv("NAQAH_ALLOW_UNSIGNED_VOICE", "1");
    vi.stubEnv("TWILIO_AUTH_TOKEN", "");
    await inbound(new Request(`${BASE}/api/voice/inbound`, { method: "POST", body: new URLSearchParams({ CallSid: CALL }) }));
    expect(mock.start).not.toHaveBeenCalled();
  });
  it("closes the line when the client can't be built", async () => {
    mock.client.mockReturnValue(null);
    expect(await (await inbound(hook("/api/voice/inbound", { CallSid: CALL }))).text()).toContain("not configured");
  });
  it("rejects a malformed CallSid", async () => {
    expect((await inbound(hook("/api/voice/inbound", { CallSid: "CA1" }))).status).toBe(400);
    expect(mock.start).not.toHaveBeenCalled();
  });
  it("rejects a turn with no valid position", async () => {
    expect((await turn(hook("/api/voice/turn?n=x", { CallSid: CALL }))).status).toBe(400);
    expect(mock.answer).not.toHaveBeenCalled();
  });
  it("never reaches the sample conversation", async () => {
    vi.stubEnv("NAQAH_VOICE_SECRET", "a-sample-line-secret-of-at-least-32-bytes");
    const response = await turn(hook("/api/voice/turn?s=anything", { CallSid: CALL }));
    expect(response.status).toBe(400);
  });
  it("tells the caller nothing was confirmed when the work throws", async () => {
    mock.answer.mockRejectedValue(new Error("boom"));
    const xml = await (await turn(hook("/api/voice/turn?n=2", { CallSid: CALL, Digits: "1" }))).text();
    expect(xml).toContain("couldn&apos;t confirm");
    expect(xml).not.toContain("boom");
    expect(xml).toContain("<Hangup/>");
  });
  it("clears working state only for a finished call", async () => {
    await voiceStatus(hook("/api/voice/status", { CallSid: CALL, CallStatus: "in-progress" }));
    expect(mock.end).not.toHaveBeenCalled();
    expect((await voiceStatus(hook("/api/voice/status", { CallSid: CALL, CallStatus: "completed" }))).status).toBe(204);
    expect(mock.end).toHaveBeenCalledWith(expect.anything(), CALL);
  });
  it("asks Twilio to retry a status callback it couldn't store", async () => {
    mock.end.mockRejectedValue(new Error("down"));
    expect((await voiceStatus(hook("/api/voice/status", { CallSid: CALL, CallStatus: "completed" }))).status).toBe(503);
  });
});
