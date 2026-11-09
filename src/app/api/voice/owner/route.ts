import { verifyCallToken } from "@/server/calls/token";
import { voiceLocale, voiceMode } from "@/server/env";
import { answerOwnerCall } from "@/server/voice/farm-call";
import { farmResponse, farmWebhook } from "@/server/voice/farm-webhook";
import { twimlGoodbye, twimlResponse } from "@/server/voice/twiml";

/** Twilio fetches this when the owner answers the summary call. The signed URL names the farm and report. */
export async function POST(request: Request): Promise<Response> {
  const locale = voiceLocale();
  if (voiceMode() !== "farm") {
    return twimlResponse(twimlGoodbye(locale, locale === "ar" ? "خط الاتصال غير مفعّل حالياً." : "The phone line is not configured yet."));
  }
  const hook = await farmWebhook(request);
  if (hook instanceof Response) return hook;
  const token = verifyCallToken(new URL(request.url).searchParams.get("s"));
  if (token?.k !== "owner") return twimlResponse(twimlGoodbye(locale), 403);
  return farmResponse(answerOwnerCall(hook.client, { token, callSid: hook.callSid, now: new Date() }));
}
