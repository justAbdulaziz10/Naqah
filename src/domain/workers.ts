/**
 * Registered workers. `settings.worker` is the primary reporting worker (the one NAQAH calls);
 * `settings.otherWorkers` holds the rest. Basic: 3 in total. Ultimate: 10.
 */
import { PLAN_LIMITS } from "./catalog";
import { uid } from "./id";
import type { Plan, Settings, Worker } from "./types";

export const workerLimit = (plan: Plan): number => PLAN_LIMITS[plan].workers;

/** Primary first, then the others. Blank primary rows are kept so setup can fill them. */
export function allWorkers(settings: Pick<Settings, "worker" | "otherWorkers">): Worker[] {
  return [settings.worker, ...(settings.otherWorkers ?? [])];
}

export function canAddWorker(settings: Pick<Settings, "plan" | "worker" | "otherWorkers">): boolean {
  return allWorkers(settings).length < workerLimit(settings.plan);
}

export function newWorker(language: Worker["language"] = "ar"): Worker {
  return { id: uid("wkr"), name: "", phone: "", language };
}

/** Give every worker a stable id (older primary workers may lack one). */
export function withWorkerIds<T extends Pick<Settings, "worker" | "otherWorkers">>(settings: T): T {
  const ensure = (w: Worker) => (w.id ? w : { ...w, id: uid("wkr") });
  return { ...settings, worker: ensure(settings.worker), otherWorkers: (settings.otherWorkers ?? []).map(ensure) };
}

/**
 * Replace the whole list; `primaryIndex` picks who NAQAH calls. Never exceeds the plan limit:
 * extra rows are dropped, but the chosen primary is always kept.
 */
export function setWorkers<T extends Pick<Settings, "plan" | "worker" | "otherWorkers">>(
  settings: T,
  workers: Worker[],
  primaryIndex = 0,
): T {
  const list = workers.length ? workers : [newWorker()];
  const index = primaryIndex >= 0 && primaryIndex < list.length ? primaryIndex : 0;
  const primary = list[index];
  const others = list.filter((_, i) => i !== index).slice(0, workerLimit(settings.plan) - 1);
  return { ...settings, worker: primary, otherWorkers: others };
}

/** Workers beyond the plan limit (e.g. after Ultimate → Basic). They are kept but flagged. */
export function workersOverLimit(settings: Pick<Settings, "plan" | "worker" | "otherWorkers">): number {
  return Math.max(0, allWorkers(settings).length - workerLimit(settings.plan));
}
