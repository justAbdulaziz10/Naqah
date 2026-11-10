import type { CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { topicsInWords } from "@/domain/conversation/answer-topic";
import { mapSpeechToInput, normalizeSpeech } from "../speech";
import { SUMMARY_STEP } from "./tools";

const MAX_UTTERANCE = 1000;
const CLEAR_CONFIRMATIONS = new Set([
  "ايه", "ايوه", "اي", "نعم", "اكيد", "صح", "صحيح", "تمام", "اوكي", "طيب",
  "احفظ", "احفظه", "احفظ التحديث", "احفظ التقرير", "ايه صح", "ايه صحيح", "نعم صحيح",
  "ايه احفظه", "نعم احفظه", "تمام احفظه", "الكلام صحيح", "كله صحيح", "كل شي صحيح",
  "احفظها", "ايه احفظها", "نعم احفظها", "تمام احفظها", "صح احفظه", "صح احفظها", "ايوه احفظه", "ايوه احفظها",
  "ايه تمام", "تمام ايه", "ايوه تمام", "ايوه صح", "اي نعم", "ايه والله", "كله تمام", "كله صح",
  "yes", "yeah", "yep", "yup", "sure", "correct", "right", "ok", "okay", "confirm",
  "save", "save it", "save the report", "save the update", "yes save it", "yes correct",
  "that is correct", "that s correct", "that is right", "that s right", "yes that is correct",
  "go ahead and save it", "confirm and save", "save them", "yes save them",
  "تاكيد وحفظ", "تاكيد", "اكد", "اكد واحفظ", "ايه اكد", "ايه تاكيد",
]);

/** «إيه صح، احفظه»: a clear Arabic yes can be strung together, as long as every word is one of these. */
const CLEAR_ARABIC_WORDS = new Set(["ايه", "ايوه", "اي", "نعم", "اكيد", "صح", "صحيح", "تمام", "اوكي", "طيب", "والله", "حفظ", "اعتمد", "احفظ", "احفظه", "احفظها", "واحفظ", "واحفظه", "تاكيد", "اكد"]);
/** Words that agree only alongside a clear yes: «إيه كله صحيح احفظه», «إيه زين احفظه». */
const AGREEING_ARABIC_WORDS = new Set(["كله", "كل", "شي", "الكلام", "زين", "مضبوط", "يعطيك", "العافيه"]);
const isClearArabic = (words: string) => {
  const list = words.split(" ");
  return list.some((word) => CLEAR_ARABIC_WORDS.has(word)) && list.every((word) => CLEAR_ARABIC_WORDS.has(word) || AGREEING_ARABIC_WORDS.has(word));
};

const AGREE = new Set(["ايه", "ايوه", "اي", "نعم", "اكيد", "صح", "صحيح", "تمام", "اوكي", "طيب", "زين", "احفظ", "احفظه", "احفظها", "حفظ", "موافق", "ماشي", "مضبوط", "yes", "yeah", "ok", "okay", "sure", "correct", "save"]);
/** «لا تعدل», «ما فيه تعديل»: nothing to change is a yes to the summary as it stands. */
const NOTHING_TO_CHANGE = /(?:^| )(?:لا|ما|مو) (?:تعدل|تغير|فيه تعديل|ابي اعدل|ابغى اعدل)(?: |$)|(?:^| )(?:no changes?|nothing to change)(?: |$)/;
const REFUSE = /(?:^| )(?:لا|ما|مو|لاء) (?:تحفظ|تحفظه|تحفظها|احفظ|ابي|ابغى|ابيه|توافق)(?: |$)|(?:^| )(?:غلط|خطا|خطأ|عدل|عدله|عدلها|تعديل|غيره|غيرها|بس|لكن|الا|مدري|ما ادري|يمكن|don t|not|wrong|change|but|maybe)(?: |$)/;
const NO_ALONE = /^(?:لا|لاء|no|nope)(?: |$)/;

/**
 * A natural call: the model heard the audio and asked to save after the whole summary, but phone transcription
 * garbles a casual Saudi yes («كل شيء تمام، لا تعدل» came back as «كل شيء نام»). The words must still agree, or say
 * there is nothing to change, and hold no refusal, no correction, no doubt and no other topic; and never a question.
 */
export function isNaturalConfirmation(utterance: string, session: CallSession, locale: Locale): boolean {
  if (!utterance || utterance.length > MAX_UTTERANCE || /[?؟]/u.test(utterance) || session.step !== SUMMARY_STEP) return false;
  const words = normalizeSpeech(utterance).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!words || NO_ALONE.test(words) || topicsInWords(words).size > 0) return false;
  const leftover = words.replace(NOTHING_TO_CHANGE, " ");
  if (REFUSE.test(` ${leftover} `)) return false;
  return NOTHING_TO_CHANGE.test(words) || words.split(" ").some((word) => AGREE.has(word)) || isVerifiedConfirmation(utterance, session, locale);
}

/** Words alone: does this transcript really say yes to the summary, with no correction in it? */
export function isVerifiedConfirmation(utterance: string, session: CallSession, locale: Locale): boolean {
  if (!utterance || utterance.length > MAX_UTTERANCE || /[?؟]/u.test(utterance)) return false;
  const words = normalizeSpeech(utterance).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!CLEAR_CONFIRMATIONS.has(words) && !isClearArabic(words)) return false;
  const expected = session.step === SUMMARY_STEP ? "confirm_save" : session.step === "instruction_review" ? "instructions_confirm" : null;
  return expected !== null && mapSpeechToInput(session, utterance, null, locale)?.value === expected;
}
