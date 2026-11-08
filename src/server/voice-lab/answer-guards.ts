/**
 * Clarify instead of guessing, where only the Lab can check: it has the worker's final words for
 * ordinary answers. Confirmation, Saudi quantities and Arabic herd answers are the calling code's own.
 */
import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { refuseAnswer } from "@/server/voice/realtime/answer-check";
import { extractNumber, mapSpeechToInput } from "@/server/voice/speech";

/** The session, plus the failed confirmations a real call keeps on its row. */
export type LabSession = CallSession & { confirmationFailures?: number; clarifyAt?: string };

export type AnswerReview = { error: string; clarify: string; session: LabSession };

const CLARIFY: Record<string, Record<Locale, string>> = {
  answer_conflicts_with_words: { ar: "ما فهمت جوابك زين. تقصد إيه ولا لا؟", en: "I didn't quite follow. Could you say that again?" },
  number_not_in_answer: { ar: "ما وصلني الرقم. كم بالضبط تقريباً؟", en: "I didn't catch a number. Roughly how many?" },
  answer_off_topic: { ar: "فهمت عليك، بس سؤالي عن شي ثاني. خلنا نرجع له.", en: "Thanks, but my question was about something else. Let's go back to it." },
  answer_unclear: { ar: "ما فهمت جوابك زين. كيف حال الحلال؟", en: "I didn't quite follow. How are the camels?" },
};

const NUMERIC = /^\d+(?:\.\d+)?$/;

/** Null lets the answer through. Words that disagree with the recorded answer are never waved through on a repeat. */
export function reviewAnswer(input: { session: LabSession; input: AnswerInput; heard: string | null; locale: Locale; camelNames?: readonly string[] }): AnswerReview | null {
  const { session, heard, locale, camelNames = [] } = input;
  const answer = input.input;
  const position = `${session.step}:${session.data.reportIndex ?? 0}`;
  const clarify = (error: string): AnswerReview => ({ error, clarify: CLARIFY[error][locale], session: { ...session, clarifyAt: position } });
  const isNumber = answer.text !== undefined && NUMERIC.test(answer.text);
  const refused = refuseAnswer(session, answer, heard, locale, camelNames);
  if (refused) return clarify(refused);
  // Once a question needed clarifying, an answer can only pass on the worker's actual words.
  if (!heard) return session.clarifyAt === position ? clarify(isNumber ? "number_not_in_answer" : "answer_conflicts_with_words") : null;

  if (isNumber && extractNumber(heard) !== Number(answer.text)) return clarify("number_not_in_answer");

  if (answer.value !== undefined) {
    if (session.inputMode === "number" && extractNumber(heard) !== null) return clarify("answer_conflicts_with_words");
    const words = mapSpeechToInput(session, heard, null, locale);
    // The parser can name a reply this question doesn't offer, which says nothing about the model's choice.
    const offered = session.replies.some((reply) => reply.value === words?.value);
    if (offered && words?.value !== answer.value) return clarify("answer_conflicts_with_words");
  }
  return null;
}
