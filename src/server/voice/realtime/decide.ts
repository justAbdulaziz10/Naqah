/**
 * What one tool call means, worked out with no storage involved. A real call keeps the outcome on
 * its row and the Voice Lab carries it in a signed token, so a Lab run tests the rules a phone call follows.
 */
import { askedTopic, topicsInWords } from "@/domain/conversation/answer-topic";
import { addUrgentNote, addWorkerNote, reportSummaryId, type AnswerInput, type CallSession, type OpenFact } from "@/domain/conversation/engine";
import { makePersonalizer } from "@/domain/conversation/personalize";
import { PREDEFINED_QUESTIONS } from "@/domain/catalog";
import type { Locale, Workspace } from "@/domain/types";
import type { VoiceCallSession } from "../farm-call";
import { camelClauses, mapSpeechToInput, namedCamels, numbersSaid, saysRestAreWell, topicSegments, unknownReply } from "../speech";
import { spokenWording } from "../twiml";
import { askedToStop, evidenceWords, isGarbled, isLeakedHint, refuseAnswer } from "./answer-check";
import { isNaturalConfirmation, isVerifiedConfirmation } from "./confirmation";
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
};
const URGENT: Record<Locale, string> = {
  ar: "إذا الأمر عاجل، اتصل بصاحب العزبة مباشرة الآن. ناقة ما تبلغ أحد بالطوارئ. ",
  en: "If this is urgent, call the ranch owner directly now. NAQAH does not report emergencies to anyone. ",
};
const CONFIRM_AGAIN: Record<Locale, string> = { ar: "ما سمعتك زين. أحفظه؟ قل إيه، أو اضغط واحد.", en: "I didn't catch that. Shall I save it? Say yes, or press 1." };
const isDeny = (heard: string) => /(?:^| )(?:لا|غلط|عدل|عدله|تعديل|no|wrong|change)(?: |$)/.test(evidenceWords(heard));
const SAVE_OR_CORRECT: Record<Locale, string> = { ar: "أحفظ التحديث، ولا تبي تعدل شي؟", en: "Shall I save the update, or would you like to correct something?" };
const SECOND_TRY: Record<Locale, string> = { ar: "قلها لي بكلمة. ", en: "In a word, please. " };
const UNKNOWN: Record<Locale, string> = {
  ar: "ما قدرت أحدد الإجابة، بنسجلها غير معروف ونكمل. ",
  en: "I couldn't determine the answer. I'll mark it unknown and continue. ",
};
const NOTED: Record<Locale, string> = { ar: "سجلت كلامك كملاحظة. ", en: "I've kept that as a note. " };
const NOTED_BACK: Record<Locale, string> = { ar: "سجلتها ملاحظة، وخلنا نرجع للسؤال. ", en: "I've kept that as a note. Back to the question. " };
const isHerdHealth = (session: CallSession) => {
  const item = session.step === "report_question" ? session.data.queue?.[session.data.reportIndex ?? 0] : undefined;
  return item?.kind === "predefined" && item.answerKind === "herd-health";
};
const LEVEL_REPLIES = ["good", "medium", "low", "critical", "unknown"].map((value) => ({ id: value, value, label: { ar: value, en: value } }));

/**
 * The parts of a guided answer that already answer a later question in this call («الحلال بخير والعلف قليل»).
 * Each part must state a level in its own words and pass the same checks as an open-mode fact.
 * `rest` is set when something else was said that only a note can keep.
 */
