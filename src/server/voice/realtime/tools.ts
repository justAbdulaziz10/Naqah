import type { AnswerInput, CallSession } from "@/domain/conversation/engine";
import { askedTopic, type AnswerTopic } from "@/domain/conversation/answer-topic";
import { makePersonalizer } from "@/domain/conversation/personalize";
import type { Locale, Workspace } from "@/domain/types";
import { mapSpeechToInput } from "../speech";

const TOPICS = ["herd", "feed", "water", "fences", "shelter", "medicine", "task", "other"] as const;
export const CLARIFY_REASONS = ["noise", "asked_to_repeat", "asked_meaning", "unclear"] as const;
export type ClarifyReason = typeof CLARIFY_REASONS[number];
const string = { type: "string" };
const evidence = { type: "string", description: "Exact words from the worker's utterance supporting this fact." };
const nullableNumber = { type: ["number", "null"], minimum: 0 };
const nullableString = { type: ["string", "null"] };
export const object = (properties: object, required: string[]) => ({ type: "object", properties, required, additionalProperties: false });
export const tool = (name: string, description: string, properties: object, required: string[]) => ({ type: "function", name, description, parameters: object(properties, required) });

export const REALTIME_TOOLS = [
  tool("answer_question", "Classify the current guided answer. Pass exactly one of value or text, and the asked topic.", { value: string, text: string, topic: { type: "string", enum: TOPICS } }, ["topic"]),
  tool("record_facts", "Record only facts supported by the worker's exact words in open mode. Never supply certainty.", {
    facts: { type: "array", maxItems: 20, items: { anyOf: [
      object({ type: { const: "camel_health" }, camelId: nullableString, scope: { enum: ["one", "all"] }, status: { enum: ["healthy", "watch", "sick", "unknown"] }, note: nullableString, evidence }, ["type", "camelId", "scope", "status", "note", "evidence"]),
      object({ type: { const: "herd_count" }, count: { type: "integer", minimum: 0 }, evidence }, ["type", "count", "evidence"]),
      object({ type: { const: "resource" }, resource: { enum: ["feed", "water", "fences", "shelter", "medicine"] }, level: { enum: ["good", "medium", "low", "critical", "unknown", null] }, quantity: nullableNumber, evidence }, ["type", "resource", "level", "quantity", "evidence"]),
      object({ type: { const: "custom" }, questionId: string, answer: string, evidence }, ["type", "questionId", "answer", "evidence"]),
      object({ type: { const: "other" }, note: string, evidence }, ["type", "note", "evidence"]),
    ] } },
  }, ["facts"]),
  tool("finish_update", "The worker has nothing more to add, only at open_more.", {}, []),
  tool("choose_mode", "Choose guided questions or an open update, only when offered.", { mode: { enum: ["guided", "open"] } }, ["mode"]),
  tool("repeat_or_clarify", "Only when the worker gave no answer: noise, asked to repeat or explain, or speech with no meaning.", { reason: { enum: CLARIFY_REASONS } }, ["reason"]),
  tool("confirm_report", "Confirm saving only after the worker heard the current full summary and explicitly agreed. False requests correction.", { confirmed: { type: "boolean" } }, ["confirmed"]),
  tool("correct_report", "Request correction of the summary. Use an offered item id if known.", { item_id: string }, []),
  tool("flag_urgent", "Report an urgent concern in the worker's words. The server tells them to call the owner directly.", { note: string }, ["note"]),
  tool("end_call", "End only when the worker explicitly asks to stop or not save, or cannot continue.", { reason: { enum: ["worker_ended", "cannot_continue"] } }, ["reason"]),
];

export type ToolAction =
  | { kind: "answer"; input: AnswerInput }
  | { kind: "facts"; facts: unknown[] }
  | { kind: "repeat"; reason: ClarifyReason }
  | { kind: "urgent"; note: string }
  | { kind: "confirm"; confirmed: boolean }
  | { kind: "end" };
