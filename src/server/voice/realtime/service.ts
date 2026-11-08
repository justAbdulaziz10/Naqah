/**
 * The bridge's side of a realtime call. The engine stays the state machine: the model's tool call
 * becomes one AnswerInput and takes the same path as a scripted turn. The scripted TwiML for each
 * position is kept in last_response, so a failure at any moment resumes the call by script.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AnswerInput } from "@/domain/conversation/engine";
import type { Locale, Workspace } from "@/domain/types";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { readVoiceSession, type VoiceSessionRow } from "@/server/db/voice-sessions";
import type { CallToken } from "@/server/calls/token";
import { advanceRow, boundElsewhere, planTurn, spokenLines, type TurnPlan, type VoiceCallSession } from "../farm-call";
import { twimlGoodbye } from "../twiml";
import { buildInstructions } from "./instructions";
import { claimRealtime, closeRealtime, realtimeOf, rememberResult, withRealtime, type RealtimeState, type ToolResponse } from "./state";
import { REALTIME_MAX_SECONDS, TICKET_CALL_MS, TICKET_CLAIM_MS, verifyRealtimeTicket, type RealtimeTicket } from "./ticket";
import { checkTool, promptFor, REALTIME_TOOLS, SUMMARY_STEP, type ToolCheck } from "./tools";

const CALL_SID = /^CA[0-9a-f]{32}$/i;
const TOOL_CALL_ID = /^[\w.:-]{1,128}$/;

const ENDED: Record<Locale, string> = {
  ar: "ما انحفظ التحديث. يعطيك العافية. مع السلامة.",
  en: "The update wasn't saved. Thank you. Goodbye.",
};

const stringify = (value: object) => JSON.stringify(value);

function logTool(callSid: string, name: unknown, result: string): void {
  const tool = name === "answer_question" || name === "confirm_report" || name === "end_call" ? name : "invalid";
  console.info(`[NAQAH] realtime tool call=${callSid.slice(-6)} name=${tool} result=${result}`);
}

export function fallbackResult(): ToolResponse {
  return {
    output: stringify({ status: "error", error: "temporary_failure", message: "Nothing was confirmed as saved. Do not tell the worker anything was saved." }),
    awaitingConfirmation: false,
    end: "fallback",
    goodbye: null,
  };
}

const finished = (status: string, goodbye: string): ToolResponse =>
  ({ output: stringify({ status, message: "The call is ending. Do not ask any more questions." }), awaitingConfirmation: false, end: "hangup", goodbye });

/** The ticket must name this exact call, on the row that issued it. */
function ticketMatches(ticket: RealtimeTicket, row: VoiceSessionRow, realtime: RealtimeState | null): realtime is RealtimeState {
  if (!realtime || realtime.jti !== ticket.j || row.farm_id !== ticket.f || row.locale !== ticket.l || row.party !== "worker") return false;
  // A finished row has had its data cleared; it can only replay a stored result.
  return row.session.done || row.session.data.reportCallId === ticket.r;
}

async function farmOf(client: SupabaseClient, row: VoiceSessionRow): Promise<Workspace> {
  return requireFarm(await loadFarm(client, { id: row.farm_id })).workspace;
}

export type OpenedSession = {
  instructions: string;
  tools: typeof REALTIME_TOOLS;
  opening: string;
  locale: Locale;
  maxSeconds: number;
};

/** Null is a refusal. Everything that can fail runs before the claim, which can't be taken back. */
export async function openRealtimeSession(client: SupabaseClient, body: Record<string, unknown>, secret: string, now: Date): Promise<OpenedSession | null> {
  const ticket = verifyRealtimeTicket(body.ticket, secret, now.getTime(), TICKET_CLAIM_MS);
  if (!ticket || typeof body.callSid !== "string" || body.callSid !== ticket.sid) return null;
  const row = await readVoiceSession(client, ticket.sid);
  if (!row || row.session.done) return null;
  const realtime = realtimeOf(row.session);
  if (!ticketMatches(ticket, row, realtime) || realtime.claimedAt || realtime.closed) return null;
  let instructions = row.seq === 0 ? realtime.instructions : undefined;
  if (!instructions) {
    const workspace = await farmOf(client, row);
    const current = promptFor(row.session, spokenLines(row.session, row.session.turns.length - 1, workspace, row.locale), workspace, row.locale);
    instructions = buildInstructions(row.locale, { worker: workspace.settings.worker.name, owner: workspace.settings.owner.name }, current);
  }
  if (!(await claimRealtime(client, row, realtime, now))) return null;
  console.info(`[NAQAH] realtime session call=${ticket.sid.slice(-6)} opened`);
  return {
    instructions,
    tools: REALTIME_TOOLS,
    opening: realtime.opening,
    locale: row.locale,
    maxSeconds: REALTIME_MAX_SECONDS,
  };
}

export type ToolBody = { ticket: unknown; callSid: string; toolCallId: string; name: unknown; args: unknown; userSpokeSinceLastTool: boolean };

export function parseToolBody(body: Record<string, unknown>): ToolBody | null {
  const { ticket, callSid, toolCallId, name, args, userSpokeSinceLastTool } = body;
  if (typeof callSid !== "string" || !CALL_SID.test(callSid)) return null;
  if (typeof toolCallId !== "string" || !TOOL_CALL_ID.test(toolCallId)) return null;
  if (typeof userSpokeSinceLastTool !== "boolean") return null;
  return { ticket, callSid, toolCallId, name, args, userSpokeSinceLastTool };
}

const refusal = (error: string, row: VoiceSessionRow): ToolResponse => ({
  output: stringify({ status: "invalid", error, replies: row.session.replies.map((reply) => reply.value) }),
  awaitingConfirmation: row.session.step === SUMMARY_STEP,
  end: null,
  goodbye: null,
});