function coveredAhead(session: CallSession, heard: string, workspace: Workspace, locale: Locale): { facts: OpenFact[]; rest: boolean } {
  const asked = askedTopic(session);
  const queue = session.data.queue ?? [];
  const index = session.data.reportIndex ?? 0;
  const facts: OpenFact[] = [];
  let rest = false;
  for (const segment of topicSegments(heard)) {
    if (!segment.topic || segment.topic === asked) continue;
    const id = PREDEFINED_QUESTIONS.find((question) => question.requires === segment.topic)?.id;
    const later = Boolean(id) && queue.findIndex((item) => item.id === id) > index && !facts.some((fact) => fact.type === "resource" && fact.resource === segment.topic);
    const level = later ? mapSpeechToInput({ ...session, step: "fact_resource", inputMode: "choices", replies: LEVEL_REPLIES }, segment.text, null, locale)?.value : undefined;
    const checked = level && level !== "unknown"
      ? validateFacts([{ type: "resource", resource: segment.topic, level, quantity: null, evidence: segment.text }], heard, session, workspace, locale)
      : null;
    const fact = checked && !checked.dropped ? checked.facts[0] : undefined;
    if (fact?.type === "resource") facts.push(fact);
    else rest = true;
  }
  return { facts, rest };
}
const ACK: Record<Locale, string[]> = { ar: ["تمام. ", "زين. ", "طيب. "], en: ["Okay. ", "Got it. ", "Thanks. "] };
const ACKNOWLEDGEMENTS = new Set([...ACK.ar, ...ACK.en, "ما عليه. ", "That's fine. ", "الحمد لله. ", "Good to hear. ", "سلامتها. ", "سلامته. ", "سلامتهم. ", "Sorry to hear that. ", "الله يعطيك العافية. ", "Thank you. ", "عدلتها. ", "Changed. "]);
const isAcknowledgement = (prefix: string) => ACKNOWLEDGEMENTS.has(prefix);

/**
 * A word that shows the answer was heard before the next question, the way a person would say it. It never
 * claims anything was saved, and nothing is said at the summary, where the next words are the save or a goodbye.
 */
function acknowledge(session: CallSession, chosen: AnswerInput, workspace: Workspace, locale: Locale): string {
  if (chosen.value?.startsWith("correct:")) return locale === "ar" ? "طيب، نعدلها. " : "Sure, let's fix that. ";
  if (session.step === SUMMARY_STEP || session.step === "report_correct_pick" || session.step === "report_mode_choice") return "";
  if (session.data.correcting) return locale === "ar" ? "عدلتها. " : "Changed. ";
  if (chosen.value === "unknown") return locale === "ar" ? "ما عليه. " : "That's fine. ";
  if (isHerdHealth(session) && chosen.value === "yes") return locale === "ar" ? "الحمد لله. " : "Good to hear. ";
  if (isHerdHealth(session) && chosen.value === "no") {
    if (locale === "en") return "Sorry to hear that. ";
    const camels = workspace.camels.filter((camel) => chosen.camelIds?.includes(camel.id));
    return camels.length > 1 ? "سلامتهم. " : camels[0]?.sex === "male" ? "سلامته. " : "سلامتها. ";
  }
  const item = session.step === "report_question" ? session.data.queue?.[session.data.reportIndex ?? 0] : undefined;
  if (item?.kind === "task" && chosen.value === "yes") return locale === "ar" ? "الله يعطيك العافية. " : "Thank you. ";
  const turn = session.turns.filter((entry) => entry.speaker === "worker").length;
  return ACK[locale][turn % ACK[locale].length];
}
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
  const steady = session.replies.find((reply) => ["mode_guided", "open_done", "back_to_summary"].includes(reply.value))?.value;
  if (!unknown && steady) return { input: { value: steady }, prefix: PREFIXES.unclear[locale] };
  return { input: { value: unknown ?? "unknown" }, prefix: UNKNOWN[locale] };
}

