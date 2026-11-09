import { verifyCallToken } from "@/server/calls/token";
import { voiceLocale, voiceMode } from "@/server/env";
import { ownerCallHeard } from "@/server/voice/farm-call";
import { farmResponse, farmWebhook } from "@/server/voice/farm-webhook";
import { twimlGoodbye, twimlResponse } from "@/server/voice/twiml";

/** Twilio follows this only after the whole Basic summary was spoken, so it records a completed call. */
export async function POST(request: Request): Promise<Response> {
  const locale = voiceLocale();
  if (voiceMode() !== "farm") return twimlResponse(twimlGoodbye(locale));
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "owner") return twimlResponse(twimlGoodbye(locale), 403);
  return farmResponse(ownerCallHeard(hook.client, { token, callSid: hook.callSid, now: new Date() }));
}
