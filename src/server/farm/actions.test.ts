import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ getOwner: vi.fn(), client: vi.fn(), repository: vi.fn(), apply: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getOwner: mock.getOwner, createWritableClient: mock.client }));
vi.mock("@/server/db/owner-repository", () => ({ createOwnerRepository: mock.repository }));
vi.mock("./changes", () => ({ applyOwnerChanges: mock.apply }));
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
    const load = vi.fn().mockResolvedValue({ workspace: { createdAt: "farm-b" } });
    mock.repository.mockReturnValue({ load });
    expect(await actions.saveOwnerEdits([], "farm-a")).toEqual({ ok: false, error: "conflict" });
    expect(mock.apply).not.toHaveBeenCalled();
    expect(load).toHaveBeenCalledTimes(1);
  });
  it("returns a code, never an exception or database text", async () => {
    addCamelRepo.mockRejectedValue(new DbError("limit_reached"));
    expect(await addCamel({})).toEqual({ ok: false, error: "limit_reached" });
    addCamelRepo.mockRejectedValue(new Error("connection string"));
    expect(await addCamel({})).toEqual({ ok: false, error: "unavailable" });
  });
});
