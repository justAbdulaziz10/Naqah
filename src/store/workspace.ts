"use client";

/**
 * Client-side workspace store.
 *
 * The demo lives in one `Workspace` document persisted to localStorage, so it never depends on a
 * backend being awake. A signed-in owner's farm uses the same shape but comes from Supabase and
 * never reaches localStorage: see `accountSync.ts`.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { createDemoWorkspace, createEmptyWorkspace, nowFor, retainDemoHistory, type Locale, type Plan, type Workspace } from "@/domain";
import { isAccountWorkspace } from "@/lib/account/types";

interface WorkspaceState {
  workspace: Workspace | null;
  /** True once localStorage has been read (avoid rendering "empty" before hydration). */
  hydrated: boolean;
  setWorkspace: (ws: Workspace) => void;
  /** Internal: flipped by the persist middleware once storage has been read. */
  markHydrated: () => void;
  /** Apply a pure domain transition: `update(ws => completeWorkerReport(ws, now, draft).ws)`. */
  update: (fn: (ws: Workspace) => Workspace) => void;
  startDemo: (locale: Locale, plan?: Plan) => void;
  startOnboarding: (plan: Plan) => void;
  reset: () => void;
}

type Persisted = { workspace: Workspace | null };

/** Outcome of the latest browser write. Kept apart from the workspace store, whose every change is itself written. */
export type SaveStatus = "idle" | "saved" | "failed";
export const useSaveStatus = create<{ status: SaveStatus }>(() => ({ status: "idle" }));

/**
 * Whose data this is. `active` means a signed-in owner's farm from Supabase: then nothing touches
 * localStorage, and the demo-only actions below do nothing. See `accountSync.ts`.
 */
export type AccountStatus = "checking" | "demo" | "ready" | "error" | "signedOut" | "planRequired";
export const useAccountState = create<{ active: boolean; status: AccountStatus; notice: "plan" | "refused" | null }>(() => ({
  active: false,
  status: process.env.NEXT_PUBLIC_NAQAH_ACCOUNT_DATA === "1" ? "checking" : "demo",
  notice: null,
}));
export const useIsAccount = () => useAccountState((state) => state.active);
export const accountLink: { active: boolean; edited: () => void } = { active: false, edited: () => undefined };

const WORKSPACE_ARRAYS = ["camels", "resources", "reports", "calls", "taskTickets", "noAnswerTickets", "pendingWorkerCalls", "relays", "events"] as const;

/** Minimal shape check so stale or hand-edited data can't crash the dashboard. */
function isWorkspace(value: unknown): value is Workspace {
  if (!value || typeof value !== "object") return false;
  const ws = value as Record<string, unknown>;
  return ws.version === 1 && typeof ws.settings === "object" && ws.settings !== null && WORKSPACE_ARRAYS.every((key) => Array.isArray(ws[key]));
}

/**
 * localStorage adapter that never throws: unreadable or wrong-shaped data is dropped
 * (the visitor simply sees "No farm yet" and can restart the demo).
 */
const hasStorage = () => typeof localStorage !== "undefined";

const safeStorage: PersistStorage<Persisted> = {
  getItem: (name) => {
    try {
      if (!hasStorage()) return null; // server prerender: nothing saved yet
      const raw = localStorage.getItem(name);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StorageValue<Persisted>;
      const workspace = parsed?.state?.workspace ?? null;
      if (workspace !== null && !isWorkspace(workspace)) throw new Error("unexpected workspace shape");
      return { state: { workspace }, version: parsed.version ?? 1 };
    } catch (error) {
      console.warn("[naqah] discarded unreadable saved workspace", error);
      try { localStorage.removeItem(name); } catch { /* storage unavailable */ }
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      if (!hasStorage() || accountLink.active) return;
      localStorage.setItem(name, JSON.stringify(value));
      useSaveStatus.setState({ status: "saved" });
    } catch (error) {
      console.warn("[naqah] could not save workspace", error);
      useSaveStatus.setState({ status: "failed" });
    }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* storage unavailable */ }
  },
};

type CoalescingPersistStorage<T> = PersistStorage<T> & {
  flushPending: () => void;
  dispose: () => void;
};

