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
  "صفر": 0, "واحد": 1, "واحده": 1, "احد": 1, "اثنين": 2, "اثنان": 2, "ثنتين": 2, "اثنتين": 2,
  "ثلاث": 3, "ثلاثه": 3, "اربع": 4, "اربعه": 4, "خمس": 5, "خمسه": 5, "ست": 6, "سته": 6,
  "سبع": 7, "سبعه": 7, "ثمان": 8, "ثماني": 8, "ثمانيه": 8, "تسع": 9, "تسعه": 9,
  "عشر": 10, "عشره": 10, "احد عشر": 11, "احدعشر": 11, "اثنا عشر": 12, "اثنى عشر": 12,
  "اثناعشر": 12, "ثلاثه عشر": 13, "ثلاث عشر": 13, "اربع عشر": 14, "اربعه عشر": 14,
  "خمسه عشر": 15, "خمس عشر": 15, "سته عشر": 16, "ست عشر": 16, "سبعه عشر": 17,
  "سبع عشر": 17, "ثمانيه عشر": 18, "ثمان عشر": 18, "تسعه عشر": 19, "تسع عشر": 19,
  "عشرين": 20, "عشرون": 20, "ثلاثين": 30, "ثلاثون": 30, "اربعين": 40, "اربعون": 40,
  "خمسين": 50, "خمسون": 50, "ستين": 60, "ستون": 60, "سبعين": 70, "سبعون": 70,
  "ثمانين": 80, "ثمانون": 80, "تسعين": 90, "تسعون": 90,
};

const ARABIC_UNITS: Record<string, number> = {
  واحد: 1, واحده: 1, احد: 1, اثنين: 2, اثنان: 2, ثنتين: 2, اثنتين: 2,
  ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5, ست: 6, سته: 6,
  سبع: 7, سبعه: 7, ثمان: 8, ثماني: 8, ثمانيه: 8, تسع: 9, تسعه: 9,
};
const ARABIC_TENS: Record<string, number> = {
  عشرين: 20, عشرون: 20, ثلاثين: 30, ثلاثون: 30, اربعين: 40, اربعون: 40,
  خمسين: 50, خمسون: 50, ستين: 60, ستون: 60, سبعين: 70, سبعون: 70,
  ثمانين: 80, ثمانون: 80, تسعين: 90, تسعون: 90,
};

