import { shouldRefuseUnsignedVoice, voiceConfiguration, voiceMode } from "@/server/env";
import { startFarmCall } from "@/server/voice/farm-call";
import { farmResponse, farmWebhook } from "@/server/voice/farm-webhook";
import { replayVoiceState, newVoiceState, voiceActionUrl } from "@/server/voice/conversation";
import { signVoiceState } from "@/server/voice/state";
import { SAMPLE_CALL_NOTICE, twimlGather, twimlGoodbye, twimlResponse } from "@/server/voice/twiml";
import { checkTwilioWebhookSignature } from "@/server/twilio/signature";
import { normalizeSpeech } from "@/server/voice/speech";

function normalizePhone(phone: string): string {
  let digits = normalizeSpeech(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `966${digits.slice(1)}`;
  return digits;
}

function disabledResponse(locale: "ar" | "en") {
  return twimlResponse(
    twimlGoodbye(locale, locale === "ar" ? "خط الاتصال غير مفعّل حالياً." : "The phone line is not configured yet."),
  );
}

export async function POST(request: Request): Promise<Response> {
  if (voiceMode() === "farm") {
    const hook = await farmWebhook(request);
    if (hook instanceof Response) return hook;
    return farmResponse(startFarmCall(hook.client, { from: hook.form.get("From") ?? "", callSid: hook.callSid, now: new Date() }));
  }

  const config = voiceConfiguration();
  if (!config.secret || !config.workerPhone || shouldRefuseUnsignedVoice()) return disabledResponse(config.locale);

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return twimlResponse(twimlGoodbye(config.locale));
  }
  const signature = checkTwilioWebhookSignature(request, form);
  if (!signature.valid) return twimlResponse(twimlGoodbye(config.locale), 403);

  const caller = normalizePhone(form.get("From") ?? "");
  const worker = normalizePhone(config.workerPhone);
  const owner = normalizePhone(config.ownerPhone);
  let scenario: "worker_report" | "owner_inquiry";
  if (caller && caller === worker) scenario = "worker_report";
  else if (caller && owner && caller === owner) scenario = "owner_inquiry";
  else {
    return twimlResponse(
      twimlGoodbye(config.locale, config.locale === "ar" ? "هذا الرقم غير مسجل لدى ناقة." : "This number is not registered with NAQAH."),
    );
  }

  const callSid = form.has("CallSid") ? form.get("CallSid") ?? "" : undefined;
  if (callSid && callSid.length > 128) return twimlResponse(twimlGoodbye(config.locale));
  const state = newVoiceState(scenario, config.locale, Date.now(), callSid);
  let replay: ReturnType<typeof replayVoiceState>;
  try {
    replay = replayVoiceState(state);
  } catch (error) {
    console.error(error instanceof Error ? error.name : "UnknownError");
    return twimlResponse(twimlGoodbye(state.l));
  }
  if (replay.session.done) {
    const final = [...replay.session.turns].reverse().find((turn) => turn.speaker === "agent")?.text[state.l];
    return twimlResponse(twimlGoodbye(state.l, final));
  }
  const signed = signVoiceState(state, config.secret);
  const action = voiceActionUrl(request.url, signed);
  return twimlResponse(twimlGather(replay.session, state.l, action, SAMPLE_CALL_NOTICE[state.l]));
}