/** Delay full-document serialization until the workspace has been quiet for 300 ms. */
export function createCoalescingStorage<T>(
  storage: PersistStorage<T>,
  delayMs = 300,
): CoalescingPersistStorage<T> {
  const pending = new Map<string, { value: StorageValue<T>; timer: ReturnType<typeof setTimeout> }>();

  const flushItem = (name: string) => {
    const write = pending.get(name);
    if (!write) return;
    clearTimeout(write.timer);
    pending.delete(name);
    storage.setItem(name, write.value);
  };
  const flushPending = () => {
    for (const name of [...pending.keys()]) flushItem(name);
  };
  const onPageExit = () => flushPending();
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flushPending();
  };
  const pageEvents = typeof window !== "undefined" && typeof window.addEventListener === "function" ? window : null;
  const visibilityEvents = typeof document !== "undefined" && typeof document.addEventListener === "function" ? document : null;

  if (pageEvents) {
    pageEvents.addEventListener("pagehide", onPageExit);
    pageEvents.addEventListener("beforeunload", onPageExit);
  }
  visibilityEvents?.addEventListener("visibilitychange", onVisibilityChange);

  return {
    getItem: (name) => storage.getItem(name),
    setItem: (name, value) => {
      if (accountLink.active) return;
      const previous = pending.get(name);
      if (previous) clearTimeout(previous.timer);
      useSaveStatus.setState({ status: "idle" });
      const timer = setTimeout(() => flushItem(name), delayMs);
      pending.set(name, { value, timer });
    },
    removeItem: (name) => {
      const previous = pending.get(name);
      if (previous) clearTimeout(previous.timer);
      pending.delete(name);
      storage.removeItem(name);
    },
    flushPending,
    dispose: () => {
      flushPending();
      if (pageEvents) {
        pageEvents.removeEventListener("pagehide", onPageExit);
        pageEvents.removeEventListener("beforeunload", onPageExit);
      }
      visibilityEvents?.removeEventListener("visibilitychange", onVisibilityChange);
    },
  };
}

const coalescingStorage = createCoalescingStorage(safeStorage);

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspace: null,
      hydrated: false,
      setWorkspace: (ws) => set({ workspace: ws }),
      markHydrated: () => set({ hydrated: true }),
      update: (fn) => {
        const ws = get().workspace;
        if (!ws) return;
        const next = fn(ws);
        if (!accountLink.active) return set({ workspace: retainDemoHistory(next) });
        // A different document is a sample or a restart, never an edit to a real farm.
        if (!isAccountWorkspace(ws) || !isAccountWorkspace(next) || next.farmId !== ws.farmId || next.ownerId !== ws.ownerId) return;
        set({ workspace: next });
        accountLink.edited();
      },
      startDemo: (locale, plan = "ultimate") => {
        if (!accountLink.active) set({ workspace: createDemoWorkspace(locale, plan) });
      },
      startOnboarding: (plan) => {
        if (!accountLink.active) set({ workspace: createEmptyWorkspace(plan) });
      },
      reset: () => {
        if (!accountLink.active) set({ workspace: null });
      },
    }),
    {
      name: "naqah-workspace-v1",
      version: 1,
      storage: coalescingStorage,
      partialize: (s) => ({ workspace: s.workspace }),
      // Future Workspace versions: transform `persisted` here instead of discarding it.
      migrate: (persisted) => persisted as Persisted,
      // localStorage is synchronous, so rehydration finishes *inside* `create()` — before
      // `useWorkspaceStore` is assigned, and the initial state can still overwrite a flag set
      // there. Mark hydrated now (state handed to the callback) and again once the store exists.
      onRehydrateStorage: (initial) => (state) => {
        (state ?? initial).markHydrated();
        queueMicrotask(() => useWorkspaceStore.setState({ hydrated: true }));
      },
    },
  ),
);

/** Convenience selector. */
export const useWorkspace = () => useWorkspaceStore((s) => s.workspace);

/** Workspace "now" (includes the demo clock offset). Re-renders every 15s. */
export function useNow(): Date {
  const offset = useWorkspaceStore((s) => s.workspace?.clockOffsetMs ?? 0);
  const [real, setReal] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setReal(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);
  return nowFor({ clockOffsetMs: offset }, real);
}
