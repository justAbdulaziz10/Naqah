import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { PREDEFINED_QUESTIONS } from "@/domain/catalog";
import { toDbId } from "./ids";
import { createOwnerRepository } from "./owner-repository";

const farmId = "11111111-1111-4111-8111-111111111111";
const camelId = "22222222-2222-4222-8222-222222222222";

type Reply = { data: unknown; error: { code: string; message?: string } | null };

/** Records the query chain and resolves with the reply for that table. */
function fakeClient(replies: Record<string, Reply>) {
  const calls: { table: string; op: string; args: unknown[] }[] = [];
  const client = {
    rpc(name: string, args: unknown) {
      calls.push({ table: name, op: "rpc", args: [args] });
      return Promise.resolve(replies[`rpc:${name}`] ?? { data: null, error: null });
    },
    from(table: string) {
      const reply = replies[table] ?? { data: [{ id: "row" }], error: null };
      const chain: Record<string, unknown> = {
        then: (done: (value: Reply) => unknown) => Promise.resolve(reply).then(done),
      };
      for (const op of ["select", "insert", "update", "delete", "upsert", "eq", "is", "limit", "single", "maybeSingle", "order", "range", "in"]) {
        chain[op] = (...args: unknown[]) => { calls.push({ table, op, args }); return chain; };
      }
      return chain;
    },
  };
  return { client: client as unknown as SupabaseClient, calls };
}

