import { withTimeout } from "@/lib/supabase/timeout";
import { bridgeRequest } from "@/server/voice/realtime/internal";
import { fallbackResult, parseToolBody, runRealtimeTool } from "@/server/voice/realtime/service";

export const maxDuration = 20;

/** One model tool call, applied as one engine step. Failures return a fallback, never a claim. */
export async function POST(request: Request): Promise<Response> {
  const bridge = await bridgeRequest(request);
  if (bridge instanceof Response) return bridge;
  const body = parseToolBody(bridge.body);
  if (!body) return new Response(null, { status: 400 });
  try {
    const result = await withTimeout(runRealtimeTool(bridge.client, body, bridge.secret, bridge.now), 12_000);
    return result ? Response.json(result, { headers: { "Cache-Control": "no-store" } }) : new Response(null, { status: 403 });
  } catch (error) {
    console.error(`[NAQAH] realtime tool timed out (${error instanceof Error ? error.name : "unknown"})`);
    return Response.json(fallbackResult(), { headers: { "Cache-Control": "no-store" } });
  }
}
