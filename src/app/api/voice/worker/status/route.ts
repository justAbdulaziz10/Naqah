import { verifyCallToken } from "@/server/calls/token";
import { voiceMode } from "@/server/env";
import { workerCallStatus } from "@/server/voice/farm-call";
import { farmWebhook } from "@/server/voice/farm-webhook";

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/** Final status of a worker instruction or verification call. Answering alone does not mean delivered. */
export async function POST(request: Request): Promise<Response> {
  if (voiceMode() !== "farm") return empty(204);
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "worker") return empty(403);
  try {
    await workerCallStatus(hook.client, { token, callSid: hook.callSid, status: hook.form.get("CallStatus") ?? "", now: new Date() });
    return empty(204);
  } catch (error) {
    console.error(`[NAQAH] worker call status failed (${error instanceof Error ? error.name : "unknown"})`);
    return empty(503);
  }
}
