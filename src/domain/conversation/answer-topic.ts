/**
 * Does the worker's reply talk about something else? «العلف زين» says «زين», but about the feed, so it
 * cannot answer "how are the camels". This fires only when the words name another ranch topic and
 * nothing of the one asked, which leaves short replies («زين», «باقي شوي») alone.
 * Takes normalized words: see `normalizeSpeech` in the voice layer.
 */
import type { CallSession } from "./engine";

export type AnswerTopic = "herd" | "feed" | "water" | "fences" | "shelter" | "medicine" | "task" | "other";
type Topic = Exclude<AnswerTopic, "task" | "other">;

const WORDS: Record<Topic, readonly string[]> = {
  herd: ["حلال", "ابل", "ناقه", "ناقتي", "نوق", "نياق", "بعير", "بعران", "جمل", "جمال", "حاشي", "حيشان", "قعود", "مريض", "مريضه", "تعبان", "تعبانه", "صحه", "صحتها", "صحتهم", "جرح", "مجروح", "تعرج", "يعرج", "كلها", "كلهم", "camel", "camels", "herd", "sick", "ill", "injured", "limping", "health"],
  feed: ["علف", "اعلاف", "شعير", "برسيم", "تبن", "دريس", "قت", "feed", "fodder", "hay", "barley"],
  water: ["مويه", "مويا", "مياه", "ماء", "الما", "ماي", "خزان", "خزانات", "وايت", "حوض", "water", "tank", "trough"],
  fences: ["سور", "اسوار", "سياج", "شبك", "بوابه", "fence", "fences", "fencing", "gate"],
  shelter: ["مظله", "مظلات", "الظل", "خيمه", "shelter", "shade"],
  medicine: ["دواء", "دوا", "ادويه", "علاج", "تطعيم", "لقاح", "ابره", "medicine", "medication", "vaccine"],
};

const TOPIC_OF_QUESTION: Record<string, Topic> = {
  herd_health: "herd",
  herd_count: "herd",
  feed_level: "feed",
  water_level: "water",
  fences_condition: "fences",
  shelter_condition: "shelter",
  medicine_stock: "medicine",
};

const TOPIC_OF_WORD = new Map(
  (Object.entries(WORDS) as [Topic, readonly string[]][]).flatMap(([topic, list]) => list.map((word) => [word, topic] as const)),
);

/** Arabic joins «و» and «ال» to the word: «والعلف». */
function topicOf(word: string): Topic | undefined {
  const withoutAnd = word.startsWith("و") && word.length > 2 ? word.slice(1) : word;
  const withoutThe = withoutAnd.startsWith("ال") && withoutAnd.length > 3 ? withoutAnd.slice(2) : withoutAnd;
  return TOPIC_OF_WORD.get(word) ?? TOPIC_OF_WORD.get(withoutAnd) ?? TOPIC_OF_WORD.get(withoutThe);
}

export function askedTopic(session: CallSession): AnswerTopic {
  if (session.step === "open_clarify") return "herd";
  const item = session.data.queue?.[session.data.reportIndex ?? 0];
  if (item?.kind === "task") return "task";
  if (item?.kind !== "predefined") return "other";
  return TOPIC_OF_QUESTION[item.id] ?? "other";
}

export function topicsInWords(normalizedWords: string): Set<Topic> {
  return new Set((normalizedWords.match(/[\p{L}\p{N}]+/gu) ?? []).map(topicOf).filter((topic): topic is Topic => Boolean(topic)));
}

export function isOffTopicAnswer(session: CallSession, normalizedWords: string, camelNames: readonly string[] = []): boolean {
  if (!["report_question", "health_pick", "health_status", "health_note", "health_more", "herd_count_detail"].includes(session.step)) return false;
  const asked = askedTopic(session);
  if (asked === "other" || asked === "task") return false;
  const words = normalizedWords.match(/[\p{L}\p{N}]+/gu) ?? [];
  const topics = topicsInWords(normalizedWords);
  if (asked === "herd" && words.some((word) => camelNames.includes(word))) return false;
  return !topics.has(asked) && topics.size > 0;
}
