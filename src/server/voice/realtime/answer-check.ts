/**
 * The worker's own words, checked against the answer the model chose. Shared by real calls and the
 * Voice Lab, so neither can record what the worker didn't say.
 */
import { isOffTopicAnswer } from "@/domain/conversation/answer-topic";
import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { mapSpeechToInput, normalizeSpeech } from "../speech";

export type AnswerRefusal = "answer_off_topic" | "answer_unclear";

export const ANSWER_REFUSAL_MESSAGE =
  "Nothing was recorded. The worker's words did not answer this question. Do not repeat what they said as an answer. Gently ask the current question again, then wait.";

function isHerdHealthYes(session: CallSession, input: AnswerInput): boolean {
  if (session.step !== "report_question" || input.value !== "yes") return false;
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  return item?.kind === "predefined" && item.answerKind === "herd-health";
}

/**
 * Null lets the answer through. `heard` is the worker's final transcript: empty when speech
 * recognition failed, null when the caller has none. A healthy herd rewrites every camel's status,
 * so that one answer must be backed by words that say it, or it is asked again.
 */
export function refuseAnswer(session: CallSession, input: AnswerInput, heard: string | null, locale: Locale, camelNames: readonly string[] = []): AnswerRefusal | null {
  if (heard === null) return null;
  const words = normalizeSpeech(heard).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (words && isOffTopicAnswer(session, words, camelNames.map((name) => normalizeSpeech(name)))) return "answer_off_topic";
  if (isHerdHealthYes(session, input) && mapSpeechToInput(session, heard, null, locale)?.value !== "yes") return "answer_unclear";
  return null;
}
