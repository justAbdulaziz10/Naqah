import { withTimeout } from "@/lib/supabase/timeout";
import { bridgeRequest } from "@/server/voice/realtime/internal";
import { recordBridgeClosed } from "@/server/voice/realtime/closed";

export const maxDuration = 20;

/**
 * The bridge reports why a call's stream closed. The closure is stored on the session before the response; a silent
 * natural report call's run and diagnostic are settled after it (`after`), so the bridge's short wait is enough.
 */
export async function POST(request: Request): Promise<Response> {
  const bridge = await bridgeRequest(request);
  if (bridge instanceof Response) return bridge;
  try {
    const outcome = await withTimeout(recordBridgeClosed(bridge.client, bridge.body, bridge.secret, bridge.now), 8_000);
    if (outcome === "invalid") return new Response(null, { status: 400 });
    if (outcome === "forbidden") return new Response(null, { status: 403 });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error(`[NAQAH] realtime closed notice failed (${error instanceof Error ? error.name : "unknown"})`);
    return new Response(null, { status: 503 });
  }
}
