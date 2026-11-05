import { beforeEach, describe, expect, it, vi } from "vitest";

const mock = vi.hoisted(() => ({ getOwner: vi.fn(), client: vi.fn(), repository: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ getOwner: mock.getOwner, createWritableClient: mock.client }));
vi.mock("@/server/db/owner-repository", () => ({ createOwnerRepository: mock.repository }));
import { DbError } from "@/server/db/errors";
import { addCamel } from "./actions";

describe("owner actions", () => {
  const addCamelRepo = vi.fn();
  beforeEach(() => {
    vi.clearAllMocks();
    mock.getOwner.mockResolvedValue({ user: { id: "owner" }, unavailable: false });
    mock.client.mockResolvedValue({ session: true });
    mock.repository.mockReturnValue({ addCamel: addCamelRepo });
    addCamelRepo.mockResolvedValue("new-id");
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
  it("returns a code, never an exception or database text", async () => {
    addCamelRepo.mockRejectedValue(new DbError("limit_reached"));
    expect(await addCamel({})).toEqual({ ok: false, error: "limit_reached" });
    addCamelRepo.mockRejectedValue(new Error("connection string"));
    expect(await addCamel({})).toEqual({ ok: false, error: "unavailable" });
  });
});
