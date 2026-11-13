import { describe, expect, it, vi } from "vitest";
import { DbError } from "@/server/db/errors";
import type { OwnerRepository } from "@/server/db/owner-repository";
import { applyOwnerChanges } from "./changes";

function repository() {
  return {
    saveFarmProfile: vi.fn(async () => undefined),
    saveWorker: vi.fn(async () => { throw new DbError("invalid_input"); }),
    addCamel: vi.fn(async () => "stored"),
    updateCamel: vi.fn(async () => undefined),
    deleteCamel: vi.fn(async () => undefined),
  };
}
const run = (repo: ReturnType<typeof repository>, input: unknown) => applyOwnerChanges(repo as unknown as OwnerRepository, input);

describe("applying owner changes", () => {
  it("keeps going past a refused field and reports it", async () => {
    const repo = repository();
    const result = await run(repo, [
      { kind: "worker", input: { phone: "x" } },
      { kind: "profile", input: { name: "Farm" } },
      { kind: "camel", action: "add", localId: "cml_1", input: { name: "Noura" } },
    ]);
    expect(result).toEqual({ created: { cml_1: "stored" }, failed: ["invalid_input"] });
    expect(repo.saveFarmProfile).toHaveBeenCalled();
    expect(repo.addCamel).toHaveBeenCalledWith({ name: "Noura" }, "cml_1");
  });
  it("treats deleting a row that's already gone as done", async () => {
    const repo = repository();
    repo.deleteCamel.mockRejectedValueOnce(new DbError("not_found"));
    expect((await run(repo, [{ kind: "camel", action: "delete", id: "x" }])).failed).toEqual([]);
  });
  it("refuses anything that isn't an owner change", async () => {
    await expect(run(repository(), "x")).rejects.toThrow();
    await expect(run(repository(), new Array(501).fill({}))).rejects.toThrow();
    expect(await run(repository(), [{ kind: "report", action: "add", localId: "r", input: {} }, null])).toEqual({ created: {}, failed: ["invalid_input", "invalid_input"] });
  });
});
