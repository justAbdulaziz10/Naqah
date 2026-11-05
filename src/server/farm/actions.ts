"use server";

import { createOwnerRepository, type OwnerRepository } from "@/server/db/owner-repository";
import { DbError, type DbErrorCode } from "@/server/db/errors";
import { createWritableClient, getOwner } from "@/lib/supabase/server";
import { withTimeout } from "@/lib/supabase/timeout";

const DB_TIMEOUT_MS = 8_000;

type ActionResult<T> = { ok: true; data: T } | { ok: false; error: DbErrorCode | "unauthenticated" };

/** Identity comes from the validated session only. No action takes an owner or farm id. */
async function asOwner<T>(work: (repository: OwnerRepository) => Promise<T>): Promise<ActionResult<T>> {
  try {
    const { user } = await getOwner();
    if (!user) return { ok: false, error: "unauthenticated" };
    const client = await createWritableClient();
    if (!client) return { ok: false, error: "unavailable" };
    return { ok: true, data: await withTimeout(work(createOwnerRepository(client, user.id)), DB_TIMEOUT_MS) };
  } catch (error) {
    return { ok: false, error: error instanceof DbError ? error.code : "unavailable" };
  }
}

export async function ensureFarm() { return asOwner((r) => r.ensureFarm()); }
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
