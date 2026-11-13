import { withTimeout } from "@/lib/supabase/timeout";
import { bridgeRequest } from "@/server/voice/realtime/internal";
import { recordBridgeClosed } from "@/server/voice/realtime/closed";

export const maxDuration = 20;

/** The bridge reports why a call's stream closed. Diagnostic only; it never moves the call or its run. */
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
