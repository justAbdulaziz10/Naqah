import type { WorkspaceUpdate } from "@/components/setup/types";
import { PREDEFINED_QUESTIONS } from "@/domain/catalog";
import { uid } from "@/domain/id";
import { canAddCustomQuestion } from "@/domain/rules";
import type { CriterionKind, EmergencyKind } from "@/domain/types";

export const ranchSample: WorkspaceUpdate = (current) => ({
  ...current,
  settings: {
    ...current.settings,
    farm: { ...current.settings.farm, name: "عزبة الوسم" },
    owner: { ...current.settings.owner, name: "فهد العتيبي" },
  },
});

export const teamSample: WorkspaceUpdate = (current) => ({
  ...current,
  settings: {
    ...current.settings,
    worker: { ...current.settings.worker, name: "محمد", language: "ar" },
    herdCount: 20,
  },
});

export const callSample: WorkspaceUpdate = (current) => ({
  ...current,
  settings: {
    ...current.settings,
    callSchedule: { day: current.settings.plan === "basic" ? 4 : null, time: "17:00" },
    ownerCallSchedule: { day: current.settings.plan === "basic" ? 4 : null, time: "18:00" },
  },
});

export function questionsSample(): WorkspaceUpdate {
  const id = uid("cq");
  const createdAt = new Date().toISOString();
  const text = "فيه شي ثاني تبي تبلغ عنه؟";
  return (current) => {
    const existing = current.settings.customQuestions.find((question) => question.text === text);
    const sample = existing ?? (canAddCustomQuestion(current) ? { id, text, createdAt } : null);
    const customQuestions = sample && !existing ? [...current.settings.customQuestions, sample] : current.settings.customQuestions;
    const topics = ["herd_health", "feed_level", "water_level", "fences_condition"];
    return {
      ...current,
      settings: {
        ...current.settings,
        reportMode: "guided",
        customQuestions,
        questionPlan: [
          ...topics.map((topic) => ({ id: topic, enabled: true, required: true })),
          ...(sample ? [{ id: sample.id, enabled: true, required: true }] : []),
          ...PREDEFINED_QUESTIONS.filter((question) => !topics.includes(question.id)).map((question) => ({ id: question.id, enabled: false, required: true })),
          ...customQuestions.filter((question) => question.id !== sample?.id).map((question) => ({ id: question.id, enabled: false, required: true })),
        ],
      },
    };
  };
}

export const resourcesSample: WorkspaceUpdate = (current) => ({
  ...current,
  resources: current.resources.map((resource) => ({ ...resource, present: ["feed", "water", "fences"].includes(resource.kind) })),
});

export function criteriaSample(): WorkspaceUpdate {
  const kinds: CriterionKind[] = ["sick_camel", "low_feed", "low_water", "fence_damage"];
  const samples = kinds.map((kind) => ({ id: uid("crt"), kind, label: null, enabled: true }));
  return (current) => ({
    ...current,
    settings: {
      ...current.settings,
      criteria: [
        ...current.settings.criteria.map((criterion) => ({ ...criterion, enabled: kinds.includes(criterion.kind) })),
        ...samples.filter((sample) => !current.settings.criteria.some((criterion) => criterion.kind === sample.kind)),
      ],
    },
  });
}

export function emergenciesSample(): WorkspaceUpdate {
  const kinds: EmergencyKind[] = ["injury", "missing_camel", "fire"];
  const samples = kinds.map((kind) => ({ id: uid("emg"), kind, label: null }));
  return (current) => ({
    ...current,
    settings: {
      ...current.settings,
      emergencies: [
        ...current.settings.emergencies.filter((emergency) => kinds.includes(emergency.kind)),
        ...samples.filter((sample) => !current.settings.emergencies.some((emergency) => emergency.kind === sample.kind)),
      ],
    },
  });
}

export const connectionsSample: WorkspaceUpdate = (current) => ({
  ...current,
  settings: { ...current.settings, integrations: { ...current.settings.integrations, supplierName: "مورد العلف (تجريبي)" } },
});
