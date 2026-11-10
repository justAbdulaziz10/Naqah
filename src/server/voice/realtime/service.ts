/**
 * The bridge's side of a realtime call. The engine stays the state machine: the model's tool call
 * becomes one AnswerInput and takes the same path as a scripted turn. The scripted TwiML for each
 * position is kept in last_response, so a failure at any moment resumes the call by script.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { answer, resumeOpenAsGuided, type CallSession } from "@/domain/conversation/engine";
import type { Locale, Workspace } from "@/domain/types";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { readVoiceSession, type VoiceSessionRow } from "@/server/db/voice-sessions";
import type { CallToken } from "@/server/calls/token";
import { advanceRow, boundElsewhere, planTurn, respond, spokenLines, type TurnPlan, type VoiceCallSession } from "../farm-call";
import { twimlGoodbye } from "../twiml";
import { callWorkspace, forgetCallWorkspace, rememberCallWorkspace } from "./call-workspace";
import { traceCall } from "../trace";
import { decideTool, fallbackResult, promptResult } from "./decide";
import { buildInstructions } from "./instructions";
import { decideOwnerTool, ownerPromptResult } from "./owner-decide";
import { buildOwnerInstructions } from "./owner-instructions";
import { OWNER_TOOLS, ownerPromptFor } from "./owner-tools";
import { claimRealtime, realtimeOf, recordRealtimeResult, rememberResult, withRealtime, type RealtimeState, type ToolResponse } from "./state";
import { REALTIME_MAX_SECONDS, TICKET_CALL_MS, TICKET_CLAIM_MS, verifyRealtimeTicket, type RealtimeTicket } from "./ticket";
import { promptFor, REALTIME_TOOLS } from "./tools";
import { buildNaturalInstructions, naturalize, naturalTools, replayAnswers } from "./natural";
import { spokenFrom } from "./decide";

export { fallbackResult };

const CALL_SID = /^CA[0-9a-f]{32}$/i;
const TOOL_CALL_ID = /^[\w.:-]{1,128}$/;

const ENDED: Record<Locale, string> = {
  ar: "ما انحفظ التحديث. يعطيك العافية. مع السلامة.",
  en: "The update wasn't saved. Thank you. Goodbye.",
};

const OWNER_ENDED: Record<Locale, string> = { ar: "ما انحفظ شيء. يعطيك العافية. مع السلامة.", en: "Nothing was saved. Thank you. Goodbye." };
const stringify = (value: object) => JSON.stringify(value);

function logTool(callSid: string, name: unknown, result: string, tookMs: number): void {
  const tool = typeof name === "string" && /^[a-z_]+$/.test(name) ? name : "invalid";
  console.info(`[NAQAH] realtime tool call=${callSid.slice(-6)} name=${tool} result=${result} ms=${tookMs}`);
}

const finished = (status: string, goodbye: string): ToolResponse =>
  ({ output: stringify({ status, message: "The call is ending. Do not ask any more questions." }), awaitingConfirmation: false, end: "hangup", goodbye });

/** The ticket must name this exact call, on the row that issued it. */
function ticketMatches(ticket: RealtimeTicket, row: VoiceSessionRow, realtime: RealtimeState | null): realtime is RealtimeState {
  if (!realtime || realtime.jti !== ticket.j || row.farm_id !== ticket.f || row.locale !== ticket.l || row.party !== (ticket.p ?? "worker")) return false;
  // A finished row has had its data cleared; it can only replay a stored result.
  return row.session.done || (ticket.p === "owner" ? row.session.data.ownerRunId : row.session.data.reportCallId) === ticket.r;
}

async function farmOf(client: SupabaseClient, row: VoiceSessionRow, now: Date): Promise<Workspace> {
  const held = callWorkspace(row.call_sid, now);
  if (held) return held;
  const { workspace } = requireFarm(await loadFarm(client, { id: row.farm_id }));
  rememberCallWorkspace(row.call_sid, workspace, now);
  return workspace;
}

