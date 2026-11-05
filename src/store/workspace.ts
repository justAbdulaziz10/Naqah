"use client";

/**
 * Client-side workspace store (investor demo).
 *
 * The whole demo state lives in one `Workspace` document persisted to
 * localStorage, so the demo never depends on a backend being awake.
 * To move to Supabase, replace the `persist` storage with a repository that
 * reads/writes the tables in `supabase/migrations` — see AGENT.md §Data.
 */
import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";
import { createDemoWorkspace, createEmptyWorkspace, nowFor, type Locale, type Plan, type Workspace } from "@/domain";

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
    if (!hasStorage()) return null; // server prerender: nothing saved yet
    try {
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
    if (!hasStorage()) return;
    try { localStorage.setItem(name, JSON.stringify(value)); } catch (error) { console.warn("[naqah] could not save workspace", error); }
  },
  removeItem: (name) => {
    try { localStorage.removeItem(name); } catch { /* storage unavailable */ }
  },
};

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspace: null,
      hydrated: false,
      setWorkspace: (ws) => set({ workspace: ws }),
      markHydrated: () => set({ hydrated: true }),
      update: (fn) => {
        const ws = get().workspace;
        if (ws) set({ workspace: fn(ws) });
      },
      startDemo: (locale, plan = "ultimate") => set({ workspace: createDemoWorkspace(locale, plan) }),
      startOnboarding: (plan) => set({ workspace: createEmptyWorkspace(plan) }),
      reset: () => set({ workspace: null }),
    }),
    {
      name: "naqah-workspace-v1",
      version: 1,
      storage: safeStorage,
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
