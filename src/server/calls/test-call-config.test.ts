import { afterEach, describe, expect, it, vi } from "vitest";
import { isTestCallAdmin, testCallPhone, testCallsEnabled } from "./test-call-config";
import { testCallFailure } from "./test-call";
import { testCallProgress } from "./test-call-store";
import { createTwilioCaller } from "./twilio";

vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());

describe("test call gates and input", () => {
  it.each([undefined, "", "true", " 1", "1 ", "0"])("is off for %s", (value) => {
    vi.stubEnv("NAQAH_TEST_CALLS", value);
    expect(testCallsEnabled()).toBe(false);
  });
  it("requires the exact switch and a listed id or confirmed email", () => {
    vi.stubEnv("NAQAH_TEST_CALLS", "1");
    vi.stubEnv("NAQAH_TEST_CALL_ADMINS", " OWNER-ID, Admin@Example.test ");
    expect(testCallsEnabled()).toBe(true);
    expect(isTestCallAdmin({ id: "owner-id" })).toBe(true);
    expect(isTestCallAdmin({ id: "other", email: "ADMIN@example.test", email_confirmed_at: "now" })).toBe(true);
    expect(isTestCallAdmin({ id: "other", email: "admin@example.test" })).toBe(false);
    expect(isTestCallAdmin({ id: "other", email: "other@example.test", email_confirmed_at: "now" })).toBe(false);
    vi.stubEnv("NAQAH_TEST_CALL_ADMINS", "");
    expect(isTestCallAdmin({ id: "owner-id" })).toBe(false);
  });
  it.each(["+966501234567", "966501234567", "0501234567", "501234567", "+966 50-123-4567"])("normalizes %s", (phone) => {
    expect(testCallPhone(phone)).toBe("+966501234567");
  });
  it.each(["00966501234567", "+15550123456", "+966401234567", "050123456", "05012345678", "abc0501234567", "(050)1234567", "٥٠١٢٣٤٥٦٧", "", null, 501234567])("rejects %s", (phone) => {
    expect(testCallPhone(phone)).toBeNull();
  });
});

describe("provider failures and progress", () => {
  it.each([
    [21215, "rejected", "saudi_calls_disabled"], [13227, "rejected", "saudi_calls_disabled"],
    [21211, "rejected", "number_rejected"], [21201, "rejected", "number_rejected"],
    [20003, "rejected", "provider_rejected"], [undefined, "rejected", "provider_rejected"],
    [undefined, "network_error", "network_error"], [undefined, "invalid_number", "number_rejected"],
    [undefined, "not_configured", "not_placed"],
  ])("maps %s / %s", (code, reason, expected) => expect(testCallFailure(code as number | undefined, reason)).toBe(expected));
  it("surfaces only the numeric Twilio code, never its message", async () => {
    const fetchMock = vi.fn(async () => Response.json({ code: 21215, message: "sensitive provider detail" }, { status: 400 }));
    const caller = createTwilioCaller({ accountSid: "fake", authToken: "fake", from: "+15550123456", baseUrl: "https://naqah.test", allowlist: null }, fetchMock);
    const result = await caller.place({ to: "+966501234567", url: "https://naqah.test/voice", statusCallback: "https://naqah.test/status" });
    expect(result).toEqual({ placed: false, reason: "rejected", status: 400, code: 21215 });
    expect(JSON.stringify(result)).not.toContain("sensitive");
  });
  it.each([
    ["ringing", "ringing", null], ["answered", "connected", null], ["in-progress", "connected", null],
    ["completed", "completed", "no_report"], ["no-answer", "failed", "no_answer"],
    ["busy", "failed", "busy"], ["failed", "failed", "failed"], ["canceled", "failed", "canceled"],
  ])("maps %s with forward-only allowed states", (input, status, result) => {
    const progress = testCallProgress(input)!;
    expect(progress).toMatchObject({ status, result });
    expect(progress.from).not.toContain("completed");
    expect(progress.from).not.toContain("failed");
    if (status === "ringing") expect(progress.from).toEqual(["calling"]);
    if (status === "connected") expect(progress.from).toEqual(["calling", "ringing"]);
  });
  it("ignores non-progress and unknown statuses", () => {
    for (const status of ["queued", "initiated", "unknown", "toString"]) expect(testCallProgress(status)).toBeNull();
  });
});
