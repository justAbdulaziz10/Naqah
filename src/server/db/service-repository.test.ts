import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { completeWorkerReport } from "@/domain/actions";
import { createEmptyWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";

const mock = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("./queries", async (original) => ({ ...(await original<typeof import("./queries")>()), loadFarm: mock.load }));
import { findCaller, runFarmAction } from "./service-repository";

const farmId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-11-08T09:00:00.000Z");
const draft = { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: true, taskConfirmations: [] };

function client(options: { rpc?: { error: { code: string } | null }[]; recorded?: unknown[] } = {}) {
  const replies = [...(options.rpc ?? [{ error: null }])];
  const recorded = [...(options.recorded ?? [])];
  const rpc = vi.fn(async () => replies.shift() ?? { error: null });
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => {
      const outcome = recorded.shift();
      return { data: outcome ? { outcome } : null, error: null };
    },
  };
  return { rpc, from: () => chain } as unknown as SupabaseClient & { rpc: typeof rpc };
}

const report = (ws: Workspace) => ({ ws: completeWorkerReport(ws, now, draft).ws, result: { status: "saved" } });

describe("runFarmAction", () => {
  const fresh = (revision = 4) => ({ farmId, revision, workspace: createEmptyWorkspace("ultimate") });

  it("sends the revision, event and outcome together", async () => {
    mock.load.mockResolvedValue(fresh());
    const db = client();
    expect(await runFarmAction(db, farmId, report, { eventId: "CA1:report", providerCallId: "CA1" })).toEqual({ status: "saved", result: { status: "saved" } });
    expect(db.rpc).toHaveBeenCalledWith("apply_farm_changes", expect.objectContaining({
      p_farm_id: farmId, p_expected_revision: 4, p_event_id: "CA1:report", p_outcome: { status: "saved" },
    }));
  });
  it("returns the first answer to a retried webhook without running the rules", async () => {
    const action = vi.fn(report);
    const db = client({ recorded: [{ status: "saved" }] });
    expect(await runFarmAction(db, farmId, action, { eventId: "CA1:report" })).toEqual({ status: "replayed", result: { status: "saved" } });
    expect(action).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("re-runs the rules on fresh state when the farm changed", async () => {
    mock.load.mockResolvedValueOnce(fresh(4)).mockResolvedValueOnce(fresh(5));
    const action = vi.fn(report);
    const db = client({ rpc: [{ error: { code: "NQ409" } }, { error: null }] });
    expect((await runFarmAction(db, farmId, action)).status).toBe("saved");
    expect(action).toHaveBeenCalledTimes(2);
    expect(db.rpc).toHaveBeenLastCalledWith("apply_farm_changes", expect.objectContaining({ p_expected_revision: 5 }));
  });
  it("gives up with a conflict instead of retrying forever", async () => {
    mock.load.mockResolvedValue(fresh());
    const db = client({ rpc: [1, 2, 3].map(() => ({ error: { code: "NQ409" } })) });
    await expect(runFarmAction(db, farmId, report)).rejects.toMatchObject({ code: "conflict" });
  });
  it("returns the winner's answer when the same event races", async () => {
    mock.load.mockResolvedValue(fresh());
    const db = client({ rpc: [{ error: { code: "23505" } }], recorded: [undefined, { status: "saved" }] });
    expect(await runFarmAction(db, farmId, report, { eventId: "CA1:report" })).toEqual({ status: "replayed", result: { status: "saved" } });
  });
  it("records an event that changed nothing, so a retry cannot be decided again", async () => {
    mock.load.mockResolvedValue(fresh());
    const db = client();
    expect(await runFarmAction(db, farmId, (ws) => ({ ws, result: { status: "unchanged" } }), { eventId: "CA1:callback" })).toEqual({ status: "unchanged", result: { status: "unchanged" } });
    expect(db.rpc).toHaveBeenCalledWith("apply_farm_changes", expect.objectContaining({ p_event_id: "CA1:callback", p_outcome: { status: "unchanged" } }));
  });
  it("finds an event saved during a conflict instead of deciding it again", async () => {
    mock.load.mockResolvedValue(fresh());
    const action = vi.fn(report);
    const db = client({ rpc: [{ error: { code: "NQ409" } }], recorded: [undefined, { status: "saved" }] });
    expect(await runFarmAction(db, farmId, action, { eventId: "CA1:report" })).toEqual({ status: "replayed", result: { status: "saved" } });
    expect(action).toHaveBeenCalledTimes(1);
  });
  it("skips the write when the action changed nothing", async () => {
    mock.load.mockResolvedValue(fresh());
    const db = client();
    expect((await runFarmAction(db, farmId, (ws) => ({ ws, result: 1 }))).status).toBe("unchanged");
    expect(db.rpc).not.toHaveBeenCalled();
  });
  it("fails for a farm that does not exist", async () => {
    mock.load.mockResolvedValue(null);
    await expect(runFarmAction(client(), farmId, report)).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("findCaller", () => {
  function lookups(workers: { farm_id: string }[], owners: { id: string }[]) {
    const reply = (data: unknown[]) => {
      const chain = { select: () => chain, eq: () => chain, limit: async () => ({ data, error: null }) };
      return chain;
    };
    return { from: (table: string) => reply(table === "workers" ? workers : owners) } as unknown as SupabaseClient;
  }
  it("recognises a worker from any Saudi format", async () => {
    expect(await findCaller(lookups([{ farm_id: farmId }], []), "0501234567")).toEqual({ kind: "worker", farmId });
  });
  it("recognises an owner", async () => {
    expect(await findCaller(lookups([], [{ id: farmId }]), "+966501234567")).toEqual({ kind: "owner", farmId });
  });
  it("treats a number on two farms as unknown rather than guessing", async () => {
    expect(await findCaller(lookups([{ farm_id: "a" }, { farm_id: "b" }], []), "0501234567")).toEqual({ kind: "unknown" });
  });
  it("treats a number that is both worker and owner as unknown", async () => {
    expect(await findCaller(lookups([{ farm_id: "a" }], [{ id: "b" }]), "0501234567")).toEqual({ kind: "unknown" });
  });
  it("treats an unreadable or hidden number as unknown", async () => {
    expect(await findCaller(lookups([], []), "anonymous")).toEqual({ kind: "unknown" });
  });
});
