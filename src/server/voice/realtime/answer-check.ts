import { isOffTopicAnswer } from "@/domain/conversation/answer-topic";
import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { extractNumber, mapSpeechToInput, normalizeSpeech } from "../speech";

export type AnswerRefusal = "answer_off_topic" | "answer_unclear" | "number_not_in_answer" | "answer_conflicts_with_words";
export const ANSWER_REFUSAL_MESSAGE = "Nothing was recorded. The worker's words did not support this answer. Do not change the answer to get past a refusal.";
export const evidenceWords = (text: string) => normalizeSpeech(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

const FOREIGN_OK = new Set(["ok", "okay", "yes", "no", "sms"]);

/** A recogniser that lost the thread returns the wrong script: «damarja», «أقدراشgba». */
export function isGarbled(words: string, locale: Locale): boolean {
  if (locale === "en") return /\p{Script=Arabic}/u.test(words);
  return words.split(" ").some((word) => /[a-z]{2,}/.test(word) && !FOREIGN_OK.has(word));
}

const STOP_WORDS = /(?:^| )(?:وقف|اوقف|اقفل|اقفلها|سكر|سكرها|مع السلامه|ما ابي اكمل|ما ابي احفظ|لا تحفظ|لا تحفظه|لا تحفظها|الغ|الغها|الغيها|بعدين|مشغول|مو فاضي|مب فاضي|stop|goodbye|bye|hang up|not now|later|busy)(?: |$)/;

/** Only the person on the line can end the call, in words that say so. */
export const askedToStop = (heard: string) => STOP_WORDS.test(evidenceWords(heard));

export function refuseAnswer(session: CallSession, input: AnswerInput, heard: string | null, locale: Locale, camelNames: readonly string[] = []): AnswerRefusal | null {
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  const health = session.step === "report_question" && item?.kind === "predefined" && item.answerKind === "herd-health";
  const closesTask = session.step === "report_question" && item?.kind === "task" && input.value === "yes";
  const numeric = input.text !== undefined && /^\d+(?:\.\d+)?$/.test(input.text);
  if (heard === null && !health && !closesTask && !numeric) return null;
  const words = evidenceWords(heard ?? "");
  if (words && isOffTopicAnswer(session, words, camelNames.map(evidenceWords))) return "answer_off_topic";
  if (!words) return numeric ? "number_not_in_answer" : "answer_unclear";
  if (isGarbled(words, locale)) return "answer_unclear";
  const mapped = mapSpeechToInput(session, heard ?? "", null, locale);
  if (health && (input.value === "yes" || input.value === "no")) {
    if (input.value === "yes" && mapped?.value !== "yes") return "answer_unclear";
    if (input.value === "no" && mapped?.value === "yes") return "answer_conflicts_with_words";
    // "One needs attention" raises a finding for the owner, so it needs words about a sick camel or a camel's name.
    if (input.value === "no" && mapped?.value !== "no" && !words.split(" ").some((word) => camelNames.map(evidenceWords).includes(word))) return "answer_unclear";
  }
  if (closesTask && mapped?.value !== "yes") return "answer_unclear";
  if (numeric && extractNumber(heard ?? "") !== Number(input.text)) return "number_not_in_answer";
  if (input.value !== undefined) {
    if (session.inputMode === "number" && extractNumber(heard ?? "") !== null) return "answer_conflicts_with_words";
    if (mapped?.value !== undefined && session.replies.some((reply) => reply.value === mapped.value) && mapped.value !== input.value) return "answer_conflicts_with_words";
  }
  // A fixed choice needs words that say so. Anything else is asked again, never guessed.
  if (input.value !== undefined && session.inputMode === "choices" && mapped?.value !== input.value) {
    const namedCamel = health && input.value === "no" && words.split(" ").some((word) => camelNames.map(evidenceWords).includes(word));
    if (!namedCamel) return "answer_unclear";
  }
  return null;
}
