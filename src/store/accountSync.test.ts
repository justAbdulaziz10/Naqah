import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import type { Workspace } from "@/domain/types";
import type { AccountWorkspace } from "@/lib/account/types";
import type { AccountApi } from "./accountSync";

const writes: string[] = [];
let stored: string | null = null;

const FARM_A = "11111111-1111-4111-8111-111111111111";
const FARM_B = "22222222-2222-4222-8222-222222222222";
const OWNER_A = "owner-a";
const OWNER_B = "owner-b";

async function setup(farm: AccountWorkspace) {
  vi.resetModules();
  const { createAccountSync } = await import("./accountSync");
  const store = await import("./workspace");
  let server = farm;
  let browserOwner: string | null = farm.ownerId;
  const api = {
    open: vi.fn<AccountApi["open"]>(async () => ({ ok: true, data: server })),
    load: vi.fn<AccountApi["load"]>(async () => ({ ok: true, data: server })),
    save: vi.fn<AccountApi["save"]>(async () => ({ ok: true, data: { workspace: server, created: {}, failed: [] } })),
  };
  const identity = { getOwnerId: vi.fn(async () => browserOwner) };
  const sync = createAccountSync(api, identity);
  return {
    ...store, api, sync, identity,
    setServer: (ws: AccountWorkspace) => { server = ws; browserOwner = ws.ownerId; },
    setIdentity: (owner: string | null, notify = true) => {
      browserOwner = owner;
      if (notify) sync.authChanged(owner);
    },
  };
}

