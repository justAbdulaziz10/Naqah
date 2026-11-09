/**
 * What an owner edit means for the database. Screens keep editing one `Workspace` through
 * `update(fn)`; in account mode this turns the difference from the last server copy into owner
 * actions. Only fields owners may write appear here, so a simulated report or ticket can never
 * reach a real farm: anything else in the document is ignored and replaced on the next load.
 */
import { nowFor } from "@/domain/clock";
import { reportModeOf, reportPlanHasContent } from "@/domain/rules";
import type { Settings, Worker, Workspace } from "@/domain/types";
import { normalizePhone } from "@/server/farm/input";

type Input = Record<string, unknown>;
export type ListKind = "camel" | "question" | "criterion" | "emergency" | "worker";

export type OwnerChange =
  | { kind: "profile" | "resource"; input: Input }
  /** Older clients: edits the primary worker. */
  | { kind: "worker"; input: Input }
  /** NAQAH calls this worker for the report. A screen id of a worker added in the same save is fine. */
  | { kind: "primaryWorker"; id: string }
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

function ownerCallScheduleChange(base: Workspace, next: Workspace): Input {
  const value = next.settings.ownerCallSchedule ?? null;
  if (same(base.settings.ownerCallSchedule ?? null, value)) return {};
  if (value?.time && !timeShape.test(value.time)) return {};
  return { ownerCallSchedule: value };
}

function callScheduleChange(base: Workspace, next: Workspace): Input {
  const value = next.settings.callSchedule ?? null;
  if (same(base.settings.callSchedule ?? null, value)) return {};
  if (value && value.time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time)) return {}; // Still typing.
  return { callSchedule: value };
}

function herdChange(base: Workspace, next: Workspace): Input {
  const from = base.settings;
  const to = next.settings;
  const count = to.herdCount ?? null;
  return {
    ...(same(from.herdCount ?? null, count) || (count !== null && (!Number.isInteger(count) || count < 0 || count > 100_000)) ? {} : { herdCount: count }),
    ...(same(from.herdCountReviewedAt ?? null, to.herdCountReviewedAt ?? null) ? {} : { herdCountReviewedAt: to.herdCountReviewedAt ?? null }),
  };
}

const plansMatch = (base: Workspace, next: Workspace) => same(base.settings.questionPlan ?? [], next.settings.questionPlan ?? []);
const hasContent = (ws: Workspace) => reportPlanHasContent(ws, nowFor(ws));

/** A plan that leaves the call with nothing to ask stays on the screen, flagged, and is not sent. */
function reportPlanChange(base: Workspace, next: Workspace): Input {
  const mode = reportModeOf(next);
  return {
    ...(reportModeOf(base) === mode ? {} : { reportMode: mode }),
    ...(plansMatch(base, next) || !hasContent(next) ? {} : { questionPlan: next.settings.questionPlan ?? [] }),
  };
}

/** Primary first. Every account worker has an id (from the server, or a screen id until saved). */
const workerList = (settings: Pick<Settings, "worker" | "otherWorkers">) =>
  [settings.worker, ...(settings.otherWorkers ?? [])].filter((w): w is Worker & { id: string } => Boolean(w.id));

