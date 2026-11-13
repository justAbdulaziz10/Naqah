/**
 * What an owner edit means for the database. Screens keep editing one `Workspace` through
 * `update(fn)`; in account mode this turns the difference from the last server copy into owner
 * actions. Only fields owners may write appear here, so a simulated report or ticket can never
 * reach a real farm: anything else in the document is ignored and replaced on the next load.
 */
import type { Workspace } from "@/domain/types";
import { normalizePhone } from "@/server/farm/input";

type Input = Record<string, unknown>;
export type ListKind = "camel" | "question" | "criterion" | "emergency";

export type OwnerChange =
  | { kind: "profile" | "worker" | "resource"; input: Input }
  | { kind: ListKind; action: "add"; localId: string; input: Input }
  | { kind: ListKind; action: "update"; id: string; input: Input }
  | { kind: ListKind; action: "delete"; id: string };

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const trimmed = (value: string | undefined) => (value ?? "").trim();

/** Only fields that differ, so an edit never overwrites what a call just changed. */
function changed<T extends object>(base: T, next: T, keys: (keyof T & string)[]): Input {
  return Object.fromEntries(keys.filter((key) => !same(base[key], next[key])).map((key) => [key, next[key]]));
}

/** A half-typed number stays on the screen, which flags it, and is not sent until it is whole. */
function phoneChange(field: string, base: string | undefined, next: string | undefined): Input {
  const value = trimmed(next);
  if (!value) return trimmed(base) ? { [field]: "" } : {};
  const phone = normalizePhone(value);
  return phone && phone !== trimmed(base) ? { [field]: phone } : {};
}

function textChange(field: string, base: string | undefined, next: string | undefined): Input {
  return trimmed(base) === trimmed(next) ? {} : { [field]: trimmed(next) };
}

function windowChange(base: Workspace, next: Workspace): Input {
  const value = next.settings.window;
  if (same(base.settings.window, value)) return {};
  if (value?.start && value.end && value.end <= value.start) return {};
  return { window: value };
}

function coordsChange(base: Workspace, next: Workspace): Input {
  return same(base.settings.farm.coords, next.settings.farm.coords) ? {} : { coords: next.settings.farm.coords };
}

function listChanges<T extends { id: string }>(
  kind: ListKind,
  base: T[],
  next: T[],
  toInput: (item: T) => Input,
  ready: (item: T) => boolean,
  diff: (before: T, after: T) => Input,
): OwnerChange[] {
  const before = new Map(base.map((item) => [item.id, item]));
  const after = new Set(next.map((item) => item.id));
  const changes: OwnerChange[] = base.filter((item) => !after.has(item.id)).map((item) => ({ kind, action: "delete", id: item.id }));
  for (const item of next) {
    const old = before.get(item.id);
    if (!old) {
      if (ready(item)) changes.push({ kind, action: "add", localId: item.id, input: toInput(item) });
      continue;
    }
    const input = ready(item) ? diff(old, item) : {};
    if (Object.keys(input).length) changes.push({ kind, action: "update", id: item.id, input });
  }
  return changes;
}

const CAMEL_FIELDS = ["name", "tag", "sex", "ageYears", "health", "healthNote", "certainty", "updatedAt"] as const;
const RESOURCE_FIELDS = ["present", "level", "quantity", "note", "certainty", "updatedAt"] as const;