function resultOf(plan: TurnPlan, session: VoiceCallSession, workspace: Workspace, locale: Locale): ToolResponse {
  if (plan.outcome === "retry_save") return fallbackResult();
  if (plan.outcome === "saved") return finished("saved", plan.goodbye!);
  if (plan.outcome === "refused") return finished("not_saved", plan.goodbye!);
  if (plan.outcome === "save_failed") return finished("save_failed", plan.goodbye!);
  if (plan.session.done) return finished("ended_without_saving", plan.goodbye ?? ENDED[locale]);
  const spoken = spokenLines(plan.session, session.turns.length, workspace, locale);
  return {
    output: stringify({ status: "ok", ...promptFor(plan.session, spoken, workspace, locale) }),
    awaitingConfirmation: plan.session.step === SUMMARY_STEP,
    end: null,
    goodbye: null,
  };
}

function endedPlan(row: VoiceSessionRow, session: VoiceCallSession): TurnPlan {
  const goodbye = ENDED[row.locale];
  return { session: { ...session, done: true }, misses: row.misses, response: twimlGoodbye(row.locale, goodbye), outcome: "continue", goodbye };
}

const inputFor = (check: Extract<ToolCheck, { ok: true }>): AnswerInput | null => {
  if (check.action.kind === "answer") return check.action.input;
  if (check.action.kind === "confirm") return { value: check.action.confirmed ? "confirm_save" : "end_without_save" };
  return null;
};

/** Null is a refusal: the ticket is bad, unclaimed or for another call. */
export async function runRealtimeTool(client: SupabaseClient, body: ToolBody, secret: string, now: Date): Promise<ToolResponse | null> {
  const ticket = verifyRealtimeTicket(body.ticket, secret, now.getTime(), TICKET_CALL_MS);
  if (!ticket || body.callSid !== ticket.sid) return null;
  try {
    const row = await readVoiceSession(client, ticket.sid);
    if (!row) return finished("call_ended", ENDED[ticket.l]);
    const realtime = realtimeOf(row.session);
    if (!ticketMatches(ticket, row, realtime) || !realtime.claimedAt) return null;

    const repeated = realtime.recent.find((entry) => entry.id === body.toolCallId);
    if (repeated) return repeated.result;
    if (row.session.done) return realtime.recent.at(-1)?.result ?? finished("call_ended", ENDED[row.locale]);
    if (realtime.closed) return fallbackResult();

    const check = checkTool(body.name, body.args, body.userSpokeSinceLastTool, row.session, row.locale);
    if (!check.ok) {
      logTool(body.callSid, body.name, check.error);
      return refusal(check.error, row);
    }

    const session: VoiceCallSession = { ...row.session, voiceSilences: 0 };
    // Ending at the summary is the worker declining to save, which the engine knows how to record.
    const chosen = inputFor(check) ?? (session.step === SUMMARY_STEP ? { value: "end_without_save" } : null);
    let workspace: Workspace | null = null;
    let plan: TurnPlan;
    if (chosen) {
      workspace = await farmOf(client, row);
      plan = await planTurn(client, row, session, workspace, chosen, now);
    } else {
      plan = endedPlan(row, session);
    }
    const result = workspace ? resultOf(plan, session, workspace, row.locale) : finished("ended_without_saving", plan.goodbye!);
    const stored = withRealtime(plan.session, rememberResult(realtime, body.toolCallId, result, plan.session.done));
    const saved = await advanceRow(client, row, stored, plan.misses, plan.response, plan.onAdvanced);
    if (saved) {
      logTool(body.callSid, body.name, plan.outcome);
      return result;
    }
    // Another request moved the call first. If it was this same tool call, its result stands.
    const latest = await readVoiceSession(client, ticket.sid);
    const replay = latest && realtimeOf(latest.session)?.recent.find((entry) => entry.id === body.toolCallId);
    if (replay) return replay.result;
    if (!latest) return finished("call_ended", ENDED[ticket.l]);
    if (latest.session.done) return realtimeOf(latest.session)?.recent.at(-1)?.result ?? finished("call_ended", ENDED[latest.locale]);
    const current = await farmOf(client, latest);
    const prompt = promptFor(latest.session, spokenLines(latest.session, latest.session.turns.length - 1, current, latest.locale), current, latest.locale);
    return { ...refusal("state_changed", latest), output: stringify({ status: "invalid", error: "state_changed", ...prompt }) };
  } catch (error) {
    console.error(`[NAQAH] realtime tool failed (${error instanceof Error ? error.name : "unknown"})`);
    return fallbackResult();
  }
}

const AFTER_ATTEMPTS = 3;

/** The stream closed. A finished call hangs up; anything else carries on by script from where it was. */
export async function afterRealtimeCall(client: SupabaseClient, input: { token: Extract<CallToken, { k: "report" }>; callSid: string }): Promise<string> {
  const { token, callSid } = input;
  if (await boundElsewhere(client, token, callSid)) return twimlGoodbye(token.l);
  for (let attempt = 0; attempt < AFTER_ATTEMPTS; attempt += 1) {
    const row = await readVoiceSession(client, callSid);
    if (!row || row.farm_id !== token.f) return twimlGoodbye(token.l);
    const realtime = realtimeOf(row.session);
    // The bridge has already spoken this call's goodbye, so it isn't said twice.
    if (row.session.done && realtime) return "<Response><Hangup/></Response>";
    if (row.session.done || !realtime || realtime.closed) return row.last_response;
    const closed = await closeRealtime(client, row, realtime);
    if (closed) return closed.last_response;
  }
  return (await readVoiceSession(client, callSid))?.last_response ?? twimlGoodbye(token.l);
}