export type ToolCheck = { ok: true; action: ToolAction } | { ok: false; error: string };
export const SUMMARY_STEP = "report_summary";
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;
export const isPlainObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
export const onlyKeys = (args: Record<string, unknown>, allowed: string[]) => Object.keys(args).every((key) => allowed.includes(key));
export const cleanString = (value: unknown, max = 300): value is string => typeof value === "string" && value.trim().length > 0 && value.length <= max && !CONTROL.test(value);
const isGuided = (session: CallSession) => session.inputMode !== "none" && ![SUMMARY_STEP, "report_correct_pick", "report_mode_choice", "open_listen", "open_more"].includes(session.step);

export function toolsFor(session: CallSession) {
  const allowed = new Set(["repeat_or_clarify", "flag_urgent", "end_call"]);
  if (isGuided(session)) allowed.add("answer_question");
  if (["open_listen", "open_more"].includes(session.step)) allowed.add("record_facts");
  if (session.step === "open_more") allowed.add("finish_update");
  if (session.step === "report_mode_choice") allowed.add("choose_mode");
  if (session.step === SUMMARY_STEP) allowed.add("confirm_report");
  if ([SUMMARY_STEP, "report_correct_pick"].includes(session.step)) allowed.add("correct_report");
  return REALTIME_TOOLS.filter((entry) => allowed.has(entry.name)).map((entry) => {
    if (entry.name !== "answer_question") return entry;
    return {
      ...entry,
      parameters: {
        ...entry.parameters,
        properties: {
          ...(session.replies.length ? { value: { type: "string", enum: session.replies.map((reply) => reply.value) } } : {}),
          ...(textAllowed(session) ? { text: string } : {}),
          topic: { type: "string", enum: [askedTopic(session)] },
        },
      },
    };
  });
}

function takesQuantity(session: CallSession): boolean {
  const item = session.step === "report_question" ? session.data.queue?.[session.data.reportIndex ?? 0] : undefined;
  return item?.kind === "predefined" && item.answerKind === "level" && (item.resource === "feed" || item.resource === "water");
}
export const textAllowed = (session: CallSession) => session.inputMode === "text" || session.inputMode === "number" || session.inputMode === "time" || takesQuantity(session);

function checkAnswer(args: Record<string, unknown>, session: CallSession, locale: Locale): ToolCheck {
  if (!onlyKeys(args, ["value", "text", "topic"]) || ("value" in args) === ("text" in args)) return { ok: false, error: "pass_exactly_one_of_value_or_text" };
  if (!TOPICS.includes(args.topic as AnswerTopic) || args.topic !== askedTopic(session)) return { ok: false, error: "answer_off_topic" };
  if ("value" in args) {
    if (!cleanString(args.value, 100) || !session.replies.some((reply) => reply.value === args.value)) return { ok: false, error: "value_not_allowed" };
    return { ok: true, action: { kind: "answer", input: { value: args.value } } };
  }
  if (!textAllowed(session)) return { ok: false, error: "text_not_allowed" };
  if (!cleanString(args.text)) return { ok: false, error: "invalid_text" };
  const input = mapSpeechToInput(session, args.text, null, locale);
  if (!input || (session.inputMode === "choices" && input.text === undefined)) return { ok: false, error: session.inputMode === "text" ? "invalid_text" : "number_not_understood" };
  return { ok: true, action: { kind: "answer", input } };
}

