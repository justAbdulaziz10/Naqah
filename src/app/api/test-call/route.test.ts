import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ owner: vi.fn(), client: vi.fn(), readiness: vi.fn(), latest: vi.fn(), start: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getOwner: mocks.owner }));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: mocks.client }));
vi.mock("@/server/calls/test-call", () => ({ testCallReadiness: mocks.readiness, latestTestCall: mocks.latest, startTestCall: mocks.start }));

const requestId = "11111111-1111-4111-8111-111111111111";
const valid = { phone: "0501234567", confirmedCharge: true, consentConfirmed: true, requestId };
const request = (body: unknown = valid, origin = "https://naqah.test") => new Request("https://naqah.test/api/test-call", {
  method: "POST", headers: { Origin: origin, Host: "naqah.test", "Content-Type": "application/json" }, body: JSON.stringify(body),
});
beforeEach(() => {
  vi.stubEnv("NAQAH_TEST_CALLS", "1");
  vi.stubEnv("NAQAH_TEST_CALL_ADMINS", "admin");
  mocks.owner.mockResolvedValue({ user: { id: "admin" }, unavailable: false });
  mocks.client.mockReturnValue({});
  mocks.readiness.mockResolvedValue({ blockers: [] });
  mocks.latest.mockResolvedValue(null);
  mocks.start.mockResolvedValue({ ok: true, call: { id: "call", status: "calling" } });
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe("test call HTTP boundary", () => {
  it.each([GET, () => POST(request())])("returns indistinguishable 404s while off or non-admin", async (handler) => {
    vi.stubEnv("NAQAH_TEST_CALLS", "");
    expect(await (await handler()).json()).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.owner).not.toHaveBeenCalled();
    vi.stubEnv("NAQAH_TEST_CALLS", "1");
    mocks.owner.mockResolvedValue({ user: { id: "other" } });
    const response = await handler();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, error: "unavailable" });
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it.each([GET, () => POST(request())])("requires a signed-in user", async (handler) => {
    mocks.owner.mockResolvedValue({ user: null });
    const response = await handler();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ ok: false, error: "unauthenticated" });
  });
  it("accepts only confirmed allowlisted emails", async () => {
    vi.stubEnv("NAQAH_TEST_CALL_ADMINS", "admin@example.test");
    mocks.owner.mockResolvedValue({ user: { id: "other", email: "admin@example.test" } });
    expect((await GET()).status).toBe(404);
    mocks.owner.mockResolvedValue({ user: { id: "other", email: "ADMIN@example.test", email_confirmed_at: "now" } });
    expect((await GET()).status).toBe(200);
  });
  it("returns readiness and no-store responses", async () => {
    mocks.readiness.mockResolvedValue({ blockers: ["no_test_ranch", "no_allowlist"] });
    const response = await GET();
    expect(await response.json()).toEqual({ ok: true, ready: false, blockers: ["no_test_ranch", "no_allowlist"], call: null });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });
  it("handles missing configuration and storage errors", async () => {
    mocks.client.mockReturnValue(null);
    expect(await (await GET()).json()).toMatchObject({ ready: false, blockers: ["not_configured"] });
    expect((await POST(request())).status).toBe(503);
    mocks.client.mockReturnValue({});
    mocks.readiness.mockRejectedValueOnce(new Error("secret storage detail"));
    expect(await (await GET()).json()).toEqual({ ok: false, error: "failed" });
    mocks.start.mockRejectedValueOnce(new Error("secret provider detail"));
    expect(await (await POST(request())).json()).toEqual({ ok: false, error: "failed" });
  });
  it("rejects cross-origin requests", async () => {
    expect((await POST(request(valid, "https://attacker.test"))).status).toBe(403);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([{ ...valid, confirmedCharge: false }, { ...valid, consentConfirmed: false }, { ...valid, confirmedCharge: "true" }])("requires explicit confirmations", async (body) => {
    expect(await (await POST(request(body))).json()).toEqual({ ok: false, error: "confirmation_required" });
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it.each([null, [], {}, { ...valid, requestId: "bad" }, { ...valid, requestId: null }])("rejects invalid requests", async (body) => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.start).not.toHaveBeenCalled();
  });
  it("bounds JSON and rejects malformed input", async () => {
    const malformed = new Request("https://naqah.test/api/test-call", { method: "POST", headers: { Origin: "https://naqah.test", Host: "naqah.test" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400);
    expect((await POST(request({ ...valid, ignored: "x".repeat(2500) }))).status).toBe(413);
  });
  it("normalizes the phone and cannot choose another farm", async () => {
    expect((await POST(request({ ...valid, farmId: "another-farm", actorId: "another-owner" }))).status).toBe(200);
    expect(mocks.start).toHaveBeenCalledWith({}, "admin", { phone: "+966501234567", requestId });
    expect(await (await POST(request({ ...valid, phone: "+15550123456" }))).json()).toEqual({ ok: false, error: "invalid_number" });
  });
  it.each([["busy", 409], ["rate_limited", 429], ["no_test_ranch", 403], ["not_configured", 503], ["number_not_allowed", 400]])("maps %s to %s", async (error, status) => {
    mocks.start.mockResolvedValue({ ok: false, error });
    const response = await POST(request());
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ ok: false, error });
  });
});
