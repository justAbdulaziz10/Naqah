import { voiceConfiguration } from "@/server/env";
import { replayVoiceState, newVoiceState, voiceActionUrl } from "@/server/voice/conversation";
import { signVoiceState } from "@/server/voice/state";
import { twimlGather, twimlGoodbye, twimlResponse } from "@/server/voice/twiml";
import { formParameters, validateTwilioSignature } from "@/server/twilio/signature";
import { normalizeSpeech } from "@/server/voice/speech";

function normalizePhone(phone: string): string {
  let digits = normalizeSpeech(phone).replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 10) digits = `966${digits.slice(1)}`;
  return digits;
}

function trustedRequest(request: Request, form: URLSearchParams): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN?.trim();
  if (!token) return true;
  return validateTwilioSignature(
    request.url,
    formParameters(form),
    request.headers.get("X-Twilio-Signature"),
    token,
  );
}

export async function POST(request: Request): Promise<Response> {
  const config = voiceConfiguration();
  if (!config.secret || !config.workerPhone) {
    return twimlResponse(
      twimlGoodbye(config.locale, config.locale === "ar" ? "خط الاتصال غير مفعّل حالياً." : "The phone line is not configured yet."),
    );
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return twimlResponse(twimlGoodbye(config.locale));
  }
  if (!trustedRequest(request, form)) return twimlResponse(twimlGoodbye(config.locale), 403);

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

  const state = newVoiceState(scenario, config.locale, Date.now());
  const replay = replayVoiceState(state);
  if (replay.session.done) {
    const final = [...replay.session.turns].reverse().find((turn) => turn.speaker === "agent")?.text[state.l];
    return twimlResponse(twimlGoodbye(state.l, final));
  }
  const signed = signVoiceState(state, config.secret);
  const action = voiceActionUrl(request.url, signed);
  return twimlResponse(twimlGather(replay.session, state.l, action));
}