export function promptResult(session: CallSession, workspace: Workspace, locale: Locale, status = "ok", error?: string, prefix = "", reason?: ClarifyReason, silent = false, spoken?: string[]): ToolResponse {
  const prompt = promptFor(session, spoken ?? spokenFrom(session, Math.max(0, session.turns.length - 1), workspace, locale), workspace, locale);
  const labels = reason === "asked_meaning" && prompt.replies.length ? " " + prompt.replies.map((reply) => reply.label).join(locale === "ar" ? "، " : ", ") : "";
  // The summary is read exactly as the engine wrote it, so what the worker confirms is what is saved.
  const words = (prompt.isSummary && isAcknowledgement(prefix) ? "" : prefix) + prompt.question + labels;
  return {
    output: stringify({ status, ...(error ? { error } : {}), ...prompt }),
    awaitingConfirmation: session.step === SUMMARY_STEP,
    ...(silent ? { silent: true as const } : prompt.isSummary ? { summaryText: words, summaryId: reportSummaryId(session, locale) } : { sayText: words }),
    repromptText: prompt.isSummary ? SAVE_OR_CORRECT[locale] : prompt.question,
    end: null,
    goodbye: null,
  };
}

export type ToolCounters = Partial<Pick<RealtimeState, "confirmationFailures" | "refusalAt" | "refusals" | "refusedAnswer" | "noiseAt" | "noiseCount" | "closed">>;

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
  /** A natural call: its own confirmation rule, and no keypad fallback after three tries. */
  natural?: boolean;
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

const BUSY = /(?:^| )(?:مشغول|مو فاضي|مب فاضي|بعدين|مو الحين|مب الحين|موب الحين|not now|busy|later)(?: |$)/;
const DIDNT_HEAR = /^(?:الو|الوو|هلو|الو الو|مين|مين معي|من معي|مين معاي|مين انت|alo|hello|hello hello|who is this)$/;

/**
 * «جاهز؟» right after the greeting. The words decide, not the tool: anything but «مو الحين» starts the report,
 * and «ألو؟», «مين؟» or no words at all mean the greeting wasn't heard over the line.
 */
function readyChoice(heard: string): "ready" | "busy" | "again" {
  const words = evidenceWords(heard);
  if (BUSY.test(words) || askedToStop(heard)) return "busy";
  if (!words || isLeakedHint(heard) || DIDNT_HEAR.test(words) || /^(?:نعم|ايوه|ايه)\s*[?؟]$/u.test(heard.trim())) return "again";
  return "ready";
}

