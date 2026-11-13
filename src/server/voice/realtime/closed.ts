/**
 * The bridge's notice that a call's media stream closed, and why. It changes no call state: Twilio's `<Connect action>`
 * and status callback still decide fallback and the run's outcome. A failure only adds the run's diagnostic, once.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordCallFailure, type CallFailure } from "@/server/calls/reliability";
import { readVoiceSession } from "@/server/db/voice-sessions";
import { realtimeOf } from "./state";
import { TICKET_CALL_MS, verifyRealtimeTicket } from "./ticket";

export const BRIDGE_CLOSE_REASONS = ["normal", "silence", "timeout", "twilio_closed", "openai_error", "openai_credit", "bridge_error"] as const;
export type BridgeCloseReason = (typeof BRIDGE_CLOSE_REASONS)[number];

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
  const failure = DIAGNOSTIC[reason];
  // An owner's summary call has no report run to describe.
  if (!failure || ticket.p) return "logged";
  const row = await readVoiceSession(client, ticket.sid);
  const realtime = row ? realtimeOf(row.session) : null;
  if (row && (row.farm_id !== ticket.f || realtime?.jti !== ticket.j)) return "forbidden";
  // Silence on a guided call carries on by keypad, where the worker may still answer.
  if (reason === "silence" && row && !row.session.done && !realtime?.naturalBase) return "logged";
  // Idempotent: a run with a report or an existing diagnostic is left as it is.
  await recordCallFailure(client, ticket.f, ticket.r, failure, now);
  return "recorded";
}