export function extractNumber(input: string): number | null {
  const normalized = normalizeSpeech(input);
  const digit = normalized.match(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/u);
  if (digit) return Number(digit[1]);

  const tokens = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  for (let index = 0; index < tokens.length; index += 1) {
    const pair = `${tokens[index]} ${tokens[index + 1] ?? ""}`.trim();
    if (pair in NUMBER_WORDS) return NUMBER_WORDS[pair];
    const nextJoined = tokens[index + 1]?.startsWith("و") ? tokens[index + 1].slice(1) : "";
    if (ARABIC_UNITS[tokens[index]] && ARABIC_TENS[nextJoined]) {
      return ARABIC_UNITS[tokens[index]] + ARABIC_TENS[nextJoined];
    }
    if (ARABIC_TENS[tokens[index]] && ARABIC_UNITS[nextJoined]) {
      return ARABIC_TENS[tokens[index]] + ARABIC_UNITS[nextJoined];
    }
    if (ARABIC_UNITS[tokens[index]] && tokens[index + 1] === "و" && ARABIC_TENS[tokens[index + 2]]) {
      return ARABIC_UNITS[tokens[index]] + ARABIC_TENS[tokens[index + 2]];
    }
    if (ARABIC_TENS[tokens[index]] && tokens[index + 1] === "و" && ARABIC_UNITS[tokens[index + 2]]) {
      return ARABIC_TENS[tokens[index]] + ARABIC_UNITS[tokens[index + 2]];
    }
    if (tokens[index] in NUMBER_WORDS) return NUMBER_WORDS[tokens[index]];
  }
  return null;
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
const SAVE_WORDS = new Set(["احفظ", "احفظه", "حفظ", "اكد", "تاكيد", "confirm", "save", "save it"]);
const DONE_WORDS = new Set(["خلصت", "خلصتها", "انتهيت", "done", "finished"]);

const words = (input: string) => compact(input).match(/[\p{L}\p{N}]+/gu) ?? [];
const isNegated = (input: string) => words(input).some((word) => NEGATORS.has(word));
const replyIsNegated = (reply: Reply) => isNegated(reply.label.ar) || isNegated(reply.label.en);

/** These steps change the farm for good, so a near match is not enough: it takes a clear answer. */
function needsClearAnswer(session: CallSession): boolean {
  if (session.step === "report_summary" || session.step === "callback_task_confirmation") return true;
  return session.step === "report_question" && session.data.queue?.[session.data.reportIndex ?? 0]?.kind === "task";
}

function overlapReply(replies: Reply[], transcript: string, locale: Locale): Reply | undefined {
  const inputTokens = words(transcript).filter((token) => !STOP_WORDS.has(token));
  if (!inputTokens.length) return undefined;
  const negated = isNegated(transcript);
  let best: { reply: Reply; score: number } | undefined;
  for (const reply of replies) {
    // «ما خلصت» shares a word with «إيه، خلصت», and means the opposite.
    if (replyIsNegated(reply) !== negated) continue;
    const preferred = (compact(reply.label[locale]).match(/[\p{L}\p{N}]+/gu) ?? []).filter((token) => !STOP_WORDS.has(token));
    const secondary = (compact(reply.label[locale === "ar" ? "en" : "ar"]).match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((token) => !STOP_WORDS.has(token));
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

function choiceInput(session: CallSession, transcript: string, locale: Locale): AnswerInput | null {
  const normalized = compact(transcript);
  const words = normalized.replaceAll(" ", "_");
  if (UNKNOWN_WORDS.has(normalized) || UNKNOWN_WORDS.has(words)) {
    const reply = semanticReply(session.replies, "unknown");
    if (reply) return { value: reply.value };
  }
  if (YES_WORDS.has(normalized)) {
    const reply = semanticReply(session.replies, "yes");
    if (reply) return { value: reply.value };
  }
  if (NO_WORDS.has(normalized)) {
    const reply = semanticReply(session.replies, "no");
    if (reply) return { value: reply.value };
  }
  const exact = session.replies.find((item) => [item.value, item.label.ar, item.label.en].some((text) => compact(text) === normalized));
  if (exact) return { value: exact.value };

  const clear = needsClearAnswer(session);
  if (clear && (session.step === "report_summary" ? SAVE_WORDS : DONE_WORDS).has(normalized)) {
    const reply = semanticReply(session.replies, "yes");
    if (reply) return { value: reply.value };
  }
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
): AnswerInput | null {
  if (session.inputMode === "none") return null;
  if (session.inputMode === "number" && digits && /^\d{1,6}$/.test(digits)) return { text: digits };
  if (digits && /^\d$/.test(digits)) {
    if (session.inputMode === "choices") {
      const reply = session.replies[Number(digits) - 1];
      return reply ? { value: reply.value } : null;
    }
    if (session.inputMode === "number") return { text: digits };
    if (session.inputMode === "time") return { text: extractTime(digits) ?? digits };
    return { text: digits };
  }

  const raw = transcript.trim().slice(0, 300);
  // Spelling varies by recogniser, and «ما ادري» saved as free text would read as a reported fact.
  if (session.inputMode !== "choices" && UNKNOWN_WORDS.has(compact(raw))) {
    const reply = unknownReply(session.replies);
    if (reply) return { value: reply.value };
  }
  if (session.inputMode === "text") return raw ? { text: raw } : null;
  if (session.inputMode === "number") {
    const number = extractNumber(raw);
    return number === null ? null : { text: String(number) };
  }
  if (session.inputMode === "time") {
    const time = extractTime(raw);
    return time ? { text: time } : null;
  }
  return choiceInput(session, raw, locale);
}