export type OpenedSession = {
  instructions: string;
  tools: typeof REALTIME_TOOLS | typeof OWNER_TOOLS | ReturnType<typeof naturalTools>;
  /** "natural": the model speaks for itself and only the summary is read word for word. */
  style?: "natural";
  opening: string;
  repromptText: string;
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
  const workspace = await farmOf(client, row, now);
  const spoken = spokenLines(row.session, Math.max(0, row.session.turns.length - 1), workspace, row.locale);
  const owner = row.party === "owner";
  let instructions = row.seq === 0 ? realtime.instructions : undefined;
  if (!instructions) {
    const names = { worker: workspace.settings.worker.name, owner: workspace.settings.owner.name };
    instructions = owner
      ? buildOwnerInstructions(row.locale, names, now, ownerPromptFor(row.session, spoken, workspace, row.locale))
      : buildInstructions(row.locale, names, promptFor(row.session, spoken, workspace, row.locale));
  }
  if (!(await claimRealtime(client, row, realtime, now))) return null;
  console.info(`[NAQAH] realtime session call=${ticket.sid.slice(-6)} opened`);
  if (realtime.naturalBase && !owner) {
    return {
      instructions: realtime.instructions ?? buildNaturalInstructions(realtime.naturalBase, workspace, row.locale),
      tools: naturalTools(realtime.naturalBase, workspace),
      style: "natural",
      opening: realtime.opening,
      repromptText: realtime.opening,
      locale: row.locale,
      maxSeconds: REALTIME_MAX_SECONDS,
    };
  }
  return {
    instructions,
    tools: owner ? OWNER_TOOLS : REALTIME_TOOLS,
    opening: realtime.opening,
    repromptText: spoken.join(" ") || realtime.opening,
    locale: row.locale,
    maxSeconds: REALTIME_MAX_SECONDS,
  };
}

export type ToolBody = { ticket: unknown; callSid: string; toolCallId: string; name: unknown; args: unknown; userSpokeSinceLastTool: boolean; workerUtterance?: string; heardSummary?: boolean; heardSummaryId?: string; keypad?: boolean };

export function parseToolBody(body: Record<string, unknown>): ToolBody | null {
  const { ticket, callSid, toolCallId, name, args, userSpokeSinceLastTool, workerUtterance, heardSummary, heardSummaryId, keypad } = body;
  if (typeof callSid !== "string" || !CALL_SID.test(callSid)) return null;
  if (typeof toolCallId !== "string" || !TOOL_CALL_ID.test(toolCallId)) return null;
  if (typeof userSpokeSinceLastTool !== "boolean") return null;
  if (workerUtterance !== undefined && (typeof workerUtterance !== "string" || workerUtterance.length > 1000 || /[\u0000-\u001f\u007f]/u.test(workerUtterance))) return null;
  if (heardSummary !== undefined && typeof heardSummary !== "boolean") return null;
  if (heardSummaryId !== undefined && (typeof heardSummaryId !== "string" || heardSummaryId.length > 200)) return null;
  if (keypad !== undefined && typeof keypad !== "boolean") return null;
  return { ticket, callSid, toolCallId, name, args, userSpokeSinceLastTool, workerUtterance, heardSummary, heardSummaryId, keypad };
}

/** The script can't sort free speech, so what it resumes must never wait on an open update. */
function scriptedFrom(session: CallSession, workspace: Workspace, now: Date): CallSession {
  if (session.step === "report_mode_choice") return answer(session, workspace, now, { value: "mode_guided" }).session;
  let current = session;
  while (current.step === "open_clarify") current = answer(current, workspace, now, { value: "unknown" }).session;
  return current.step.startsWith("open_") ? resumeOpenAsGuided(current, workspace, now) : current;
}

function resultOf(plan: TurnPlan, session: VoiceCallSession, workspace: Workspace, locale: Locale, prefix = "", owner = false): ToolResponse {
  if (plan.outcome === "retry_save") return fallbackResult();
  if (plan.outcome === "saved") return finished("saved", plan.goodbye!);
  if (plan.outcome === "refused") return finished("not_saved", plan.goodbye!);
  if (plan.outcome === "save_failed") return finished("save_failed", plan.goodbye!);
  if (plan.session.done) return finished("ended_without_saving", plan.goodbye ?? (owner ? OWNER_ENDED : ENDED)[locale]);
  return (owner ? ownerPromptResult : promptResult)(plan.session, workspace, locale, "ok", undefined, prefix, undefined, false, spokenLines(plan.session, session.turns.length, workspace, locale));
}

function endedPlan(row: VoiceSessionRow, session: VoiceCallSession): TurnPlan {
  const goodbye = (row.party === "owner" ? OWNER_ENDED : ENDED)[row.locale];
  return { session: { ...session, done: true }, misses: row.misses, response: twimlGoodbye(row.locale, goodbye), outcome: "continue", goodbye };
}

export async function runRealtimeTool(client: SupabaseClient, body: ToolBody, secret: string, now: Date): Promise<ToolResponse | null> {
  const context: { session?: CallSession } = {};
  const result = await runTool(client, body, secret, now, context);
  if (context.session) traceCall(body.callSid, { session: context.session, tool: String(body.name), args: body.args, workerUtterance: body.workerUtterance ?? "", resultStatus: result ? JSON.parse(result.output).status : "refused", spokenText: result?.summaryText ?? result?.sayText ?? result?.goodbye ?? "" });
  return result;
}

