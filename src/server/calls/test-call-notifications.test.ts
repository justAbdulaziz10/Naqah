import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as turn } from "@/app/api/voice/turn/route";
import { callOwnerAfterReport } from "./owner-call";
import { recordingCaller } from "./twilio";

const mocks = vi.hoisted(() => ({ marker: vi.fn(), answer: vi.fn(), summary: vi.fn(), webhook: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("./test-call-store", () => ({ isTestRanch: mocks.marker }));
vi.mock("@/server/voice/farm-call", () => ({ answerFarmCall: mocks.answer }));
vi.mock("@/server/voice/summary", () => ({ scheduleOwnerSummary: mocks.summary, buildOwnerCallSummary: vi.fn() }));
vi.mock("@/server/voice/farm-webhook", () => ({
  farmWebhook: mocks.webhook,
  farmResponse: async (response: Promise<string>) => new Response(await response),
}));

beforeEach(() => {
  vi.stubEnv("NAQAH_TEST_CALLS", "1");
  vi.stubEnv("NAQAH_CALL_OWNER", "1");
  vi.stubEnv("NAQAH_VOICE_MODE", "farm");
  vi.stubEnv("TWILIO_ACCOUNT_SID", "");
  mocks.marker.mockResolvedValue(true);
  mocks.answer.mockResolvedValue("<Response><Say>Report saved</Say></Response>");
  mocks.webhook.mockResolvedValue({ client: {}, callSid: `CA${"a".repeat(32)}`, form: new URLSearchParams() });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("test ranch notification isolation", () => {
  it("suppresses owner calls before considering provider configuration", async () => {
    const { caller, requests } = recordingCaller();
    expect(await callOwnerAfterReport({} as never, { farmId: "marked", reportCallId: "run", now: new Date() }, caller)).toBeNull();
    expect(mocks.marker).toHaveBeenCalledWith({}, "marked");
    expect(requests).toHaveLength(0);
  });
  it("does not query new tables when off", async () => {
    vi.stubEnv("NAQAH_TEST_CALLS", "");
    expect(await callOwnerAfterReport({} as never, { farmId: "ordinary", reportCallId: null, now: new Date() })).toMatchObject({ placed: false, reason: "not_configured" });
    expect(mocks.marker).not.toHaveBeenCalled();
  });
  it("never enters the sample WhatsApp summary path for a farm report", async () => {
    const response = await turn(new Request("https://naqah.test/api/voice/turn?n=1", { method: "POST" }));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Report saved");
    expect(mocks.answer).toHaveBeenCalledOnce();
    expect(mocks.summary).not.toHaveBeenCalled();
  });
});
