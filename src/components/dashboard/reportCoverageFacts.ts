import { PREDEFINED_QUESTIONS, RESOURCE_LABELS } from "@/domain/catalog";
import type { FarmReport, LocalizedText, Workspace } from "@/domain/types";

export function reportResources(ws: Workspace, report: FarmReport) {
  return ws.resources.filter((resource) => {
    const question = PREDEFINED_QUESTIONS.find((item) => item.requires === resource.kind);
    const coverage = report.coverage?.find((entry) => entry.questionId === question?.id);
    return resource.present && resource.updatedAt !== null &&
      Date.parse(resource.updatedAt) === Date.parse(report.at) && coverage?.status !== "not_reported";
  });
}

export function unreportedTopics(ws: Workspace, report: FarmReport, labels: { health: LocalizedText; count: LocalizedText; other: LocalizedText }): LocalizedText[] {
  return (report.coverage ?? []).filter((entry) => entry.status === "not_reported").map((entry) => {
    if (entry.questionId === "herd_health") return labels.health;
    if (entry.questionId === "herd_count") return labels.count;
    const predefined = PREDEFINED_QUESTIONS.find((question) => question.id === entry.questionId);
    if (predefined?.requires) return RESOURCE_LABELS[predefined.requires];
    const custom = ws.settings.customQuestions.find((question) => question.id === entry.questionId);
    return custom ? { ar: custom.text, en: custom.text } : labels.other;
  });
}

/** Some of the report is not known: an answer was «I don't know», or a question went unmentioned. Never "all is well". */
export function reportIsPartial(report: FarmReport): boolean {
  return report.answers.some((entry) => entry.certainty === "unknown") || (report.coverage ?? []).some((entry) => entry.status !== "reported");
}
