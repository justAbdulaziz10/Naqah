import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const mocks = vi.hoisted(() => ({ webhook: vi.fn(), existing: vi.fn(), progress: vi.fn(), token: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/server/voice/farm-webhook", () => ({ farmWebhook: mocks.webhook }));
vi.mock("@/server/voice/farm-call", () => ({ reportCallStatus: mocks.existing }));
vi.mock("@/server/calls/test-call-store", () => ({ recordTestCallProgress: mocks.progress }));
vi.mock("@/server/calls/token", () => ({ verifyCallToken: mocks.token }));
const token = { k: "report", f: "farm", r: "run", n: 1, l: "en", t: 0 };
const request = () => new Request("https://naqah.test/api/voice/outbound/status?s=fake", { method: "POST" });

beforeEach(() => {
  vi.stubEnv("NAQAH_VOICE_MODE", "farm");
  vi.stubEnv("NAQAH_TEST_CALLS", "1");
  mocks.webhook.mockResolvedValue({ client: {}, callSid: `CA${"a".repeat(32)}`, form: new URLSearchParams({ CallStatus: "ringing" }) });
  mocks.token.mockReturnValue(token);
  mocks.existing.mockResolvedValue(undefined);
  mocks.progress.mockResolvedValue(undefined);
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => { vi.clearAllMocks(); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("optional test call status recording", () => {
  it("does nothing new when the switch is off", async () => {
    vi.stubEnv("NAQAH_TEST_CALLS", "");
    expect((await POST(request())).status).toBe(204);
    expect(mocks.existing).toHaveBeenCalledOnce();
    expect(mocks.progress).not.toHaveBeenCalled();
  });
  it("records after the existing handler and never breaks it", async () => {
    mocks.progress.mockRejectedValueOnce(new Error("database unavailable"));
    expect((await POST(request())).status).toBe(204);
    expect(mocks.existing.mock.invocationCallOrder[0]).toBeLessThan(mocks.progress.mock.invocationCallOrder[0]);
    expect(mocks.progress).toHaveBeenCalledWith({}, "run", "farm", "ringing", expect.any(Date));
  });
  it("still tries to close test runs if existing handling fails", async () => {
    mocks.existing.mockRejectedValueOnce(new Error("existing failure"));
    expect((await POST(request())).status).toBe(503);
    expect(mocks.progress).toHaveBeenCalledOnce();
  });
  it("never bypasses webhook verification or the signed run token", async () => {
    mocks.webhook.mockResolvedValueOnce(new Response(null, { status: 403 }));
    expect((await POST(request())).status).toBe(403);
    mocks.token.mockReturnValueOnce(null);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.progress).not.toHaveBeenCalled();
  });
});
