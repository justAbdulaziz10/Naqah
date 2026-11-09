import { isOffTopicAnswer } from "@/domain/conversation/answer-topic";
import type { AnswerInput, CallSession, Reply } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

export function normalizeSpeech(input: string): string {
  return input
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[٠-٩۰-۹]/g, (digit) => ARABIC_DIGITS[digit] ?? digit)
    .toLocaleLowerCase("en-US")
    .replace(/[’‘]/g, "'")
    .trim();
}

const YES_WORDS = new Set([
  "ايه", "ايوه", "نعم", "اي", "تمام", "yes", "yeah", "yep", "sure",
]);
const NO_WORDS = new Set(["لا", "باقي", "مو", "no", "not yet"]);
const UNKNOWN_WORDS = new Set([
  "ما ادري", "ماادري", "ما اعرف", "لا اعرف", "مدري", "i don t know", "i dont know",
  "i do not know", "not sure",
]);

const POSITIVE_VALUES = new Set([
  "yes", "answer", "all_present", "complete", "completed", "confirm", "confirm_save",
  "done", "good", "healthy", "ok", "received", "sufficient", "true", "instruction_yes",
]);
const NEGATIVE_VALUES = new Set([
  "no", "miss", "no_answer", "not_yet", "incomplete", "false", "sick", "missing",
  "low", "critical", "end_without_save", "skip", "instruction_no",
]);

const REPLY_UNKNOWN_VALUES = new Set(["unknown", "dont_know", "don't_know", "not_sure", "unsure"]);
const REPLY_UNKNOWN_LABELS = new Set(["unknown", "i don t know", "ما ادري", "غير معروف"]);

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  "صفر": 0, "واحد": 1, "واحده": 1, "وحده": 1, "احد": 1, "اثنين": 2, "اثنان": 2, "ثنتين": 2, "اثنتين": 2,
  "ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6,
  "سبع": 7, "سبعه": 7, "ثمان": 8, "ثماني": 8, "ثمانيه": 8, "تسع": 9, "تسعه": 9,
  "عشر": 10, "عشره": 10, "احد عشر": 11, "احدعشر": 11, "اثنا عشر": 12, "اثنى عشر": 12,
  "اثناعشر": 12, "اثنعش": 12, "اثناعش": 12, "ثنعش": 12, "ثلاثه عشر": 13, "ثلاث عشر": 13, "اربع عشر": 14, "اربعه عشر": 14,
  "خمسه عشر": 15, "خمس عشر": 15, "سته عشر": 16, "ست عشر": 16, "سبعه عشر": 17,
  "سبع عشر": 17, "ثمانيه عشر": 18, "ثمان عشر": 18, "تسعه عشر": 19, "تسع عشر": 19,
  "عشرين": 20, "عشرون": 20, "ثلاثين": 30, "ثلاثون": 30, "اربعين": 40, "اربعون": 40,
  "خمسين": 50, "خمسون": 50, "ستين": 60, "ستون": 60, "سبعين": 70, "سبعون": 70,
  "ثمانين": 80, "ثمانون": 80, "تسعين": 90, "تسعون": 90,
  "احدعش": 11, "حدعش": 11, "ثلاثطعش": 13, "اربعطعش": 14, "خمسطعش": 15, "خمستعش": 15,
  "ستطعش": 16, "سبعطعش": 17, "ثمانطعش": 18, "تسعطعش": 19, "كيسين": 2, "كيسان": 2, "لترين": 2,
};

const HUNDREDS: Record<string, number> = {
  ميه: 100, مئه: 100, مائه: 100, ميتين: 200, مئتين: 200, مائتين: 200,
  ثلاثميه: 300, ثلاثمئه: 300, ثلاثمائه: 300, اربعميه: 400, اربعمائه: 400,
  خمسميه: 500, خمسمائه: 500, ستميه: 600, ستمائه: 600, سبعميه: 700, سبعمائه: 700,
  ثمانميه: 800, ثمانمائه: 800, تسعميه: 900, تسعمائه: 900,
};

/** «ما في ولا وحدة», "none", "not a single one": zero, unless it goes on to give a count («إلا وحدة»). */
const ZERO = /(?:^|\s)(?:صفر|zero|none|nothing|nobody|not\s+(?:a\s+single(?:\s+one)?|one|any)|no\s+(?:camels?|bags?|one)|ولا\s+(?:وحده|واحده|واحد|ناقه|شي|شيء|كيس|حبه|لتر|نقطه)|ما\s*(?:في|فيه)\s+(?:شي|شيء|احد)|مافي\s+(?:شي|شيء|احد)|محد)(?:\s|$)/u;
const EXCEPT = /(?:^|\s)(?:الا|غير|بس|only|just|except|but)(?:\s|$)/u;

