import { topicsInWords } from "@/domain/conversation/answer-topic";
import type { CallSession, OpenFact } from "@/domain/conversation/engine";
import type { Locale, Workspace } from "@/domain/types";
import { DETERMINED, extractNumber, mapSpeechToInput } from "../speech";
import { evidenceWords } from "./answer-check";

const contains = (source: string, part: string) => Boolean(part) && (` ${source} `).includes(` ${part} `);
const token = (word: string) => word.replace(/[ءؤئ]/gu, "").replace(/^و(?=.{2})/u, "").replace(/^ال(?=.{3})/u, "");
const tokens = (words: string) => words.split(" ").filter(Boolean).map(token);
/**
 * The model hears the audio and the transcript is a separate reading of it, so a long phrase may differ by a word.
 * A short one must match, and a topic named in the phrase must be in what was transcribed.
 */
const supports = (source: string, part: string) => {
  const heard = new Set(tokens(source));
  const said = tokens(part);
  if (!said.length || said.filter((word) => heard.has(word)).length / said.length < 0.8) return false;
  // The one word allowed to differ can never be a number.
  if (part.split(" ").some((word) => !heard.has(token(word)) && extractNumber(word) !== null)) return false;
  const transcribed = topicsInWords(source);
  return [...topicsInWords(part)].every((topic) => transcribed.has(topic));
};
const namesCamel = (evidence: string, name: string) => contains(tokens(evidence).join(" "), tokens(name).join(" "));
const asNote = (evidence: string): OpenFact => ({ type: "other", note: evidence, evidence });
const NEGATORS = new Set(["ما", "مو", "مب", "مش", "لا", "ولا", "مافي", "مافيه", "ماكو", "بدون", "ليس", "no", "not", "never", "without"]);
const NEGATION_REACH = 2;

/** «ما فيه ناقة مريضة» quoted as «ناقة مريضة», or "not" dropped mid-phrase: the transcript's words for what was denied, or null. */
function deniedPhrase(utterance: string, evidence: string): string | null {
  const spoken = utterance.split(/\s+/).filter((word) => evidenceWords(word));
  const heardWords = spoken.map((word) => token(evidenceWords(word)));
  const said = tokens(evidence);
  if (said.some((word) => NEGATORS.has(word))) return null;
  const first = heardWords.indexOf(said[0]);
  const last = heardWords.lastIndexOf(said[said.length - 1]);
  if (first < 0 || last < first) return null;
  const from = Math.max(0, first - NEGATION_REACH);
  // «لا، وضحة مريضة» answers the question; it doesn't deny what follows.
  const interjection = (index: number) => ["لا", "no"].includes(heardWords[index]) && (index === 0 || /[,،.؟?!]$/u.test(spoken[index - 1]))
    && (/[,،.]$/u.test(spoken[index]) || !DETERMINED.has(evidenceWords(spoken[index + 1] ?? "")));
  const negator = heardWords.slice(from, last + 1).findIndex((word, offset) => NEGATORS.has(word) && !interjection(from + offset));
  return negator < 0 ? null : spoken.slice(Math.min(from + negator, first), last + 1).join(" ");
}
const string = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= 300;
const nullableText = (value: unknown) => value === null || string(value);
const number = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 999999;