async function runTool(client: SupabaseClient, body: ToolBody, secret: string, now: Date, context: { session?: CallSession }): Promise<ToolResponse | null> {
  const started = Date.now();
  const ticket = verifyRealtimeTicket(body.ticket, secret, now.getTime(), TICKET_CALL_MS);
  if (!ticket || body.callSid !== ticket.sid) return null;
  try {
    const row = await readVoiceSession(client, ticket.sid);
    const endedWords = ticket.p === "owner" ? OWNER_ENDED : ENDED;
    if (!row) return finished("call_ended", endedWords[ticket.l]);
    const realtime = realtimeOf(row.session);
    if (!ticketMatches(ticket, row, realtime) || !realtime.claimedAt) return null;
    context.session = row.session;
    const repeated = realtime.recent.find((entry) => entry.id === body.toolCallId);
    if (repeated) return repeated.result;
    if (row.session.done) return realtime.recent.at(-1)?.result ?? finished("call_ended", endedWords[row.locale]);
    if (realtime.closed) return fallbackResult();
    const workspace = await farmOf(client, row, now);
    const owner = ticket.p === "owner";
    if (realtime.naturalBase && !owner) {
      if (body.name === "submit_report") return submitNatural(client, row, realtime, body, workspace, now, started);
      // No keypad on a natural call: only spoken words confirm.
      if (body.keypad) return null;
    }
    const keypad = body.keypad === true && body.name === "keypad_confirm";
    const toolName = keypad ? (owner ? "confirm_instructions" : "confirm_report") : body.name;
    const toolArgs = keypad ? { confirmed: true } : body.args;
    const toolTurn = { session: row.session, counters: realtime, workspace, locale: row.locale, name: toolName, args: toolArgs, keypad, spoke: body.userSpokeSinceLastTool, heard: body.workerUtterance ?? "", heardSummaryId: body.heardSummaryId , now, natural: Boolean(realtime.naturalBase) && !owner };
    const decision = owner ? decideOwnerTool(toolTurn) : decideTool(toolTurn);
    const nextRealtime = { ...realtime, ...decision.counters };
    const keep = async (result: ToolResponse) => {
      const saved = await recordRealtimeResult(client, row, rememberResult(nextRealtime, body.toolCallId, result, false));
      if (saved) return result;
      const latest = await readVoiceSession(client, ticket.sid);
      return latest && realtimeOf(latest.session)?.recent.find((entry) => entry.id === body.toolCallId)?.result || fallbackResult();
    };
    if (decision.checkError) logTool(body.callSid, body.name, decision.checkError, Date.now() - started);
    if (decision.kind === "reply") return keep(realtime.naturalBase && !owner ? naturalize(decision.result, row.locale) : decision.result);
    const session = decision.session;
    let plan: TurnPlan;
    if (decision.kind === "stay") {
      plan = { session, misses: row.misses, response: row.last_response, outcome: "continue", goodbye: null };
    } else if (decision.kind === "apply") {
      const current = await readVoiceSession(client, ticket.sid);
      if (!current || current.seq !== row.seq || realtimeOf(current.session)?.closed !== false) return fallbackResult();
      plan = await planTurn(client, row, session, workspace, decision.chosen, now);
    } else {
      plan = endedPlan(row, session);
    }
    const spoken = decision.kind === "stay" ? decision.result : resultOf(plan, session, workspace, row.locale, decision.kind === "apply" ? decision.prefix : "", owner);
    const result = realtime.naturalBase && !owner ? naturalize(spoken, row.locale) : spoken;
    const stored = withRealtime(plan.session, rememberResult(nextRealtime, body.toolCallId, result, plan.session.done));
    const saved = await advanceRow(client, row, stored, plan.misses, plan.response, plan.onAdvanced, true);
    if (plan.session.done) forgetCallWorkspace(ticket.sid);
    if (saved) {
      logTool(body.callSid, body.name, plan.outcome, Date.now() - started);
      return result;
    }
    const latest = await readVoiceSession(client, ticket.sid);
    const replay = latest && realtimeOf(latest.session)?.recent.find((entry) => entry.id === body.toolCallId);
    if (replay) return replay.result;
    if (!latest) return finished("call_ended", endedWords[ticket.l]);
    if (realtimeOf(latest.session)?.closed) return fallbackResult();
    if (latest.session.done) return realtimeOf(latest.session)?.recent.at(-1)?.result ?? finished("call_ended", endedWords[latest.locale]);
    return (owner ? ownerPromptResult : promptResult)(latest.session, workspace, latest.locale, "invalid", "state_changed");
  } catch (error) {
    console.error("[NAQAH] realtime tool failed (" + (error instanceof Error ? error.name : "unknown") + ")");
    return fallbackResult();
  }
}