export function extractNumber(input: string): number | null {
  const normalized = normalizeSpeech(input).replaceAll("٫", ".");
  const plain = normalized.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (/(?:^|\s)(?:سالب|minus|negative|between|بين|او|or)(?:\s|$)|[-−]\s*\d/u.test(normalized)) return null;
  const numericValue = (token: string): number | undefined => {
    if (/^\d+(?:\.\d+)?$/.test(token)) return Number(token);
    return Object.hasOwn(NUMBER_WORDS, token) ? NUMBER_WORDS[token] : Object.hasOwn(HUNDREDS, token) ? HUNDREDS[token] : undefined;
  };
  if (ZERO.test(plain) && !EXCEPT.test(plain)) {
    const remaining = plain.replace(ZERO, " ").match(/[\p{L}\p{N}]+/gu) ?? [];
    return remaining.some((token) => (numericValue(token) ?? 0) > 0) ? null : 0;
  }
  const tokens = (normalized.match(/\d+(?:\.\d+)?|\p{L}+/gu) ?? []).flatMap((token) =>
    token.startsWith("و") && numericValue(token) === undefined && numericValue(token.slice(1)) !== undefined
      ? ["و", token.slice(1)] : [token]);
  let total = 0;
  let group: number | null = null;
  let previous: number | null = null;
  let ended = false;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (["و", "and"].includes(token) && (group !== null || total > 0)) {
      if (numericValue(tokens[index + 1] ?? "") === undefined) return null;
      continue;
    }
    if (["hundred", "ميه", "مئه", "مائه", "thousand", "الف", "الاف", "الفين", "الفان"].includes(token)) {
      if (ended) return null;
      if (["hundred", "ميه", "مئه", "مائه"].includes(token)) {
        if (group !== null && (group < 1 || group > 9)) return null;
        group = (group ?? 1) * 100;
        previous = group;
      } else {
        if (total || (group !== null && (!Number.isInteger(group) || group < 1 || group > 999))) return null;
        const dual = token === "الفين" || token === "الفان";
        if (dual && group !== null) return null;
        total = (group ?? (dual ? 2 : 1)) * 1000;
        group = null;
        previous = null;
      }
      continue;
    }
    const pair = `${tokens[index]} ${tokens[index + 1] ?? ""}`.trim();
    const paired = Boolean(tokens[index + 1]) && Object.hasOwn(NUMBER_WORDS, pair);
    const value = paired ? NUMBER_WORDS[pair] : numericValue(token);
    if (value === undefined) {
      if (group !== null || total) ended = true;
      continue;
    }
    if (ended) return null;
    if (paired) index += 1;
    if (previous !== null) {
      const descending = (previous >= 100 && previous % 100 === 0 && value < 100) ||
        (previous >= 20 && previous < 100 && previous % 10 === 0 && value > 0 && value < 10);
      const arabicUnitFirst = previous > 0 && previous < 10 && value >= 20 && value <= 90 &&
        value % 10 === 0 && tokens[index - 1] === "و";
      if (!descending && !arabicUnitFirst) return null;
    }
    group = (group ?? 0) + value;
    previous = value;
  }
  const result = total + (group ?? 0);
  return (group !== null || total > 0) && Number.isFinite(result) && result <= 999999 ? result : null;
}