export function checkTool(name: unknown, args: unknown, spoke: boolean, session: CallSession, locale: Locale): ToolCheck {
  if (!REALTIME_TOOLS.some((entry) => entry.name === name)) return { ok: false, error: "unknown_tool" };
  if (!isPlainObject(args)) return { ok: false, error: "invalid_arguments" };
  if (!toolsFor(session).some((entry) => entry.name === name)) return { ok: false, error: name === "answer_question" && session.step === SUMMARY_STEP ? "use_confirm_report" : "tool_not_available" };
  if (name === "repeat_or_clarify") return onlyKeys(args, ["reason"]) && CLARIFY_REASONS.includes(args.reason as ClarifyReason) ? { ok: true, action: { kind: "repeat", reason: args.reason as ClarifyReason } } : { ok: false, error: "invalid_arguments" };
  if (!spoke && name !== "end_call" && !(name === "confirm_report" && args.confirmed === false)) return { ok: false, error: name === "confirm_report" ? "worker_has_not_confirmed" : "worker_has_not_answered" };
  if (name === "answer_question") return checkAnswer(args, session, locale);
  if (name === "record_facts") return onlyKeys(args, ["facts"]) && Array.isArray(args.facts) && args.facts.length <= 20 ? { ok: true, action: { kind: "facts", facts: args.facts } } : { ok: false, error: "invalid_arguments" };
  if (name === "finish_update") return onlyKeys(args, []) ? { ok: true, action: { kind: "answer", input: { value: "open_done" } } } : { ok: false, error: "invalid_arguments" };
  if (name === "choose_mode") return onlyKeys(args, ["mode"]) && ["guided", "open"].includes(String(args.mode)) ? { ok: true, action: { kind: "answer", input: { value: "mode_" + args.mode } } } : { ok: false, error: "invalid_arguments" };
  if (name === "correct_report") {
    if (!onlyKeys(args, ["item_id"]) || (args.item_id !== undefined && !cleanString(args.item_id, 100))) return { ok: false, error: "invalid_arguments" };
    const value = args.item_id ? "correct:" + args.item_id : "correct";
    if (args.item_id && !correctionItems(session, locale).some((item) => item.id === args.item_id)) return { ok: false, error: "value_not_allowed" };
    return { ok: true, action: { kind: "answer", input: { value } } };
  }
  if (name === "flag_urgent") return onlyKeys(args, ["note"]) && cleanString(args.note) ? { ok: true, action: { kind: "urgent", note: args.note } } : { ok: false, error: "invalid_arguments" };
  if (name === "confirm_report") return onlyKeys(args, ["confirmed"]) && typeof args.confirmed === "boolean" ? { ok: true, action: { kind: "confirm", confirmed: args.confirmed } } : { ok: false, error: "invalid_arguments" };
  if (!onlyKeys(args, ["reason"]) || !["worker_ended", "cannot_continue"].includes(String(args.reason))) return { ok: false, error: "invalid_arguments" };
  return { ok: true, action: { kind: "end" } };
}

function correctionItems(session: CallSession, locale: Locale) {
  const offered = session.replies.filter((reply) => reply.value.startsWith("correct:")).map((reply) => ({ id: reply.value.slice(8), label: reply.label[locale] }));
  if (offered.length) return offered;
  const answered = new Set(session.draft.answers.map((entry) => entry.questionId));
  return (session.data.queue ?? []).filter((item) => answered.has(item.id)).map((item) => ({ id: item.id, label: item.question[locale] }));
}

export function promptFor(session: CallSession, spoken: string[], ws: Workspace, locale: Locale) {
  const personalize = makePersonalizer(ws);
  const question = spoken.join(" ");
  const isSummary = session.step === SUMMARY_STEP;
  const literal = [...session.turns].reverse().find((turn) => turn.speaker === "agent")?.literal;
  return {
    question,
    topic: askedTopic(session),
    replies: session.replies.map((reply) => ({ value: reply.value, label: literal ? reply.label[locale] : personalize(reply.label[locale]) })),
    textAllowed: textAllowed(session),
    numberExpected: session.inputMode === "number",
    isSummary,
    allowedTools: toolsFor(session).map((entry) => entry.name),
    ...(isSummary || session.step === "report_correct_pick" ? { correctionItems: correctionItems(session, locale) } : {}),
    ...(isSummary ? { summary: question } : {}),
  };
}
