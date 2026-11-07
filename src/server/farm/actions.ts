"use server";

import { createOwnerRepository, type OwnerRepository } from "@/server/db/owner-repository";
import { DbError, type DbErrorCode } from "@/server/db/errors";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { createWritableClient, getOwner } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/supabase/timeout";
import { applyOwnerChanges } from "./changes";
import { isAccountDataEnabled } from "./account-mode";

const DB_TIMEOUT_MS = 8_000;

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: DbErrorCode | "unauthenticated" };

/** Identity comes from the validated session only. No action takes an owner or farm id. */
async function asOwner<T>(work: (repository: OwnerRepository) => Promise<T>): Promise<ActionResult<T>> {
  if (!isAccountDataEnabled()) return { ok: false, error: "unavailable" };
  try {
    const { user, unavailable } = await getOwner();
    // An outage is not a signed-out owner: treating it as one would show them the demo.
    if (!user) return { ok: false, error: unavailable ? "unavailable" : "unauthenticated" };
    const client = await createWritableClient();
    if (!client) return { ok: false, error: "unavailable" };
    return { ok: true, data: await withTimeout(work(createOwnerRepository(client, user.id)), DB_TIMEOUT_MS) };
  } catch (error) {
    return { ok: false, error: error instanceof DbError ? error.code : "unavailable" };
  }
}

export async function ensureFarm() { return asOwner((r) => r.ensureFarm()); }

/** Entering the dashboard or setup. Without Supabase configured there is no account to open. */
export async function openAccount() {
  if (!isAccountDataEnabled()) return { ok: false as const, error: "unavailable" as const };
  if (!getSupabaseConfig()) return { ok: false as const, error: "unauthenticated" as const };
  return asOwner(async (r) => {
    await r.ensureFarm();
    return (await r.load()).workspace;
  });
}

/** One save from the screens: validated change by change, then the server's copy of the farm. */
export async function saveOwnerEdits(changes: unknown, farm: unknown) {
  return asOwner(async (r) => {
    // A tab opened by one owner can outlive their session: its edits must not land on the next farm.
    const { workspace } = await r.load();
    if (workspace.createdAt !== farm) throw new DbError("conflict");
    const applied = await applyOwnerChanges(r, changes);
    return { ...applied, workspace: (await r.load()).workspace };
  });
}

export async function loadWorkspace() { return asOwner(async (r) => (await r.load()).workspace); }
export async function listAlerts() { return asOwner((r) => r.alerts(new Date())); }
export async function listInstructions() { return asOwner((r) => r.instructions()); }

export async function saveFarmProfile(input: unknown) { return asOwner((r) => r.saveFarmProfile(input)); }
export async function saveWorker(input: unknown) { return asOwner((r) => r.saveWorker(input)); }
export async function saveResource(input: unknown) { return asOwner((r) => r.saveResource(input)); }

export async function addCamel(input: unknown) { return asOwner((r) => r.addCamel(input)); }
export async function updateCamel(id: unknown, input: unknown) { return asOwner((r) => r.updateCamel(id, input)); }
export async function deleteCamel(id: unknown) { return asOwner((r) => r.deleteCamel(id)); }

export async function addCustomQuestion(text: unknown) { return asOwner((r) => r.addCustomQuestion(text)); }
export async function updateCustomQuestion(id: unknown, text: unknown) { return asOwner((r) => r.updateCustomQuestion(id, text)); }
export async function deleteCustomQuestion(id: unknown) { return asOwner((r) => r.deleteCustomQuestion(id)); }

export async function addCriterion(input: unknown) { return asOwner((r) => r.addCriterion(input)); }
export async function updateCriterion(id: unknown, input: unknown) { return asOwner((r) => r.updateCriterion(id, input)); }
export async function deleteCriterion(id: unknown) { return asOwner((r) => r.deleteCriterion(id)); }

export async function addEmergency(input: unknown) { return asOwner((r) => r.addEmergency(input)); }
export async function updateEmergency(id: unknown, input: unknown) { return asOwner((r) => r.updateEmergency(id, input)); }
export async function deleteEmergency(id: unknown) { return asOwner((r) => r.deleteEmergency(id)); }
