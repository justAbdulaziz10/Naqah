import { PREDEFINED_QUESTIONS } from "./catalog";
import { isHerdCount } from "./herd";
import { applicableQuestions, taskTicketsEnabled } from "./rules";
import type { CustomQuestion, PredefinedQuestion, ResourceKind, Workspace } from "./types";

export type SkippedQuestion =
  | { question: PredefinedQuestion; reason: "resource"; resource: ResourceKind }
  | { question: PredefinedQuestion; reason: "herd_count" };

export interface CallQuestionPlan {
  /** NAQAH's own questions, in the order the call asks them. */
  asked: PredefinedQuestion[];
  /** NAQAH's questions this ranch won't hear, and why. */
  skipped: SkippedQuestion[];
  /** The owner's questions, asked after NAQAH's. */
  custom: CustomQuestion[];
  /** Ultimate: open tasks are checked at the end of the call. */
  checksTasks: boolean;
}

/**
 * What the next report call asks, for the owner to read. Mirrors the report queue in
 * `conversation/engine.ts`: applicable questions (the herd check only with a known herd size),
 * then the owner's questions, then open tasks on Ultimate. A hot-day water check may come first.
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
