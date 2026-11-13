import { verifyCallToken } from "@/server/calls/token";
import { voiceLocale, voiceMode } from "@/server/env";
import { farmResponse, farmWebhook } from "@/server/voice/farm-webhook";
import { afterRealtimeCall } from "@/server/voice/realtime/service";
import { twimlGoodbye, twimlResponse } from "@/server/voice/twiml";

export const maxDuration = 20;

/**
 * Twilio fetches this when the media stream closes with the call still up. It stays available
 * when the engine flag is off, so a call in progress still resumes. Farm mode only.
 */
export async function POST(request: Request): Promise<Response> {
  const locale = voiceLocale();
  if (voiceMode() !== "farm") return twimlResponse(twimlGoodbye(locale), 404);
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "report" && token?.k !== "owner") return twimlResponse(twimlGoodbye(locale), 403);
  return farmResponse(afterRealtimeCall(hook.client, { token, callSid: hook.callSid }));
}
