import { shouldRefuseUnsignedVoice, voiceConfiguration, voiceLocale, voiceMode } from "@/server/env";
import { answerFarmCall } from "@/server/voice/farm-call";
import { farmResponse, farmWebhook } from "@/server/voice/farm-webhook";
import { replayVoiceState, trailingMissCount, voiceActionUrl } from "@/server/voice/conversation";
import { mapSpeechToInput, unknownReply } from "@/server/voice/speech";
import { VOICE_MISS_VALUE, signVoiceState, verifyVoiceState } from "@/server/voice/state";
import { scheduleOwnerSummary } from "@/server/voice/summary";
import { SAMPLE_CALL_ENDED, twimlGather, twimlGoodbye, twimlResponse } from "@/server/voice/twiml";
import { checkTwilioWebhookSignature } from "@/server/twilio/signature";

const MISS_ONCE = {
  ar: "معليش، ما فهمت عليك. ",
  en: "Sorry, I didn't catch that. ",
} as const;
const MISS_AGAIN = {
  ar: "معليش، ما وصلتني الإجابة. نعيد السؤال مرة أخيرة. ",
  en: "Sorry, I still didn't catch that. Let's try once more. ",
} as const;
const MISSED_TWICE = {
  ar: "ما قدرت أفهم إجابتك. تقدر تتصل مرة ثانية، يعطيك العافية.",
  en: "I couldn't understand your answer. Please call again. Thank you.",
} as const;

function hangUpWithCurrentTurn(session: ReturnType<typeof replayVoiceState>["session"], locale: "ar" | "en") {
  const final = [...session.turns].reverse().find((turn) => turn.speaker === "agent")?.text[locale];
  return twimlResponse(twimlGoodbye(locale, session.next ? SAMPLE_CALL_ENDED[locale] : final));
}

function responseForState(request: Request, state: NonNullable<ReturnType<typeof verifyVoiceState>>, prefix = "") {
  const replay = replayVoiceState(state);
  if (replay.session.done) return { replay, response: hangUpWithCurrentTurn(replay.session, state.l) };
  const signed = signVoiceState(state);
  return {
    replay,
    response: twimlResponse(twimlGather(replay.session, state.l, voiceActionUrl(request.url, signed), prefix)),
  };
}

export async function POST(request: Request): Promise<Response> {
  if (voiceMode() === "farm") {
    const hook = await farmWebhook(request);
    if (hook instanceof Response) return hook;
    const seq = new URL(request.url).searchParams.get("n") ?? "";
    if (!/^\d{1,4}$/.test(seq)) return twimlResponse(twimlGoodbye(voiceLocale()), 400);
    return farmResponse(answerFarmCall(hook.client, {
      callSid: hook.callSid,
      seq: Number(seq),
      speech: hook.form.get("SpeechResult") ?? "",
      digits: hook.form.get("Digits"),
      now: new Date(),
    }));
  }

  const config = voiceConfiguration();
  if (!config.secret || !config.workerPhone || shouldRefuseUnsignedVoice()) {
    return twimlResponse(twimlGoodbye(config.locale, config.locale === "ar" ? "خط الاتصال غير مفعّل حالياً." : "The phone line is not configured yet."));
  }

  let form: URLSearchParams;
  try {
    form = new URLSearchParams(await request.text());
  } catch {
    return twimlResponse(twimlGoodbye(config.locale));
  }
  const signature = checkTwilioWebhookSignature(request, form);
  if (!signature.valid) return twimlResponse(twimlGoodbye(config.locale), 403);
  const url = new URL(request.url);
  const state = verifyVoiceState(url.searchParams.get("s"), config.secret);
  if (!state) return twimlResponse(twimlGoodbye(config.locale));
  if (state.callSid !== undefined && form.get("CallSid") !== state.callSid) {
    return twimlResponse(twimlGoodbye(state.l), 403);
  }

  try {
    const current = replayVoiceState(state);
    if (current.session.done) return hangUpWithCurrentTurn(current.session, state.l);
    const input = mapSpeechToInput(current.session, form.get("SpeechResult") ?? "", form.get("Digits"), state.l);

    if (!input) {
      const misses = trailingMissCount(state.a);
      if (misses >= 2) return twimlResponse(twimlGoodbye(state.l, MISSED_TWICE[state.l]));
      if (misses === 1) {
        const reply = unknownReply(current.session.replies);
        if (reply) {
          state.a.push({ value: reply.value });
        } else {
          state.a.push({ value: VOICE_MISS_VALUE });
          return responseForState(request, state, MISS_AGAIN[state.l]).response;
        }
      } else {
        state.a.push({ value: VOICE_MISS_VALUE });
        return responseForState(request, state, MISS_ONCE[state.l]).response;
      }
    } else {
      state.a.push(input);
    }

    const next = responseForState(request, state);
    if (next.replay.session.done) {
      const workspace = next.replay.workspace;
      const latestReport = workspace.reports[workspace.reports.length - 1];
      const latestCall = workspace.calls[workspace.calls.length - 1];
      if (state.sc === "report_call" && latestCall?.kind === "worker_report" && latestCall.at === new Date(state.t).toISOString() && latestReport) {
        if (signature.verified) await scheduleOwnerSummary(latestReport, state.l);
        else console.info("owner summary skipped: unsigned webhook");
      }
    }
    return next.response;
  } catch (error) {
    console.error(error instanceof Error ? error.name : "UnknownError");
    return twimlResponse(twimlGoodbye(state.l));
  }
}
