import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "@/domain/seed";
import { freeCallPreflight } from "./preflight";

vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ load: vi.fn(), clean: vi.fn() }));
vi.mock("@/server/db/queries", () => ({ loadFarm: mocks.load, requireFarm: (value: unknown) => value }));
vi.mock("@/server/calls/reliability", async (original) => ({ ...await original<typeof import("@/server/calls/reliability")>(), cleanStaleReportCalls: mocks.clean }));
const FARM = "11111111-1111-4111-8111-111111111111";
const SID = `AC${"a".repeat(32)}`;
const PHONE = "+966512345678";

beforeEach(() => {
  for (const [key, value] of Object.entries({ TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: "unit-token", TWILIO_PHONE_NUMBER: "+15555550100", NAQAH_PUBLIC_BASE_URL: "https://tunnel.test", NAQAH_BRIDGE_PUBLIC_URL: "wss://tunnel.test/voice-bridge/media", NAQAH_VOICE_SECRET: "unit-secret", NAQAH_CALL_ALLOWLIST: PHONE, NAQAH_CALL_TIME_LIMIT_SECONDS: "300" })) vi.stubEnv(key, value);
  const ws = createDemoWorkspace("ar", "ultimate");
  ws.settings.worker.phone = PHONE;
  ws.reportCalls = [];
  mocks.load.mockResolvedValue({ workspace: ws });
  mocks.clean.mockResolvedValue(undefined);
});
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });

function freeFetch(failed = "") {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes("IncomingPhoneNumbers")) return Response.json({ incoming_phone_numbers: [{ phone_number: "+15555550100", capabilities: { voice: failed !== "number" } }] });
    if (url.includes("api.twilio.com")) return Response.json({ sid: SID, status: "active" }, { status: failed === "twilio" ? 401 : 200 });
    if (url.endsWith("/health")) return Response.json({ ok: true, publicUrl: failed === "url" ? "wss://old.test/voice-bridge/media" : "wss://tunnel.test/voice-bridge/media", maxCallSeconds: 300 });
    if (url.endsWith("/preflight")) return Response.json({ openaiKeyValid: failed !== "openai" });
    throw new Error("Unexpected or paid endpoint");
  });
}

describe("free provider preflight", () => {
  it("uses only Twilio GETs and a signed bridge probe, without exposing credentials or recipients", async () => {
    const fetcher = freeFetch();
    const result = await freeCallPreflight({} as never, FARM, fetcher as typeof fetch);
    expect(result.ready).toBe(true);
    expect(result.checks).toHaveLength(8);
    for (const [url, init] of fetcher.mock.calls as unknown as [string | URL, RequestInit][]) {
      expect(String(url)).not.toContain("/Calls");
      expect(init.method ?? "GET").toBe(String(url).endsWith("/preflight") ? "POST" : "GET");
      expect(init.redirect).toBe("error");
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
    expect(JSON.stringify(result)).not.toMatch(/unit-token|unit-secret|966512345678|ACaaaa/);
  });
  it.each([["twilio", "twilio_account"], ["number", "twilio_voice_number"], ["openai", "openai_key"], ["url", "bridge_configuration"]])("explains %s failures in both languages", async (failure, name) => {
    const result = await freeCallPreflight({} as never, FARM, freeFetch(failure) as typeof fetch);
    expect(result.ready).toBe(false);
    expect(result.checks).toContainEqual(expect.objectContaining({ name, passed: false }));
    expect(result.message?.ar).toBeTruthy();
    expect(result.message?.en).toBeTruthy();
  });
  it("fails allowlist mismatches and active runs before any placement", async () => {
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", "+966500000001");
    const { workspace } = await mocks.load();
    workspace.reportCalls = [{ id: "active", state: "answered", occurrence: new Date().toISOString(), attempts: [{ at: new Date().toISOString(), result: "answered" }], nextAttemptAt: null }];
    const result = await freeCallPreflight({} as never, FARM, freeFetch() as typeof fetch);
    expect(result.checks.filter((check) => !check.passed).map((check) => check.name)).toEqual(["worker_allowlisted", "no_active_run"]);
  });
  it("reports an unreachable tunnel without leaking an exception", async () => {
    const result = await freeCallPreflight({} as never, FARM, vi.fn().mockRejectedValue(new Error("secret-provider-body")));
    expect(result.ready).toBe(false);
    expect(JSON.stringify(result)).not.toContain("secret-provider-body");
  });
});
