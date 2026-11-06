import type { Workspace } from "@/domain/types";
import type { OwnerChange } from "@/lib/account/changes";
import { createAccountSync, type SavedChanges } from "./accountSync";
import { accountLink, useSaveStatus } from "./workspace";

const TIMEOUT_MS = 15_000;

async function call<T>(op: string, changes?: OwnerChange[], farm?: string): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  const response = await fetch("/api/account", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op, changes, farm }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return response.json();
}

export const accountSync = createAccountSync({
  open: () => call<Workspace>("open"),
  load: () => call<Workspace>("load"),
  save: (changes, farm) => call<SavedChanges>("save", changes, farm),
});

/** For a screen that confirms a save in words: in account mode that has to wait for the server. */
export async function savedForSure(): Promise<boolean> {
  if (accountLink.active) await accountSync.flush();
  const { status } = useSaveStatus.getState();
  return accountLink.active ? status === "saved" : status !== "failed";
}
