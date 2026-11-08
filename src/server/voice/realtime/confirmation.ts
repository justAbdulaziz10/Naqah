import type { CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { mapSpeechToInput, normalizeSpeech } from "../speech";
import { SUMMARY_STEP } from "./tools";

const MAX_UTTERANCE = 1000;

/** Words alone: does this transcript really say yes to the summary, with no correction in it? */
export function isVerifiedConfirmation(utterance: string, session: CallSession, locale: Locale): boolean {
  if (!utterance || utterance.length > MAX_UTTERANCE) return false;
  const words = normalizeSpeech(utterance).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (/(?:^|\s)(?:و)?(?:لا|ماهو|ماهي|مهو|مهي|مهوب|مهيب|مهب|ما|مو|مش|ماني|مب|ليس|لن|بس|لكن|الا|غلط|خطا|تصحيح|تعديل|عدل|عدله|غير|غيره|بدل|بدله|انتظر|لحظه|no|not|never|but|however|except|wrong|correction|change|wait|dont|don|isnt|isn)(?:\s|$)/u.test(words)) return false;
  return session.step === SUMMARY_STEP && mapSpeechToInput(session, utterance, null, locale)?.value === "confirm_save";
}
