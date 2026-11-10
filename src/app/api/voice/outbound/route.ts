import { verifyCallToken } from "@/server/calls/token";
import { voiceLocale, voiceMode } from "@/server/env";
import { answerReportCall } from "@/server/voice/farm-call";
import { farmResponse, farmWebhook } from "@/server/voice/farm-webhook";
import { voiceMessages } from "@/server/voice/messages";
import { twimlGoodbye, twimlResponse } from "@/server/voice/twiml";

/**
 * Twilio fetches this when the worker answers NAQAH's report call. The farm and run come from the
 * signed `s` token the scheduler put in the URL; caller ID is not used. Farm mode only.
 */
export async function POST(request: Request): Promise<Response> {
  const locale = voiceLocale();
  if (voiceMode() !== "farm") {
    return twimlResponse(twimlGoodbye(locale, voiceMessages[locale].lineNotConfigured));
  }
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "report") return twimlResponse(twimlGoodbye(locale), 403);
  return farmResponse(answerReportCall(hook.client, { token, callSid: hook.callSid, now: new Date() }));
}
