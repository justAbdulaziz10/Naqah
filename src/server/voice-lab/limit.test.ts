import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { resetRateLimitState } from "@/server/rate-limit";
import { allowLabOpen } from "./limit";

describe("voice-lab opening quotas", () => {
  beforeEach(() => {
    resetRateLimitState();
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

  it("limits each owner to 30 opens per hour", async () => {
    for (let index = 0; index < 30; index += 1) expect(await allowLabOpen("owner-1", index)).toBe(true);
    expect(await allowLabOpen("owner-1", 31)).toBe(false);
    expect(await allowLabOpen("owner-2", 31)).toBe(true);
  });

  it("enforces a global 300 open quota and rolls back a rejected owner's reservation", async () => {
    for (let index = 0; index < 300; index += 1) expect(await allowLabOpen(`owner-${index}`, index)).toBe(true);
    expect(await allowLabOpen("owner-over-global", 301)).toBe(false);
    // The same owner slot is still available once the global window expires.
    expect(await allowLabOpen("owner-over-global", 60 * 60 * 1000)).toBe(true);
  });
});
