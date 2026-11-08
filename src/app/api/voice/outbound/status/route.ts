import { verifyCallToken } from "@/server/calls/token";
import { voiceMode } from "@/server/env";
import { reportCallStatus } from "@/server/voice/farm-call";
import { farmWebhook } from "@/server/voice/farm-webhook";

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/** Final status of a report call: unanswered → retry or missed; answered and hung up → ended unsaved. */
export async function POST(request: Request): Promise<Response> {
  if (voiceMode() !== "farm") return empty(204);
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "report") return empty(403);
  try {
    await reportCallStatus(hook.client, { token, callSid: hook.callSid, status: hook.form.get("CallStatus") ?? "", now: new Date() });
    return empty(204);
  } catch (error) {
    console.error(`[NAQAH] report call status failed (${error instanceof Error ? error.name : "unknown"})`);
    // Twilio does not retry status callbacks; the run stays as it was and the next scheduler pass sees it.
    return empty(503);
  }
}