export function validateFacts(facts: unknown[], utterance: string, session: CallSession, workspace: Workspace, locale: Locale): { facts: OpenFact[]; dropped: boolean } {
  const heard = evidenceWords(utterance);
  const valid: OpenFact[] = [];
  for (const candidate of facts) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const fact = candidate as Record<string, unknown>;
    if (!string(fact.evidence)) continue;
    const evidence = evidenceWords(fact.evidence);
    if (!supports(heard, evidence)) continue;
    const topics = topicsInWords(evidence);
    const keys: Record<string, string[]> = {
      camel_health: ["type", "camelId", "scope", "status", "note", "evidence"],
      herd_count: ["type", "count", "evidence"],
      resource: ["type", "resource", "level", "quantity", "evidence"],
      custom: ["type", "questionId", "answer", "evidence"],
      other: ["type", "note", "evidence"],
    };
    const allowed = typeof fact.type === "string" ? keys[fact.type] : undefined;
    if (!allowed || Object.keys(fact).some((key) => !allowed.includes(key))) continue;
    if (fact.type === "resource" || fact.type === "camel_health") {
      // Never read a denied condition as the condition: keep what was actually said, for the owner and the read-back.
      const denied = deniedPhrase(utterance, evidence);
      if (denied) { valid.push(asNote(denied)); continue; }
    }
    if (fact.type === "herd_count") {
      if (!topics.has("herd") || !number(fact.count) || !Number.isInteger(fact.count) || extractNumber(fact.evidence) !== fact.count) continue;
      valid.push({ type: "herd_count", count: fact.count, evidence: fact.evidence });
    } else if (fact.type === "resource") {
      if (!["feed", "water", "fences", "shelter", "medicine"].includes(String(fact.resource)) || !topics.has(fact.resource as "feed")) continue;
      if (fact.level !== null && !["good", "medium", "low", "critical", "unknown"].includes(String(fact.level))) continue;
      if (fact.quantity !== null && (!number(fact.quantity) || extractNumber(fact.evidence) !== fact.quantity)) continue;
      if (fact.level === null && fact.quantity === null) continue;
      if (fact.level !== null) {
        const replies = ["good", "medium", "low", "critical", "unknown"].map((value) => ({ id: value, value, label: { ar: value, en: value } }));
        const parsed = mapSpeechToInput({ ...session, step: "fact_resource", inputMode: "choices", replies }, fact.evidence, null, locale);
        // The topic is right but the words don't state that level: keep the words, not the guess.
        if (parsed?.value !== fact.level) { valid.push(asNote(fact.evidence)); continue; }
      }
      valid.push(fact as unknown as OpenFact);
    } else if (fact.type === "camel_health") {
      if (!["one", "all"].includes(String(fact.scope)) || !["healthy", "watch", "sick", "unknown"].includes(String(fact.status)) || !nullableText(fact.note)) continue;
      if (typeof fact.note === "string" && !supports(evidence, evidenceWords(fact.note))) continue;
      const named = workspace.camels.find((camel) => camel.id === fact.camelId && namesCamel(evidence, evidenceWords(camel.name)));
      if (!topics.has("herd") && !named) continue;
      if (fact.scope === "all" && !/(?:^| )(?:كل الحلال|الحلال كله|الحلال كلها|كل الابل|الابل كلها|كل النوق|النوق كلها|كل النياق|كل الجمال|all (?:the )?(?:camels|herd)|every camel)(?: |$)/u.test(evidence)) continue;
      const replies = ["healthy", "watch", "sick", "unknown"].map((value) => ({ id: value, value, label: { ar: value, en: value } }));
      const parsed = mapSpeechToInput({ ...session, step: "fact_health", inputMode: "choices", replies }, fact.evidence, null, locale);
      if (parsed?.value !== fact.status) { valid.push(asNote(fact.evidence)); continue; }
      valid.push({ ...fact, camelId: fact.scope === "all" ? null : named?.id ?? null } as unknown as OpenFact);
    } else if (fact.type === "custom") {
      if (!session.data.queue?.some((item) => item.kind === "custom" && item.id === fact.questionId) || !string(fact.answer) || !supports(evidence, evidenceWords(fact.answer))) continue;
      valid.push(fact as unknown as OpenFact);
    } else if (fact.type === "other") {
      if (!string(fact.note) || !supports(evidence, evidenceWords(fact.note))) continue;
      valid.push(fact as unknown as OpenFact);
    }
  }
  return { facts: valid, dropped: valid.length !== facts.length || facts.length === 0 };
}
