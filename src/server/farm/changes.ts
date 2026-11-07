import type { ListKind, OwnerChange } from "@/lib/account/changes";
import { DbError, type DbErrorCode } from "@/server/db/errors";
import type { OwnerRepository } from "@/server/db/owner-repository";
import { record } from "./input";

const MAX_CHANGES = 500;

export interface AppliedChanges {
  /** Screen id → stored id, for rows added by this batch. */
  created: Record<string, string>;
  failed: DbErrorCode[];
}

function listActions(repository: OwnerRepository, kind: ListKind) {
  switch (kind) {
    case "camel":
      return { add: repository.addCamel, update: repository.updateCamel, remove: repository.deleteCamel };
    case "question":
      return {
        add: (input: unknown, localId?: string) => repository.addCustomQuestion(record(input).text, localId),
        update: (id: unknown, input: unknown) => repository.updateCustomQuestion(id, record(input).text),
        remove: repository.deleteCustomQuestion,
      };
    case "criterion":
      return { add: repository.addCriterion, update: repository.updateCriterion, remove: repository.deleteCriterion };
    case "emergency":
      return { add: repository.addEmergency, update: repository.updateEmergency, remove: repository.deleteEmergency };
    case "worker":
      return { add: repository.addWorker, update: repository.updateWorker, remove: repository.deleteWorker };
    default:
      throw new DbError("invalid_input", "kind");
  }
}

async function applyOne(repository: OwnerRepository, change: OwnerChange, created: Record<string, string>) {
  if (change.kind === "profile") return repository.saveFarmProfile(change.input);
  if (change.kind === "primaryWorker") return repository.setPrimaryWorker(change.id);
  if (change.kind === "worker" && !("action" in change)) return repository.saveWorker(change.input);
  if (change.kind === "resource") return repository.saveResource(change.input);
  if (!("action" in change)) throw new DbError("invalid_input", "action");
  const list = listActions(repository, change.kind);
  if (change.action === "delete") {
    // Already gone is what was asked for, as when the reply to an earlier try was lost.
    return list.remove(change.id).catch((error: unknown) => {
      if (!(error instanceof DbError && error.code === "not_found")) throw error;
    });
  }
  if (change.action === "update") return list.update(change.id, change.input);
  if (change.action !== "add" || typeof change.localId !== "string") throw new DbError("invalid_input", "action");
  created[change.localId] = await list.add(change.input, change.localId);
}

/**
 * Every change runs through the same validated owner actions, under the owner's session. One bad
 * field must not lose the rest of the form, so each change stands alone and failures are reported.
 */
export async function applyOwnerChanges(repository: OwnerRepository, input: unknown): Promise<AppliedChanges> {
  if (!Array.isArray(input) || input.length > MAX_CHANGES) throw new DbError("invalid_input", "changes");
  const created: Record<string, string> = {};
  const failed: DbErrorCode[] = [];
  for (const change of input as OwnerChange[]) {
    try {
      await applyOne(repository, record(change) as unknown as OwnerChange, created);
    } catch (error) {
      failed.push(error instanceof DbError ? error.code : "unavailable");
    }
  }
  return { created, failed };
}
