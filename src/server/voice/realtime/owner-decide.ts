/**
 * What one tool call means on an owner's summary call. Same protocol as a worker call: the model
 * classifies, the server speaks, and nothing reaches the farm without a verified yes.
 */
import { reportSummaryId, type AnswerInput, type CallSession } from "@/domain/conversation/engine";
import type { Locale, Workspace } from "@/domain/types";
import type { VoiceCallSession } from "../farm-call";
import { mapSpeechToInput } from "../speech";
import { askedToStop, evidenceWords, isLeakedHint } from "./answer-check";
import { isVerifiedConfirmation } from "./confirmation";
import { fallbackResult, spokenFrom, type ToolCounters, type ToolDecision, type ToolTurn } from "./decide";
import { readBackProposals, validateCorrection, validateProposals } from "./owner-facts";
import { checkOwnerTool, ownerPromptFor, ownerToolsFor, REVIEW_STEP } from "./owner-tools";
import type { ToolResponse } from "./state";
import type { ClarifyReason } from "./tools";

const stringify = (value: object) => JSON.stringify(value);

const PREFIXES: Record<ClarifyReason, Record<Locale, string>> = {
  noise: { ar: "ما وصلني صوتك زين. ", en: "I couldn't hear you clearly. " },
  asked_to_repeat: { ar: "أكيد، أعيد. ", en: "Of course. " },
  asked_meaning: { ar: "المقصود: ", en: "This means: " },
  unclear: { ar: "معليش، ما فهمت عليك زين. ", en: "Sorry, I didn't quite follow that. " },
};
const SAVE_OR_CHANGE: Record<Locale, string> = { ar: "أحفظها، ولا تبي تغير شي؟", en: "Shall I save these, or would you like to change something?" };

const positionOf = (session: CallSession) => [session.step, session.data.schedulingIndex ?? "", session.data.correctingIndex ?? "", session.data.draftRevision ?? 0].join(":");

export function ownerPromptResult(session: CallSession, workspace: Workspace, locale: Locale, status = "ok", error?: string, prefix = "", reason?: ClarifyReason, silent = false, spoken?: string[]): ToolResponse {
  const prompt = ownerPromptFor(session, spoken ?? spokenFrom(session, Math.max(0, session.turns.length - 1), workspace, locale), workspace, locale);
  const labels = reason === "asked_meaning" && prompt.replies.length ? " " + prompt.replies.map((reply) => reply.label).join(locale === "ar" ? "، " : ", ") : "";
  const words = prefix + prompt.question + labels;
  return {
    output: stringify({ status, ...(error ? { error } : {}), ...prompt }),
    awaitingConfirmation: session.step === REVIEW_STEP,
    ...(silent ? { silent: true as const } : prompt.isSummary ? { summaryText: words, summaryId: reportSummaryId(session, locale) } : { sayText: words }),
    repromptText: prompt.isSummary ? SAVE_OR_CHANGE[locale] : prompt.question,
    end: null,
    goodbye: null,
  };
}

