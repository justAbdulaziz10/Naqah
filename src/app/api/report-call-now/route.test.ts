import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace } from "@/domain/seed";

const mock = vi.hoisted(() => ({ owner: vi.fn(), client: vi.fn(), load: vi.fn(), clean: vi.fn(), preflight: vi.fn(), reserve: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getOwner: mock.owner }));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: mock.client }));
vi.mock("@/server/db/queries", () => ({ loadFarm: mock.load, requireFarm: (farm: unknown) => farm }));
vi.mock("@/server/calls/reliability", () => ({ cleanStaleReportCalls: mock.clean, callDiagnostic: () => null }));
vi.mock("@/server/voice/preflight", () => ({ freeCallPreflight: mock.preflight }));
vi.mock("@/server/rate-limit", () => ({ reserveRateLimit: mock.reserve }));
const { GET } = await import("./route");
const FARM = "11111111-1111-4111-8111-111111111111";
const get = (query = "") => GET(new Request(`https://naqah.test/api/report-call-now${query}`));

describe("report-call-now read privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NAQAH_MANUAL_REPORT_CALLS", "1");
    vi.stubEnv("NAQAH_CALL_ALLOWLIST", "+966501234567");
    mock.owner.mockResolvedValue({ user: { id: "owner" } });
    const chain = { select: () => chain, eq: vi.fn(() => chain), maybeSingle: async () => ({ data: { id: FARM }, error: null }) };
    mock.client.mockReturnValue({ from: () => chain });
    mock.load.mockResolvedValue({ workspace: createDemoWorkspace("en", "basic") });
    mock.reserve.mockResolvedValue({ release: vi.fn() });
    mock.preflight.mockResolvedValue({ ready: true, checks: [], message: null });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("returns only run state and the repeat setting, with no allowlist or approval oracle", async () => {
    const payloads = [];
    for (const phone of ["+966501234567", "+966500000001", ""]) {
      const workspace = createDemoWorkspace("en", "basic");
      workspace.settings.worker.phone = phone;
      workspace.reportCalls = [];
      mock.load.mockResolvedValue({ workspace });
      const response = await get();
      expect(response.headers.get("cache-control")).toBe("no-store");
      payloads.push(await response.json());
    }
    expect(payloads[0]).toEqual({ ok: true, runId: null, state: null, message: null, repeatReports: false });
    expect(payloads[1]).toEqual(payloads[0]);
    expect(payloads[2]).toEqual(payloads[0]);
    expect(JSON.stringify(payloads)).not.toMatch(/allowlist|approved|966/gi);
  });

  it("does not load a farm for an unauthenticated request", async () => {
    mock.owner.mockResolvedValue({ user: null });
    expect((await get()).status).toBe(401);
    expect(mock.client).not.toHaveBeenCalled();
  });

  it("meters the membership-sensitive preflight before checking a saved number", async () => {
    expect((await get("?preflight=1")).status).toBe(200);
    expect(mock.reserve).toHaveBeenCalledWith(`call-preflight:farm:${FARM}:day`, 10, 86400);
    mock.preflight.mockClear();
    mock.reserve.mockResolvedValue(null);
    const response = await get("?preflight=1");
    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ ok: false, ready: false, reason: "rate_limited" });
    expect(mock.preflight).not.toHaveBeenCalled();
  });
});
