/**
 * Signed closure notices preserve the bridge's goodbye and resolve unsaved natural silence as unanswered.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCallFailure, type CallFailure } from "@/server/calls/reliability";
import { advanceVoiceSession, readVoiceSession } from "@/server/db/voice-sessions";
import type { CallSession } from "@/domain/conversation/engine";
import { resolveSilentReportCall } from "../farm-call";
import { realtimeOf, withRealtime } from "./state";
import { TICKET_CALL_MS, verifyRealtimeTicket } from "./ticket";

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

export async function recordBridgeClosed(client: SupabaseClient, body: Record<string, unknown>, secret: string, now: Date): Promise<BridgeClosedOutcome> {
  const { reason, event } = body;
  if (!isReason(reason) || (event !== undefined && (typeof event !== "string" || !/^[a-z_]{1,64}$/.test(event)))) return "invalid";
  const ticket = verifyRealtimeTicket(body.ticket, secret, now.getTime(), TICKET_CALL_MS);
  if (!ticket || ticket.sid !== body.callSid) return "forbidden";
  console.info(`[NAQAH] realtime stream closed (${reason}${event ? `, ${event}` : ""}) call …${ticket.sid.slice(-6)}`);
  let row = await readVoiceSession(client, ticket.sid);
  for (let attempt = 0; row && attempt < 3; attempt += 1) {
    if (row.farm_id !== ticket.f || realtimeOf(row.session)?.jti !== ticket.j || row.party !== (ticket.p ?? "worker")) return "forbidden";
    if ((row.session as BridgeClosedSession).bridgeCloseReason) break;
    const realtime = realtimeOf(row.session);
    const terminal = reason === "silence" && Boolean(realtime?.naturalBase);
    const session: BridgeClosedSession = { ...row.session, bridgeCloseReason: reason };
    const recorded = await advanceVoiceSession(client, row.call_sid, row.seq, {
      session: terminal && realtime ? withRealtime({ ...session, done: true }, { ...realtime, closed: true, fallbackPrepared: true }) : session,
      misses: row.misses,
      last_response: terminal ? "<Response><Hangup/></Response>" : row.last_response,
    });
    if (recorded) { row = recorded; break; }
    row = await readVoiceSession(client, ticket.sid);
  }
  const failure = DIAGNOSTIC[reason];
  if (!failure || ticket.p) return "logged";
  const realtime = row ? realtimeOf(row.session) : null;
  // Silence on a guided call carries on by keypad, where the worker may still answer.
  if (reason === "silence" && row && !row.session.done && !realtime?.naturalBase) return "logged";
  if (reason === "silence") await resolveSilentReportCall(client, ticket, now);
  // Idempotent: a run with a report or an existing diagnostic is left as it is.
  await recordCallFailure(client, ticket.f, ticket.r, failure, now);
  return "recorded";
}
