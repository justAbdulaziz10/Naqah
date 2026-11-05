import { createDemoWorkspace } from "@/domain/seed";
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
