import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ rpc: vi.fn(), createClient: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: mock.createClient }));

const { reserveRateLimit, resetRateLimitState } = await import("./rate-limit");

describe("shared rate limiter", () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    mock.rpc.mockReset();
    mock.createClient.mockReset().mockReturnValue({ rpc: mock.rpc });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("uses the atomic RPC and can release a reserved slot", async () => {
    mock.rpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: true, error: null });
    const lease = await reserveRateLimit("otp:phone:+966500000000", 5, 900);
    expect(lease).not.toBeNull();
    expect(mock.rpc).toHaveBeenCalledWith("consume_rate_limit", {
      p_key: "otp:phone:+966500000000", p_limit: 5, p_window_seconds: 900,
    });
    await lease?.release();
    expect(mock.rpc).toHaveBeenLastCalledWith("release_rate_limit", { p_key: "otp:phone:+966500000000" });
  });

  it("falls back to local buckets when the RPC returns an error and warns once", async () => {
    mock.rpc.mockResolvedValue({ data: null, error: new Error("migration pending") });
    const first = await reserveRateLimit("otp:phone:1", 1, 60, 0);
    expect(first).not.toBeNull();
    expect(await reserveRateLimit("otp:phone:1", 1, 60, 1)).toBeNull();
    expect(console.warn).toHaveBeenCalledTimes(1);
    await first?.release();
    expect(await reserveRateLimit("otp:phone:1", 1, 60, 2)).not.toBeNull();
  });

  it("uses local buckets when service credentials are missing", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(await reserveRateLimit("push:ip:127.0.0.1", 2, 60, 0)).not.toBeNull();
    expect(await reserveRateLimit("push:ip:127.0.0.1", 2, 60, 1)).not.toBeNull();
    expect(await reserveRateLimit("push:ip:127.0.0.1", 2, 60, 2)).toBeNull();
    expect(mock.createClient).not.toHaveBeenCalled();
    expect(console.warn).toHaveBeenCalledTimes(1);
  });

  it("opens a fresh local window after expiry", async () => {
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    expect(await reserveRateLimit("push:ip:test", 1, 60, 0)).not.toBeNull();
    expect(await reserveRateLimit("push:ip:test", 1, 60, 60_000)).not.toBeNull();
  });

  it.each(["call-now:farm:1:hour", "owner-call-now:farm:1:hour", "worker-retry:farm:1:day", "test-call:actor:1:hour", "voice-lab:owner:1", "call-preflight:farm:1:day", "new-paid-action:1"])("denies %s without shared enforcement", async (key) => {
    mock.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") });
    expect(await reserveRateLimit(key, 3, 3600)).toBeNull();
    mock.rpc.mockRejectedValue(new Error("offline"));
    expect(await reserveRateLimit(key, 3, 3600)).toBeNull();
    mock.rpc.mockResolvedValue({ data: "true", error: null });
    expect(await reserveRateLimit(key, 3, 3600)).toBeNull();
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    expect(await reserveRateLimit(key, 3, 3600)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("paid actions denied"));
  });

  it("does not fall back when the shared quota is exhausted", async () => {
    mock.rpc.mockResolvedValue({ data: false, error: null });
    expect(await reserveRateLimit("call-now:farm:1:hour", 3, 3600)).toBeNull();
    expect(console.warn).not.toHaveBeenCalled();
  });
});
