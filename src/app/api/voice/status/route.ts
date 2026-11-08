import { voiceMode } from "@/server/env";
import { endFarmCall } from "@/server/voice/farm-call";
import { farmWebhook } from "@/server/voice/farm-webhook";

const ENDED = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);
const noContent = () => new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });

/** A call that ends before its save saved nothing, so this only clears the working state. */
export async function POST(request: Request): Promise<Response> {
  if (voiceMode() !== "farm") return noContent();
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  if (!ENDED.has(hook.form.get("CallStatus") ?? "")) return noContent();
  try {
    await endFarmCall(hook.client, hook.callSid);
    return noContent();
  } catch (error) {
    console.error(`[NAQAH] voice status failed (${error instanceof Error ? error.name : "unknown"})`);
    return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
