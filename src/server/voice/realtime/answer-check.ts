import { askedTopic, isOffTopicAnswer, topicsInWords } from "@/domain/conversation/answer-topic";
import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { camelNameKey, extractNumber, mapSpeechToInput, normalizeSpeech, numbersSaid } from "../speech";

export type AnswerRefusal = "answer_off_topic" | "answer_unclear" | "number_not_in_answer" | "answer_conflicts_with_words";
export const ANSWER_REFUSAL_MESSAGE = "Nothing was recorded. The worker's words did not support this answer. Do not change the answer to get past a refusal.";
export const evidenceWords = (text: string) => normalizeSpeech(text).replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");

/** A recogniser can write its own context back on silence. It is never the worker speaking. */
export const isLeakedHint = (heard: string) => /مكالمه هاتف/.test(normalizeSpeech(heard)) || (heard.match(/[،,]/g)?.length ?? 0) >= 4;

const FOREIGN_OK = new Set(["ok", "okay", "yes", "no", "sms"]);

/** A recogniser that lost the thread returns the wrong script: «damarja», «أقدراشgba». */
export function isGarbled(words: string, locale: Locale): boolean {
  if (locale === "en") return /\p{Script=Arabic}/u.test(words);
  return words.split(" ").some((word) => /[a-z]{2,}/.test(word) && !FOREIGN_OK.has(word));
}

const STOP_WORDS = /(?:^| )(?:وقف|اوقف|اقفل|اقفلها|سكر|سكرها|مع السلامه|ما ابي اكمل|ما ابي احفظ|لا تحفظ|لا تحفظه|لا تحفظها|لا تسجل|لا تسجله|لا تسجلها|الغ|الغها|الغيها|بعدين|مشغول|مو فاضي|مب فاضي|stop|goodbye|bye|hang up|not now|later|busy)(?: |$)/;

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
  // «تمام بس نورة تعبانة»: naming a camel says one needs attention, whatever else the sentence says.
  const namesCamel = words.split(" ").some((word) => camelNames.some((name) => camelNameKey(word) === camelNameKey(name)));
  if (health && input.value === "no" && namesCamel) return null;
  if (closesTask && mapped?.value !== "yes") return "answer_unclear";
  if (numeric && !numbersSaid(heard ?? "").has(Number(input.text))) return "number_not_in_answer";
  if (input.value !== undefined) {
    if (session.inputMode === "number" && extractNumber(heard ?? "") !== null) return "answer_conflicts_with_words";
    // A clear contradiction, unless another topic in the sentence is what the words were about.
    const asked = askedTopic(session);
    const mixedTopics = [...topicsInWords(words)].some((topic) => topic !== asked);
    if (mapped?.value !== undefined && session.replies.some((reply) => reply.value === mapped.value) && mapped.value !== input.value && !mixedTopics) return "answer_conflicts_with_words";
  }
  if (input.value === undefined || session.inputMode !== "choices" || mapped?.value === input.value) return null;
  // The model reads the meaning. A herd-wide health answer changes every camel, so it needs health words or a camel's name;
  // one unrecognised word is what a mishearing looks like.
  // A plain yes/no follow-up has no meaning to read into: words must say yes or no.
  const yesNo = session.replies.some((reply) => reply.value === "yes") && session.replies.some((reply) => reply.value === "no");
  if (health || yesNo || words.split(" ").length < 2) return "answer_unclear";
  return null;
}
