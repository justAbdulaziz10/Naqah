/**
 * The only things the model can do on a call. Arguments are checked here against the engine's
 * current step, so the model chooses among what the step allows and cannot add anything else.
 */
import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import { makePersonalizer } from "@/domain/conversation/personalize";
import type { Locale, Workspace } from "@/domain/types";
import { mapSpeechToInput } from "../speech";
import { spokenWording } from "../twiml";

export const REALTIME_TOOLS = [
  {
    type: "function",
    name: "answer_question",
    description: "Record the worker's answer to the current question. Pass value for one of the allowed replies, or text only when textAllowed is true.",
    parameters: {
      type: "object",
      properties: {
        value: { type: "string", description: "One of the allowed reply values for the current question." },
        text: { type: "string", description: "The worker's answer in their own words, or the number they said." },
      },
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "confirm_report",
    description: "Only after reading the summary. confirmed is true only when the worker clearly said to save it; false when they said not to.",
    parameters: {
      type: "object",
      properties: { confirmed: { type: "boolean" } },
      required: ["confirmed"],
      additionalProperties: false,
    },
  },
  {
    type: "function",
    name: "end_call",
    description: "End the call without saving: the worker asked to stop, or the call cannot continue.",
    parameters: {
      type: "object",
      properties: { reason: { type: "string", enum: ["worker_ended", "cannot_continue"] } },
      required: ["reason"],
      additionalProperties: false,
    },
  },
] as const;

export type ToolAction =
  | { kind: "answer"; input: AnswerInput }
  | { kind: "confirm"; confirmed: boolean }
  | { kind: "end" };

export type ToolCheck = { ok: true; action: ToolAction } | { ok: false; error: string };

const MAX_VALUE = 64;
const MAX_TEXT = 300;
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const SUMMARY_STEP = "report_summary";

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const onlyKeys = (args: Record<string, unknown>, allowed: string[]) => Object.keys(args).every((key) => allowed.includes(key));
const cleanString = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);

/** "How much is left?" also takes a quantity for feed and water, as the scripted call does. */
function takesQuantity(session: CallSession): boolean {
  const item = session.step === "report_question" ? session.data.queue?.[session.data.reportIndex ?? 0] : undefined;
  return item?.kind === "predefined" && item.answerKind === "level" && (item.resource === "feed" || item.resource === "water");
}

export const textAllowed = (session: CallSession) =>
  session.inputMode === "text" || session.inputMode === "number" || session.inputMode === "time" || takesQuantity(session);

function checkAnswer(args: Record<string, unknown>, session: CallSession, locale: Locale): ToolCheck {
  if (session.step === SUMMARY_STEP) return { ok: false, error: "use_confirm_report" };
  if (session.inputMode === "none") return { ok: false, error: "no_answer_expected" };
  if (!onlyKeys(args, ["value", "text"]) || ("value" in args) === ("text" in args)) return { ok: false, error: "pass_exactly_one_of_value_or_text" };
  if ("value" in args) {
    if (!cleanString(args.value, MAX_VALUE) || !session.replies.some((reply) => reply.value === args.value)) return { ok: false, error: "value_not_allowed" };
    return { ok: true, action: { kind: "answer", input: { value: args.value } } };
  }
  if (!textAllowed(session)) return { ok: false, error: "text_not_allowed" };
  if (!cleanString(args.text, MAX_TEXT)) return { ok: false, error: "invalid_text" };
  // The scripted call's own parsing: digits in either script, spoken numbers, «ما أدري».
  const input = mapSpeechToInput(session, args.text, null, locale);
  if (!input || (session.inputMode === "choices" && input.text === undefined)) return { ok: false, error: session.inputMode === "text" ? "invalid_text" : "number_not_understood" };
  return { ok: true, action: { kind: "answer", input } };
}

export function checkTool(name: unknown, args: unknown, spoke: boolean, session: CallSession, locale: Locale): ToolCheck {
  if (name !== "answer_question" && name !== "confirm_report" && name !== "end_call") return { ok: false, error: "unknown_tool" };
  if (!isPlainObject(args)) return { ok: false, error: "invalid_arguments" };
  if (name === "answer_question") return spoke ? checkAnswer(args, session, locale) : { ok: false, error: "worker_has_not_answered" };
  if (name === "confirm_report") {
    if (session.step !== SUMMARY_STEP) return { ok: false, error: "not_at_summary" };
    if (!onlyKeys(args, ["confirmed"]) || typeof args.confirmed !== "boolean") return { ok: false, error: "invalid_arguments" };
    if (args.confirmed && !spoke) return { ok: false, error: "worker_has_not_confirmed" };
    return { ok: true, action: { kind: "confirm", confirmed: args.confirmed } };
  }
  if (!onlyKeys(args, ["reason"]) || (args.reason !== "worker_ended" && args.reason !== "cannot_continue")) return { ok: false, error: "invalid_arguments" };
  return { ok: true, action: { kind: "end" } };
}

/** The current step, as the model needs it. `spoken` is every line the engine says for this step. */
export function promptFor(session: CallSession, spoken: string[], ws: Workspace, locale: Locale) {
  const personalize = makePersonalizer(ws);
  const question = spokenWording(spoken.join(" "), locale);
  const isSummary = session.step === SUMMARY_STEP;
  return {
    question,
    replies: session.replies.map((reply) => ({ value: reply.value, label: personalize(reply.label[locale]) })),
    textAllowed: textAllowed(session),
    numberExpected: session.inputMode === "number",
    isSummary,
    ...(isSummary ? { summary: question } : {}),
  };
}
