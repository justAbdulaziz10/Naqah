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

/** "All camels well" rewrites every camel's status, and "done" closes a task: both need words that say so. */
function yesNeedsWords(session: CallSession, input: AnswerInput): boolean {
  if (session.step !== "report_question" || input.value !== "yes") return false;
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  return item?.kind === "task" || (item?.kind === "predefined" && item.answerKind === "herd-health");
}

/**
 * «لا ما فيه مريض» means every camel is fine, and the model reads it either way. On the herd-health
 * question the worker's clear words decide. A bare «لا» depends on how the question was put, so it stays with the model.
 */
export function herdAnswerFromWords(session: CallSession, input: AnswerInput, heard: string | null, locale: Locale): AnswerInput {
  if (!heard || session.step !== "report_question" || input.value === undefined) return input;
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  if (item?.kind !== "predefined" || item.answerKind !== "herd-health") return input;
  if (normalizeSpeech(heard).replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").length < 2) return input;
  const value = mapSpeechToInput(session, heard, null, locale)?.value;
  return value === "yes" || value === "no" ? { value } : input;
}

/**
 * Null lets the answer through. `heard` is the worker's final transcript: empty when speech
 * recognition failed, null when the caller has none.
 */
export function refuseAnswer(session: CallSession, input: AnswerInput, heard: string | null, locale: Locale, camelNames: readonly string[] = []): AnswerRefusal | null {
  if (heard === null) return null;
  const words = normalizeSpeech(heard).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (words && isOffTopicAnswer(session, words, camelNames.map((name) => normalizeSpeech(name)))) return "answer_off_topic";
  if (yesNeedsWords(session, input) && mapSpeechToInput(session, heard, null, locale)?.value !== "yes") return "answer_unclear";
  return null;
}
