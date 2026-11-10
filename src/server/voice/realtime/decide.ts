/**
 * What one tool call means, worked out with no storage involved. A real call keeps the outcome on
 * its row and the Voice Lab carries it in a signed token, so a Lab run tests the rules a phone call follows.
 */
import { askedTopic, topicsInWords } from "@/domain/conversation/answer-topic";
import { addUrgentNote, addWorkerNote, reportSummaryId, type AnswerInput, type CallSession, type OpenFact } from "@/domain/conversation/engine";
import { makePersonalizer } from "@/domain/conversation/personalize";
import type { Locale, Workspace } from "@/domain/types";
import type { VoiceCallSession } from "../farm-call";
import { mapSpeechToInput, unknownReply } from "../speech";
import { spokenWording } from "../twiml";
import { askedToStop, evidenceWords, isGarbled, refuseAnswer } from "./answer-check";
import { isVerifiedConfirmation } from "./confirmation";
import { validateFacts } from "./facts";
import type { RealtimeState, ToolResponse } from "./state";
import { checkTool, promptFor, SUMMARY_STEP, toolsFor, type ClarifyReason } from "./tools";

const stringify = (value: object) => JSON.stringify(value);

export function fallbackResult(): ToolResponse {
  return {
    output: stringify({ status: "error", error: "temporary_failure", message: "Nothing was confirmed as saved. Do not tell the worker anything was saved." }),
    awaitingConfirmation: false,
    end: "fallback",
    goodbye: null,
  };
}

const PREFIXES: Record<ClarifyReason, Record<Locale, string>> = {
  noise: { ar: "ما وصلني صوتك زين. ", en: "I couldn't hear you clearly. " },
  asked_to_repeat: { ar: "أكيد. ", en: "Of course. " },
  asked_meaning: { ar: "المقصود بهالسؤال: ", en: "This question means: " },
  unclear: { ar: "معليش، ما فهمت جوابك زين. ", en: "Sorry, I didn't understand that answer. " },
  off_topic: { ar: "خلنا نرجع للسؤال. ", en: "Let's return to the question. " },
};
const URGENT: Record<Locale, string> = {
  ar: "إذا الأمر عاجل، اتصل بصاحب العزبة مباشرة الآن. ناقة ما تبلغ أحد بالطوارئ. ",
  en: "If this is urgent, call the ranch owner directly now. NAQAH does not report emergencies to anyone. ",
};
const CONFIRM_AGAIN: Record<Locale, string> = { ar: "ما سمعتك زين. أحفظه؟ قل إيه، أو اضغط واحد.", en: "I didn't catch that. Shall I save it? Say yes, or press 1." };
const isDeny = (heard: string) => /(?:^| )(?:لا|غلط|عدل|عدله|تعديل|no|wrong|change)(?: |$)/.test(evidenceWords(heard));
const SAVE_OR_CORRECT: Record<Locale, string> = { ar: "أحفظ التحديث، ولا تبي تعدل شي؟", en: "Shall I save the update, or would you like to correct something?" };
const UNKNOWN: Record<Locale, string> = {
  ar: "ما قدرت أحدد الإجابة، بنسجلها غير معروف ونكمل. ",
  en: "I couldn't determine the answer. I'll mark it unknown and continue. ",
};
const NOTED: Record<Locale, string> = { ar: "سجلت كلامك كملاحظة. ", en: "I've kept that as a note. " };
const NOTED_BACK: Record<Locale, string> = { ar: "سجلتها ملاحظة، وخلنا نرجع للسؤال. ", en: "I've kept that as a note. Back to the question. " };
const positionOf = (session: CallSession) => [session.step, session.data.reportIndex ?? 0, session.data.tempCamelId ?? "", session.data.draftRevision ?? 0].join(":");

/** The agent's lines from a turn onwards, with the farm's real names. Here and not imported, because farm-call brings in the write paths. */
export function spokenFrom(session: CallSession, from: number, ws: Workspace, locale: Locale): string[] {
  const personalize = makePersonalizer(ws);
  return session.turns.slice(from).filter((turn) => turn.speaker === "agent").map((turn) => spokenWording(turn.literal ? turn.text[locale] : personalize(turn.text[locale]), locale, turn.literal));
}

/** The answer after too many refusals. A yes/no check has no "unknown", and anything but "no" would confirm what nobody confirmed. */
function afterRefusals(session: CallSession, locale: Locale): { input: AnswerInput; prefix: string } {
  const unknown = unknownReply(session.replies)?.value;
  if (!unknown && session.replies.some((reply) => reply.value === "no")) return { input: { value: "no" }, prefix: PREFIXES.unclear[locale] };
  return { input: { value: unknown ?? "unknown" }, prefix: UNKNOWN[locale] };
}

