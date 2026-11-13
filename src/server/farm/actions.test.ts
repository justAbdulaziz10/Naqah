import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ getOwner: vi.fn(), client: vi.fn(), repository: vi.fn(), apply: vi.fn(), service: vi.fn(), run: vi.fn(), reserve: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getOwner: mock.getOwner, createWritableClient: mock.client }));
vi.mock("@/server/db/owner-repository", () => ({ createOwnerRepository: mock.repository }));
vi.mock("./changes", () => ({ applyOwnerChanges: mock.apply }));
vi.mock("@/server/db/service-client", () => ({ createServiceClient: mock.service }));
vi.mock("@/server/db/service-repository", () => ({ runFarmAction: mock.run }));
vi.mock("@/server/rate-limit", () => ({ reserveRateLimit: mock.reserve }));
import { DbError } from "@/server/db/errors";
import { addCamel } from "./actions";
import * as actions from "./actions";

describe("owner actions", () => {
  const addCamelRepo = vi.fn();
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", "1");
    vi.clearAllMocks();
    mock.getOwner.mockResolvedValue({ user: { id: "owner" }, unavailable: false });
    mock.client.mockResolvedValue({ session: true });
    mock.repository.mockReturnValue({ addCamel: addCamelRepo });
    addCamelRepo.mockResolvedValue("new-id");
  });
  afterEach(() => vi.unstubAllEnvs());
  it.each([undefined, "", "0", "true"])("gates every independently callable owner action with flag %s", async (flag) => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", flag);
    for (const action of Object.values(actions)) {
      const invoke = action as (...args: unknown[]) => Promise<unknown>;
      expect(await invoke({}, {})).toEqual({ ok: false, error: "unavailable" });
    }
    expect(mock.getOwner).not.toHaveBeenCalled();
    expect(mock.client).not.toHaveBeenCalled();
    expect(mock.repository).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "0", "true"])("gates retryUndelivered with a well-formed id and flag %s", async (flag) => {
    vi.stubEnv("NEXT_PUBLIC_NAQAH_ACCOUNT_DATA", flag);
    expect(await actions.retryUndelivered("11111111-1111-4111-8111-111111111111")).toEqual({ ok: false, error: "unavailable" });
    expect(mock.getOwner).not.toHaveBeenCalled();
    expect(mock.client).not.toHaveBeenCalled();
    expect(mock.repository).not.toHaveBeenCalled();
  });
  it("refuses without a validated session", async () => {
    mock.getOwner.mockResolvedValue({ user: null, unavailable: false });
    expect(await addCamel({ name: "Wadha" })).toEqual({ ok: false, error: "unauthenticated" });
    expect(mock.repository).not.toHaveBeenCalled();
  });
  it("binds the repository to the session's owner", async () => {
    expect(await addCamel({ name: "Wadha" })).toEqual({ ok: true, data: "new-id" });
    expect(mock.repository).toHaveBeenCalledWith({ session: true }, "owner");
  });
  it("never applies another farm's pending edits when enabled", async () => {
    const load = vi.fn().mockResolvedValue({ farmId: "22222222-2222-4222-8222-222222222222", workspace: { createdAt: "2026-11-01T00:00:00Z" } });
    mock.repository.mockReturnValue({ load });
    expect(await actions.saveOwnerEdits([], "11111111-1111-4111-8111-111111111111")).toEqual({ ok: false, error: "conflict" });
    expect(mock.apply).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("does not accept a matching timestamp as farm identity", async () => {
    const timestamp = "2026-11-01T00:00:00.000Z";
    const load = vi.fn().mockResolvedValue({ farmId: "22222222-2222-4222-8222-222222222222", workspace: { createdAt: timestamp } });
    mock.repository.mockReturnValue({ load });
    expect(await actions.saveOwnerEdits([], timestamp)).toEqual({ ok: false, error: "invalid_input" });
    expect(mock.apply).not.toHaveBeenCalled();
  });
  it("uses the session's repository even when the caller knows another farm's id", async () => {
    const farmId = "22222222-2222-4222-8222-222222222222";
    const loaded = { farmId, workspace: { createdAt: "2026-11-01T00:00:00.000Z", farmId: "forged", ownerId: "forged" } };
    const repository = { load: vi.fn().mockResolvedValue(loaded) };
    mock.repository.mockReturnValue(repository);
    mock.apply.mockResolvedValue({ created: {}, failed: [] });
    const result = await actions.saveOwnerEdits([], farmId);
    expect(result).toMatchObject({ ok: true, data: { workspace: { farmId, ownerId: "owner" } } });
    expect(mock.repository).toHaveBeenCalledWith({ session: true }, "owner");
    expect(mock.apply).toHaveBeenCalledWith(repository, []);
  });
  it("returns session-derived owner and repository-derived farm ids for open and load", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "mock-only");
    const farmId = "11111111-1111-4111-8111-111111111111";
    const repository = {
      initialPlanState: vi.fn().mockResolvedValue({ required: false, setupComplete: false, existingFarm: true }),
      ensureFarm: vi.fn(),
      load: vi.fn().mockResolvedValue({ farmId, workspace: { createdAt: "same-time" } }),
    };
    mock.repository.mockReturnValue(repository);
    for (const read of [actions.openAccount, actions.loadWorkspace]) {
      expect(await read()).toEqual({ ok: true, data: { farmId, ownerId: "owner", createdAt: "same-time" } });
    }
    expect(repository.ensureFarm).toHaveBeenCalledTimes(1);
  });
  it("routes new and incomplete legacy owners to explicit plan selection without creating a farm", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "mock-only");
    const repository = { initialPlanState: vi.fn().mockResolvedValue({ required: true, setupComplete: false, existingFarm: false }), ensureFarm: vi.fn() };
    mock.repository.mockReturnValue(repository);
    expect(await actions.openAccount()).toEqual({ ok: false, error: "plan_required" });
    expect(repository.ensureFarm).not.toHaveBeenCalled();
  });
  it("saves only a validated initial plan for the session owner and checks the page owner as stale state", async () => {
    const ownerId = "11111111-1111-4111-8111-111111111111";
    mock.getOwner.mockResolvedValue({ user: { id: ownerId }, unavailable: false });
    const repository = { selectInitialPlan: vi.fn(), ensureFarm: vi.fn() };
    mock.repository.mockReturnValue(repository);
    expect(await actions.selectInitialPlan("ultimate", ownerId)).toEqual({ ok: true, data: { plan: "ultimate" } });
    expect(repository.selectInitialPlan).toHaveBeenCalledWith("ultimate");
    expect(repository.ensureFarm).toHaveBeenCalledOnce();
    repository.selectInitialPlan.mockClear();
    expect(await actions.selectInitialPlan("basic", "22222222-2222-4222-8222-222222222222")).toEqual({ ok: false, error: "conflict" });
    expect(repository.selectInitialPlan).not.toHaveBeenCalled();
    expect(await actions.selectInitialPlan("premium", ownerId)).toEqual({ ok: false, error: "invalid_input" });
  });
  it("returns a code, never an exception or database text", async () => {
    addCamelRepo.mockRejectedValue(new DbError("limit_reached"));
    expect(await addCamel({})).toEqual({ ok: false, error: "limit_reached" });
    addCamelRepo.mockRejectedValue(new Error("connection string"));
    expect(await addCamel({})).toEqual({ ok: false, error: "unavailable" });
  });

  it("denies retryUndelivered before queue writes when the farm quota is unavailable or exhausted", async () => {
    const farmId = "11111111-1111-4111-8111-111111111111";
    mock.repository.mockReturnValue({ load: async () => ({ farmId }) });
    mock.service.mockReturnValue({ service: true });
    mock.reserve.mockResolvedValue(null);
    expect(await actions.retryUndelivered("22222222-2222-4222-8222-222222222222")).toEqual({ ok: false, error: "limit_reached" });
    expect(mock.reserve).toHaveBeenCalledWith(`worker-retry:farm:${farmId}:hour`, 3, 3600, expect.any(Number));
    expect(mock.run).not.toHaveBeenCalled();
  });

  it("reserves the session-derived farm quota before retryUndelivered writes", async () => {
    const farmId = "11111111-1111-4111-8111-111111111111";
    mock.repository.mockReturnValue({ load: async () => ({ farmId }) });
    mock.service.mockReturnValue({ service: true });
    const release = vi.fn();
    mock.reserve.mockResolvedValue({ release });
    mock.run.mockResolvedValue({ result: true });
    expect(await actions.retryUndelivered("22222222-2222-4222-8222-222222222222")).toEqual({ ok: true, data: true });
    expect(mock.run).toHaveBeenCalledWith({ service: true }, farmId, expect.any(Function));
    expect(mock.reserve).toHaveBeenCalledTimes(2);
    expect(release).not.toHaveBeenCalled();
  });
});
