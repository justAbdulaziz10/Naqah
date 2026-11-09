/** The tools the model has on an owner's summary call, and what the server tells it at each step. */
import type { CallSession } from "@/domain/conversation/engine";
import { MAX_INSTRUCTIONS } from "@/domain/conversation/owner-briefing";
import { makePersonalizer } from "@/domain/conversation/personalize";
import type { Locale, Workspace } from "@/domain/types";
import { CLARIFY_REASONS, cleanString, isPlainObject, object, onlyKeys, tool, type ClarifyReason } from "./tools";

export const REVIEW_STEP = "instruction_review";
const SCHEDULE_STEPS = ["instruction_schedule", "instruction_date", "instruction_time"];
const CORRECT_STEPS = [REVIEW_STEP, "instruction_correct_pick", "instruction_correct_what"];
const due = {
  type: ["string", "null"],
  description: "\"any_time\" if the owner said any time; an ISO 8601 time with +03:00 if they gave a day and a time; YYYY-MM-DD if they gave only a day; null if they gave no time.",
};
const kind = { enum: ["task", "information"], description: "task: the worker must do something. information: the worker only needs to know." };

export const OWNER_TOOLS = [
  tool("propose_instructions", "Propose what the owner asked for, split into separate instructions. Use the owner's own words. An empty list means they only said yes and have not said the instruction yet.", {
    items: { type: "array", maxItems: MAX_INSTRUCTIONS, items: object({
      message: { type: "string", description: "The instruction for the worker, in the owner's words." },
      kind,
      due,
      evidence: { type: "string", description: "The owner's exact words for this instruction, including any time they gave." },
    }, ["message", "kind", "due", "evidence"]) },
  }, ["items"]),
  tool("no_instructions", "The owner has no instructions.", {}, []),
  tool("confirm_instructions", "true only after the owner heard the whole list and clearly agreed to save it. false means they want to change one.", { confirmed: { type: "boolean" } }, ["confirmed"]),
  tool("correct_instruction", "Change one instruction, by its index in the list. Pass only what the owner changed, or only the index if they have not said what should change.", {
    index: { type: "integer", minimum: 0 },
    kind,
    message: { type: "string", description: "The owner's new words for this instruction." },
    due,
  }, ["index"]),
  tool("remove_instruction", "Remove one instruction from the list, by its index, when the owner asks to drop it.", { index: { type: "integer", minimum: 0 } }, ["index"]),
  tool("repeat_or_clarify", "Ask the server to repeat or clarify the current question. Never speak yourself.", { reason: { enum: CLARIFY_REASONS } }, ["reason"]),
  tool("end_call", "owner_ended: the owner asked to stop or not to save. cannot_continue: the call cannot go on.", { reason: { enum: ["owner_ended", "cannot_continue"] } }, ["reason"]),
];

export type OwnerToolAction =
  | { kind: "propose"; items: unknown[] }
  | { kind: "none" }
  | { kind: "confirm"; confirmed: boolean }
  | { kind: "correct"; args: Record<string, unknown> }
  | { kind: "remove"; index: number }
  | { kind: "repeat"; reason: ClarifyReason }
  | { kind: "end"; reason: "owner_ended" | "cannot_continue" };
export type OwnerToolCheck = { ok: true; action: OwnerToolAction } | { ok: false; error: string };

export function ownerToolsFor(session: CallSession) {
  const allowed = new Set(["repeat_or_clarify", "end_call"]);
  if (["instruction_yesno", "instruction_text"].includes(session.step)) ["propose_instructions", "no_instructions"].forEach((name) => allowed.add(name));
  if ([...SCHEDULE_STEPS, ...CORRECT_STEPS].includes(session.step)) allowed.add("correct_instruction");
  if (session.step === REVIEW_STEP) ["confirm_instructions", "propose_instructions", "correct_instruction", "remove_instruction"].forEach((name) => allowed.add(name));
  if (session.step === "instruction_remove_pick") allowed.add("remove_instruction");
  return OWNER_TOOLS.filter((entry) => allowed.has(entry.name));
}

export function checkOwnerTool(name: unknown, args: unknown, spoke: boolean, session: CallSession): OwnerToolCheck {
  if (!OWNER_TOOLS.some((entry) => entry.name === name)) return { ok: false, error: "unknown_tool" };
  if (!isPlainObject(args)) return { ok: false, error: "invalid_arguments" };
  if (!ownerToolsFor(session).some((entry) => entry.name === name)) return { ok: false, error: "tool_not_available" };
  if (name === "repeat_or_clarify") return onlyKeys(args, ["reason"]) && CLARIFY_REASONS.includes(args.reason as ClarifyReason) ? { ok: true, action: { kind: "repeat", reason: args.reason as ClarifyReason } } : { ok: false, error: "invalid_arguments" };
  if (name === "end_call") return onlyKeys(args, ["reason"]) && (args.reason === "owner_ended" || args.reason === "cannot_continue") ? { ok: true, action: { kind: "end", reason: args.reason } } : { ok: false, error: "invalid_arguments" };
  if (!spoke && !(name === "confirm_instructions" && args.confirmed === false)) return { ok: false, error: name === "confirm_instructions" ? "owner_has_not_confirmed" : "owner_has_not_answered" };
  if (name === "remove_instruction") return onlyKeys(args, ["index"]) && Number.isInteger(args.index) && (args.index as number) >= 0 ? { ok: true, action: { kind: "remove", index: args.index as number } } : { ok: false, error: "invalid_arguments" };
  if (name === "propose_instructions") return onlyKeys(args, ["items"]) && Array.isArray(args.items) ? { ok: true, action: { kind: "propose", items: args.items } } : { ok: false, error: "invalid_arguments" };
  if (name === "no_instructions") return onlyKeys(args, []) ? { ok: true, action: { kind: "none" } } : { ok: false, error: "invalid_arguments" };
  if (name === "confirm_instructions") return onlyKeys(args, ["confirmed"]) && typeof args.confirmed === "boolean" ? { ok: true, action: { kind: "confirm", confirmed: args.confirmed } } : { ok: false, error: "invalid_arguments" };
  if (!onlyKeys(args, ["index", "kind", "message", "due"]) || (args.message !== undefined && !cleanString(args.message, 300))) return { ok: false, error: "invalid_arguments" };
  // Asking "when" is the only thing open here, and it is about one instruction.
  if (SCHEDULE_STEPS.includes(session.step) && (args.index !== session.data.schedulingIndex || args.due === undefined || args.kind !== undefined || args.message !== undefined)) return { ok: false, error: "value_not_allowed" };
  return { ok: true, action: { kind: "correct", args } };
}

export function ownerPromptFor(session: CallSession, spoken: string[], ws: Workspace, locale: Locale) {
  const personalize = makePersonalizer(ws);
  const question = spoken.join(" ");
  const isSummary = session.step === REVIEW_STEP;
  const literal = [...session.turns].reverse().find((turn) => turn.speaker === "agent")?.literal;
  const items = session.data.pendingInstructions ?? [];
  return {
    question,
    replies: session.replies.map((reply) => ({ value: reply.value, label: literal ? reply.label[locale] : personalize(reply.label[locale]) })),
    isSummary,
    allowedTools: ownerToolsFor(session).map((entry) => entry.name),
    ...(items.length ? { instructions: items.map((item, index) => ({ index, message: item.message, kind: item.actionable ? "task" : "information" })) } : {}),
    ...(session.data.schedulingIndex !== undefined ? { schedulingIndex: session.data.schedulingIndex } : {}),
    ...(isSummary ? { summary: question } : {}),
  };
}
