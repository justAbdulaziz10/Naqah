import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { allWorkers, newWorker, setWorkers } from "@/domain/workers";
import type { Workspace } from "@/domain/types";
import { ownerChanges, withServerIds } from "@/lib/account/changes";
import { createOwnerRepository } from "@/server/db/owner-repository";
import { applyOwnerChanges } from "./changes";

/**
 * LOCAL ONLY. An owner's first setup saved exactly as the website saves it: the screen's edits become
 * owner changes, which run under the owner's session through PostgREST, RLS and the 0006 grants.
 * Needs supabase/local-validation/run-stack.sh; skipped without NAQAH_TEST_GATEWAY.
 *
 *   NAQAH_TEST_GATEWAY=http://127.0.0.1:54352 NAQAH_TEST_ANON_KEY=… npx vitest run src/server/farm/owner-flow.stack.test.ts
 */
const gateway = process.env.NAQAH_TEST_GATEWAY;
const anonKey = process.env.NAQAH_TEST_ANON_KEY ?? "";

async function signedInOwner() {
  const email = `owner-${Math.random().toString(16).slice(2, 10)}@example.test`;
  const password = "local-test-password";
  const made = await fetch(`${gateway}/__test/users`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
  if (made.status !== 201) throw new Error(`user: ${made.status}`);
  const token = await (await fetch(`${gateway}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { "Content-Type": "application/json", apikey: anonKey }, body: JSON.stringify({ email, password }),
  })).json() as { access_token: string; user: { id: string } };
  const client = createClient(gateway!, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token.access_token}` } },
  });
  return { client, ownerId: token.user.id, repository: createOwnerRepository(client, token.user.id) };
}

async function ownerSession() { return (await signedInOwner()).repository; }

async function save(repository: Awaited<ReturnType<typeof ownerSession>>, base: Workspace, next: Workspace) {
  const result = await applyOwnerChanges(repository, ownerChanges(base, next));
  return { ...result, ws: (await repository.load()).workspace, local: withServerIds(next, result.created) };
}

