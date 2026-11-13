import { verifyCallToken } from "@/server/calls/token";
import { voiceMode } from "@/server/env";
import { gateOutboundAnswer, ownerCallStatus } from "@/server/voice/farm-call";
import { twimlResponse } from "@/server/voice/twiml";
import { farmWebhook } from "@/server/voice/farm-webhook";

const empty = (status: number) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

/** Final status of the owner's update call: records whether the owner answered. */
export async function POST(request: Request): Promise<Response> {
  if (voiceMode() !== "farm") return empty(204);
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "owner") return empty(403);
  try {
    if (new URL(request.url).searchParams.get("amd") === "1") return twimlResponse(await gateOutboundAnswer(hook.client, { token, callSid: hook.callSid, answeredBy: hook.form.get("AnsweredBy"), now: new Date() }));
    await ownerCallStatus(hook.client, { token, callSid: hook.callSid, status: hook.form.get("CallStatus") ?? "", now: new Date() });
    return empty(204);
  } catch (error) {
    console.error(`[NAQAH] owner call status failed (${error instanceof Error ? error.name : "unknown"})`);
    return empty(503);
  }
}
