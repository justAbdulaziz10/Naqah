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
import { createJSONStorage, persist } from "zustand/middleware";
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
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ workspace: s.workspace }),
      // localStorage is synchronous, so rehydration finishes *inside* `create()` — before
      // `useWorkspaceStore` is assigned. Use the state handed to the callback, never the export.
      onRehydrateStorage: (initial) => (state) => (state ?? initial).markHydrated(),
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
