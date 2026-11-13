import { withTimeout } from "@/lib/supabase/timeout";
import { bridgeRequest } from "@/server/voice/realtime/internal";
import { openRealtimeSession } from "@/server/voice/realtime/service";
import { bridgeTimeLimitSeconds } from "@/server/calls/config";

export const maxDuration = 20;

/** The bridge presents the stream's ticket and receives the call's instructions. Single use. */
export async function POST(request: Request): Promise<Response> {
  const bridge = await bridgeRequest(request);
  if (bridge instanceof Response) return bridge;
  try {
    const opened = await withTimeout(openRealtimeSession(bridge.client, bridge.body, bridge.secret, bridge.now), 8_000);
    return opened ? Response.json({ ...opened, maxSeconds: Math.min(opened.maxSeconds, bridgeTimeLimitSeconds()) }, { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 403 });
  } catch (error) {
    console.error(`[NAQAH] realtime session failed (${error instanceof Error ? error.name : "unknown"})`);
    return new Response(null, { status: 503 });
  }
}