export function decideOwnerTool({ session: current, counters, workspace, locale, name, args, spoke, heard, heardSummaryId, now, keypad = false }: ToolTurn): ToolDecision {
  const position = positionOf(current);
  let next: ToolCounters = {};
  const reply = (result: ToolResponse, refused: string | null = null, checkError: string | null = null): ToolDecision => ({ kind: "reply", result, refused, counters: next, checkError });
  /** Three refusals in a row and the script takes over: it can capture the owner's words without a model. */
  const refuse = (error: string): ToolDecision => {
    const refusals = counters.refusalAt === position ? (counters.refusals ?? 0) + 1 : 1;
    next = { ...next, refusalAt: position, refusals, closed: refusals >= 3 };
    return reply(refusals >= 3 ? fallbackResult() : ownerPromptResult(current, workspace, locale, "invalid", error, PREFIXES.unclear[locale]), error, error);
  };

  const check = checkOwnerTool(name, args, spoke || name === "end_call", current);
  const offered = ownerToolsFor(current).some((entry) => entry.name === name);
  const noise = isLeakedHint(heard) || !evidenceWords(heard) || /^(?:noise|background noise|silence|ضجيج|ضوضاء|صمت)$/.test(evidenceWords(heard)) || (check.ok && check.action.kind === "repeat" && check.action.reason === "noise");
  if (offered && name !== "end_call" && name !== "confirm_instructions" && noise) {
    const count = counters.noiseAt === position ? (counters.noiseCount ?? 0) + 1 : 1;
    next = { ...next, noiseAt: position, noiseCount: count };
    const explicitNoise = !evidenceWords(heard) && check.ok && check.action.kind === "repeat" && check.action.reason === "noise";
    return reply(ownerPromptResult(current, workspace, locale, "ok", undefined, count > 1 ? PREFIXES.noise[locale] : "", undefined, explicitNoise || count === 1), "noise");
  }

  const confirming = name === "confirm_instructions" && typeof args === "object" && args !== null && "confirmed" in args && args.confirmed === true;
  if (confirming && current.step === REVIEW_STEP) {
    const stale = heardSummaryId !== reportSummaryId(current, locale);
    if (stale || (!keypad && (!spoke || !heard || !isVerifiedConfirmation(heard, current, locale)))) {
      const error = stale ? "summary_not_finished" : "owner_has_not_confirmed";
      const failures = (counters.confirmationFailures ?? 0) + 1;
      next = { ...next, confirmationFailures: failures, closed: failures >= 2 };
      return reply(failures >= 2 ? fallbackResult() : ownerPromptResult(current, workspace, locale, "invalid", error), error);
    }
  }

  if (name === "end_call" && !askedToStop(heard)) {
    return reply(ownerPromptResult(current, workspace, locale, "invalid", "owner_has_not_asked_to_stop", evidenceWords(heard) ? PREFIXES.unclear[locale] : "", undefined, !evidenceWords(heard)), "owner_has_not_asked_to_stop");
  }
  if (!check.ok) return refuse(check.error);
  const { action } = check;
  // Never circle on one prompt: after three the script takes over.
  if (action.kind === "repeat") {
    const tries = counters.refusalAt === position ? (counters.refusals ?? 0) + 1 : 1;
    next = { ...next, refusalAt: position, refusals: tries, closed: tries >= 3 };
    return reply(tries >= 3 ? fallbackResult() : ownerPromptResult(current, workspace, locale, "ok", undefined, PREFIXES[action.reason][locale], action.reason));
  }
  const session: VoiceCallSession = { ...current, voiceSilences: 0 };
  const said = mapSpeechToInput(session, heard, null, locale)?.value;
  let chosen: AnswerInput;
  if (action.kind === "end") {
    if (action.reason === "cannot_continue") return { kind: "end", session, counters: next, checkError: null };
    chosen = { value: "instructions_cancel" };
  } else if (action.kind === "none") {
    if (said === "instruction_yes") return refuse("answer_conflicts_with_words");
    chosen = { value: "instruction_no" };
  } else if (action.kind === "propose") {
    if (!action.items.length) {
      if (current.step !== "instruction_yesno" || said !== "instruction_yes") return refuse("instructions_not_supported");
      chosen = { value: "instruction_yes" };
    } else {
      // The transcript first; if it is too garbled to back the words up, the read-back and the owner's yes check them.
      const instructions = validateProposals(action.items, heard, now) ?? (evidenceWords(heard) ? readBackProposals(action.items, heard, now) : null);
      if (!instructions) return refuse("instructions_not_supported");
      chosen = { text: heard, instructions };
    }
  } else if (action.kind === "remove") {
    if (action.index >= (current.data.pendingInstructions?.length ?? 0)) return refuse("value_not_allowed");
    chosen = { text: heard, instructionRemove: action.index };
  } else if (action.kind === "confirm") {
    chosen = { value: action.confirmed ? "instructions_confirm" : "instructions_correct" };
  } else {
    const correction = validateCorrection(action.args, heard, current.data.pendingInstructions?.length ?? 0, now);
    if (!correction.ok) return refuse(correction.error);
    chosen = { text: heard, instructionCorrection: correction.correction };
  }
  return { kind: "apply", session, chosen, prefix: "", counters: next, checkError: null };
}
