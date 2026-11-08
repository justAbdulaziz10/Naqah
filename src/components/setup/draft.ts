import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import type { Locale, Plan, Workspace } from "@/domain/types";

/** Sample values for onboarding, without a prior report or demo activity. */
export function createOnboardingSample(locale: Locale, plan: Plan): Workspace {
  const sample = createDemoWorkspace(locale, plan);
  return {
    ...sample,
    setupComplete: false,
    lastUpdateAt: null,
    reports: [],
    calls: [],
    taskTickets: [],
    noAnswerTickets: [],
    pendingWorkerCalls: [],
    relays: [],
    events: [],
    clockOffsetMs: 0,
    ownerAllowanceUsedAt: null,
    missedNotificationAt: null,
    camels: sample.camels.map((camel) => ({ ...camel, updatedAt: null })),
    resources: sample.resources.map((resource) => ({
      ...resource,
      level: "unknown",
      quantity: null,
      note: null,
      certainty: "unknown",
      updatedAt: null,
    })),
  };
}

/** The parts of a workspace an owner sets up, in a form that compares across fresh copies. */
function setupFingerprint(ws: Workspace): string {
  const { owner, farm, worker, otherWorkers, herdCount, callSchedule, customQuestions, criteria, emergencies, integrations } = ws.settings;
  return JSON.stringify({
    owner,
    farm: { name: farm.name, location: farm.location, coords: farm.coords ?? null },
    worker: { name: worker.name, phone: worker.phone, language: worker.language },
    otherWorkers: (otherWorkers ?? []).map(({ name, phone, language }) => ({ name, phone, language })),
    herdCount: herdCount ?? null,
    callSchedule: callSchedule ?? null,
    questions: customQuestions.map((question) => question.text),
    criteria: criteria.map(({ kind, label, enabled }) => ({ kind, label, enabled })),
    emergencies: emergencies.map(({ kind, label }) => ({ kind, label })),
    camels: ws.camels.map(({ name, sex, ageYears, health, healthNote }) => ({ name, sex, ageYears, health, healthNote })),
    resources: ws.resources.map(({ kind, present }) => ({ kind, present })),
    supplier: { name: integrations?.supplierName ?? "", phone: integrations?.supplierPhone ?? "" },
    activity: ws.reports.length + ws.calls.length + ws.taskTickets.length + ws.noAnswerTickets.length + ws.relays.length,
  });
}

/** True when the workspace holds anything beyond a blank setup or an untouched sample, so loading a sample would lose it. */
export function hasOwnSetupData(ws: Workspace | null): boolean {
  if (!ws) return false;
  const { plan } = ws.settings;
  const untouched = [
    createEmptyWorkspace(plan),
    ...(["ar", "en"] as const).flatMap((locale) => [createDemoWorkspace(locale, plan), createOnboardingSample(locale, plan)]),
  ];
  const fingerprint = setupFingerprint(ws);
  return !untouched.some((candidate) => setupFingerprint(candidate) === fingerprint);
}