function workerDiff(old: Worker, worker: Worker): Input {
  return {
    ...textChange("name", old.name, worker.name),
    ...phoneChange("phone", old.phone, worker.phone),
    ...(old.language === worker.language ? {} : { language: worker.language }),
  };
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

/** The ranch name is required: a cleared name stays on the screen, flagged, and the stored one is kept. */
function farmNameChange(base: string | undefined, next: string | undefined): Input {
  return trimmed(next) ? textChange("name", base, next) : {};
}

const timeShape = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Edits on the screen that differ from the server but can't be sent yet: a half-typed mobile, a
 * cleared ranch name, a partly chosen call time, a herd count that isn't a whole number or a
 * question plan with nothing to ask. They
 * are what keeps a section from being "saved" and what a sign-out must not silently drop.
 */
export function unsentDrafts(base: Workspace, next: Workspace): string[] {
  const { settings: from } = base;
  const { settings: to } = next;
  const drafts: string[] = [];
  const phone = (field: string, before: string | undefined, after: string | undefined) => {
    const value = trimmed(after);
    if (value && value !== trimmed(before) && !normalizePhone(value)) drafts.push(field);
  };
  phone("ownerPhone", from.owner.phone, to.owner.phone);
  phone("supplierPhone", from.integrations?.supplierPhone, to.integrations?.supplierPhone);
  const workers = new Map(workerList(from).map((worker) => [worker.id, worker]));
  for (const worker of workerList(to)) phone(`worker:${worker.id}`, workers.get(worker.id)?.phone, worker.phone);
  if (!trimmed(to.farm.name) && trimmed(from.farm.name)) drafts.push("farmName");
  const schedule = to.callSchedule ?? null;
  if (!same(from.callSchedule ?? null, schedule) && schedule?.time && !timeShape.test(schedule.time)) drafts.push("callSchedule");
  const ownerSchedule = to.ownerCallSchedule ?? null;
  if (!same(from.ownerCallSchedule ?? null, ownerSchedule) && ownerSchedule?.time && !timeShape.test(ownerSchedule.time)) drafts.push("ownerCallSchedule");
  const count = to.herdCount ?? null;
  if (!same(from.herdCount ?? null, count) && count !== null && (!Number.isInteger(count) || count < 0 || count > 100_000)) drafts.push("herdCount");
  // A farm already saved this way stays quiet until the owner touches it.
  if (!hasContent(next) && (!plansMatch(base, next) || hasContent(base))) drafts.push("questionPlan");
  return drafts;
}

export function ownerChanges(base: Workspace, next: Workspace): OwnerChange[] {
  const { settings: from } = base;
  const { settings: to } = next;
  const profile = {
    ...textChange("ownerName", from.owner.name, to.owner.name),
    ...phoneChange("ownerPhone", from.owner.phone, to.owner.phone),
    ...farmNameChange(from.farm.name, to.farm.name),
    ...textChange("location", from.farm.location, to.farm.location),
    ...coordsChange(base, next),
    ...textChange("supplierName", from.integrations?.supplierName, to.integrations?.supplierName),
    ...phoneChange("supplierPhone", from.integrations?.supplierPhone, to.integrations?.supplierPhone),
    ...windowChange(base, next),
    ...callScheduleChange(base, next),
    ...ownerCallScheduleChange(base, next),
    ...herdChange(base, next),
  };

  const changes: OwnerChange[] = [];
  if (Object.keys(profile).length) changes.push({ kind: "profile", input: profile });
  // Removals first, so swapping a worker at the plan limit frees the place before the new one.
  changes.push(
    ...listChanges("worker", workerList(from), workerList(to),
      (worker) => ({ name: trimmed(worker.name), phone: normalizePhone(trimmed(worker.phone)) ?? "", language: worker.language }),
      (worker) => Boolean(trimmed(worker.name) || normalizePhone(trimmed(worker.phone))),
      workerDiff),
  );
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
  // After the workers, so a worker added in this save exists before it becomes the primary.
  const primary = to.worker.id;
  if (primary && primary !== from.worker.id && workerList(to).some((w) => w.id === primary)) {
    const ready = Boolean(trimmed(to.worker.name) || normalizePhone(trimmed(to.worker.phone))) || workerList(from).some((w) => w.id === primary);
    if (ready) changes.push({ kind: "primaryWorker", id: primary });
  }
  // After the questions, so the plan is checked against the questions this save leaves in place.
  const reportPlan = reportPlanChange(base, next);
  if (Object.keys(reportPlan).length) changes.push({ kind: "profile", input: reportPlan });
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

/** Workers merge as a list; the primary is the owner's pick if they changed it here, else the server's. */
function mergeWorkers(before: Settings, local: Settings, fresh: Settings): Pick<Settings, "worker" | "otherWorkers"> {
  const merged = mergeList(workerList(before), workerList(local), workerList(fresh), (w) => w.id);
  const primaryId = before.worker.id === local.worker.id ? fresh.worker.id : local.worker.id;
  const worker = merged.find((w) => w.id === primaryId) ?? merged[0] ?? fresh.worker;
  return { worker, otherWorkers: merged.filter((w) => w !== worker) };
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
      ...mergeWorkers(before.settings, local.settings, fresh.settings),
      callSchedule: same(before.settings.callSchedule, local.settings.callSchedule) ? fresh.settings.callSchedule : local.settings.callSchedule,
      ownerCallSchedule: same(before.settings.ownerCallSchedule, local.settings.ownerCallSchedule) ? fresh.settings.ownerCallSchedule : local.settings.ownerCallSchedule,
      herdCount: same(before.settings.herdCount, local.settings.herdCount) ? fresh.settings.herdCount : local.settings.herdCount,
      herdCountReviewedAt: same(before.settings.herdCountReviewedAt, local.settings.herdCountReviewedAt)
        ? fresh.settings.herdCountReviewedAt : local.settings.herdCountReviewedAt,
      window: same(before.settings.window, local.settings.window) ? fresh.settings.window : local.settings.window,
      integrations: same(before.settings.integrations, local.settings.integrations) ? fresh.settings.integrations : local.settings.integrations,
      customQuestions: mergeList(before.settings.customQuestions, local.settings.customQuestions, fresh.settings.customQuestions, byId),
      reportMode: reportModeOf(before) === reportModeOf(local) ? fresh.settings.reportMode : local.settings.reportMode,
      questionPlan: plansMatch(before, local) ? fresh.settings.questionPlan : local.settings.questionPlan,
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
      worker: ws.settings.worker.id && created[ws.settings.worker.id] ? { ...ws.settings.worker, id: created[ws.settings.worker.id] } : ws.settings.worker,
      otherWorkers: ws.settings.otherWorkers && remap(ws.settings.otherWorkers as (Worker & { id: string })[]),
      customQuestions: remap(ws.settings.customQuestions),
      questionPlan: ws.settings.questionPlan && remap(ws.settings.questionPlan),
      criteria: remap(ws.settings.criteria),
      emergencies: remap(ws.settings.emergencies),
    },
  };
}
