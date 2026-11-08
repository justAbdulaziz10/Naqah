/**
 * Clarify instead of guessing. These checks sit between the tool checks and the engine, and each
 * asks one question rather than recording something the worker didn't clearly say.
 *
 * LAB ONLY FOR NOW: real calls don't run this file. The matching engine and instruction changes
 * are in docs/integrations/voice-lab-calling-fixes.patch, for the calling team to apply. Once they
 * land, remove `repairHerdDetail` and the quantity check here.
 */
import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { extractNumber, mapSpeechToInput } from "@/server/voice/speech";

/** The session, plus which clarification was already asked at this step. */
export type LabSession = CallSession & { labAsked?: string };

export type AnswerReview =
  | { kind: "clarify"; error: string; clarify: string; session: LabSession }
  | { kind: "adjust"; session: LabSession };

/** Added to the phone instructions, which don't yet tell the model to clarify an unclear answer. */
export const CLARIFY_RULE: Record<Locale, string> = {
  ar: "إذا جواب العامل ما يجاوب السؤال الحالي بوضوح (عن موضوع ثاني، أو ناقص، أو يحتمل أكثر من معنى)، لا تنادي الأداة ولا تفترض شي. اسأله سؤال توضيح قصير عن نفس السؤال وانتظر جوابه.",
  en: "If the worker's answer does not clearly answer the current question (it is about something else, incomplete, or could mean more than one thing), do not call the tool and do not assume anything. Ask one short clarifying question about the same question and wait for the answer.",
};

const CLARIFY: Record<string, Record<Locale, string>> = {
  no_worker_answer: { ar: "ما سمعت جوابك على هذا السؤال. وش تقول؟", en: "I didn't hear your answer to this one. What would you say?" },
  answer_conflicts_with_words: { ar: "ما فهمت جوابك زين. تقصد إيه ولا لا؟", en: "I didn't quite follow. Could you say that again?" },
  number_not_in_answer: { ar: "ما وصلني الرقم. كم بالضبط تقريباً؟", en: "I didn't catch a number. Roughly how many?" },
  quantity_contradicts_level: { ar: "قلت إنه كافي، وبعدها إن ما فيه شي. كم باقي تقريباً؟ وإذا ما تدري قل ما أدري.", en: "You said there was enough, then that there's none. Roughly how much is left? If you don't know, just say so." },
};

const SUFFICIENT = new Set(["good", "medium"]);
const NUMERIC = /^\d+(?:\.\d+)?$/;

/**
 * Null lets the answer through. A worker who repeats themselves after being asked is believed,
 * so a question can't loop, except that an answer with no speech behind it is never accepted.
 */
export function reviewAnswer(input: { session: LabSession; input: AnswerInput; spoke: boolean; heard: string | null; locale: Locale }): AnswerReview | null {
  const { session, spoke, heard, locale } = input;
  const answer = input.input;
  const position = `${session.step}:${session.data.reportIndex ?? 0}`;
  const clarify = (error: string): AnswerReview => ({ kind: "clarify", error, clarify: CLARIFY[error][locale], session: { ...session, labAsked: `${position}:${error}` } });
  const askedAlready = (error: string) => session.labAsked === `${position}:${error}`;

  if (!spoke) return clarify("no_worker_answer");

  const number = answer.text !== undefined && NUMERIC.test(answer.text) ? Number(answer.text) : null;
  if (number !== null && heard && extractNumber(heard) !== number && !askedAlready("number_not_in_answer")) return clarify("number_not_in_answer");

  if (answer.value !== undefined && heard && !askedAlready("answer_conflicts_with_words")) {
    const words = mapSpeechToInput(session, heard, null, locale);
    // The parser can name a reply this question doesn't offer, which says nothing about the model's choice.
    const offered = session.replies.some((reply) => reply.value === words?.value);
    if (offered && words?.value !== answer.value) return clarify("answer_conflicts_with_words");
  }

  if (session.step === "quantity_input" && number === 0 && SUFFICIENT.has(session.data.tempLevel ?? "")) {
    if (!askedAlready("quantity_contradicts_level")) return clarify("quantity_contradicts_level");
    // Still none: the earlier "enough" can't stand, and nothing says what should replace it.
    return { kind: "adjust", session: { ...session, data: { ...session.data, tempLevel: "unknown" } } };
  }
  return null;
}

/** The engine writes "17 camels — …" into Arabic answers. Keeps both languages, as it does with no detail. */
export function repairHerdDetail(before: LabSession, next: LabSession): LabSession {
  if (before.step !== "herd_count_detail") return next;
  const count = next.draft.herdCount;
  const last = next.draft.answers.at(-1);
  if (typeof count !== "number" || !last || last.answerText) return next;
  const prefix = `${count} ${count === 1 ? "camel" : "camels"} — `;
  if (!last.answer.startsWith(prefix)) return next;
  const detail = last.answer.slice(prefix.length);
  const answerText = { ar: `${count} من الحلال — ${detail}`, en: last.answer };
  return { ...next, draft: { ...next.draft, answers: [...next.draft.answers.slice(0, -1), { ...last, answerText }] } };
}
