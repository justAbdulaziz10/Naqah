import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import type { AccountApi } from "./accountSync";

const writes: string[] = [];
let stored: string | null = null;

async function setup(farm: Workspace) {
  vi.resetModules();
  const { createAccountSync } = await import("./accountSync");
  const store = await import("./workspace");
  let server = farm;
  const api = {
    open: vi.fn<AccountApi["open"]>(async () => ({ ok: true, data: server })),
    load: vi.fn<AccountApi["load"]>(async () => ({ ok: true, data: server })),
    save: vi.fn<AccountApi["save"]>(async () => ({ ok: true, data: { workspace: server, created: {}, failed: [] } })),
  };
  return { ...store, api, sync: createAccountSync(api), setServer: (ws: Workspace) => { server = ws; } };
}

const template = createEmptyWorkspace("basic");
const farm = (): Workspace => ({ ...template, createdAt: "2026-11-01T00:00:00.000Z", setupComplete: true });
const rename = (name: string) => (ws: Workspace): Workspace => ({ ...ws, settings: { ...ws.settings, owner: { ...ws.settings.owner, name } } });

beforeEach(() => {
  vi.useFakeTimers();
  writes.length = 0;
  stored = null;
  vi.stubGlobal("localStorage", {
    getItem: () => stored,
    setItem: (_key: string, value: string) => { writes.push(value); stored = value; },
    removeItem: () => { stored = null; },
  });
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("account mode", () => {
  it("never writes a real farm to this browser", async () => {
    const { sync, useWorkspaceStore } = await setup(farm());
    await sync.open();
    useWorkspaceStore.getState().update(rename("Salem"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(writes.join()).not.toContain("Salem");
    expect(writes.join()).not.toContain("2026-11-01");
  });

  it("saves after typing stops, in one request", async () => {
    const { sync, api, useWorkspaceStore } = await setup(farm());
    await sync.open();
    for (const name of ["S", "Sa", "Sal"]) {
      useWorkspaceStore.getState().update(rename(name));
      await vi.advanceTimersByTimeAsync(100);
    }
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0][0]).toEqual([{ kind: "profile", input: { ownerName: "Sal" } }]);
  });

  it("says saved only once the server has", async () => {
    const { sync, api, useSaveStatus, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    let answer = () => undefined as void;
    api.save.mockImplementationOnce(() => new Promise((resolve) => {
      answer = () => {
        const saved = rename("Salem")(farm());
        setServer(saved);
        resolve({ ok: true, data: { workspace: saved, created: {}, failed: [] } });
      };
    }));
    useWorkspaceStore.getState().update(rename("Salem"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useSaveStatus.getState().status).toBe("idle");
    answer();
    await vi.advanceTimersByTimeAsync(0);
    expect(useSaveStatus.getState().status).toBe("saved");
  });

  it("reports a failed save, keeps the edit and tries again", async () => {
    const { sync, api, useSaveStatus, useWorkspaceStore } = await setup(farm());
    await sync.open();
    api.save.mockResolvedValueOnce({ ok: false, error: "unavailable" } as never);
    useWorkspaceStore.getState().update(rename("Salem"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useSaveStatus.getState().status).toBe("failed");
    expect(useWorkspaceStore.getState().workspace?.settings.owner.name).toBe("Salem");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(api.save).toHaveBeenCalledTimes(2);
  });

  it("refuses a sample or restart, which would replace a real farm", async () => {
    const { sync, api, useWorkspaceStore } = await setup(farm());
    await sync.open();
    const before = useWorkspaceStore.getState().workspace;
    useWorkspaceStore.getState().update(() => createDemoWorkspace("en", "ultimate"));
    useWorkspaceStore.getState().startDemo("en");
    useWorkspaceStore.getState().reset();
    useWorkspaceStore.getState().startOnboarding("ultimate");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useWorkspaceStore.getState().workspace).toBe(before);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("undoes a plan change and says so", async () => {
    const { sync, api, useAccountState, useWorkspaceStore } = await setup(farm());
    await sync.open();
    useWorkspaceStore.getState().update((ws) => ({ ...ws, settings: { ...ws.settings, plan: "ultimate" as const } }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useWorkspaceStore.getState().workspace?.settings.plan).toBe("basic");
    expect(useAccountState.getState().notice).toBe("plan");
    expect(api.save).not.toHaveBeenCalled();
  });

  it("shows a report that arrived from a call", async () => {
    const { sync, setServer, useWorkspaceStore } = await setup(farm());
    await sync.open();
    setServer({ ...farm(), lastUpdateAt: "2026-11-02T00:00:00.000Z" });
    await sync.refresh();
    expect(useWorkspaceStore.getState().workspace?.lastUpdateAt).toBe("2026-11-02T00:00:00.000Z");
  });

  it("doesn't let a refresh overwrite an edit that isn't saved yet", async () => {
    const { sync, api, useWorkspaceStore } = await setup(farm());
    await sync.open();
    useWorkspaceStore.getState().update(rename("Salem"));
    await sync.refresh();
    expect(api.load).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().workspace?.settings.owner.name).toBe("Salem");
  });

  it("uses a new row's stored id, so a later edit can't add it twice", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    const camel = { id: "cml_new", name: "Noura", tag: "", sex: "female" as const, ageYears: null, health: "healthy" as const, healthNote: null, certainty: "verified" as const, updatedAt: null };
    const stored = { ...farm(), camels: [{ ...camel, id: "stored-id" }] };
    api.save.mockImplementationOnce(async () => {
      useWorkspaceStore.getState().update(rename("Typed during the save"));
      setServer(stored);
      return { ok: true, data: { workspace: stored, created: { cml_new: "stored-id" }, failed: [] } };
    });
    useWorkspaceStore.getState().update((ws) => ({ ...ws, camels: [camel] }));
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save.mock.calls[1][0]).toEqual([{ kind: "profile", input: { ownerName: "Typed during the save" } }]);
  });

  it("finishes a pending save before reloading, so finished setup isn't lost on the way to the dashboard", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup({ ...farm(), setupComplete: false });
    await sync.open();
    api.save.mockImplementationOnce(async (changes) => {
      expect(changes).toEqual([{ kind: "profile", input: { setupComplete: true } }]);
      const saved = farm();
      setServer(saved);
      return { ok: true, data: { workspace: saved, created: {}, failed: [] } };
    });
    useWorkspaceStore.getState().update((ws) => ({ ...ws, setupComplete: true }));
    await sync.open();
    expect(useWorkspaceStore.getState().workspace?.setupComplete).toBe(true);
  });

  it("drops the farm and restores the demo when the session ends", async () => {
    const demo = createDemoWorkspace("en", "basic");
    stored = JSON.stringify({ state: { workspace: demo }, version: 1 });
    const { sync, api, useAccountState, useWorkspaceStore } = await setup(farm());
    await sync.open();
    api.load.mockResolvedValueOnce({ ok: false, error: "unauthenticated" } as never);
    await sync.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(useAccountState.getState()).toMatchObject({ active: false, status: "signedOut" });
    expect(useWorkspaceStore.getState().workspace?.createdAt).toBe(demo.createdAt);
  });

  it("shows a signed-in owner an outage as an outage, never as the demo", async () => {
    vi.stubGlobal("document", { cookie: "sb-127-auth-token=base64-x" });
    const { sync, api, useAccountState } = await setup(farm());
    api.open.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    await sync.open();
    expect(useAccountState.getState()).toMatchObject({ active: false, status: "error" });
  });

  it("keeps the demo working offline for a visitor who never signed in", async () => {
    vi.stubGlobal("document", { cookie: "" });
    const { sync, api, useAccountState } = await setup(farm());
    api.open.mockRejectedValueOnce(new TypeError("offline"));
    await sync.open();
    expect(useAccountState.getState().status).toBe("demo");
  });

  it("keeps a worker's report when an old screen saves a different field", async () => {
    const camel = { id: "c1", name: "Noura", tag: "", sex: "female" as const, ageYears: 5, health: "healthy" as const, healthNote: null, certainty: "reported" as const, updatedAt: null };
    const start = { ...farm(), camels: [camel] };
    const { sync, api, useWorkspaceStore, setServer } = await setup(start);
    await sync.open();
    const reported = { ...start, camels: [{ ...camel, health: "sick" as const, certainty: "reported" as const }] };
    api.save.mockImplementationOnce(async () => {
      setServer(reported);
      return { ok: true, data: { workspace: reported, created: {}, failed: ["invalid_input"] } };
    });
    useWorkspaceStore.getState().update((ws) => ({ ...ws, camels: ws.camels.map((c) => ({ ...c, ageYears: 70 })) }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useWorkspaceStore.getState().workspace?.camels[0]).toMatchObject({ health: "sick", ageYears: 70 });
    useWorkspaceStore.getState().update(rename("Salem"));
    await vi.advanceTimersByTimeAsync(1_000);
    const changes = JSON.stringify(api.save.mock.calls[1][0]);
    expect(changes).toContain('"ageYears":70');
    expect(changes).not.toContain("health");
  });

  it("drops everything when another owner's farm arrives, so nothing crosses over", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    useWorkspaceStore.getState().update(rename("Owner A"));
    const other = { ...farm(), createdAt: "2026-11-05T00:00:00.000Z" };
    setServer(other);
    await sync.open();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(useWorkspaceStore.getState().workspace?.createdAt).toBe(other.createdAt);
    expect(api.save.mock.calls.every(([, farmId]) => farmId === farm().createdAt)).toBe(true);
  });

  it("names the farm in every save, and reloads when the server refuses it", async () => {
    const { sync, api, useWorkspaceStore } = await setup(farm());
    await sync.open();
    api.save.mockResolvedValueOnce({ ok: false, error: "conflict" });
    useWorkspaceStore.getState().update(rename("Salem"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.save.mock.calls[0][1]).toBe(farm().createdAt);
    expect(api.open).toHaveBeenCalledTimes(2);
  });

  it("keeps an unsaved edit when re-entering after a failed save", async () => {
    const { sync, api, useSaveStatus, useWorkspaceStore } = await setup(farm());
    await sync.open();
    api.save.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    useWorkspaceStore.getState().update(rename("Salem"));
    await sync.open();
    expect(useWorkspaceStore.getState().workspace?.settings.owner.name).toBe("Salem");
    expect(useSaveStatus.getState().status).toBe("failed");
  });

  it("stops retrying what only the owner can fix, and clears once it's fixed", async () => {
    const { sync, api, useAccountState, useSaveStatus, useWorkspaceStore } = await setup(farm());
    await sync.open();
    api.save.mockResolvedValueOnce({ ok: true, data: { workspace: farm(), created: {}, failed: ["invalid_input"] } });
    useWorkspaceStore.getState().update(rename("A very long name"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(useAccountState.getState().notice).toBe("refused");
    useWorkspaceStore.getState().update(rename(""));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useSaveStatus.getState().status).toBe("idle");
    await sync.flush();
    expect(useAccountState.getState().notice).toBeNull();
  });

  it("never runs two saves at once", async () => {
    const { sync, api, useWorkspaceStore } = await setup(farm());
    await sync.open();
    let running = 0;
    let peak = 0;
    api.save.mockImplementation(async () => {
      peak = Math.max(peak, ++running);
      await new Promise((resolve) => setTimeout(resolve, 50));
      running -= 1;
      return { ok: true, data: { workspace: farm(), created: {}, failed: [] } };
    });
    useWorkspaceStore.getState().update(rename("Salem"));
    const all = [sync.flush(), sync.flush(), sync.flush()];
    await vi.advanceTimersByTimeAsync(500);
    await Promise.all(all);
    expect(peak).toBe(1);
  });

  it("stays in demo mode for a visitor, and leaves the demo untouched", async () => {
    const { sync, api, useAccountState, useWorkspaceStore } = await setup(farm());
    useWorkspaceStore.getState().startDemo("en");
    const demo = useWorkspaceStore.getState().workspace;
    api.open.mockResolvedValueOnce({ ok: false, error: "unauthenticated" } as never);
    await sync.open();
    expect(useAccountState.getState().status).toBe("demo");
    expect(useWorkspaceStore.getState().workspace).toBe(demo);
  });
});