/**
 * The whole report at once. It is replayed from the call's first question through the engine, so it passes the same
 * checks as a guided call, and the engine's summary is what the worker hears and confirms.
 */
async function submitNatural(client: SupabaseClient, row: VoiceSessionRow, realtime: RealtimeState, body: ToolBody, workspace: Workspace, now: Date, started: number): Promise<ToolResponse> {
  const replayed = replayAnswers(realtime.naturalBase!, workspace, now, body.args, row.session.draft.urgentNote ?? undefined);
  if (!replayed.ok) {
    const result: ToolResponse = {
      output: stringify({ status: "invalid", error: replayed.error, questions: replayed.questions, message: "Nothing was recorded. Ask the worker about these questions, briefly, then call submit_report again with every answer." }),
      awaitingConfirmation: false, end: null, goodbye: null, continue: true,
    };
    const kept = await recordRealtimeResult(client, row, rememberResult(realtime, body.toolCallId, result, false));
    logTool(body.callSid, "submit_report", replayed.error, Date.now() - started);
    return kept ? result : fallbackResult();
  }
  const session = { ...replayed.session, data: { ...replayed.session.data, draftRevision: (row.session.data.draftRevision ?? 0) + 1 } } as VoiceCallSession;
  const summary = promptResult(session, workspace, row.locale, "ok", undefined, "", undefined, false, spokenFrom(session, session.turns.length - 1, workspace, row.locale));
  const result: ToolResponse = { ...summary, repromptText: row.locale === "ar" ? "أحفظ التحديث، ولا تبي تعدل شي؟" : "Shall I save the update, or would you like to correct something?" };
  const stored = withRealtime(session, rememberResult(realtime, body.toolCallId, result, false));
  const response = respond(session, session.turns.length - 1, workspace, row.locale, row.seq + 1);
  const saved = await advanceRow(client, row, stored, row.misses, response, undefined, true);
  logTool(body.callSid, "submit_report", saved ? "summary" : "state_changed", Date.now() - started);
  return saved ? result : fallbackResult();
}

const NATURAL_SORRY: Record<Locale, string> = {
  ar: "معليش، صار عندنا خلل في الاتصال. ما انحفظ شي. مع السلامة.",
  en: "Sorry, the call ran into a problem. Nothing was saved. Goodbye.",
};

const AFTER_ATTEMPTS = 3;

/** The stream closed. A finished call hangs up; anything else carries on by script from where it was. */
export async function afterRealtimeCall(client: SupabaseClient, input: { token: Extract<CallToken, { k: "report" | "owner" }>; callSid: string }): Promise<string> {
  const { token, callSid } = input;
  if (token.k === "report" && await boundElsewhere(client, token, callSid)) return twimlGoodbye(token.l);
  for (let attempt = 0; attempt < AFTER_ATTEMPTS; attempt += 1) {
    const row = await readVoiceSession(client, callSid);
    if (!row || row.farm_id !== token.f) return twimlGoodbye(token.l);
    const realtime = realtimeOf(row.session);
    // The bridge has already spoken this call's goodbye, so it isn't said twice.
    if (row.session.done && realtime) {
      const last = realtime.recent.at(-1)?.result;
      return row.party === "owner" || (last && JSON.parse(last.output).status === "saved") ? "<Response><Hangup/></Response>" : row.last_response;
    }
    if (row.session.done || !realtime || realtime.fallbackPrepared) return row.last_response;
    // A natural call has no keypad script to fall back to: a short apology, nothing saved.
    if (realtime.naturalBase && row.party !== "owner") {
      const goodbye = twimlGoodbye(row.locale, NATURAL_SORRY[row.locale]);
      const ended = await advanceRow(client, row, withRealtime({ ...row.session, done: true }, { ...realtime, closed: true, fallbackPrepared: true }), row.misses, goodbye);
      if (ended) return goodbye;
      continue;
    }
    const workspace = await farmOf(client, row, new Date());
    const session = scriptedFrom(row.session, workspace, new Date());
    const prefix = row.party === "owner"
      ? (row.locale === "ar" ? "بنكمل المكالمة بطريقة ثانية. " : "We'll continue the call another way. ")
      : row.locale === "ar" ? "بنكمل المكالمة بالأزرار. " : "We'll continue the call using the keypad. ";
    const response = respond(session, Math.max(0, session.turns.length - 1), workspace, row.locale, row.seq + 1, prefix, true);
    const closed = await advanceRow(client, row, withRealtime({ ...session, voiceKeypad: true }, { ...realtime, closed: true, fallbackPrepared: true }), row.misses, response);
    if (closed) return closed.last_response;
  }
  return (await readVoiceSession(client, callSid))?.last_response ?? twimlGoodbye(token.l);
}