export function promptResult(session: CallSession, workspace: Workspace, locale: Locale, status = "ok", error?: string, prefix = "", reason?: ClarifyReason, silent = false, spoken?: string[]): ToolResponse {
  const prompt = promptFor(session, spoken ?? spokenFrom(session, Math.max(0, session.turns.length - 1), workspace, locale), workspace, locale);
  const labels = reason === "asked_meaning" && prompt.replies.length ? " " + prompt.replies.map((reply) => reply.label).join(locale === "ar" ? "، " : ", ") : "";
  const words = prefix + prompt.question + labels;
  return {
    output: stringify({ status, ...(error ? { error } : {}), ...prompt }),
    awaitingConfirmation: session.step === SUMMARY_STEP,
    ...(silent ? { silent: true as const } : prompt.isSummary ? { summaryText: words, summaryId: reportSummaryId(session, locale) } : { sayText: words }),
    repromptText: prompt.isSummary ? SAVE_OR_CORRECT[locale] : prompt.question,
    end: null,
    goodbye: null,
  };
}

export type ToolCounters = Partial<Pick<RealtimeState, "confirmationFailures" | "refusalAt" | "refusals" | "noiseAt" | "noiseCount" | "closed">>;

export type ToolTurn = {
  session: CallSession;
  counters: ToolCounters;
  workspace: Workspace;
  locale: Locale;
  name: unknown;
  args: unknown;
  /** The worker spoke since the last tool call. */
  spoke: boolean;
  /** The final transcript of that turn. Empty when speech recognition returned nothing. */
  heard: string;
  heardSummaryId?: string;
  now: Date;
  /** Key 1, pressed after the whole summary was heard. */
  keypad?: boolean;
};

export type ToolDecision = { counters: ToolCounters; checkError: string | null } & (
  /** Nothing moved: this result goes back as it is. */
  | { kind: "reply"; result: ToolResponse; refused: string | null }
  /** The question stays, but the session changed: an urgent concern or a kept note. */
  | { kind: "stay"; session: VoiceCallSession; result: ToolResponse; refused?: string }
  /** An answer the engine should take. */
  | { kind: "apply"; session: VoiceCallSession; chosen: AnswerInput; prefix: string }
  | { kind: "end"; session: VoiceCallSession }
);