describe("owner repository", () => {
  beforeEach(() => vi.clearAllMocks());
  const farms = { data: { id: farmId, plan_selected_at: "2026-11-08T00:00:00.000Z", setup_complete: false }, error: null };

  it("scopes every write to the owner's farm", async () => {
    const { client, calls } = fakeClient({ farms });
    await createOwnerRepository(client, "owner").updateCamel(camelId, { name: "Wadha" });
    expect(calls).toEqual(expect.arrayContaining([
      { table: "farms", op: "eq", args: ["owner_id", "owner"] },
      { table: "camels", op: "eq", args: ["farm_id", farmId] },
      { table: "camels", op: "eq", args: ["id", camelId] },
    ]));
  });
  it("takes the farm from the owner, never from the input", async () => {
    const { client, calls } = fakeClient({ farms, camels: { data: { id: camelId }, error: null } });
    await createOwnerRepository(client, "owner").addCamel({ name: "Wadha", farm_id: "someone-else" });
    expect(calls.find((c) => c.op === "insert")?.args[0]).toEqual({ name: "Wadha", farm_id: farmId });
  });
  it("does not report a save when RLS hid the row", async () => {
    const { client } = fakeClient({ farms, camels: { data: [], error: null } });
    await expect(createOwnerRepository(client, "owner").deleteCamel(camelId)).rejects.toMatchObject({ code: "not_found" });
  });
  it("refuses a malformed id before any query", async () => {
    const { client, calls } = fakeClient({ farms });
    await expect(createOwnerRepository(client, "owner").deleteCamel("1 or 1=1")).rejects.toMatchObject({ code: "invalid_input" });
    expect(calls.some((c) => c.table === "camels")).toBe(false);
  });
  it("names the Basic question limit", async () => {
    const { client } = fakeClient({ farms, custom_questions: { data: null, error: { code: "23514", message: "Basic plan allows up to 5 custom questions" } } });
    await expect(createOwnerRepository(client, "owner").addCustomQuestion("q")).rejects.toMatchObject({ code: "limit_reached" });
  });
  it("retries a custom question with the same farm-scoped id and upsert target", async () => {
    const { client, calls } = fakeClient({ farms });
    const repository = createOwnerRepository(client, "owner");
    const first = await repository.addCustomQuestion("Fifth question", "cq_retry");
    expect(await repository.addCustomQuestion("Fifth question", "cq_retry")).toBe(first);
    const writes = calls.filter((call) => call.op === "upsert");
    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual(writes[1]);
    expect(writes[0].args).toEqual([{ text: "Fifth question", id: first, farm_id: farmId }, { onConflict: "id" }]);
  });
  it("hides database text from errors", async () => {
    const { client } = fakeClient({ farms: { data: null, error: { code: "XX000", message: "secret detail" } } });
    await expect(createOwnerRepository(client, "owner").load()).rejects.toMatchObject({ code: "unavailable", message: "XX000" });
  });
  it("requires an explicit plan for a new owner instead of creating a default-Basic farm", async () => {
    const { client, calls } = fakeClient({ farms: { data: null, error: null } });
    const repository = createOwnerRepository(client, "owner");
    expect(await repository.initialPlanState()).toEqual({ required: true, setupComplete: false, existingFarm: false });
    await expect(repository.ensureFarm()).rejects.toMatchObject({ code: "not_found" });
    expect(calls.some((call) => call.op === "upsert" && call.table === "farms")).toBe(false);
  });
  it("keeps a missing plan-selection column classified as an unavailable schema, not a missing farm", async () => {
    const { client, calls } = fakeClient({
      farms: { data: null, error: { code: "42703", message: "column farms.plan_selected_at does not exist" } },
    });
    await expect(createOwnerRepository(client, "owner").initialPlanState()).rejects.toMatchObject({ code: "unavailable" });
    expect(calls.find((call) => call.table === "farms" && call.op === "select")?.args).toEqual(["plan_selected_at, setup_complete"]);
    expect(calls.some((call) => ["insert", "upsert", "update"].includes(call.op))).toBe(false);
  });
  it("requires an explicit confirmation for an incomplete legacy farm, but leaves completed farms alone", async () => {
    const incomplete = fakeClient({ farms: { data: { id: farmId, plan_selected_at: null, setup_complete: false }, error: null } });
    expect(await createOwnerRepository(incomplete.client, "owner").initialPlanState()).toEqual({ required: true, setupComplete: false, existingFarm: true });
    await expect(createOwnerRepository(incomplete.client, "owner").load()).rejects.toMatchObject({ code: "plan_required" });
    const complete = fakeClient({ farms: { data: { id: farmId, plan_selected_at: null, setup_complete: true }, error: null } });
    expect(await createOwnerRepository(complete.client, "owner").initialPlanState()).toEqual({ required: false, setupComplete: true, existingFarm: true });
  });
  it("records the plan through the narrow RPC and leaves the choice stable", async () => {
    const { client, calls } = fakeClient({ farms, "rpc:select_initial_plan": { data: null, error: null } });
    const repository = createOwnerRepository(client, "owner");
    await repository.selectInitialPlan("ultimate");
    expect(calls).toContainEqual({ table: "select_initial_plan", op: "rpc", args: [{ p_plan: "ultimate" }] });
  });
  it("skips first-time setup when it already finished", async () => {
    const { client, calls } = fakeClient({ farms, workers: { data: [{ id: "w" }], error: null } });
    await createOwnerRepository(client, "owner").ensureFarm();
    expect(calls.some((c) => c.table === "criteria")).toBe(false);
  });
  it("creates defaults with stable ids and the primary worker last", async () => {
    const { client, calls } = fakeClient({ farms, workers: { data: [], error: null } });
    await createOwnerRepository(client, "owner").ensureFarm();
    const upserts = calls.filter((c) => c.op === "upsert");
    expect(upserts.map((c) => c.table)).toEqual(["resources", "criteria", "emergency_categories", "workers"]);
    expect(calls.at(-2)).toMatchObject({ table: "farms", op: "eq", args: ["id", farmId] });
    expect(calls.at(-1)).toEqual({ table: "farms", op: "is", args: ["primary_worker_id", null] });
    const repeat = fakeClient({ farms, workers: { data: [], error: null } });
    await createOwnerRepository(repeat.client, "owner").ensureFarm();
    const again = repeat.calls.filter((c) => c.op === "upsert");
    expect(again[1].args[0]).toEqual(upserts[1].args[0]);
    expect(again[3].args[0]).toEqual(upserts[3].args[0]); // Same primary worker id: a retry adds no second worker.
  });
  it("makes a worker added in the same save the primary, by the id it was stored under", async () => {
    const { client, calls } = fakeClient({ farms });
    const repository = createOwnerRepository(client, "owner");
    const id = await repository.addWorker({ name: "Ahmed", phone: "0501234567", language: "ar" }, "wkr_new");
    // The fake answers every farms query with one object, so the written-row check can't pass here.
    await repository.setPrimaryWorker("wkr_new").catch(() => undefined);
    expect(calls.find((c) => c.table === "farms" && c.op === "update")?.args[0]).toEqual({ primary_worker_id: id });
    expect(calls.find((c) => c.table === "workers" && c.op === "upsert")?.args[0]).toMatchObject({ phone: "+966501234567" });
  });

  describe("saving the question plan", () => {
    const none = { data: [], error: null };
    const lists = Object.fromEntries(["workers", "camels", "resources", "custom_questions", "criteria", "emergency_categories", "reports", "calls", "task_tickets",
      "no_answer_tickets", "pending_worker_calls", "report_call_runs", "relays", "events"].map((table) => [table, none]));
    const silent = PREDEFINED_QUESTIONS.map((question) => ({ id: question.id, enabled: false, required: true }));
    const updates = (calls: { table: string; op: string; args: unknown[] }[]) => calls.filter((c) => c.table === "farms" && c.op === "update");

    it("refuses a plan that leaves the call with nothing to ask", async () => {
      const { client, calls } = fakeClient({ farms, ...lists });
      await expect(createOwnerRepository(client, "owner").saveFarmProfile({ questionPlan: silent })).rejects.toMatchObject({ code: "invalid_input" });
      expect(updates(calls)).toEqual([]);
    });
    it("stores a custom question under its row id", async () => {
      const { client, calls } = fakeClient({ farms, ...lists });
      const questionPlan = [{ id: "cq_new", enabled: false, required: true }, { id: "herd_health", enabled: true, required: false }];
      // The fake answers every farms query with one object, so the written-row check can't pass here.
      await createOwnerRepository(client, "owner").saveFarmProfile({ questionPlan, reportMode: "open" }).catch(() => undefined);
      expect(updates(calls)[0].args[0]).toEqual({ report_mode: "open", question_plan: [{ ...questionPlan[0], id: toDbId(farmId, "cq_new") }, questionPlan[1]] });
    });
  });
});
