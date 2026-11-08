import type { CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
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
  "go ahead and save it", "confirm and save",
  "تاكيد وحفظ", "تاكيد", "اكد", "اكد واحفظ", "ايه اكد", "ايه تاكيد",
]);

/** «إيه صح، احفظه»: a clear Arabic yes can be strung together, as long as every word is one of these. */
const CLEAR_ARABIC_WORDS = new Set(["ايه", "ايوه", "اي", "نعم", "اكيد", "صح", "صحيح", "تمام", "اوكي", "طيب", "والله", "احفظ", "احفظه", "احفظها", "واحفظ", "واحفظه", "تاكيد", "اكد"]);
const isClearArabic = (words: string) => words.split(" ").every((word) => CLEAR_ARABIC_WORDS.has(word));

/** Words alone: does this transcript really say yes to the summary, with no correction in it? */
export function isVerifiedConfirmation(utterance: string, session: CallSession, locale: Locale): boolean {
  if (!utterance || utterance.length > MAX_UTTERANCE || /[?؟]/u.test(utterance)) return false;
  const words = normalizeSpeech(utterance).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!CLEAR_CONFIRMATIONS.has(words) && !isClearArabic(words)) return false;
  return session.step === SUMMARY_STEP && mapSpeechToInput(session, utterance, null, locale)?.value === "confirm_save";
}