const template = createEmptyWorkspace("basic");
const farm = (): AccountWorkspace => ({ ...template, farmId: FARM_A, ownerId: OWNER_A, createdAt: "2026-11-01T00:00:00.000Z", setupComplete: true });
const rename = (name: string) => <T extends Workspace>(ws: T): T => ({ ...ws, settings: { ...ws.settings, owner: { ...ws.settings.owner, name } } });

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
  it("keeps this owner's farm on screen while a new screen checks it again", async () => {
    const { sync, api, useAccountState, useWorkspaceStore } = await setup(farm());
    await sync.open();
    expect(useAccountState.getState().status).toBe("ready");
    let finish!: () => void;
    api.open.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: farm() }); }));
    const reopening = sync.open();
    await vi.advanceTimersByTimeAsync(0);
    expect(useAccountState.getState().status).toBe("ready");
    expect(useWorkspaceStore.getState().workspace).not.toBeNull();
    finish();
    await reopening;
    expect(useAccountState.getState().status).toBe("ready");
  });

  it("still blanks the screen at once when another owner signs in meanwhile", async () => {
    const { sync, useAccountState, useWorkspaceStore, setIdentity } = await setup(farm());
    await sync.open();
    setIdentity(OWNER_B);
    expect(useAccountState.getState().status).toBe("checking");
    expect(useWorkspaceStore.getState().workspace).toBeNull();
  });

  it("does not merge or flush between two farms with identical createdAt and the same owner hint", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    useWorkspaceStore.getState().update(rename("Old farm pending"));
    const other = { ...farm(), farmId: FARM_B };
    expect(other.createdAt).toBe(farm().createdAt);
    setServer(other);
    await sync.open();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
    expect(api.save).not.toHaveBeenCalled();
  });

  it.each(["open", "load", "save"] as const)("discards pending %s results immediately after a cross-tab auth event", async (operation) => {
    const { sync, api, useWorkspaceStore, setServer, setIdentity } = await setup(farm());
    await sync.open();
    let finish!: () => void;
    let pending: Promise<void>;
    if (operation === "save") {
      api.save.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: { workspace: rename("Stale A")(farm()), created: {}, failed: [] } }); }));
      useWorkspaceStore.getState().update(rename("A pending"));
      pending = sync.flush();
    } else {
      api[operation].mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: rename("Stale A")(farm()) }); }));
      pending = operation === "open" ? sync.open() : sync.refresh();
    }
    await vi.advanceTimersByTimeAsync(0);
    const other = { ...rename("Current B")(farm()), farmId: FARM_B, ownerId: OWNER_B };
    expect(other.createdAt).toBe(farm().createdAt);
    setServer(other);
    setIdentity(OWNER_B);
    expect(useWorkspaceStore.getState().workspace).toBeNull();
    await vi.advanceTimersByTimeAsync(0);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
    expect(sync.hasUnsaved()).toBe(false); // A's still-pending request is not B's pending work.
    finish();
    await pending;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
    expect(sync.hasUnsaved()).toBe(false);
    expect(api.save.mock.calls.every(([, id]) => id === FARM_A)).toBe(true);
  });

  it.each(["open", "load", "save"] as const)("rechecks identity after %s even before a cross-tab notification arrives", async (operation) => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    let finish!: () => void;
    let pending: Promise<void>;
    if (operation === "save") {
      api.save.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: { workspace: rename("Stale A")(farm()), created: {}, failed: [] } }); }));
      useWorkspaceStore.getState().update(rename("A pending"));
      pending = sync.flush();
    } else {
      api[operation].mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: rename("Stale A")(farm()) }); }));
      pending = operation === "open" ? sync.open() : sync.refresh();
    }
    await vi.advanceTimersByTimeAsync(0);
    const other = { ...rename("Current B")(farm()), farmId: FARM_B, ownerId: OWNER_B };
    setServer(other); // Updates the cookie/session hint, without an SDK event.
    finish();
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
  });

  it("rejects a response with a different validated owner than the initiating browser identity", async () => {
    const { sync, api, useWorkspaceStore, useAccountState } = await setup(farm());
    await sync.open();
    api.open.mockResolvedValueOnce({ ok: true, data: { ...farm(), farmId: FARM_B, ownerId: OWNER_B } });
    await sync.open();
    expect(useWorkspaceStore.getState().workspace).toBeNull();
    expect(useAccountState.getState().status).toBe("error");
    expect(api.save).not.toHaveBeenCalled();
  });

  it.each(["open", "load", "save"] as const)("rechecks the final identity boundary immediately before adopting %s", async (operation) => {
    const { sync, api, identity, useWorkspaceStore, setServer, setIdentity } = await setup(farm());
    await sync.open();
    let finish!: () => void;
    let pending: Promise<void>;
    const stale = rename("Stale response A")(farm());
    if (operation === "save") {
      api.save.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: { workspace: stale, created: {}, failed: [] } }); }));
      useWorkspaceStore.getState().update(rename("A pending"));
      pending = sync.flush();
    } else {
      api[operation].mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: stale }); }));
      pending = operation === "open" ? sync.open() : sync.refresh();
    }
    await vi.advanceTimersByTimeAsync(0);
    let switched = false;
    let adoptedOldResult = false;
    const unsubscribe = useWorkspaceStore.subscribe(({ workspace }) => {
      if (switched && workspace?.settings.owner.name === "Stale response A") adoptedOldResult = true;
    });
    const other = { ...rename("Current B")(farm()), farmId: FARM_B, ownerId: OWNER_B };
    identity.getOwnerId.mockImplementationOnce(async () => {
      // Event lands after the awaited probe/check resolves, but before its caller adopts.
      queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
        switched = true;
        setServer(other);
        setIdentity(OWNER_B);
      })));
      return OWNER_A;
    });
    finish();
    await pending;
    await vi.advanceTimersByTimeAsync(0);
    unsubscribe();
    expect(adoptedOldResult).toBe(false);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
  });

  it("does not invalidate pending edits for same-owner token refresh events", async () => {
    const { sync, api, useWorkspaceStore } = await setup(farm());
    await sync.open();
    useWorkspaceStore.getState().update(rename("Still mine"));
    sync.authChanged(OWNER_A);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0][1]).toBe(FARM_A);
  });

  it("rejects an old A result after rapid A to B to A events", async () => {
    const { sync, api, useWorkspaceStore, setServer, setIdentity } = await setup(farm());
    await sync.open();
    let finish!: () => void;
    api.open.mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ ok: true, data: rename("Obsolete A")(farm()) }); }));
    const pending = sync.open();
    await vi.advanceTimersByTimeAsync(0);
    setIdentity(OWNER_B);
    const fresh = rename("Current A")(farm());
    setServer(fresh);
    setIdentity(OWNER_A);
    await vi.advanceTimersByTimeAsync(0);
    finish();
    await pending;
    expect(useWorkspaceStore.getState().workspace).toEqual(fresh);
  });

  it("lets an initial SDK auth event supersede an old identity probe", async () => {
    const { sync, api, identity, useWorkspaceStore, setServer, setIdentity } = await setup(farm());
    let finish!: (owner: string | null) => void;
    identity.getOwnerId.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const pending = sync.open();
    const fresh = { ...farm(), farmId: FARM_B, ownerId: OWNER_B };
    setServer(fresh);
    setIdentity(OWNER_B);
    await vi.advanceTimersByTimeAsync(0);
    finish(OWNER_A);
    await pending;
    expect(useWorkspaceStore.getState().workspace).toEqual(fresh);
    expect(api.open).toHaveBeenCalledTimes(1);
  });

  it("keeps pending edits and retries after a local session-probe failure", async () => {
    const { sync, api, identity, useSaveStatus, useWorkspaceStore } = await setup(farm());
    await sync.open();
    identity.getOwnerId.mockRejectedValueOnce(new Error("temporarily unavailable"));
    useWorkspaceStore.getState().update(rename("Still pending"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useSaveStatus.getState().status).toBe("failed");
    expect(api.save).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().workspace?.settings.owner.name).toBe("Still pending");
    await vi.advanceTimersByTimeAsync(15_000);
    expect(api.save).toHaveBeenCalledTimes(1);
  });

  it("serializes queued flushes and retains the last server snapshot", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    let running = 0, peak = 0, sequence = 0;
    api.save.mockImplementation(async (changes) => {
      peak = Math.max(peak, ++running);
      const order = ++sequence;
      await new Promise((resolve) => setTimeout(resolve, 20));
      const name = (changes.find((change) => change.kind === "profile") as { input?: { ownerName?: string } })?.input?.ownerName ?? "";
      const saved = { ...rename(name)(farm()), lastUpdateAt: `snapshot-${order}` };
      setServer(saved);
      running--;
      return { ok: true, data: { workspace: saved, created: {}, failed: [] } };
    });
    useWorkspaceStore.getState().update(rename("First"));
    const initial = sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    useWorkspaceStore.getState().update(rename("Second"));
    const waiting = Array.from({ length: 4 }, () => sync.flush());
    await vi.advanceTimersByTimeAsync(200);
    await Promise.all([initial, ...waiting]);
    expect(peak).toBe(1);
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(useWorkspaceStore.getState().workspace).toMatchObject({ lastUpdateAt: "snapshot-2", settings: { owner: { name: "Second" } } });
  });
  it("drops conflicted edits and opens once even if every save would conflict", async () => {
    const { sync, api, useWorkspaceStore, setServer, useAccountState } = await setup(farm());
    await sync.open();
    api.save.mockImplementation(async () => {
      // Bound the old regression instead of allowing an infinite microtask loop in a failing test.
      if (api.save.mock.calls.length > 5) return { ok: false, error: "unavailable" };
      return { ok: false, error: "conflict" };
    });
    const other = { ...rename("Replacement farm")(farm()), farmId: FARM_B };
    setServer(other);
    useWorkspaceStore.getState().update(rename("Owner A pending edit"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.open).toHaveBeenCalledTimes(2);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
    expect(useAccountState.getState()).toMatchObject({ status: "ready", notice: null });
    expect(sync.hasUnsaved()).toBe(false);
  });

  it("discovers a changed owner before flushing a scheduled retry", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    api.save.mockResolvedValueOnce({ ok: false, error: "unavailable" });
    useWorkspaceStore.getState().update(rename("Owner A pending edit"));
    await vi.advanceTimersByTimeAsync(1_000);
    const other = { ...farm(), farmId: FARM_B, ownerId: OWNER_B };
    setServer(other);
    await sync.open();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
  });

  it.each(["saved", "conflict", "unavailable", "unauthenticated"] as const)("ignores an old owner's in-flight %s result after loading the new owner", async (reply) => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    let finish!: (result: Awaited<ReturnType<AccountApi["save"]>>) => void;
    api.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useWorkspaceStore.getState().update(rename("Owner A pending edit"));
    await vi.advanceTimersByTimeAsync(1_000);
    const other = { ...rename("Owner B")(farm()), farmId: FARM_B, ownerId: OWNER_B };
    setServer(other);
    await sync.open();
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
    finish(reply === "saved"
      ? { ok: true, data: { workspace: rename("Old response")(farm()), created: { old: "wrong-id" }, failed: [] } }
      : { ok: false, error: reply });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.open).toHaveBeenCalledTimes(2);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
  });

  it("ignores an obsolete open response that arrives after another account opens", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    let finish!: (result: Awaited<ReturnType<AccountApi["open"]>>) => void;
    api.open.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const obsolete = sync.open();
    await vi.advanceTimersByTimeAsync(0);
    const other = { ...farm(), farmId: FARM_B, ownerId: OWNER_B };
    setServer(other);
    await sync.open();
    finish({ ok: true, data: rename("Old A")(farm()) });
    await obsolete;
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("cancels a queued flush waiting on an old owner's save", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    let finish!: (result: Awaited<ReturnType<AccountApi["save"]>>) => void;
    api.save.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    useWorkspaceStore.getState().update(rename("A pending"));
    const inFlight = sync.flush();
    const queued = sync.flush();
    await vi.advanceTimersByTimeAsync(0);
    const other = { ...farm(), farmId: FARM_B, ownerId: OWNER_B };
    setServer(other);
    await sync.open();
    finish({ ok: false, error: "unavailable" });
    await Promise.all([inFlight, queued]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
  });

  it("invalidates a pending refresh across close and a different owner opening", async () => {
    const { sync, api, useWorkspaceStore, setServer } = await setup(farm());
    await sync.open();
    let finish!: (result: Awaited<ReturnType<AccountApi["load"]>>) => void;
    api.load.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const refresh = sync.refresh();
    await vi.advanceTimersByTimeAsync(0);
    sync.close();
    const other = { ...farm(), farmId: FARM_B, ownerId: OWNER_B };
    setServer(other);
    await sync.open();
    finish({ ok: true, data: rename("Stale A")(farm()) });
    await refresh;
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
  });

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
    useWorkspaceStore.getState().update(() => ({ ...createDemoWorkspace("en", "ultimate"), createdAt: farm().createdAt }));
    useWorkspaceStore.getState().update((ws) => ({ ...ws, farmId: FARM_B }));
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
    const other = { ...farm(), farmId: FARM_B, ownerId: OWNER_B };
    setServer(other);
    await sync.open();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(useWorkspaceStore.getState().workspace).toEqual(other);
    expect(api.save.mock.calls.every(([, farmId]) => farmId === FARM_A)).toBe(true);
  });

  it("names the farm in every save, and reloads when the server refuses it", async () => {
    const { sync, api, useWorkspaceStore } = await setup(farm());
    await sync.open();
    api.save.mockResolvedValueOnce({ ok: false, error: "conflict" });
    useWorkspaceStore.getState().update(rename("Salem"));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(api.save.mock.calls[0][1]).toBe(FARM_A);
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

  it("never claims a section saved while an invalid edit is still on the screen", async () => {
    const { sync, api, useSaveStatus, useWorkspaceStore } = await setup(farm());
    const { useUnsentDrafts } = await import("./accountSync");
    await sync.open();
    useWorkspaceStore.getState().update((ws) => ({
      ...ws,
      settings: { ...ws.settings, farm: { ...ws.settings.farm, name: "Al Nakheel" }, owner: { ...ws.settings.owner, phone: "123" } },
    }));
    expect(useUnsentDrafts.getState().fields).toEqual(["ownerPhone"]);
    await vi.runAllTimersAsync();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save.mock.calls[0][0]).toEqual([{ kind: "profile", input: { name: "Al Nakheel" } }]);
    expect(useSaveStatus.getState().status).toBe("saved");
    // The name is saved, but the screen still shows an edit that was not: that edit stays unsaved.
    expect(useUnsentDrafts.getState().fields).toEqual(["ownerPhone"]);
    expect(sync.hasUnsaved()).toBe(true);
    useWorkspaceStore.getState().update((ws) => ({ ...ws, settings: { ...ws.settings, owner: { ...ws.settings.owner, phone: "" } } }));
    expect(useUnsentDrafts.getState().fields).toEqual([]);
  });
});
