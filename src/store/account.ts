import type { AccountWorkspace } from "@/lib/account/types";
import { browserOwnerId, observeAccountAuth } from "@/lib/account/auth-observer";
import { loadClient } from "@/lib/supabase/lazy-client";
import type { OwnerChange } from "@/lib/account/changes";
import type { CallNowResult } from "@/server/calls/scheduler";
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

/** The owner's controlled "Call now" (route handler, not a Server Action: see /api/account). */
export const reportCallNow = {
  available: () => call<boolean>("callNowAvailable"),
  call: () => call<CallNowResult>("callNow"),
};

export const accountSync = createAccountSync({
  open: () => call<AccountWorkspace>("open"),
  load: () => call<AccountWorkspace>("load"),
  save: (changes, farm) => call<SavedChanges>("save", changes, farm),
}, {
  async getOwnerId() {
    const client = await loadClient();
    return client ? browserOwnerId(client.auth) : null;
  },
});

let observers = 0;
let stopObserving: (() => void) | undefined;
export function watchAccountAuth(): () => void {
  let watching = true;
  if (++observers === 1) {
    void loadClient().then((client) => {
      if (client && observers > 0 && !stopObserving) stopObserving = observeAccountAuth(client.auth, accountSync.authChanged);
    });
  }
  return () => {
    if (!watching) return;
    watching = false;
    if (--observers === 0) { stopObserving?.(); stopObserving = undefined; }
  };
}

/** For a screen that confirms a save in words: in account mode that has to wait for the server. */
export async function savedForSure(): Promise<boolean> {
  const account = accountLink.active;
  if (account) await accountSync.flush();
  const { status } = useSaveStatus.getState();
  // A rejected save can close the account mid-flush, which must not read as the demo succeeding.
  return account ? accountLink.active && status === "saved" : status !== "failed";
}
