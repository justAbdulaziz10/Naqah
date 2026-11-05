import { createDemoWorkspace, createEmptyWorkspace } from "@/domain/seed";
import type { Locale, Plan, Workspace } from "@/domain/types";

const REPLACEMENT_DRAFT_KEY = "naqah-onboarding-replacement-v1";
const DRAFT_CHANGE_EVENT = "naqah-onboarding-draft-change";

let cachedDraft: { sourceCreatedAt: string; raw: string | null; draft: Workspace | null } | null = null;

/** A separate browser draft protects a completed workspace until confirmation. */
export function readReplacementDraft(sourceCreatedAt: string | undefined): Workspace | null {
  if (!sourceCreatedAt || typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(REPLACEMENT_DRAFT_KEY);
  } catch {
    return null;
  }
  if (cachedDraft?.sourceCreatedAt === sourceCreatedAt && cachedDraft.raw === raw) return cachedDraft.draft;
  let draft: Workspace | null = null;
  if (raw) {
    try {
      const stored = JSON.parse(raw) as { sourceCreatedAt?: string; draft?: Workspace };
      if (stored.sourceCreatedAt === sourceCreatedAt && stored.draft?.settings && !stored.draft.setupComplete) draft = stored.draft;
    } catch {
      draft = null;
    }
  }
  cachedDraft = { sourceCreatedAt, raw, draft };
  return draft;
}

export function subscribeReplacementDraft(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  const refresh = () => {
    cachedDraft = null;
    onChange();
  };
  window.addEventListener("storage", refresh);
  window.addEventListener(DRAFT_CHANGE_EVENT, refresh);
  return () => {
    window.removeEventListener("storage", refresh);
    window.removeEventListener(DRAFT_CHANGE_EVENT, refresh);
  };
}

export function saveReplacementDraft(sourceCreatedAt: string, draft: Workspace): boolean {
  try {
    window.localStorage.setItem(REPLACEMENT_DRAFT_KEY, JSON.stringify({ sourceCreatedAt, draft }));
    cachedDraft = null;
    window.dispatchEvent(new Event(DRAFT_CHANGE_EVENT));
    return true;
  } catch {
    return false;
  }
}

export function clearReplacementDraft(): void {
  try {
    window.localStorage.removeItem(REPLACEMENT_DRAFT_KEY);
  } catch {
    // Reset the in-memory snapshot even if browser storage is unavailable.
  }
  cachedDraft = null;
  window.dispatchEvent(new Event(DRAFT_CHANGE_EVENT));
}

/** Starts over from the current plan and settings, so nothing changes unless the owner changes it. Stock readings belong to the history and do not carry over. */
export function createReplacementDraft(ws: Workspace): Workspace {
  return {
    ...createEmptyWorkspace(ws.settings.plan),
    settings: ws.settings,
    camels: ws.camels,
    resources: ws.resources.map((resource) => ({
      ...resource,
      level: "unknown",
      quantity: null,
      note: null,
      certainty: "unknown",
      updatedAt: null,
    })),
  };
}

/** What confirming a replacement clears, for the owner to read before agreeing. */
export function replacementLoss(ws: Workspace) {
  return {
    reports: ws.reports.length,
    calls: ws.calls.length,
    tickets: ws.taskTickets.length + ws.noAnswerTickets.length,
  };
}

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
  const { owner, farm, worker, window, customQuestions, criteria, emergencies, integrations } = ws.settings;
  return JSON.stringify({
    owner,
    farm: { name: farm.name, location: farm.location, coords: farm.coords ?? null },
    worker,
    window,
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
