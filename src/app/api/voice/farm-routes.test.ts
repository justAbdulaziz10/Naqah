import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as outbound } from "./outbound/route";
import { POST as outboundStatus } from "./outbound/status/route";
import { POST as ownerStatus } from "./owner/status/route";
import { POST as realtimeAfter } from "./realtime/after/route";
import { POST as voiceStatus } from "./status/route";
import { signCallToken } from "@/server/calls/token";

const mock = vi.hoisted(() => ({
  farmWebhook: vi.fn(),
  farmResponse: vi.fn(),
  answerReportCall: vi.fn(),
  reportCallStatus: vi.fn(),
  ownerCallStatus: vi.fn(),
  endFarmCall: vi.fn(),
  afterRealtimeCall: vi.fn(),
  logCallProgress: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/server/voice/farm-webhook", () => ({ farmWebhook: mock.farmWebhook, farmResponse: mock.farmResponse }));
vi.mock("@/server/voice/farm-call", () => ({
  answerReportCall: mock.answerReportCall,
  reportCallStatus: mock.reportCallStatus,
  ownerCallStatus: mock.ownerCallStatus,
  endFarmCall: mock.endFarmCall,
}));
vi.mock("@/server/voice/diagnostics", () => ({ logCallProgress: mock.logCallProgress }));
vi.mock("@/server/voice/realtime/service", () => ({ afterRealtimeCall: mock.afterRealtimeCall }));

const BASE = "https://naqah.test";
const FIXTURE_SIGNING_KEY = "unit-test-fixture-signing-key-32-bytes-min";
const CALL = `CA${"a".repeat(32)}`;
const FARM = "00000000-0000-4000-8000-000000000001";
const RUN = "00000000-0000-4000-8000-000000000002";
const reportToken = () => signCallToken({ k: "report", f: FARM, r: RUN, n: 1, l: "en", t: Date.now() }, FIXTURE_SIGNING_KEY);
const ownerToken = () => signCallToken({ k: "owner", f: FARM, r: RUN, l: "en", t: Date.now() }, FIXTURE_SIGNING_KEY);
const url = (path: string, token = "bad") => `${BASE}${path}?s=${encodeURIComponent(token)}`;
const request = (path: string, token = "bad") => new Request(url(path, token), { method: "POST" });

beforeEach(() => {
  vi.stubEnv("NAQAH_VOICE_MODE", "farm");
  vi.stubEnv("NAQAH_VOICE_SECRET", FIXTURE_SIGNING_KEY);
  vi.stubEnv("NAQAH_VOICE_LOCALE", "en");
  mock.farmWebhook.mockResolvedValue({ client: {}, form: new URLSearchParams(`CallSid=${CALL}&CallStatus=completed`), callSid: CALL });
  mock.farmResponse.mockImplementation(async (work: Promise<string>) => new Response(await work, { headers: { "content-type": "text/xml" } }));
  mock.answerReportCall.mockResolvedValue("<Response><Say>answer</Say></Response>");
  mock.reportCallStatus.mockResolvedValue(undefined);
  mock.ownerCallStatus.mockResolvedValue(undefined);
  mock.endFarmCall.mockResolvedValue(undefined);
  mock.afterRealtimeCall.mockResolvedValue("<Response><Say>after</Say></Response>");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("farm outbound voice routes", () => {
  it("refuses invalid or wrong-kind signed tokens on all token-protected routes", async () => {
    expect((await outbound(request("/api/voice/outbound"))).status).toBe(403);
    expect((await outboundStatus(request("/api/voice/outbound/status"))).status).toBe(403);
    expect((await ownerStatus(request("/api/voice/owner/status"))).status).toBe(403);
    expect((await realtimeAfter(request("/api/voice/realtime/after"))).status).toBe(403);
    expect((await ownerStatus(request("/api/voice/owner/status", reportToken()))).status).toBe(403);
    expect((await outboundStatus(request("/api/voice/outbound/status", ownerToken()))).status).toBe(403);
    expect(mock.answerReportCall).not.toHaveBeenCalled();
    expect(mock.reportCallStatus).not.toHaveBeenCalled();
    expect(mock.ownerCallStatus).not.toHaveBeenCalled();
    expect(mock.afterRealtimeCall).not.toHaveBeenCalled();
  });

  it("runs the validated report and owner callbacks using their matching signed token", async () => {
    expect((await outbound(request("/api/voice/outbound", reportToken()))).status).toBe(200);
    expect(mock.answerReportCall).toHaveBeenCalledWith({}, expect.objectContaining({ callSid: CALL }));
    expect((await outboundStatus(request("/api/voice/outbound/status", reportToken()))).status).toBe(204);
    expect(mock.reportCallStatus).toHaveBeenCalledWith({}, expect.objectContaining({ callSid: CALL, status: "completed" }));
    expect((await ownerStatus(request("/api/voice/owner/status", ownerToken()))).status).toBe(204);
    expect(mock.ownerCallStatus).toHaveBeenCalledWith({}, expect.objectContaining({ callSid: CALL, status: "completed" }));
    expect((await realtimeAfter(request("/api/voice/realtime/after", reportToken()))).status).toBe(200);
    expect(mock.afterRealtimeCall).toHaveBeenCalledWith({}, expect.objectContaining({ callSid: CALL }));
  });

  it("passes shared webhook signature and input refusals through before route work", async () => {
    mock.farmWebhook.mockResolvedValueOnce(new Response("forbidden", { status: 403 }));
    expect((await outbound(request("/api/voice/outbound", reportToken()))).status).toBe(403);
    mock.farmWebhook.mockResolvedValueOnce(new Response(null, { status: 400 }));
    expect((await outboundStatus(request("/api/voice/outbound/status", reportToken()))).status).toBe(400);
    expect(mock.answerReportCall).not.toHaveBeenCalled();
    expect(mock.reportCallStatus).not.toHaveBeenCalled();
  });

  it("passes bounded-body 413 refusals through every farm Twilio route", async () => {
    const oversized = () => new Response(null, { status: 413 });
    const routes = [
      () => outbound(request("/api/voice/outbound", reportToken())),
      () => outboundStatus(request("/api/voice/outbound/status", reportToken())),
      () => ownerStatus(request("/api/voice/owner/status", ownerToken())),
      () => realtimeAfter(request("/api/voice/realtime/after", reportToken())),
      () => voiceStatus(request("/api/voice/status")),
    ];
    for (const route of routes) {
      mock.farmWebhook.mockResolvedValueOnce(oversized());
      expect((await route()).status).toBe(413);
    }
    expect(mock.answerReportCall).not.toHaveBeenCalled();
    expect(mock.reportCallStatus).not.toHaveBeenCalled();
    expect(mock.ownerCallStatus).not.toHaveBeenCalled();
    expect(mock.afterRealtimeCall).not.toHaveBeenCalled();
    expect(mock.endFarmCall).not.toHaveBeenCalled();
  });
});