export function ownerChanges(base: Workspace, next: Workspace): OwnerChange[] {
  const { settings: from } = base;
  const { settings: to } = next;
  const profile = {
    ...textChange("ownerName", from.owner.name, to.owner.name),
    ...phoneChange("ownerPhone", from.owner.phone, to.owner.phone),
    ...textChange("name", from.farm.name, to.farm.name),
    ...textChange("location", from.farm.location, to.farm.location),
    ...coordsChange(base, next),
    ...textChange("supplierName", from.integrations?.supplierName, to.integrations?.supplierName),
    ...phoneChange("supplierPhone", from.integrations?.supplierPhone, to.integrations?.supplierPhone),
    ...windowChange(base, next),
  };
  const worker = {
    ...textChange("name", from.worker.name, to.worker.name),
    ...phoneChange("phone", from.worker.phone, to.worker.phone),
    ...(from.worker.language === to.worker.language ? {} : { language: to.worker.language }),
  };

  const changes: OwnerChange[] = [];
  if (Object.keys(profile).length) changes.push({ kind: "profile", input: profile });
  if (Object.keys(worker).length) changes.push({ kind: "worker", input: worker });
  for (const resource of next.resources) {
    const old = base.resources.find((item) => item.kind === resource.kind);
    if (!old) continue;
    const input = changed(old, resource, [...RESOURCE_FIELDS]);
    if (Object.keys(input).length) changes.push({ kind: "resource", input: { kind: resource.kind, ...input } });
  }
  changes.push(
    ...listChanges("camel", base.camels, next.camels,
      (camel) => Object.fromEntries(CAMEL_FIELDS.map((key) => [key, camel[key]])),
      (camel) => Boolean(trimmed(camel.name)),
      (old, camel) => changed(old, camel, [...CAMEL_FIELDS])),
    ...listChanges("question", from.customQuestions, to.customQuestions,
      (question) => ({ text: question.text }),
      (question) => Boolean(trimmed(question.text)),
      (old, question) => textChange("text", old.text, question.text)),
    ...listChanges("criterion", from.criteria, to.criteria,
      ({ kind, label, enabled }) => ({ kind, label, enabled }),
      (criterion) => criterion.kind !== "custom" || Boolean(trimmed(criterion.label ?? "")),
      (old, criterion) => (same(old, criterion) ? {} : { kind: criterion.kind, label: criterion.label, enabled: criterion.enabled })),
    ...listChanges("emergency", from.emergencies, to.emergencies,
      ({ kind, label }) => ({ kind, label }),
      (emergency) => emergency.kind !== "custom" || Boolean(trimmed(emergency.label ?? "")),
      (old, emergency) => (same(old, emergency) ? {} : { kind: emergency.kind, label: emergency.label })),
  );
  // Last, so a farm is only marked ready once everything before it has been sent.
  if (base.setupComplete !== next.setupComplete) changes.push({ kind: "profile", input: { setupComplete: next.setupComplete } });
  return changes;
}

/** Field by field: what the owner changed since `before` stays, everything else comes from `fresh`. */
function mergeRow<T extends object>(before: T | undefined, local: T, fresh: T): T {
  if (!before) return local;
  const merged = { ...fresh };
  for (const key of Object.keys(local) as (keyof T)[]) {
    if (!same(before[key], local[key])) merged[key] = local[key];
  }
  return merged;
}

function mergeList<T extends object>(before: T[], local: T[], fresh: T[], key: (item: T) => string): T[] {
  const old = new Map(before.map((item) => [key(item), item]));
  const mine = new Map(local.map((item) => [key(item), item]));
  const stored = new Set(fresh.map(key));
  return [
    ...fresh.filter((item) => mine.has(key(item)) || !old.has(key(item))) // Removed here: stays removed until the delete lands.
      .map((item) => {
        const own = mine.get(key(item));
        return own ? mergeRow(old.get(key(item)), own, item) : item;
      }),
    ...local.filter((item) => !stored.has(key(item)) && !old.has(key(item))), // Added here, not saved yet.
  ];
}

/**
 * Takes a newer server copy without losing edits still on their way, and without letting an old
 * screen count as an edit: a report that landed meanwhile keeps its values.
 */
export function mergeEdits(before: Workspace, local: Workspace, fresh: Workspace): Workspace {
  const byId = (item: { id: string }) => item.id;
  const scalars = <T extends object>(pick: (ws: Workspace) => T) => mergeRow(pick(before), pick(local), pick(fresh));
  return {
    ...fresh,
    weather: local.weather,
    setupComplete: before.setupComplete === local.setupComplete ? fresh.setupComplete : local.setupComplete,
    camels: mergeList(before.camels, local.camels, fresh.camels, byId),
    resources: mergeList(before.resources, local.resources, fresh.resources, (item) => item.kind),
    settings: {
      ...fresh.settings,
      owner: scalars((ws) => ws.settings.owner),
      farm: scalars((ws) => ws.settings.farm),
      worker: scalars((ws) => ws.settings.worker),
      window: same(before.settings.window, local.settings.window) ? fresh.settings.window : local.settings.window,
      integrations: same(before.settings.integrations, local.settings.integrations) ? fresh.settings.integrations : local.settings.integrations,
      customQuestions: mergeList(before.settings.customQuestions, local.settings.customQuestions, fresh.settings.customQuestions, byId),
      criteria: mergeList(before.settings.criteria, local.settings.criteria, fresh.settings.criteria, byId),
      emergencies: mergeList(before.settings.emergencies, local.settings.emergencies, fresh.settings.emergencies, byId),
    },
  };
}

/** A row added on this screen gets its real id from the server; later edits must use that id. */
export function withServerIds(ws: Workspace, created: Record<string, string>): Workspace {
  const remap = <T extends { id: string }>(list: T[]) => list.map((item) => (created[item.id] ? { ...item, id: created[item.id] } : item));
  return {
    ...ws,
    camels: remap(ws.camels),
    settings: {
      ...ws.settings,
      customQuestions: remap(ws.settings.customQuestions),
      criteria: remap(ws.settings.criteria),
      emergencies: remap(ws.settings.emergencies),
    },
  };
}
