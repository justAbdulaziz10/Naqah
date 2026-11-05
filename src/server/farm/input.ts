import { RESOURCE_KINDS } from "@/domain/catalog";
import type { Camel, Certainty, CriterionKind, EmergencyKind, HealthStatus, Level, ResourceKind, WorkerLanguage } from "@/domain/types";
import { normalizeSaudiPhone } from "@/lib/supabase/auth-input";
import { DbError } from "@/server/db/errors";

const invalid = (field: string) => new DbError("invalid_input", field);
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const E164 = /^\+[1-9]\d{7,14}$/;

const LEVELS: readonly Level[] = ["good", "medium", "low", "critical", "unknown"];
const CERTAINTIES: readonly Certainty[] = ["reported", "approximate", "unknown", "verified"];
const HEALTH: readonly HealthStatus[] = ["healthy", "watch", "sick", "unknown"];
const LANGUAGES: readonly WorkerLanguage[] = ["ar", "en", "ur", "hi", "bn", "fil"];
const CRITERIA: readonly CriterionKind[] = ["sick_camel", "low_feed", "low_water", "fence_damage", "missing_camel", "medicine_low", "custom"];
const EMERGENCIES: readonly EmergencyKind[] = ["injury", "missing_camel", "fire", "predator", "theft", "death", "custom"];

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("body");
  return value as Record<string, unknown>;
}

export function text(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.length > max) throw invalid(field);
  return value.trim();
}

export function requiredText(value: unknown, field: string, max = 200): string {
  const result = text(value, field, max);
  if (!result) throw invalid(field);
  return result;
}

function optionalText(value: unknown, field: string, max = 500): string | null {
  if (value === null || value === undefined) return null;
  return text(value, field, max) || null;
}

export function oneOf<T>(value: unknown, options: readonly T[], field: string): T {
  if (!options.includes(value as T)) throw invalid(field);
  return value as T;
}

/** Saudi formats become E.164; other E.164 numbers pass through. Null when it is neither. */
export function normalizePhone(value: string): string | null {
  const saudi = normalizeSaudiPhone(value);
  if (saudi) return saudi;
  const compact = value.replace(/[\s()-]/g, "");
  return E164.test(compact) ? compact : null;
}

function phone(value: unknown, field: string): string {
  const raw = text(value ?? "", field, 32);
  if (!raw) return "";
  const result = normalizePhone(raw);
  if (!result) throw invalid(field);
  return result;
}

function coordinate(value: unknown, limit: number, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > limit) throw invalid(field);
  return value;
}

function window(value: unknown) {
  if (value === null || value === undefined) return { window_day: null, window_start: null, window_end: null };
  const input = record(value);
  if (!Number.isInteger(input.day) || (input.day as number) < 0 || (input.day as number) > 6) throw invalid("window.day");
  const time = (raw: unknown, field: string) => {
    if (raw === "" || raw === null || raw === undefined) return null;
    if (typeof raw !== "string" || !TIME.test(raw)) throw invalid(field);
    return raw;
  };
  const start = time(input.start, "window.start");
  const end = time(input.end, "window.end");
  if (start && end && end <= start) throw invalid("window.end");
  return { window_day: input.day as number, window_start: start, window_end: end };
}

/** Only the keys sent are written, so a partial save can never blank a field. */
const given = (input: Record<string, unknown>, key: string) => input[key] !== undefined;

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw invalid(field);
  return value;
}

/** Every farm column an owner may write (see the column grants in 0001). Plan is not one of them. */
export function parseFarmProfile(value: unknown) {
  const input = record(value);
  const coords = input.coords === null ? null : input.coords === undefined ? undefined : record(input.coords);
  return {
    ...(given(input, "ownerName") && { owner_name: text(input.ownerName, "ownerName") }),
    ...(given(input, "ownerPhone") && { owner_phone: phone(input.ownerPhone, "ownerPhone") }),
    ...(given(input, "name") && { name: text(input.name, "name") }),
    ...(given(input, "location") && { location: text(input.location, "location") }),
    ...(coords !== undefined && {
      latitude: coords ? coordinate(coords.lat, 90, "coords.lat") : null,
      longitude: coords ? coordinate(coords.lon, 180, "coords.lon") : null,
    }),
    ...(given(input, "supplierName") && { supplier_name: text(input.supplierName, "supplierName") }),
    ...(given(input, "supplierPhone") && { supplier_phone: phone(input.supplierPhone, "supplierPhone") }),
    ...(given(input, "window") && window(input.window)),
    ...(given(input, "setupComplete") && { setup_complete: bool(input.setupComplete, "setupComplete") }),
  };
}

export function parseWorker(value: unknown) {
  const input = record(value);
  return {
    ...(given(input, "name") && { name: text(input.name, "name") }),
    ...(given(input, "phone") && { phone: phone(input.phone, "phone") }),
    ...(given(input, "language") && { language: oneOf(input.language, LANGUAGES, "language") }),
  };
}

function parseAge(value: unknown) {
  if (value !== null && (!Number.isInteger(value) || (value as number) < 0 || (value as number) > 60)) throw invalid("ageYears");
  return value as number | null;
}

/** The edit form no longer asks for a tag, so a missing tag must keep the stored one. */
export function parseCamelPatch(value: unknown) {
  const input = record(value);
  return {
    ...(given(input, "name") && { name: requiredText(input.name, "name") }),
    ...(given(input, "tag") && { tag: text(input.tag, "tag", 40) }),
    ...(given(input, "sex") && { sex: oneOf<Camel["sex"]>(input.sex, ["female", "male"], "sex") }),
    ...(given(input, "ageYears") && { age_years: parseAge(input.ageYears) }),
    ...(given(input, "health") && { health: oneOf(input.health, HEALTH, "health") }),
    ...(given(input, "healthNote") && { health_note: optionalText(input.healthNote, "healthNote") }),
  };
}

export function parseNewCamel(value: unknown) {
  const input = record(value);
  return { ...parseCamelPatch(input), name: requiredText(input.name, "name") };
}

export function parseResource(value: unknown) {
  const input = record(value);
  return {
    kind: oneOf<ResourceKind>(input.kind, RESOURCE_KINDS, "kind"),
    ...(given(input, "present") && { present: bool(input.present, "present") }),
    ...(given(input, "level") && { level: oneOf(input.level, LEVELS, "level") }),
    ...(given(input, "quantity") && { quantity: optionalText(input.quantity, "quantity", 120) }),
    ...(given(input, "note") && { note: optionalText(input.note, "note") }),
    ...(given(input, "certainty") && { certainty: oneOf(input.certainty, CERTAINTIES, "certainty") }),
  };
}

export function parseCriterion(value: unknown) {
  const input = record(value);
  const kind = oneOf(input.kind, CRITERIA, "kind");
  return {
    kind,
    label: kind === "custom" ? requiredText(input.label, "label") : null,
    ...(given(input, "enabled") && { enabled: bool(input.enabled, "enabled") }),
  };
}

export function parseEmergency(value: unknown) {
  const input = record(value);
  const kind = oneOf(input.kind, EMERGENCIES, "kind");
  return { kind, label: kind === "custom" ? requiredText(input.label, "label") : null };
}
