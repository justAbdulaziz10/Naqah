import type { SupabaseClient } from "@supabase/supabase-js";
import { farmAlerts, farmInstructions } from "@/domain/alerts";
import { createEmptyWorkspace } from "@/domain/seed";
import {
  parseCamelPatch, parseCriterion, parseEmergency, parseFarmProfile, parseNewCamel, parseResource, parseWorker, requiredText,
} from "@/server/farm/input";
import { DbError, fromPostgrest } from "./errors";
import { isUuid, toDbId } from "./ids";
import { loadFarm, requireFarm, type LoadedFarm } from "./queries";

type Result = { data: unknown; error: { code?: string; message?: string } | null };

function assertOk(result: Result) {
  if (result.error) throw fromPostgrest(result.error);
}

/** A write that matched nothing is a missing row or one RLS hid: never report it as saved. */
function assertWritten(result: Result) {
  assertOk(result);
  if (!Array.isArray(result.data) || !result.data.length) throw new DbError("not_found");
}

function rowId(id: unknown): string {
  if (typeof id !== "string" || !isUuid(id)) throw new DbError("invalid_input", "id");
  return id;
}

/**
 * Everything an owner can do to their own farm. Takes the owner's session client, so RLS and
 * the column grants apply to every call; the farm filter below only keeps queries precise.
 */
export function createOwnerRepository(client: SupabaseClient, ownerId: string) {
  let farmId: string | null = null;

  async function currentFarmId() {
    if (farmId) return farmId;
    const { data, error } = await client.from("farms").select("id").eq("owner_id", ownerId).maybeSingle();
    if (error) throw fromPostgrest(error);
    if (!data) throw new DbError("not_found");
    farmId = data.id as string;
    return farmId;
  }

  async function updateRow(table: string, id: unknown, values: Record<string, unknown>) {
    const row = rowId(id);
    const farm = await currentFarmId();
    assertWritten(await client.from(table).update(values).eq("farm_id", farm).eq("id", row).select("id"));
  }

  /** With a screen id the row gets a stable id, so a save repeated after a lost reply updates, not adds. */
  async function insertRow(table: string, values: Record<string, unknown>, localId?: string) {
    const farm = await currentFarmId();
    if (localId) {
      const id = toDbId(farm, localId);
      assertOk(await client.from(table).upsert({ ...values, id, farm_id: farm }, { onConflict: "id" }));
      return id;
    }
    const result = await client.from(table).insert({ ...values, farm_id: farm }).select("id").single();
    assertOk(result);
    return (result.data as { id: string }).id;
  }

  async function deleteRow(table: string, id: unknown) {
    const row = rowId(id);
    const farm = await currentFarmId();
    assertWritten(await client.from(table).delete().eq("farm_id", farm).eq("id", row).select("id"));
  }

  return {
    /**
     * First sign-in. Safe to repeat after a failure: every step skips what exists, and the
     * worker row goes last, so it marks a finished setup. Plan stays Basic until billing or the
     * service changes it; owners cannot grant themselves a plan.
     */
    async ensureFarm(): Promise<string> {
      assertOk(await client.from("farms").upsert({ owner_id: ownerId }, { onConflict: "owner_id", ignoreDuplicates: true }));
      const farm = await currentFarmId();
      const worker = await client.from("workers").select("farm_id").eq("farm_id", farm).maybeSingle();
      assertOk(worker);
      if (worker.data) return farm;

      const defaults = createEmptyWorkspace("basic");
      const once = { ignoreDuplicates: true };
      assertOk(await client.from("resources").upsert(
        defaults.resources.map((r) => ({ farm_id: farm, kind: r.kind, present: r.present })),
        { ...once, onConflict: "farm_id,kind" },
      ));
      // Ids come from the kind, not from uid(), so a repeated setup cannot add a second copy.
      assertOk(await client.from("criteria").upsert(
        defaults.settings.criteria.map((c) => ({ id: toDbId(farm, `default:${c.kind}`), farm_id: farm, kind: c.kind, label: c.label, enabled: c.enabled })),
        { ...once, onConflict: "id" },
      ));
      assertOk(await client.from("emergency_categories").upsert(
        defaults.settings.emergencies.map((e) => ({ id: toDbId(farm, `default:${e.kind}`), farm_id: farm, kind: e.kind, label: e.label })),
        { ...once, onConflict: "id" },
      ));
      assertOk(await client.from("workers").upsert({ farm_id: farm }, { ...once, onConflict: "farm_id" }));
      return farm;
    },

    async load(): Promise<LoadedFarm> {
      return requireFarm(await loadFarm(client, { owner_id: ownerId }));
    },

    /** Read models: reports, alerts and instructions are written by calls, never by owners. */
    async alerts(now: Date) {
      return farmAlerts((await this.load()).workspace, now);
    },
    async instructions() {
      return farmInstructions((await this.load()).workspace);
    },

    async saveFarmProfile(input: unknown) {
      const values = parseFarmProfile(input);
      const farm = await currentFarmId();
      assertWritten(await client.from("farms").update(values).eq("id", farm).select("id"));
    },
    async saveWorker(input: unknown) {
      const values = parseWorker(input);
      const farm = await currentFarmId();
      assertWritten(await client.from("workers").update(values).eq("farm_id", farm).select("farm_id"));
    },

    addCamel: (input: unknown, localId?: string) => insertRow("camels", parseNewCamel(input), localId),
    updateCamel: (id: unknown, input: unknown) => updateRow("camels", id, parseCamelPatch(input)),
    deleteCamel: (id: unknown) => deleteRow("camels", id),

    async saveResource(input: unknown) {
      const { kind, ...values } = parseResource(input);
      const farm = await currentFarmId();
      assertWritten(await client.from("resources").update(values).eq("farm_id", farm).eq("kind", kind).select("kind"));
    },

    addCustomQuestion: (text: unknown, localId?: string) => insertRow("custom_questions", { text: requiredText(text, "text", 300) }, localId),
    updateCustomQuestion: (id: unknown, text: unknown) => updateRow("custom_questions", id, { text: requiredText(text, "text", 300) }),
    deleteCustomQuestion: (id: unknown) => deleteRow("custom_questions", id),

    addCriterion: (input: unknown, localId?: string) => insertRow("criteria", parseCriterion(input), localId),
    updateCriterion: (id: unknown, input: unknown) => updateRow("criteria", id, parseCriterion(input)),
    deleteCriterion: (id: unknown) => deleteRow("criteria", id),

    addEmergency: (input: unknown, localId?: string) => insertRow("emergency_categories", parseEmergency(input), localId),
    updateEmergency: (id: unknown, input: unknown) => updateRow("emergency_categories", id, parseEmergency(input)),
    deleteEmergency: (id: unknown) => deleteRow("emergency_categories", id),
  };
}

export type OwnerRepository = ReturnType<typeof createOwnerRepository>;