export function decideTool({ session: current, counters, workspace, locale, name, args, spoke, heard, heardSummaryId, now, keypad = false }: ToolTurn): ToolDecision {
  const position = positionOf(current);
  let next: ToolCounters = {};
  let checkError: string | null = null;
  const reply = (result: ToolResponse, refused: string | null = null): ToolDecision => ({ kind: "reply", result, refused, counters: next, checkError });
  const refuse = (error: string, prefix = PREFIXES.unclear[locale]) => reply(promptResult(current, workspace, locale, "invalid", error, prefix), error);
  let check = checkTool(name, args, spoke || name === "end_call", current, locale);
  let gaveUp: string | null = null;
  const offered = toolsFor(current).some((entry) => entry.name === name);
  const noise = !evidenceWords(heard) || /^(?:noise|background noise|silence|ضجيج|ضوضاء|صمت)$/.test(evidenceWords(heard)) || (check.ok && check.action.kind === "repeat" && check.action.reason === "noise");
  // An urgent concern always gets its warning, even if the transcript failed.
  if (offered && name !== "end_call" && name !== "confirm_report" && name !== "flag_urgent" && noise) {
    const count = counters.noiseAt === position ? (counters.noiseCount ?? 0) + 1 : 1;
    next = { ...next, noiseAt: position, noiseCount: count };
    const explicitNoise = !evidenceWords(heard) && check.ok && check.action.kind === "repeat" && check.action.reason === "noise";
    return reply(promptResult(current, workspace, locale, "ok", undefined, count > 1 ? PREFIXES.noise[locale] : "", undefined, explicitNoise || count === 1), "noise");
  }
  const confirming = name === "confirm_report" && typeof args === "object" && args !== null && "confirmed" in args && args.confirmed === true;
  const verified = keypad || (spoke && Boolean(heard) && isVerifiedConfirmation(heard, current, locale));
  if (name === "end_call" && !askedToStop(heard)) {
    return reply(promptResult(current, workspace, locale, "invalid", "worker_has_not_asked_to_stop", evidenceWords(heard) ? PREFIXES.unclear[locale] : "", undefined, !evidenceWords(heard)), "worker_has_not_asked_to_stop");
  }
  if (confirming && current.step === SUMMARY_STEP && (!verified || heardSummaryId !== reportSummaryId(current, locale))) {
    const error = heardSummaryId !== reportSummaryId(current, locale) ? "summary_not_finished" : "worker_has_not_confirmed";
    const failures = (counters.confirmationFailures ?? 0) + 1;
    next = { ...next, confirmationFailures: failures, closed: failures >= 3 };
    if (failures >= 3) return reply(fallbackResult(), error);
    // The summary was heard, so only the question needs asking again.
    if (error === "worker_has_not_confirmed") return reply({ ...promptResult(current, workspace, locale, "invalid", error), summaryText: undefined, summaryId: undefined, sayText: CONFIRM_AGAIN[locale], repromptText: CONFIRM_AGAIN[locale] }, error);
    return reply(promptResult(current, workspace, locale, "invalid", error), error);
  }
  if (!check.ok) {
    checkError = check.error;
    if (name !== "answer_question" || check.error === "worker_has_not_answered" || !offered) return refuse(check.error);
    const refusals = counters.refusalAt === position ? (counters.refusals ?? 0) + 1 : 1;
    next = { ...next, refusalAt: position, refusals };
    if (refusals < 3) return refuse(check.error);
    const fallback = afterRefusals(current, locale);
    check = { ok: true, action: { kind: "answer", input: fallback.input } };
    gaveUp = fallback.prefix;
  }
  const action = check.action;
  if (action.kind === "repeat") return reply(promptResult(current, workspace, locale, "ok", undefined, PREFIXES[action.reason][locale], action.reason));
  let session: VoiceCallSession = { ...current, voiceSilences: 0 };
  let chosen: AnswerInput | null = action.kind === "answer" ? action.input : action.kind === "confirm" ? { value: action.confirmed ? "confirm_save" : "correct" } : null;
  let prefix = gaveUp ?? "";
  let droppedFacts = false;
  if (action.kind === "facts") {
    const checked = validateFacts(action.facts, heard, session, workspace, locale);
    // Whatever couldn't be sorted into a topic is kept in the worker's own words, never guessed at and never lost.
    const asNote: OpenFact = { type: "other", note: heard.trim().slice(0, 300), evidence: heard };
    chosen = { facts: checked.dropped ? [...checked.facts, asNote] : checked.facts };
    droppedFacts = checked.dropped;
  }
  // A confirmation that "no" needs words too: unclear audio must not reopen a correct report.
  if (name === "confirm_report" && action.kind === "confirm" && !action.confirmed && !["correct", "end_without_save"].includes(mapSpeechToInput(session, heard, null, locale)?.value ?? "") && !isDeny(heard)) {
    return reply({ ...promptResult(current, workspace, locale, "invalid", "worker_has_not_confirmed"), summaryText: undefined, summaryId: undefined, sayText: CONFIRM_AGAIN[locale], repromptText: CONFIRM_AGAIN[locale] }, "worker_has_not_confirmed");
  }
  // A custom question takes the worker's words, not a canned reply the model picked for them.
  if (action.kind === "answer" && action.input.value?.startsWith("suggest_")) {
    if (isGarbled(evidenceWords(heard), locale)) return refuse("answer_unclear");
    action.input = { text: heard.trim().slice(0, 300) };
    chosen = action.input;
  }
  if (action.kind === "answer" && current.step === "health_status" && action.input.value !== undefined && heard.trim()) {
    chosen = { value: action.input.value, text: heard.trim().slice(0, 300) };
  }
  // Free text is kept as the worker said it, not as the model worded it.
  if (action.kind === "answer" && action.input.text !== undefined && session.inputMode === "text" && heard.trim()) {
    chosen = mapSpeechToInput(session, heard, null, locale) ?? chosen;
  }
  // An answer that also mentions another topic: the answer stands and the rest is kept with it.
  if (action.kind === "answer" && name === "answer_question" && gaveUp === null && session.inputMode !== "text") {
    const asked = askedTopic(session);
    if (asked !== "other" && asked !== "task" && [...topicsInWords(evidenceWords(heard))].some((topic) => topic !== asked)) session = addWorkerNote(session, heard);
  }
  if (action.kind === "answer" && name === "answer_question" && gaveUp === null) {
    const refused = refuseAnswer(session, action.input, heard, locale, workspace.camels.map((camel) => camel.name));
    if (refused) {
      const refusals = counters.refusalAt === position ? (counters.refusals ?? 0) + 1 : 1;
      next = { ...next, refusalAt: position, refusals };
      if (refused === "answer_off_topic") {
        const noted = addWorkerNote(session, heard);
        if (refusals < 3) return { kind: "stay", session: noted, result: promptResult(noted, workspace, locale, "invalid", refused, NOTED_BACK[locale]), refused, counters: next, checkError };
        session = noted;
      }
      if (refusals < 3) return refuse(refused, PREFIXES.unclear[locale]);
      ({ input: chosen, prefix } = afterRefusals(session, locale));
    }
  }
  if (action.kind === "urgent") {
    // The model heard the audio and the note may word it differently, so what is kept is what was transcribed.
    const note = heard.trim().slice(0, 300);
    if (note) session = addUrgentNote(session, workspace, now, note);
    return { kind: "stay", session, result: promptResult(session, workspace, locale, "ok", undefined, URGENT[locale]), counters: next, checkError };
  }
  if (!chosen) return { kind: "end", session, counters: next, checkError };
  return { kind: "apply", session, chosen, prefix: droppedFacts ? NOTED[locale] : prefix, counters: next, checkError };
}
