import type { CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { topicsInWords } from "@/domain/conversation/answer-topic";
import { mapSpeechToInput, namedCamels, normalizeSpeech, numbersSaid } from "../speech";
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

const AGREE = new Set([
  "ايه", "ايوه", "اي", "نعم", "اكيد", "صح", "صحيح", "تمام", "اوكي", "طيب", "زين", "احفظ", "احفظه", "احفظها", "حفظ", "موافق", "ماشي", "مضبوط",
  "ايوا", "احفظي", "احفظيه", "احفظيها", "سجلي", "سجليه", "سجليها",
  "خلاص", "يلا", "سجل", "سجله", "سجلها", "اعتمد", "اعتمده",
  "yes", "yeah", "yep", "yup", "ok", "okay", "sure", "correct", "save", "done", "right", "fine", "good",
]);
/** «طيب», «زين», «خلاص», «اوكي» are also how people fill a pause: alongside other words they need a clearer yes. */
const SOFT_AGREE = new Set(["طيب", "اوكي", "زين", "ماشي", "خلاص", "يلا", "ok", "okay", "done", "right", "fine", "good"]);
/** Words that add nothing to a yes or a no: «طيب طيب يا جماعة الخير», «كذا تمام», «yes please, that's it». */
const FILLER = new Set([
  "يا", "جماعه", "الخير", "شيخ", "اخوي", "الغالي", "حبيبي", "الحبيب", "طال", "عمرك", "الله", "يعافيك", "يحفظك", "كذا", "كله", "كل", "شي",
  "الكلام", "والله", "it", "that", "s", "is", "all", "please", "thanks", "thank", "you",
]);
/** «لا تعدل», «ما فيه تعديل»: nothing to change is a yes to the summary as it stands. */
const NOTHING_TO_CHANGE = /(?:^| )(?:(?:و?لا|ما|مو) (?:ما )?(?:(?:تعدلي?|تغيري?|اعدل|اغير|(?:ابي|ابغى|ابغي|ودي) (?:اعدل|اغير|اصحح)|يحتاج (?:تعدلي?|تغيري?|اعدل|اغير|تعديل))(?: (?:شي|شيء|اي شي))?)|ما ?(?:فيه|في) (?:تعديل|شي يتعدل)|no changes?|nothing to change|no need to (?:edit|change)|(?:don t|do not) (?:edit|change)(?: it)?)(?= |$)/u;
const WANTS_CHANGE = /(?:^| )(?:و?(?:اعدل|عدلي?(?:ه|ها)?|تعدلي?|اغير|غيري?(?:ه|ها)?|تغيري?|اصحح|صححي?(?:ه|ها)?|تصحيح|تعديل)|(?:مو|مش|غير) (?:صح|صحيح|صحيحه|مضبوط|مضبوطه)|edit|editing|change|changes|correction|correcting|correct (?:it|this|that|the|my))(?= |$)/u;
const NO_THEN_SAVE = /^(?:لا|لاء) (?=تمام (?:احفظ(?:ي(?:ه|ها)?|ه|ها)?|سجل(?:ي(?:ه|ها)?|ه|ها)?)(?: |$))/u;
/** «توكل على الله», «يلا احفظ», and «الله يعطيك العافية» said back to «أحفظه؟»: a Saudi go-ahead. */
const GO_AHEAD = /(?:^| )(?:توكل على الله|توكل|يلا احفظ|يلا احفظه)(?: |$)|^(?:الله )?يعطيك العافيه(?: يا \p{L}+)?$/u;
const REFUSE = /(?:^| )(?:لا|ما|مو|لاء) (?:تحفظ(?:ين?(?:ه|ها)?|ه|ها)?|احفظ(?:ي(?:ه|ها)?|ه|ها)?|تسجل(?:ين?(?:ه|ها)?|ه|ها)?|سجل(?:ي(?:ه|ها)?|ه|ها)?|ابي|ابغى|ابيه|توافق)(?: |$)|(?:^| )(?:غلط|خطا|خطأ|عدل|عدله|عدلها|تعديل|غيره|غيرها|بس|لكن|الا|مدري|ما ادري|يمكن|don t|not|wrong|change|but|maybe)(?: |$)/;
/** Waiting, asking, doubting or wanting the owner: «طيب انتظر», «ايه وش قلت», «ايه اظن», «تمام قل للمعزب يتصل». */
const HOLD = /(?:^| )(?:انتظر|انطر|استني|لحظه|ثواني|ثانيه|دقيقه|اصبر|خلني|خليني|وش|ايش|شو|مين|من معي|اسمع|بعدين|اظن|اعتقد|احس|اتاكد|قل|قول|كلم|اكلم|يتصل|wait|hold|hang on|what|who|later|think|guess|second|sec|moment|minute|listen)(?: |$)|معزب/;
const NO_ALONE = /^(?:لا|لاء|no|nope)(?: |$)/;
/** «احفظ… لا»: a no said last takes the yes back. */
const NO_LAST = /(?:^| )(?:لا|لاء|no|nope)$/;

/**
 * A natural call: the model heard the audio and asked to save after the whole summary, but phone transcription
 * garbles a casual Saudi yes («كل شيء تمام، لا تعدل» came back as «كل شيء نام»). The words must still agree, or say
 * there is nothing to change, and hold no refusal, no correction, no doubt, no wait and no other topic; and never a
 * question, even one the transcript wrote without its «؟».
 */
export function isNaturalConfirmation(utterance: string, session: CallSession, locale: Locale, camels: readonly { name: string }[] = []): boolean {
  if (!utterance || utterance.length > MAX_UTTERANCE || /[?؟]/u.test(utterance) || session.step !== SUMMARY_STEP) return false;
  const words = normalizeSpeech(utterance).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!words || NO_LAST.test(words) || topicsInWords(words).size > 0) return false;
  const leftover = words.replace(new RegExp(NOTHING_TO_CHANGE, "gu"), " ").trim().replace(NO_THEN_SAVE, "");
  // A number or a camel's name is what a correction sounds like («تمام، عشرين كيس», «إيه مزون بخير»), never a plain yes.
  if (numbersSaid(leftover).size > 0 || namedCamels(words, camels).length > 0) return false;
  if (NO_ALONE.test(leftover) || WANTS_CHANGE.test(leftover) || REFUSE.test(leftover) || HOLD.test(leftover)) return false;
  if (NOTHING_TO_CHANGE.test(words) || GO_AHEAD.test(words)) return true;
  const list = words.split(" ");
  // «زين، ماشي» agrees in every word, and «طيب طيب يا جماعة الخير» only adds filler to it. A soft word beside anything
  // else («خلاص اقفل», «طيب الحين») needs a clearer yes.
  const agrees = (list.some((word) => AGREE.has(word)) && list.every((word) => AGREE.has(word) || FILLER.has(word)))
    || list.some((word) => AGREE.has(word) && !SOFT_AGREE.has(word));
  return agrees || isVerifiedConfirmation(utterance, session, locale);
}

/** Words alone: does this transcript really say yes to the summary, with no correction in it? */
export function isVerifiedConfirmation(utterance: string, session: CallSession, locale: Locale): boolean {
  if (!utterance || utterance.length > MAX_UTTERANCE || /[?؟]/u.test(utterance)) return false;
  const words = normalizeSpeech(utterance).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (!CLEAR_CONFIRMATIONS.has(words) && !isClearArabic(words)) return false;
  const expected = session.step === SUMMARY_STEP ? "confirm_save" : session.step === "instruction_review" ? "instructions_confirm" : null;
  return expected !== null && mapSpeechToInput(session, utterance, null, locale)?.value === expected;
}
