/**
 * Signed closure notices preserve the bridge's goodbye and resolve unsaved natural silence: unanswered when the
 * worker never spoke, answered-but-unsaved when they did.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { endReportCallWithoutReport } from "@/domain/reportCalls";
import { afterResponse } from "@/server/calls/after";
import { recordCallFailure, type CallFailure } from "@/server/calls/reliability";
import { findReportCallRun, runFarmAction } from "@/server/db/service-repository";
import { advanceVoiceSession, readVoiceSession } from "@/server/db/voice-sessions";
import type { CallSession } from "@/domain/conversation/engine";
import { resolveSilentReportCall } from "../farm-call";
import { realtimeOf, withRealtime } from "./state";
import { TICKET_CALL_MS, verifyRealtimeTicket, type RealtimeTicket } from "./ticket";

export const BRIDGE_CLOSE_REASONS = ["normal", "silence", "timeout", "twilio_closed", "openai_error", "openai_credit", "bridge_error"] as const;
export type BridgeCloseReason = (typeof BRIDGE_CLOSE_REASONS)[number];
export type BridgeClosedSession = CallSession & { bridgeCloseReason?: BridgeCloseReason };

/** A caller hanging up or a finished call is the status callback's to describe. */
const DIAGNOSTIC: Partial<Record<BridgeCloseReason, CallFailure>> = {
  silence: "no_answer",
  timeout: "timed_out",
  openai_credit: "openai_quota",
  openai_error: "bridge_disconnected",
  bridge_error: "bridge_disconnected",
};

export type BridgeClosedOutcome = "recorded" | "logged" | "forbidden" | "invalid";

const isReason = (value: unknown): value is BridgeCloseReason =>
  typeof value === "string" && (BRIDGE_CLOSE_REASONS as readonly string[]).includes(value);

/**
 * The worker spoke, then went quiet until the bridge said goodbye: an answered call that ended unsaved. The attempt is
 * used and a scheduled run retries, as when a worker hangs up before saving.
 */
async function endSpokenSilentReportCall(client: SupabaseClient, ticket: RealtimeTicket, now: Date): Promise<void> {
  const bound = await findReportCallRun(client, ticket.sid);
  if (!bound || bound.farmId !== ticket.f || bound.runId !== ticket.r) return;
  await runFarmAction(client, ticket.f, (workspace) => {
    const attempt = workspace.reportCalls?.find((entry) => entry.id === ticket.r)?.attempts.at(-1);
    if (!attempt || Date.parse(attempt.at) > ticket.t) return { ws: workspace, result: null };
    return { ws: endReportCallWithoutReport(workspace, now, ticket.r), result: null };
  });
}

export async function recordBridgeClosed(client: SupabaseClient, body: Record<string, unknown>, secret: string, now: Date): Promise<BridgeClosedOutcome> {
  const { reason, event, workerSpoke } = body;
  if (!isReason(reason) || (event !== undefined && (typeof event !== "string" || !/^[a-z_]{1,64}$/.test(event)))
    || (workerSpoke !== undefined && typeof workerSpoke !== "boolean")) return "invalid";
  const ticket = verifyRealtimeTicket(body.ticket, secret, now.getTime(), TICKET_CALL_MS);
  if (!ticket || ticket.sid !== body.callSid) return "forbidden";
  // An older bridge sends no workerSpoke: treated as silence from the start, as before.
  const spoke = workerSpoke === true;
  console.info(`[NAQAH] realtime stream closed (${reason}${event ? `, ${event}` : ""}${spoke ? ", worker spoke" : ""}) call …${ticket.sid.slice(-6)}`);
  // First and cheapest: the closure on the session, so /after sees it even if the farm update below is slow.
  let row = await readVoiceSession(client, ticket.sid);
  for (let attempt = 0; row && attempt < 3; attempt += 1) {
    if (row.farm_id !== ticket.f || realtimeOf(row.session)?.jti !== ticket.j || row.party !== (ticket.p ?? "worker")) return "forbidden";
    if ((row.session as BridgeClosedSession).bridgeCloseReason) break;
    const realtime = realtimeOf(row.session);
    const terminal = reason === "silence" && Boolean(realtime?.naturalBase);
    // A natural call's silence after the worker spoke is stored as a normal ending, so Twilio's status callback
    // also reads it as answered-but-unsaved rather than unanswered, whichever arrives first.
    const stored: BridgeCloseReason = terminal && spoke ? "normal" : reason;
    const session: BridgeClosedSession = { ...row.session, bridgeCloseReason: stored };
    const recorded = await advanceVoiceSession(client, row.call_sid, row.seq, {
      session: terminal && realtime ? withRealtime({ ...session, done: true }, { ...realtime, closed: true, fallbackPrepared: true }) : session,
      misses: row.misses,
      last_response: terminal ? "<Response><Hangup/></Response>" : row.last_response,
    });
    if (recorded) { row = recorded; break; }
    row = await readVoiceSession(client, ticket.sid);
  }
  const failure: CallFailure | undefined = reason === "silence" && spoke ? "not_saved" : DIAGNOSTIC[reason];
  if (!failure || ticket.p) return "logged";
  const realtime = row ? realtimeOf(row.session) : null;
  // Silence on a guided call carries on by keypad, where the worker may still answer.
  if (reason === "silence" && row && !row.session.done && !realtime?.naturalBase) return "logged";
  // The run and its diagnostic follow after the bridge has its answer; both are idempotent against the status callback.
  await afterResponse(async () => {
    try {
      if (reason === "silence") await (spoke ? endSpokenSilentReportCall : resolveSilentReportCall)(client, ticket, now);
      // Idempotent: a run with a report or an existing diagnostic is left as it is.
      await recordCallFailure(client, ticket.f, ticket.r, failure, now);
    } catch (error) {
      console.error(`[NAQAH] realtime closed follow-up failed (${error instanceof Error ? error.name : "unknown"})`);
    }
  });
  return "recorded";
}