function formatTime(hour: number, minute: number, meridiem?: string): string | null {
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  let normalizedHour = hour;
  if (["pm", "مساء", "ليلا", "ليل"].includes(meridiem ?? "")) normalizedHour = hour % 12 + 12;
  if (["am", "صباح", "صباحا", "فجرا"].includes(meridiem ?? "")) normalizedHour = hour % 12;
  return `${String(normalizedHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function extractTime(input: string): string | null {
  const normalized = normalizeSpeech(input);
  const digits = normalized.match(/(?:^|\s)(\d{1,2})(?:\s*[:٫.]\s*(\d{1,2}))?\s*(am|pm|صباحا|صباح|مساء|ليلا|ليل|فجرا)?(?=\s|$)/u);
  if (digits) return formatTime(Number(digits[1]), Number(digits[2] ?? 0), digits[3]);

  const wordDaypart = normalized.match(/(?:الساعه\s+)?([\p{L} ]+?)\s*(am|pm|صباحا|صباح|مساء|ليلا|ليل|فجرا)$/u);
  if (wordDaypart) {
    const hour = extractNumber(wordDaypart[1]);
    const suffix = wordDaypart[2];
    if (hour !== null) return formatTime(hour, 0, suffix);
  }

  const spokenHour = normalized.match(/(?:الساعه|الساعة|عند|at|around|about)\s+([\p{L} ]+)$/u);
  if (spokenHour) {
    const hour = extractNumber(spokenHour[1]);
    if (hour !== null) return formatTime(hour, 0);
  }
  return null;
}

function compact(input: string): string {
  return normalizeSpeech(input).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function findReply(replies: Reply[], values: Set<string>, labels: Set<string> = new Set()): Reply | undefined {
  return replies.find((reply) => values.has(compact(reply.value).replaceAll(" ", "_"))) ??
    replies.find((reply) => labels.has(compact(`${reply.label.en} ${reply.label.ar}`)) ||
      [...labels].some((label) => compact(`${reply.label.en} ${reply.label.ar}`).includes(label)));
}

export function unknownReply(replies: Reply[]): Reply | undefined {
  return findReply(replies, REPLY_UNKNOWN_VALUES, REPLY_UNKNOWN_LABELS);
}

function semanticReply(replies: Reply[], intent: "yes" | "no" | "unknown"): Reply | undefined {
  if (intent === "unknown") return unknownReply(replies);
  const direct = findReply(replies, intent === "yes" ? POSITIVE_VALUES : NEGATIVE_VALUES);
  if (direct) return direct;
  return replies.find((reply) => {
    const label = compact(`${reply.label.en} ${reply.label.ar}`);
    if (intent === "yes") return /\b(yes|answer|healthy|good|complete|done|received|sufficient|confirm)\b/u.test(label) ||
      /(?:نعم|ايه|ايوه|بصحه جيده|كاف|سليم|تم|مكتمل|موجود)/u.test(label);
    return /\b(no|miss|sick|missing|low|incomplete|skip)\b/u.test(label) ||
      /(?:لا|مريض|مفقود|ناقص|نفد|تخطي|فائت)/u.test(label);
  });
}

const STOP_WORDS = new Set(["the", "a", "an", "is", "are", "of", "to", "for", "and", "or", "هل", "في", "من", "هو", "هي"]);

const NEGATORS = new Set(["ما", "مو", "لا", "مب", "مش", "بدون", "غير", "ليس", "no", "not", "dont", "don", "never", "without", "nothing", "none"]);
const NEGATIVE_ANSWERS = new Set(["no", "not_yet", "not_enough", "end_without_save", "instruction_no"]);

const words = (input: string) => compact(input).match(/[\p{L}\p{N}]+/gu) ?? [];
const isNegated = (input: string) => words(input).some((word) => NEGATORS.has(word));
const replyIsNegated = (reply: Reply) => isNegated(reply.label.ar) || isNegated(reply.label.en);

/* ─────────────── What was said, with negation ───────────────
 * «لا، ما فيه مريض» means every camel is fine, though it holds «لا» and «مريض». So words are read
 * as concepts, and a concept preceded by a negator (up to five words back) in the same clause counts as negated.
 */
type Concept = "healthy" | "sick" | "watch" | "damaged" | "enough" | "low" | "medium" | "finished" | "pending" | "save" | "thing";

const CONCEPTS: Record<Concept, readonly string[]> = {
  healthy: ["بخير", "زين", "زينه", "زينين", "طيب", "طيبه", "طيبين", "سليم", "سليمه", "سالمه", "سالمين", "عال", "كويس", "كويسه", "كويسين", "جيد", "جيده", "healthy", "well", "fine", "good", "ok", "okay", "alright"],
  sick: [
    "مريض", "مريضه", "مرضى", "مريضات", "تعبان", "تعبانه", "تعبانين", "مصاب", "مصابه", "مصابين", "عيان", "عيانه",
    "مشكله", "مشاكل", "تعرج", "عرجا", "عرجاء", "يعرج", "طايح", "طايحه", "ضعيف", "ضعيفه", "هزيله", "هزيل", "متعب", "متعبه", "مسقوم", "مسقومه", "ميت", "ميته", "نافق", "نافقه", "جربانه", "جرب", "sick", "ill", "injured", "hurt", "unwell", "limping", "wrong", "problem", "problems", "issue", "issues",
  ],
  watch: ["متابعه", "ملاحظه", "مراقبه", "نراقبها", "watch", "observation"],
  damaged: ["خربان", "خربانه", "مكسور", "مكسوره", "broken", "damaged"],
  enough: ["كافي", "كافيه", "يكفي", "تكفي", "يكفون", "كفايه", "متوفر", "متوفره", "موجود", "موجوده", "وايد", "كثير", "enough", "plenty", "sufficient", "full"],
  low: ["ناقص", "ناقصه", "نقص", "نقصت", "قليل", "قليله", "شوي", "شويه", "low", "short", "little"],
  medium: ["متوسط", "متوسطه", "نص", "نصه", "النص", "نصف", "النصف", "half", "medium", "average"],
  finished: ["خلص", "خلصت", "خلصان", "خلصانه", "خلصتها", "خالص", "انتهيت", "انتهى", "انتهت", "نفد", "نفذ", "سويتها", "سويته", "سويناها", "سويناه", "انجزتها", "انجزته", "صلحتها", "صلحته", "done", "finished", "complete", "completed", "empty"],
  pending: ["باقي", "لسه", "لسا", "yet"],
  save: ["احفظ", "احفظه", "احفظها", "تحفظ", "تحفظه", "حفظ", "اكد", "تاكيد", "اعتمد", "confirm", "save"],
  thing: ["شي", "شيء", "احد", "حد", "وحده", "واحده", "ناقه", "anything", "something", "thing", "anyone", "camel", "camels"],
};
const CONCEPT_OF = new Map<string, Concept>(
  (Object.entries(CONCEPTS) as [Concept, readonly string[]][]).flatMap(([concept, list]) => list.map((word) => [word, concept] as const)),
);
const AFFIRM = new Set(["ايه", "ايوه", "نعم", "اي", "اكيد", "صح", "صحيح", "تمام", "اوكي", "طيب", "ok", "okay", "yes", "yeah", "yep", "yup", "sure", "correct", "right"]);
const WELLBEING = new Set(["تمام", "طيب", "اوكي", "ok", "okay"]);
/** «لا» / "no" at the start of a clause answers the question; it doesn't negate what follows. */
const INTERJECTIONS = new Set(["لا", "no", "nope", "nah"]);
/** …unless it is a determiner: «لا يوجد», "no camel". */
export const DETERMINED = new Set(["يوجد", "احد", "شي", "شيء", "ناقه", "وحده", "camel", "camels", "one", "animal", "problem", "problems", "sign", "signs"]);
const SCOPE_NEGATORS = new Set([
  "ما", "ماهو", "ماهي", "مهو", "مهي", "مهوب", "مهيب", "مهب", "مو", "مب", "مش", "ليس", "ليست", "لم", "لن", "لا", "ولا", "بدون", "غير", "مافي", "مافيه", "ماكو", "محد",
  "not", "never", "without", "no", "none", "nothing", "nobody", "neither", "nor",
]);
/** Words that are themselves "nothing at all". */
const NOTHING = new Set(["nothing", "none", "nobody", "محد", "ماكو"]);
const UNKNOWN_PHRASE = /(?:^|\s)(?:ما\s*ادري|ما\s*اعرف|لا\s*اعرف|مدري|ما\s*عندي\s*علم|i\s*don\s*t\s*know|i\s*do\s*not\s*know|not\s*sure|no\s*idea|dunno)(?:\s|$)/u;
const DENY_PHRASE = /(?:^|\s)(?:i\s*do\s*not\s*think\s*so|i\s*don\s*t\s*think\s*so|not\s*really|not\s*at\s*all|ما\s*اظن|ما\s*اعتقد|مو\s*صحيح|غلط)(?:\s|$)/u;

/** How many words back a negator reaches: "not all of them are well". */
const NEGATION_SCOPE = 5;

interface Reading {
  unknown: boolean;
  affirm: boolean;
  wellbeing: boolean;
  deny: boolean;
  /** A negator with nothing to negate («مو», "not"). */
  bareNegation: boolean;
  said: Set<Concept>;
  negated: Set<Concept>;
}

function readSpeech(transcript: string): Reading {
  const text = normalizeSpeech(transcript).replace(/n['’]t\b/g, " not").replace(/\bcannot\b/g, "can not")
    .replace(/(?:قارب|قرب)\s+يخلص|بيخلص(?:ون)?|nearly\s+empty|almost\s+(?:gone|finished)/gu, " low ")
    .replace(/ما\s+(?:عليهم|عليها|عليه)\s+(?:خلاف|باس|شر)|الحمد\s+لله|ما\s*شاء\s+الله/gu, " بخير ")
    .replace(/ما\s+تاكل/gu, " مريضه ");
  const reading: Reading = { unknown: false, affirm: false, wellbeing: false, deny: false, bareNegation: false, said: new Set(), negated: new Set() };
  const plain = text.replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  if (UNKNOWN_PHRASE.test(plain)) reading.unknown = true;
  if (DENY_PHRASE.test(plain)) reading.deny = true;
  const withoutUnknown = text.replace(/ما\s*ادري|ما\s*اعرف|لا\s*اعرف|i\s*don\s*t\s*know|i\s*do\s*not\s*know/gu, " ");

  for (const clause of withoutUnknown.split(/[,،.;؛!?؟]|\s(?:لكن|بس|but|however)\s/u)) {
    const tokens = clause.match(/[\p{L}\p{N}]+/gu) ?? [];
    let skip = -1;
    const [first = "", second = ""] = tokens;
    if (INTERJECTIONS.has(first) && (!second || second === "والله" || !DETERMINED.has(second))) {
      reading.deny = true;
      skip = 0;
    }
    let negators = 0;
    let concepts = 0;
    tokens.forEach((token, index) => {
      if (index === skip) return;
      const from = Math.max(0, index - NEGATION_SCOPE);
      const negatedHere = tokens.slice(from, index).some((word, offset) => {
        const at = from + offset;
        return at !== skip && SCOPE_NEGATORS.has(word);
      });
      if (NOTHING.has(token)) {
        reading.negated.add("thing");
        reading.deny = true;
        concepts += 1;
        return;
      }
      if (SCOPE_NEGATORS.has(token)) {
        negators += 1;
        return;
      }
      if (lookup({ get: (key: string) => AFFIRM.has(key) || undefined }, token)) {
        if (negatedHere) reading.deny = true;
        else {
          reading.affirm = true;
          if (WELLBEING.has(token)) reading.wellbeing = true;
        }
        return;
      }
      const concept = lookup(CONCEPT_OF, token);
      if (!concept) return;
      concepts += 1;
      (negatedHere ? reading.negated : reading.said).add(concept);
    });
    if (negators && !concepts) reading.bareNegation = true;
  }
  // "not yet" / «باقي» on its own is a no.
  if (reading.said.has("pending") && !reading.said.has("finished")) reading.deny = true;
  return reading;
}

/** Arabic joins «و» ("and") to the next word: «وباقي». */
function lookup<T>(map: { get(key: string): T | undefined }, token: string): T | undefined {
  return map.get(token) ?? (token.length > 2 && token.startsWith("و") ? map.get(token.slice(1)) : undefined);
}

const has = (reading: Reading, concept: Concept, negated = false) => (negated ? reading.negated : reading.said).has(concept);

/** One clear side, or nothing: a mixed answer is asked again rather than guessed. */
function oneSide<T extends string>(yes: boolean, no: boolean, yesValue: T, noValue: T): T | null {
  if (yes === no) return null;
  return yes ? yesValue : noValue;
}

function currentItem(session: CallSession) {
  return session.step === "report_question" ? session.data.queue?.[session.data.reportIndex ?? 0] : undefined;
}

/**
 * The reply a reading points to, using what the question asked. Returns a reply value, or null
 * when the reading doesn't decide it here (other matching then runs, or the caller is asked again).
 */
function intentReply(session: CallSession, reading: Reading): string | null {
  const values = new Set(session.replies.map((reply) => reply.value));
  if (reading.unknown) return unknownReply(session.replies)?.value ?? null;
  const item = currentItem(session);
  const negatedSomething = reading.negated.size > 0 || reading.bareNegation;

  // "How are the camels? Is any camel sick?" — a plain «لا» means none is.
  if (item?.kind === "predefined" && item.answerKind === "herd-health" && values.has("yes") && values.has("no")) {
    const sick = has(reading, "sick") || has(reading, "healthy", true) || has(reading, "watch");
    const well = reading.wellbeing || has(reading, "healthy") || has(reading, "sick", true) || has(reading, "thing", true);
    return oneSide(well, sick, "yes", "no") ?? (reading.deny && !reading.affirm ? "yes" : reading.affirm && !reading.deny ? "no" : null);
  }
  if (item?.kind === "predefined" && item.id === "fences_condition") {
    const intact = has(reading, "healthy") || has(reading, "damaged", true);
    const damaged = has(reading, "damaged") || has(reading, "healthy", true);
    const condition = oneSide(intact, damaged, "yes", "no");
    if (condition) return condition;
  }
  if (values.has("not_enough")) {
    const short = has(reading, "low") || has(reading, "enough", true) || has(reading, "thing", true) || has(reading, "finished");
    const enough = has(reading, "enough") || has(reading, "low", true) || has(reading, "healthy");
    return oneSide(enough, short, "yes", "not_enough") ?? oneSide(reading.affirm, reading.deny || reading.bareNegation, "yes", "not_enough");
  }
  if (values.has("good") && values.has("low") && values.has("critical")) {
    if ((has(reading, "finished") || has(reading, "thing", true)) && !has(reading, "finished", true)) return "critical";
    const low = has(reading, "low") || has(reading, "enough", true);
    const good = has(reading, "enough") || has(reading, "healthy") || has(reading, "low", true);
    if (low && !good) return "low";
    if (has(reading, "medium") && !low) return "medium";
    if (good && !low) return "good";
    return null;
  }
  if (values.has("healthy") && values.has("sick")) {
    if (has(reading, "watch") && values.has("watch")) return "watch";
    const sick = has(reading, "sick") || has(reading, "healthy", true);
    const well = reading.wellbeing || has(reading, "healthy") || has(reading, "sick", true) || has(reading, "thing", true);
    return oneSide(well, sick, "healthy", "sick");
  }
  if (values.has("instructions_confirm") && values.has("instructions_cancel")) {
    if (!has(reading, "save") && !has(reading, "save", true) && (reading.said.size > 0 || reading.negated.size > 0)) return null;
    if (has(reading, "save", true)) return "instructions_cancel";
    if (reading.deny || negatedSomething) return "instructions_correct";
    return reading.affirm || has(reading, "save") ? "instructions_confirm" : null;
  }
  if (values.has("confirm_save") && values.has("end_without_save")) {
    if (!has(reading, "save") && !has(reading, "save", true) &&
      (reading.said.size > 0 || reading.negated.size > 0)) return null;
    if (has(reading, "save", true)) return "end_without_save";
    if (reading.deny || negatedSomething) return values.has("correct") ? "correct" : "end_without_save";
    return reading.affirm || has(reading, "save") ? "confirm_save" : null;
  }
  const isTask = item?.kind === "task" || session.step === "callback_task_confirmation" || session.step === "outbound_task_confirmation";
  if (isTask && values.has("yes") && values.has("no")) {
    const done = reading.affirm || has(reading, "finished");
    const notDone = reading.deny || has(reading, "finished", true) || has(reading, "pending") || reading.bareNegation;
    return oneSide(done, notDone, "yes", "no");
  }
  const pairs: [string, string][] = [["yes", "no"], ["instruction_yes", "instruction_no"]];
  for (const [yes, no] of pairs) {
    if (!values.has(yes) || !values.has(no)) continue;
    return oneSide(reading.affirm, reading.deny || negatedSomething, yes, no);
  }
  return null;
}

/** These steps change the farm for good, so a near match is not enough: it takes a clear answer. */
function needsClearAnswer(session: CallSession): boolean {
  if (["report_summary", "instruction_review", "callback_task_confirmation", "outbound_task_confirmation", "quantity_confirm", "herd_count_confirm", "health_name_confirm"].includes(session.step)) return true;
  return currentItem(session)?.kind === "task";
}

function overlapReply(replies: Reply[], transcript: string, locale: Locale): Reply | undefined {
  // A negator is not shared meaning: «ما خلصت» and «ما أدري» have nothing in common.
  const content = (text: string) => words(text).filter((token) => !STOP_WORDS.has(token) && !NEGATORS.has(token));
  const inputTokens = content(transcript);
  if (!inputTokens.length) return undefined;
  const negated = isNegated(transcript);
  let best: { reply: Reply; score: number } | undefined;
  for (const reply of replies) {
    // «ما خلصت» shares a word with «إيه، خلصت», and means the opposite.
    if (replyIsNegated(reply) !== negated) continue;
    const preferred = content(reply.label[locale]);
    const secondary = content(reply.label[locale === "ar" ? "en" : "ar"]);
    const dice = (labelTokens: string[]) => {
      const common = new Set(inputTokens.filter((token) => labelTokens.includes(token)));
      return common.size ? (2 * common.size) / (inputTokens.length + labelTokens.length) : 0;
    };
    const score = Math.max(dice(preferred), dice(secondary) * 0.9);
    if (!score) continue;
    if (!best || score > best.score) best = { reply, score };
  }
  return best && best.score >= 0.32 ? best.reply : undefined;
}

const ORDINALS: Record<string, number> = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, "الاولي": 1, "الاول": 1, "الثانيه": 2, "الثاني": 2, "الثالثه": 3, "الثالث": 3, "الرابعه": 4, "الرابع": 4, "الخامسه": 5, "الخامس": 5 };

/** "The second one": a position in the list being read, or null. */
function pickedPosition(normalized: string): number | null {
  for (const word of normalized.split(" ")) if (Object.hasOwn(ORDINALS, word)) return ORDINALS[word];
  return extractNumber(normalized);
}

function choiceInput(session: CallSession, transcript: string, locale: Locale): AnswerInput | null {
  const normalized = compact(transcript);
  const exact = session.replies.find((item) => [item.value, item.label.ar, item.label.en].some((text) => compact(text) === normalized));
  if (exact) return { value: exact.value };
  if (session.step === "health_pick" || session.step === "open_clarify") {
    const nameKey = (text: string) => compact(text).split(" ").map((word) => word.startsWith("ال") && word.length > 3 ? word.slice(2) : word).join(" ");
    const names = session.replies.filter((reply) => [reply.label.ar, reply.label.en].some((label) => nameKey(label) === nameKey(transcript)));
    if (names.length === 1) return { value: names[0].value };
    if (names.length > 1) return null;
  }

  const reading = readSpeech(transcript);
  if (needsClearAnswer(session) && /(?:^|\s)(?:يمكن|اظن|اعتقد|اتوقع|maybe|perhaps|probably|possibly|i\s+think)(?:\s|$)/u.test(normalized)) return null;
  if (needsClearAnswer(session) && reading.affirm && (reading.deny || reading.bareNegation)) return null;
  const intended = intentReply(session, reading);
  if (intended) return { value: intended };
  if (reading.unknown) return null;
  if (session.step === "report_summary" || session.step === "instruction_review") return null;
  if (session.replies.some((reply) => reply.value === "good") && session.replies.some((reply) => reply.value === "critical")) return null;

  const words = normalized.replaceAll(" ", "_");
  if (YES_WORDS.has(normalized) || YES_WORDS.has(words)) {
    const reply = semanticReply(session.replies, "yes");
    if (reply) return { value: reply.value };
  }
  if (NO_WORDS.has(normalized)) {
    const reply = semanticReply(session.replies, "no");
    if (reply) return { value: reply.value };
  }

  const clear = needsClearAnswer(session);
  const reply = clear ? undefined : overlapReply(session.replies, transcript, locale);
  if (reply) return { value: reply.value };
  const negative = isNegated(transcript) ? session.replies.find((item) => NEGATIVE_ANSWERS.has(item.value)) : undefined;
  return negative ? { value: negative.value } : null;
}

export function mapSpeechToInput(
  session: CallSession,
  transcript: string,
  digits: string | null = null,
  locale: Locale = "ar",
  confidence: string | null = null,
): AnswerInput | null {
  void confidence;
  if (session.inputMode === "none") return null;
  if (session.inputMode === "number" && digits && /^\d{1,6}$/.test(digits)) return { text: digits };
  if (session.inputMode === "choices" && digits && /^\d{2}$/.test(digits)) {
    const reply = session.replies[Number(digits) - 1];
    return reply ? { value: reply.value } : null;
  }
  if (digits && /^\d$/.test(digits)) {
    if (session.inputMode === "choices") {
      const reply = session.replies[Number(digits) - 1];
      return reply ? { value: reply.value } : null;
    }
    if (session.inputMode === "number") return { text: digits };
    if (session.inputMode === "time") return { text: extractTime(digits) ?? digits };
    return null;
  }

  if (digits) return null;
  const raw = transcript.trim().slice(0, 300);
  const normalized = compact(raw);
  if (["report_summary", "report_correct_pick"].includes(session.step) && session.replies.some((reply) => reply.value === "end_without_save") && /(?:^|\s)(?:لا\s+(?:تحفظ|تحفظه|تحفظها|تسجل|تسجله)|بدون\s+حفظ|don\s*t\s+save|do\s+not\s+save|save\s+nothing)(?:\s|$)/u.test(normalized)) return { value: "end_without_save" };
  if (session.step === "instruction_review") {
    if (/(?:^|\s)(?:الغ|الغها|الغيها|الغي|الغاء|cancel|لا\s+(?:تحفظ|تحفظها|ترسل|ترسلها)|don\s*t\s+save|do\s+not\s+save)(?:\s|$)/u.test(normalized)) return { value: "instructions_cancel" };
    if (/(?:^|\s)(?:عدل|عدلها|غير|غيرها|تعديل|change|edit|correct\s+one)(?:\s|$)/u.test(normalized)) return { value: "instructions_correct" };
  }
  if (session.step === "instruction_correct_pick") {
    if (/^(?:ارجع|رجوع|القائمه|back|back to the list)$/.test(normalized)) return { value: "back_to_review" };
    const position = pickedPosition(normalized);
    const picked = position === null ? undefined : session.replies.find((reply) => reply.value === `correct:${position - 1}`);
    if (picked) return { value: picked.value };
  }
  if (session.step === "instruction_date") {
    if (/(?:^|\s)(?:اي وقت|any ?time)(?:\s|$)/u.test(normalized)) return { value: "any_time" };
    const days = /(?:^|\s)(?:يوم|ايام|يوما|days?)(?:\s|$)/u.test(normalized) ? extractNumber(raw.replace(/(?:^|\s)(?:يوم|أيام|ايام|يوماً|يوما|days?)(?:\s|$)/gu, " ")) : null;
    if (days !== null) return { text: `in ${days} days` };
  }
  if (session.step === "open_more" && /^(?:لا|لاء|لا والله|بس|خلاص|ما عندي شي|ما عندي شيء|ما فيه شي|مافيه شي|no|nothing|nothing else|that s all|done)$/.test(normalized)) return { value: "open_done" };
  if (session.step === "report_mode_choice") {
    if (/(?:^|\s)(?:مفتوح|مفتوحه|open|freely)(?:\s|$)/u.test(normalized)) return { value: "mode_open" };
    if (/(?:^|\s)(?:اسئله|سوال|guided|questions)(?:\s|$)/u.test(normalized)) return { value: "mode_guided" };
  }
  if (session.step === "report_correct_pick") {
    if (/^(?:ارجع|رجوع|الملخص|back|summary|back to summary)$/.test(normalized)) return { value: "back_to_summary" };
    if (/^(?:لا تحفظ|لا تحفظه|لا تحفظ التقرير|لا تحفظ التحديث|don t save|do not save|don t save it|do not save it)$/.test(normalized)) return { value: "end_without_save" };
    const correction = overlapReply(session.replies.filter((reply) => reply.value.startsWith("correct:")), raw, locale);
    if (correction) return { value: correction.value };
    return null;
  }
  // Spelling varies by recogniser, and «ما ادري» saved as free text would read as a reported fact.
  if (session.inputMode !== "choices" && ((session.inputMode === "number" && UNKNOWN_PHRASE.test(compact(raw))) || UNKNOWN_WORDS.has(compact(raw)) ||
    /^(?:والله\s+)?(?:ما\s*ادري|ما\s*اعرف|لا\s*اعرف|مدري|i\s*don\s*t\s*know|i\s*do\s*not\s*know|not\s*sure)(?:\s+(?:والله|honestly))?$/.test(compact(raw)))) {
    const reply = unknownReply(session.replies);
    if (reply) return { value: reply.value };
  }
  if (session.replies.some((reply) => reply.value === "skip_question") && /^(?:تخطي|تخطاه|تخطى|skip|skip it)$/.test(compact(raw))) return { value: "skip_question" };
  if (isOffTopicAnswer(session, compact(raw))) return null;
  if (session.inputMode === "text") return raw ? { text: raw } : null;
  if (session.inputMode === "number") {
    const number = extractNumber(raw);
    return number === null ? null : { text: String(number) };
  }
  if (session.inputMode === "time") {
    const time = extractTime(raw);
    return time ? { text: time } : null;
  }
  const item = currentItem(session);
  if (item?.kind === "predefined" && item.answerKind === "level" && (item.resource === "feed" || item.resource === "water")) {
    const quantity = extractNumber(raw);
    if (quantity !== null) return { text: String(quantity) };
  }
  return choiceInput(session, raw, locale);
}
