/** What the owner asked for, checked against the transcript before the engine sees any of it. */
import type { InstructionCorrection, ProposedInstruction } from "@/domain/conversation/engine";
import { MAX_INSTRUCTIONS, readDue } from "@/domain/conversation/owner-briefing";
import { extractNumber, wordBacking } from "../speech";
import { evidenceWords } from "./answer-check";
import { supports, token } from "./facts";
import { cleanString, onlyKeys } from "./tools";

const MAX_WORDS = 300;
const NEGATORS = new Set(["ما", "مو", "مب", "مش", "لا", "ولا", "بدون", "no", "not", "never", "without"]);
const NEGATION_REACH = 2;
const TIME_WORDS = /(?:^| )(?:اليوم|الليله|بكره|بكرا|باجر|باكر|غدا|بعد|الساعه|الصبح|الصباح|الظهر|العصر|المغرب|العشا|العشاء|الفجر|الاحد|الاثنين|الثلاثاء|الثلاث|الاربعاء|الاربع|الخميس|الجمعه|السبت|today|tonight|tomorrow|morning|noon|afternoon|evening|night|at|am|pm|sunday|monday|tuesday|wednesday|thursday|friday|saturday|days?|week)(?: |$)/u;
const ANY_TIME_WORDS = /(?:^| )(?:(?:ب)?اي وقت|متي ما|وقت ما|وقت ما يقدر|any ?time|whenever|no rush)(?: |$)/u;

const expanded = (text: string) => text.replace(/n['’]t\b/giu, " not");

/**
 * An instruction quoted without its «لا» or "not" means the opposite. Returns the transcript's words for it, or null.
 * This is not the worker check: on a call about what to do, «لا تصلح» forbids, it doesn't answer.
 */
function droppedNegation(utterance: string, evidence: string): string | null {
  const spoken = expanded(utterance).split(/\s+/).filter((word) => evidenceWords(word));
  const heard = spoken.map((word) => token(evidenceWords(word)));
  const said = evidenceWords(expanded(evidence)).split(" ").filter(Boolean).map(token);
  if (!said.length || said.some((word) => NEGATORS.has(word))) return null;
  const first = heard.indexOf(said[0]);
  const last = heard.lastIndexOf(said[said.length - 1]);
  if (first < 0 || last < first) return null;
  const from = Math.max(0, first - NEGATION_REACH);
  // A clause-ending «لا،» answers "any instructions?" and doesn't touch what follows.
  const negator = heard.slice(from, last + 1).findIndex((word, offset) => NEGATORS.has(word) && !/[,،.]$/u.test(spoken[from + offset]));
  return negator < 0 ? null : spoken.slice(Math.min(from + negator, first), last + 1).join(" ");
}

/** Keeps a due the words back up. A due with no time word goes back to null, and the server asks. */
function supportedDue(due: unknown, words: string, now: Date): ProposedInstruction["due"] {
  if (due === "any_time") return ANY_TIME_WORDS.test(words) ? "any_time" : null;
  if (typeof due !== "string" || !readDue(due, now)) return null;
  return TIME_WORDS.test(words) || extractNumber(words) !== null ? due : null;
}

/** All or nothing: a list with one unsupported item is asked again, so nothing goes missing without the owner knowing. */
export function validateProposals(raw: unknown[], utterance: string, now: Date): ProposedInstruction[] | null {
  if (!raw.length || raw.length > MAX_INSTRUCTIONS) return null;
  const heard = evidenceWords(utterance);
  const items: ProposedInstruction[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!onlyKeys(item, ["message", "kind", "due", "evidence"]) || (item.kind !== "task" && item.kind !== "information")) return null;
    if (!cleanString(item.evidence, MAX_WORDS) || !cleanString(item.message, MAX_WORDS)) return null;
    if (!supports(heard, evidenceWords(item.evidence))) return null;
    const denied = droppedNegation(utterance, item.evidence);
    const evidence = denied ?? item.evidence.trim();
    // The model may trim the words, but what the worker will hear must be the owner's.
    const message = denied || !supports(evidenceWords(evidence), evidenceWords(item.message)) || droppedNegation(evidence, item.message) ? evidence : item.message.trim();
    items.push({ message, kind: item.kind, due: item.kind === "task" ? supportedDue(item.due, evidenceWords(evidence), now) : null, evidence });
  }
  return items;
}

/**
 * The model's own words for instructions the transcript couldn't back up. Phone transcription garbles Saudi speech
 * («خلي ودي وضح البيضة» for «خليه يودي وضحة البيطري», call 5d7773) while the model heard the audio. Safe only because
 * every instruction is read back to the owner word for word and saved only after their spoken yes (REVIEW_STEP).
 * Still close to what was heard: some of the words are the owner's and at most half are not, so an instruction the
 * owner never gave («يصلح السياج» for «قل له يسقي الحلال») is still refused. A due must be backed by the quoted words.
 */
export function readBackProposals(raw: unknown[], utterance: string, now: Date): ProposedInstruction[] | null {
  if (!raw.length || raw.length > MAX_INSTRUCTIONS) return null;
  const items: ProposedInstruction[] = [];
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
    const item = candidate as Record<string, unknown>;
    if (!onlyKeys(item, ["message", "kind", "due", "evidence"]) || (item.kind !== "task" && item.kind !== "information")) return null;
    if (!cleanString(item.evidence, MAX_WORDS) || !cleanString(item.message, MAX_WORDS)) return null;
    const evidence = item.evidence.trim();
    const backing = wordBacking(evidence, [utterance]);
    if (!backing.fromWorker || backing.unbacked.length * 2 > backing.content) return null;
    items.push({ message: item.message.trim(), kind: item.kind, due: item.kind === "task" ? supportedDue(item.due, evidenceWords(evidence), now) : null, evidence });
  }
  return items;
}

export type CorrectionCheck = { ok: true; correction: InstructionCorrection } | { ok: false; error: string };

export function validateCorrection(args: Record<string, unknown>, utterance: string, count: number, now: Date): CorrectionCheck {
  const { index, kind, message, due } = args;
  if (typeof index !== "number" || !Number.isInteger(index) || index < 0 || index >= count) return { ok: false, error: "value_not_allowed" };
  if (kind !== undefined && kind !== "task" && kind !== "information") return { ok: false, error: "invalid_arguments" };
  const correction: InstructionCorrection = { index, ...(kind ? { kind } : {}) };
  const heard = evidenceWords(utterance);
  if (message !== undefined) {
    if (!cleanString(message, MAX_WORDS) || !supports(heard, evidenceWords(message))) return { ok: false, error: "message_not_supported" };
    correction.message = droppedNegation(utterance, message) ?? message.trim();
  }
  if (due !== undefined) {
    const supported = supportedDue(due, heard, now);
    if (due === null || supported === null) return { ok: false, error: "due_not_supported" };
    correction.due = supported;
  }
  return { ok: true, correction };
}