export function decideTool({ session: current, counters, workspace, locale, name, args, spoke, heard, heardSummaryId, now, keypad = false, natural = false }: ToolTurn): ToolDecision {
  if (current.step === "report_ready" && name !== "flag_urgent" && (spoke || name === "end_call")) {
    return { kind: "apply", session: { ...current, voiceSilences: 0 }, chosen: { value: name === "end_call" ? "busy" : readyChoice(heard) }, prefix: "", counters: {}, checkError: null };
  }
  const position = positionOf(current);
  let next: ToolCounters = {};
  let checkError: string | null = null;
  const reply = (result: ToolResponse, refused: string | null = null): ToolDecision => ({ kind: "reply", result, refused, counters: next, checkError });
  const refuse = (error: string, prefix = PREFIXES.unclear[locale]) => reply(promptResult(current, workspace, locale, "invalid", error, prefix), error);
  /** Asked differently: in one short phrase, with the options a worker can pick from. */
  const secondTry = (error?: string): ToolDecision => reply(promptResult(current, workspace, locale, error ? "invalid" : "ok", error, SECOND_TRY[locale], "asked_meaning"), error ?? null);
  let check = checkTool(name, args, spoke || name === "end_call", current, locale);
  let gaveUp: string | null = null;
  const offered = toolsFor(current).some((entry) => entry.name === name);
  const noise = isLeakedHint(heard) || !evidenceWords(heard) || /^(?:noise|background noise|silence|ضجيج|ضوضاء|صمت)$/.test(evidenceWords(heard)) || (check.ok && check.action.kind === "repeat" && check.action.reason === "noise");
  // An urgent concern always gets its warning, even if the transcript failed.
  if (offered && name !== "end_call" && name !== "confirm_report" && name !== "flag_urgent" && noise) {
    const count = counters.noiseAt === position ? (counters.noiseCount ?? 0) + 1 : 1;
    next = { ...next, noiseAt: position, noiseCount: count, ...(count >= 4 ? { closed: true } : {}) };
    // The audio isn't getting through: the keypad is the different thing to try.
    if (count >= 4) return reply(fallbackResult(), "noise");
    const explicitNoise = !evidenceWords(heard) && check.ok && check.action.kind === "repeat" && check.action.reason === "noise";
    return reply(promptResult(current, workspace, locale, "ok", undefined, count > 1 ? PREFIXES.noise[locale] : "", undefined, explicitNoise || count === 1), "noise");
  }
  const confirming = name === "confirm_report" && typeof args === "object" && args !== null && "confirmed" in args && args.confirmed === true;
  const verified = keypad || (spoke && Boolean(heard) && (isVerifiedConfirmation(heard, current, locale) || (natural && isNaturalConfirmation(heard, current, locale))));
  if (name === "end_call" && !askedToStop(heard)) {
    return reply(promptResult(current, workspace, locale, "invalid", "worker_has_not_asked_to_stop", evidenceWords(heard) ? PREFIXES.unclear[locale] : "", undefined, !evidenceWords(heard)), "worker_has_not_asked_to_stop");
  }
  if (confirming && current.step === SUMMARY_STEP && (!verified || heardSummaryId !== reportSummaryId(current, locale))) {
    const error = heardSummaryId !== reportSummaryId(current, locale) ? "summary_not_finished" : "worker_has_not_confirmed";
    const failures = (counters.confirmationFailures ?? 0) + 1;
    // A natural call has no keypad to fall back to: after three tries it says plainly nothing was saved and ends.
    if (natural && failures >= 3) return { kind: "end", session: { ...current, voiceSilences: 0 }, counters: { ...next, confirmationFailures: failures }, checkError: error };
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
    if (refusals < 3) return refusals === 2 ? secondTry(check.error) : refuse(check.error);
    const fallback = afterRefusals(current, locale);
    check = { ok: true, action: { kind: "answer", input: fallback.input } };
    gaveUp = fallback.prefix;
  }
  // A clear answer the model hesitated on is still a clear answer.
  if (check.ok && check.action.kind === "repeat" && check.action.reason === "unclear" && ![SUMMARY_STEP, "report_correct_pick"].includes(current.step)) {
    const said = mapSpeechToInput(current, heard, null, locale)?.value;
    if (said !== undefined && current.replies.some((entry) => entry.value === said)) check = { ok: true, action: { kind: "answer", input: { value: said } } };
  }
  const action = check.action;
  let forced: { input: AnswerInput; prefix: string } | null = null;
  // A worker can ask for a repeat, but a call never circles: the second time is asked differently, the third moves on.
  if (action.kind === "repeat") {
    const tries = counters.refusalAt === position ? (counters.refusals ?? 0) + 1 : 1;
    next = { ...next, refusalAt: position, refusals: tries };
    if (tries === 1) return reply(promptResult(current, workspace, locale, "ok", undefined, PREFIXES[action.reason][locale], action.reason));
    if (tries === 2) return secondTry();
    if (current.step === SUMMARY_STEP || current.step === "report_correct_pick") {
      next = { ...next, closed: true };
      return reply(fallbackResult());
    }
    forced = afterRefusals(current, locale);
  }
  let session: VoiceCallSession = { ...current, voiceSilences: 0 };
  let chosen: AnswerInput | null = forced ? forced.input : action.kind === "answer" ? action.input : action.kind === "confirm" ? { value: action.confirmed ? "confirm_save" : "correct" } : null;
  let prefix = forced?.prefix ?? gaveUp ?? "";
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
  // An answer that also covers a later question answers that one too; anything else it mentions is kept as a note.
  let ahead: OpenFact[] = [];
  if (action.kind === "answer" && name === "answer_question" && gaveUp === null && session.inputMode !== "text") {
    const asked = askedTopic(session);
    if (asked !== "other" && asked !== "task" && [...topicsInWords(evidenceWords(heard))].some((topic) => topic !== asked)) {
      const covered = coveredAhead(session, heard, workspace, locale);
      ahead = covered.facts;
      if (covered.rest) session = addWorkerNote(session, heard);
    }
  }
  // «كلهم تمام بس نورة تعبانة»: when the words say one isn't well, "all well" is never what gets recorded.
  if (action.kind === "answer" && name === "answer_question" && action.input.value === "yes" && isHerdHealth(current) && mapSpeechToInput(current, heard, null, locale)?.value === "no") {
    action.input = { value: "no" };
    chosen = action.input;
  }
  if (action.kind === "answer" && name === "answer_question" && gaveUp === null) {
    let refused = refuseAnswer(session, action.input, heard, locale, workspace.camels.map((camel) => camel.name));
    // Phone transcription misses short replies the model heard («عشرين»). The model hearing the same answer twice,
    // from two separate replies, outweighs the transcript; the read-back still lets the worker correct it.
    const said = JSON.stringify(action.input);
    // A task still closes only on words that say it is done.
    const closesTask = askedTopic(session) === "task";
    // Only a count: a different number in the transcript is a contradiction, and words that say nothing about the
    // camels («الجو حار») must never become "all well".
    const missed = refused === "number_not_in_answer" && numbersSaid(heard).size === 0;
    if (refused && missed && !closesTask && counters.refusalAt === position && counters.refusedAnswer === said) refused = null;
    if (refused) {
      const refusals = counters.refusalAt === position ? (counters.refusals ?? 0) + 1 : 1;
      next = { ...next, refusalAt: position, refusals, refusedAnswer: said };
      if (refused === "answer_off_topic") {
        const noted = addWorkerNote(session, heard);
        if (refusals < 3) return { kind: "stay", session: noted, result: promptResult(noted, workspace, locale, "invalid", refused, NOTED_BACK[locale]), refused, counters: next, checkError };
        session = noted;
      }
      if (refusals === 2) return secondTry(refused);
      if (refusals < 3) return refuse(refused, PREFIXES.unclear[locale]);
      ({ input: chosen, prefix } = afterRefusals(session, locale));
    }
  }
  // «كلهم بخير بس نورة تعبانة»: the worker already said which camels, and maybe that the rest are well.
  if (chosen?.value === "no" && isHerdHealth(current)) {
    const named = namedCamels(heard, workspace.camels);
    const restWell = saysRestAreWell(heard);
    const notes = Object.fromEntries(Object.entries(camelClauses(heard, named)).map(([id, note]) => [id, note.slice(0, 300)]));
    chosen = named.length
      ? { value: "no", text: heard.trim().slice(0, 300), camelIds: named.map((camel) => camel.id), restWell, ...(Object.keys(notes).length ? { camelNotes: notes } : {}), ...(named.length === 1 ? { camelId: named[0].id } : {}) }
      : { ...chosen, restWell };
  }
  if (chosen && ahead.length && current.step === "report_question") chosen = { ...chosen, heardAhead: ahead };
  if (action.kind === "urgent") {
    // The model heard the audio and the note may word it differently, so what is kept is what was transcribed.
    const note = heard.trim().slice(0, 300);
    if (note) session = addUrgentNote(session, workspace, now, note);
    return { kind: "stay", session, result: promptResult(session, workspace, locale, "ok", undefined, URGENT[locale]), counters: next, checkError };
  }
  if (!chosen) return { kind: "end", session, counters: next, checkError };
  return { kind: "apply", session, chosen, prefix: droppedFacts ? NOTED[locale] : prefix || acknowledge(current, chosen, workspace, locale), counters: next, checkError };
}
