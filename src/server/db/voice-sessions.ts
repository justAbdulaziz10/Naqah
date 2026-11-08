import type { SupabaseClient } from "@supabase/supabase-js";
import type { CallSession } from "@/domain/conversation/engine";
import type { Locale } from "@/domain/types";
import { fromPostgrest } from "./errors";

export interface VoiceSessionRow {
  call_sid: string;
  farm_id: string;
  party: "worker" | "owner";
  locale: Locale;
  seq: number;
  misses: number;
  session: CallSession;
  last_response: string;
}

type NewSession = Omit<VoiceSessionRow, "seq" | "misses"> & { created_at: string };

export async function readVoiceSession(client: SupabaseClient, callSid: string): Promise<VoiceSessionRow | null> {
  const { data, error } = await client.from("voice_call_sessions").select("*").eq("call_sid", callSid).maybeSingle();
  if (error) throw fromPostgrest(error);
  return data as VoiceSessionRow | null;
}

/** Twilio can repeat the first webhook, so the row that got in first is the call. */
export async function createVoiceSession(client: SupabaseClient, row: NewSession): Promise<VoiceSessionRow | null> {
  const { error } = await client.from("voice_call_sessions").upsert(row, { onConflict: "call_sid", ignoreDuplicates: true });
  if (error) throw fromPostgrest(error);
  return readVoiceSession(client, row.call_sid);
}

/** Moves the call on only from the turn it was read at. Null means another webhook got there first. */
export async function advanceVoiceSession(
  client: SupabaseClient,
  callSid: string,
  seq: number,
  next: Pick<VoiceSessionRow, "session" | "misses" | "last_response">,
  requireRealtimeOpen = false,
): Promise<VoiceSessionRow | null> {
  let query = client
    .from("voice_call_sessions")
    .update({ ...next, seq: seq + 1, updated_at: new Date().toISOString() })
    .eq("call_sid", callSid)
    .eq("seq", seq);
  if (requireRealtimeOpen) query = query.eq("session->realtime->closed", false);
  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw fromPostgrest(error);
  return data as VoiceSessionRow | null;
}

export async function deleteVoiceSession(client: SupabaseClient, callSid: string): Promise<void> {
  const { error } = await client.from("voice_call_sessions").delete().eq("call_sid", callSid);
  if (error) throw fromPostgrest(error);
}

/** Catches calls whose final status callback never arrived. */
export async function deleteStaleVoiceSessions(client: SupabaseClient, before: Date): Promise<void> {
  const { error } = await client.from("voice_call_sessions").delete().lt("created_at", before.toISOString());
  if (error) throw fromPostgrest(error);
}
