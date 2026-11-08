/**
 * What a realtime call adds to its voice_call_sessions row, inside the `session` column. Both
 * writes here compare the turn they read, and neither moves it: the scripted fallback's Gather
 * stays numbered for the turn the worker is on.
 */
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallSession } from "@/domain/conversation/engine";
import { fromPostgrest } from "@/server/db/errors";
import type { VoiceSessionRow } from "@/server/db/voice-sessions";

export interface ToolResponse {
  output: string;
  awaitingConfirmation: boolean;
  end: null | "hangup" | "fallback";
  goodbye: string | null;
}

export interface RealtimeState {
  jti: string;
  /** The first thing the agent says, fixed when the call was answered. */
  opening: string;
  instructions?: string;
  claimedAt: string | null;
  /** Set once the call fell back to the script. A late tool call must not write after that. */
  closed: boolean;
  confirmationFailures?: number;
  recent: { id: string; result: ToolResponse }[];
}

const RECENT_TOOL_CALLS = 20;

export const realtimeOf = (session: CallSession): RealtimeState | null =>
  (session as CallSession & { realtime?: RealtimeState }).realtime ?? null;

export function withRealtime<T extends CallSession>(session: T, realtime: RealtimeState): T {
  return { ...session, realtime };
}

export function newRealtimeState(opening: string): RealtimeState {
  return { jti: randomBytes(16).toString("hex"), opening, claimedAt: null, closed: false, recent: [] };
}

/** A finished call keeps no facts, so only its closing result stays. */
export function rememberResult(realtime: RealtimeState, id: string, result: ToolResponse, done: boolean): RealtimeState {
  return { ...realtime, recent: done ? [{ id, result }] : [...realtime.recent, { id, result }].slice(-RECENT_TOOL_CALLS) };
}

async function writeRealtime(client: SupabaseClient, row: VoiceSessionRow, realtime: RealtimeState, unclaimedOnly: boolean, confirmationOnly = false): Promise<VoiceSessionRow | null> {
  let query = client
    .from("voice_call_sessions")
    .update({ session: withRealtime(row.session, realtime), updated_at: new Date().toISOString() })
    .eq("call_sid", row.call_sid)
    .eq("seq", row.seq)
    .eq("session->realtime->closed", false);
  if (unclaimedOnly) query = query.eq("session->realtime->>jti", realtime.jti).is("session->realtime->>claimedAt", null);
  if (confirmationOnly) {
    const failures = realtimeOf(row.session)?.confirmationFailures;
    query = failures === undefined
      ? query.is("session->realtime->confirmationFailures", null)
      : query.eq("session->realtime->confirmationFailures", failures);
  }
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw fromPostgrest(error);
  return data as VoiceSessionRow | null;
}

export function recordConfirmationFailure(client: SupabaseClient, row: VoiceSessionRow, realtime: RealtimeState): Promise<VoiceSessionRow | null> {
  return writeRealtime(client, row, realtime, false, true);
}

/** Null means someone else claimed it first, which is what makes the ticket single use. */
export function claimRealtime(client: SupabaseClient, row: VoiceSessionRow, realtime: RealtimeState, now: Date): Promise<VoiceSessionRow | null> {
  return writeRealtime(client, row, { ...realtime, claimedAt: now.toISOString() }, true);
}

export function closeRealtime(client: SupabaseClient, row: VoiceSessionRow, realtime: RealtimeState): Promise<VoiceSessionRow | null> {
  return writeRealtime(client, row, { ...realtime, closed: true }, false);
}