describe.skipIf(!gateway)("owner setup through the local Supabase stack", () => {
  it("saves the ranch, workers, primary, herd count, questions and call time, and reloads them", async () => {
    const repository = await ownerSession();
    await repository.selectInitialPlan("basic");
    await repository.selectInitialPlan("basic"); // Retried submission of the same choice is idempotent.
    await repository.ensureFarm();
    await repository.ensureFarm(); // A repeated first sign-in adds nothing.
    const base = (await repository.load()).workspace;
    expect(allWorkers(base.settings)).toHaveLength(1);
    expect(base.setupComplete).toBe(false);
    expect(base.settings.plan).toBe("basic");

    const ahmed = { ...newWorker("ar"), name: "Ahmed", phone: "0501234567" };
    const salem = { ...newWorker("ur"), name: "Salem", phone: "+966507654321" };
    const primary = { ...base.settings.worker, name: "Yousef", phone: "0509998888" };
    const next: Workspace = {
      ...base,
      setupComplete: true,
      settings: {
        ...setWorkers(base.settings, [primary, ahmed, salem], 1),
        owner: { name: "Abdullah", phone: "0501112222" },
        farm: { name: "Al Nakheel", location: "Qassim", coords: null },
        herdCount: 42,
        callSchedule: { day: 4, time: "17:30" },
        customQuestions: [{ id: "cq_one", text: "Did the new calf feed today?", createdAt: base.createdAt }],
      },
    };
    const first = await save(repository, base, next);
    expect(first.failed).toEqual([]);
    const ws = first.ws;
    expect(ws.setupComplete).toBe(true);
    expect(ws.settings.owner).toEqual({ name: "Abdullah", phone: "+966501112222" });
    expect(ws.settings.farm.name).toBe("Al Nakheel");
    expect(ws.settings.worker).toMatchObject({ name: "Ahmed", phone: "+966501234567", language: "ar" });
    expect(ws.settings.otherWorkers?.map((w) => w.name).sort()).toEqual(["Salem", "Yousef"]);
    expect(ws.settings.herdCount).toBe(42);
    expect(ws.settings.callSchedule).toEqual({ day: 4, time: "17:30" });
    expect(ws.settings.customQuestions.map((q) => q.text)).toEqual(["Did the new calf feed today?"]);
    // Nothing left to send: the screen and the server agree.
    expect(ownerChanges(ws, first.local).filter((c) => c.kind !== "profile" || !("setupComplete" in c.input))).toEqual([]);

    // Basic allows three workers: a fourth is refused by the database, the rest of the save lands.
    const fourth = { ...newWorker("ar"), name: "Fahad", phone: "0505550000" };
    const crowded: Workspace = { ...ws, settings: { ...ws.settings, otherWorkers: [...(ws.settings.otherWorkers ?? []), fourth], herdCount: 45 } };
    const second = await save(repository, ws, crowded);
    expect(second.failed).toEqual(["limit_reached"]);
    expect(allWorkers(second.ws.settings)).toHaveLength(3);
    expect(second.ws.settings.herdCount).toBe(45);

    // Remove one and switch the primary back in the same save.
    const yousef = second.ws.settings.otherWorkers!.find((w) => w.name === "Yousef")!;
    const reshuffled: Workspace = { ...second.ws, settings: { ...second.ws.settings, worker: yousef, otherWorkers: [second.ws.settings.worker] } };
    const third = await save(repository, second.ws, reshuffled);
    expect(third.failed).toEqual([]);
    expect(third.ws.settings.worker.name).toBe("Yousef");
    expect(allWorkers(third.ws.settings).map((w) => w.name).sort()).toEqual(["Ahmed", "Yousef"]);

    // Ultimate's daily call keeps the time; clearing the schedule clears both columns.
    const cleared = await save(repository, third.ws, { ...third.ws, settings: { ...third.ws.settings, callSchedule: null, herdCount: null } });
    expect(cleared.failed).toEqual([]);
    expect(cleared.ws.settings.callSchedule).toBeNull();
    expect(cleared.ws.settings.herdCount).toBeNull();
  });

  it("never lets one owner see or pick another owner's worker", async () => {
    const a = await ownerSession();
    await a.selectInitialPlan("basic");
    await a.ensureFarm();
    const aWorker = (await a.load()).workspace.settings.worker.id!;
    const b = await ownerSession();
    await b.selectInitialPlan("basic");
    await b.ensureFarm();
    const bLoaded = (await b.load()).workspace;
    expect(allWorkers(bLoaded.settings).some((w) => w.id === aWorker)).toBe(false);
    await expect(b.setPrimaryWorker(aWorker)).rejects.toBeTruthy();
    await expect(b.updateWorker(aWorker, { name: "Hijacked" })).rejects.toMatchObject({ code: "not_found" });
    expect((await a.load()).workspace.settings.worker.name).toBe("");
  });

  it("requires an explicit choice, preserves Ultimate after reload and rejects plan bypasses", async () => {
    const { client, ownerId, repository } = await signedInOwner();
    await expect(repository.ensureFarm()).rejects.toMatchObject({ code: "not_found" });
    await repository.selectInitialPlan("ultimate");
    await repository.ensureFarm();
    const first = await repository.load();
    expect(first.workspace.settings.plan).toBe("ultimate");
    await repository.ensureFarm();
    expect((await repository.load()).workspace.settings.plan).toBe("ultimate");
    await expect(repository.selectInitialPlan("basic")).rejects.toMatchObject({ code: "conflict" });

    const changed = await client.from("farms").update({ plan: "basic" }).eq("owner_id", ownerId).select("id");
    expect(changed.error?.code).toBe("42501");
    expect((await repository.load()).workspace.settings.plan).toBe("ultimate");
  });

  it("applies Ultimate's approved setup limits after selection and reload", async () => {
    const repository = await ownerSession();
    await repository.selectInitialPlan("ultimate");
    await repository.ensureFarm();
    for (let index = 0; index < 6; index += 1) {
      await repository.addCustomQuestion(`Ultimate question ${index + 1}`, `question_${index + 1}`);
    }
    for (let index = 0; index < 9; index += 1) {
      await repository.addWorker({ name: `Worker ${index + 2}`, phone: "0501234567", language: "ar" }, `worker_${index + 2}`);
    }
    const reloaded = (await repository.load()).workspace;
    expect(reloaded.settings.plan).toBe("ultimate");
    expect(reloaded.settings.customQuestions).toHaveLength(6);
    expect(allWorkers(reloaded.settings)).toHaveLength(10);
  });
});
