import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ owner: vi.fn(), status: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("@/lib/supabase/server", () => ({ getOwner: mock.owner }));
vi.mock("@/server/env", () => ({ integrationsStatus: mock.status }));
const { GET } = await import("./route");

describe("integration status audience", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NEXT_PUBLIC_NAQAH_BUILD_COMMIT", "a".repeat(40));
    mock.status.mockReturnValue({ ok: true, voice: { signatureValidation: true }, outbound: { allowlistSize: 2, scheduledCalls: true } });
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([false, true])("returns bare health without a validated session (auth unavailable: %s)", async (unavailable) => {
    mock.owner.mockResolvedValue({ user: null, unavailable });
    const response = await GET();
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mock.status).not.toHaveBeenCalled();
  });

  it("retains Settings and schedule details for a validated owner", async () => {
    mock.owner.mockResolvedValue({ user: { id: "owner" } });
    expect(await (await GET()).json()).toMatchObject({ voice: { signatureValidation: true }, outbound: { scheduledCalls: true }, version: { commit: "a".repeat(40) } });
  });
});
