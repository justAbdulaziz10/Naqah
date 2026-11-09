import { PREDEFINED_QUESTIONS } from "./catalog";
import { isHerdCount } from "./herd";
import { applicableQuestions, taskTicketsEnabled } from "./rules";
import type { CustomQuestion, PredefinedQuestion, ResourceKind, Workspace } from "./types";

export type SkippedQuestion =
  | { question: PredefinedQuestion; reason: "resource"; resource: ResourceKind }
  | { question: PredefinedQuestion; reason: "herd_count" };

export interface CallQuestionPlan {
  /** NAQAH's own questions that can apply here, in catalog order. `plannedQuestions` decides what is asked and when. */
  asked: PredefinedQuestion[];
  /** NAQAH's questions this ranch won't hear, and why. */
  skipped: SkippedQuestion[];
  /** The owner's own questions. */
  custom: CustomQuestion[];
  /** Ultimate: open tasks are checked at the end of the call. */
  checksTasks: boolean;
}

/**
 * Which of NAQAH's questions this ranch can hear, and why the rest are left out. The order and
 * on/off switches are the owner's plan (`plannedQuestions`); open tasks come last on Ultimate,
 * and a hot-day water check may come first.
 */
export function callQuestionPlan(ws: Workspace): CallQuestionPlan {
  const applicable = applicableQuestions(ws);
  const applicableIds = new Set(applicable.map((question) => question.id));
  const herdKnown = isHerdCount(ws.settings.herdCount) || ws.camels.length > 0;
  const asked = applicable.filter((question) => question.id !== "herd_count" || herdKnown);
  const skipped: SkippedQuestion[] = [];
  for (const question of PREDEFINED_QUESTIONS) {
    if (question.id === "herd_count" && !herdKnown) skipped.push({ question, reason: "herd_count" });
    else if (!applicableIds.has(question.id) && question.requires) skipped.push({ question, reason: "resource", resource: question.requires });
  }
  return { asked, skipped, custom: ws.settings.customQuestions, checksTasks: taskTicketsEnabled(ws) };
}
