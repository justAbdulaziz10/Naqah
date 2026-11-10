import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resetRateLimitState } from "@/server/rate-limit";
import { withCallNowLimit } from "./call-now-limit";
import type { CallNowResult } from "./scheduler";

const placed = async (): Promise<CallNowResult> => ({ status: "placed" });
const at = (minutes: number) => new Date(Date.UTC(2026, 10, 10, 9, 0) + minutes * 60_000);

describe("«اتصال حقيقي» rate limit", () => {
  beforeEach(() => {
    // No Supabase here, so the limiter uses its in-process buckets: same windows, same counting.
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    resetRateLimitState();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("allows 3 calls an hour per ranch, then refuses without dialling", async () => {
    const place = vi.fn(placed);
    for (let i = 0; i < 3; i++) expect(await withCallNowLimit("farm-a", at(i), place)).toEqual({ status: "placed" });
    expect(await withCallNowLimit("farm-a", at(3), place)).toEqual({ status: "blocked", reason: "rate_limited" });
    expect(place).toHaveBeenCalledTimes(3);
    expect(await withCallNowLimit("farm-b", at(3), place)).toEqual({ status: "placed" });
  });

  it("allows 10 calls a day across hours", async () => {
    const place = vi.fn(placed);
    let accepted = 0;
    for (let hour = 0; hour < 5; hour++) {
      for (let i = 0; i < 3; i++) if ((await withCallNowLimit("farm-a", at(hour * 61 + i), place)).status === "placed") accepted++;
    }
    expect(accepted).toBe(10);
    expect(place).toHaveBeenCalledTimes(10);
  });

  it("gives the slot back when the call is refused before dialling", async () => {
    const blocked = vi.fn(async (): Promise<CallNowResult> => ({ status: "blocked", reason: "already_reported" }));
    for (let i = 0; i < 5; i++) await withCallNowLimit("farm-a", at(i), blocked);
    const place = vi.fn(placed);
    for (let i = 0; i < 3; i++) expect((await withCallNowLimit("farm-a", at(10 + i), place)).status).toBe("placed");
  });

  it("keeps the slot for a dial that failed at the provider", async () => {
    const failed = async (): Promise<CallNowResult> => ({ status: "failed", reason: "not_placed" });
    for (let i = 0; i < 3; i++) await withCallNowLimit("farm-a", at(i), failed);
    expect(await withCallNowLimit("farm-a", at(4), placed)).toEqual({ status: "blocked", reason: "rate_limited" });
  });

  it("lets only 3 of many simultaneous presses through", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const place = vi.fn(async (): Promise<CallNowResult> => { await gate; return { status: "placed" }; });
    const presses = Array.from({ length: 8 }, () => withCallNowLimit("farm-a", at(0), place));
    release();
    const results = await Promise.all(presses);
    expect(results.filter((r) => r.status === "placed")).toHaveLength(3);
    expect(results.filter((r) => r.status === "blocked")).toHaveLength(5);
    expect(place).toHaveBeenCalledTimes(3);
  });
  it("keeps reservations when placement throws and acceptance is unknown", async () => {
    for (let index = 0; index < 3; index += 1) await expect(withCallNowLimit("farm-a", at(index), async () => { throw new Error("response lost"); })).rejects.toThrow("response lost");
    expect(await withCallNowLimit("farm-a", at(4), placed)).toEqual({ status: "blocked", reason: "rate_limited" });
  });
});
