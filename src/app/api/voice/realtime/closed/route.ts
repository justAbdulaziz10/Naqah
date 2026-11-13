import { advanceVoiceSession, readVoiceSession } from "@/server/db/voice-sessions";
import { bridgeRequest } from "@/server/voice/realtime/internal";
import { realtimeOf, withRealtime } from "@/server/voice/realtime/state";
import { TICKET_CALL_MS, verifyRealtimeTicket } from "@/server/voice/realtime/ticket";
import { recordCallFailure } from "@/server/calls/reliability";

export const maxDuration = 20;

export async function POST(request: Request): Promise<Response> {
  const bridge = await bridgeRequest(request);
  if (bridge instanceof Response) return bridge;
  const ticket = verifyRealtimeTicket(bridge.body.ticket, bridge.secret, bridge.now.getTime(), TICKET_CALL_MS);
  if (!ticket || ticket.sid !== bridge.body.callSid || typeof bridge.body.event !== "string") return new Response(null, { status: 403 });
  try {
    const row = await readVoiceSession(bridge.client, ticket.sid);
    const realtime = row && realtimeOf(row.session);
    if (row && (row.farm_id !== ticket.f || realtime?.jti !== ticket.j)) return new Response(null, { status: 403 });
    if (row && !row.session.done && realtime && !realtime.closed) {
      await advanceVoiceSession(bridge.client, row.call_sid, row.seq, {
        session: withRealtime(row.session, { ...realtime, closed: true }), misses: row.misses, last_response: row.last_response,
      }, true);
    }
    if (!ticket.p && !row?.session.done) {
      const event = bridge.body.event;
      await recordCallFailure(bridge.client, ticket.f, ticket.r, event === "maximum_timeout" ? "timed_out" : event === "provider_auth_failed" ? "openai_auth" : "bridge_disconnected", bridge.now);
    }
    return new Response(null, { status: 204 });
  } catch { return new Response(null, { status: 503 }); }
}
