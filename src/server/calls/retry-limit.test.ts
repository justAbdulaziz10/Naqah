import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRateLimitRpc } from "@/server/rate-limit.test-utils";
import { resetRateLimitState } from "@/server/rate-limit";
import { withWorkerRetryLimit } from "./retry-limit";

const shared = vi.hoisted(() => ({ rpc: vi.fn(), nowMs: 0 }));
vi.mock("server-only", () => ({}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ rpc: shared.rpc }) }));
const at = (minutes: number) => new Date(shared.nowMs = minutes * 60_000);

describe("undelivered worker retry quota", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    shared.nowMs = 0;
    shared.rpc.mockReset().mockImplementation(createRateLimitRpc(() => shared.nowMs));
    resetRateLimitState();
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("allows three requeues per farm per hour and isolates farms", async () => {
    const retry = vi.fn(async () => true);
    for (let index = 0; index < 3; index += 1) expect(await withWorkerRetryLimit("farm-a", at(index), retry)).toBe(true);
    await expect(withWorkerRetryLimit("farm-a", at(3), retry)).rejects.toMatchObject({ code: "limit_reached" });
    expect(retry).toHaveBeenCalledTimes(3);
    expect(await withWorkerRetryLimit("farm-b", at(3), retry)).toBe(true);
  });

  it("allows only ten requeues per day across hourly windows", async () => {
    const retry = vi.fn(async () => true);
    for (let index = 0; index < 10; index += 1) expect(await withWorkerRetryLimit("farm-a", at(Math.floor(index / 3) * 61 + index % 3), retry)).toBe(true);
    await expect(withWorkerRetryLimit("farm-a", at(244), retry)).rejects.toMatchObject({ code: "limit_reached" });
    expect(retry).toHaveBeenCalledTimes(10);
  });

  it("refunds reservations when the requested call cannot be requeued", async () => {
    for (let index = 0; index < 8; index += 1) expect(await withWorkerRetryLimit("farm-a", at(index), async () => false)).toBe(false);
    for (let index = 0; index < 3; index += 1) expect(await withWorkerRetryLimit("farm-a", at(index + 10), async () => true)).toBe(true);
  });

  it("refunds reservations when the requeue write fails", async () => {
    for (let index = 0; index < 3; index += 1) {
      await expect(withWorkerRetryLimit("farm-a", at(index), async () => { throw new Error("write failed"); })).rejects.toThrow("write failed");
    }
    expect(await withWorkerRetryLimit("farm-a", at(4), async () => true)).toBe(true);
  });

  it("bounds simultaneous retries before any queue write", async () => {
    const retry = vi.fn(async () => true);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => withWorkerRetryLimit("farm-a", at(0), retry)));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(3);
    expect(retry).toHaveBeenCalledTimes(3);
  });

  it("denies before mutation if shared enforcement is unavailable", async () => {
    shared.rpc.mockResolvedValue({ data: null, error: new Error("unavailable") });
    const retry = vi.fn(async () => true);
    await expect(withWorkerRetryLimit("farm-a", at(0), retry)).rejects.toMatchObject({ code: "limit_reached" });
    expect(retry).not.toHaveBeenCalled();
  });
});
