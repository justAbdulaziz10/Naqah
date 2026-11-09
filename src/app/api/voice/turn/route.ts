import { shouldRefuseUnsignedVoice, voiceConfiguration, voiceLocale, voiceMode } from "@/server/env";
import { answerFarmCall } from "@/server/voice/farm-call";
import { farmResponse, farmWebhook } from "@/server/voice/farm-webhook";
import { replayVoiceState, trailingMissCount, voiceActionUrl } from "@/server/voice/conversation";
import { logVoiceTurn } from "@/server/voice/diagnostics";
import { mapSpeechToInput, unknownReply } from "@/server/voice/speech";
import { VOICE_MISS_VALUE, signVoiceState, verifyVoiceState } from "@/server/voice/state";
import { scheduleOwnerSummary } from "@/server/voice/summary";
import { SAMPLE_CALL_ENDED, twimlGather, twimlGoodbye, twimlResponse } from "@/server/voice/twiml";
import { checkTwilioWebhookSignature } from "@/server/twilio/signature";
import { MAX_FORM_BODY_BYTES, readBoundedText } from "@/lib/http/body";
import { voiceMessages } from "@/server/voice/messages";

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
      confidence: hook.form.get("Confidence"),
      now: new Date(),
    }));
  }

  const config = voiceConfiguration();
  if (!config.secret || !config.workerPhone || shouldRefuseUnsignedVoice()) {
    return twimlResponse(twimlGoodbye(config.locale, voiceMessages[config.locale].lineNotConfigured));
  }

  const bounded = await readBoundedText(request, MAX_FORM_BODY_BYTES);
  if (!bounded.ok) return twimlResponse(twimlGoodbye(config.locale), bounded.status);
  const form = new URLSearchParams(bounded.text);
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
    const input = mapSpeechToInput(current.session, form.get("SpeechResult") ?? "", form.get("Digits"), state.l, form.get("Confidence"));
    logVoiceTurn({
      callSid: form.get("CallSid") ?? "", seq: state.a.length, speech: form.get("SpeechResult") ?? "",
      digits: form.get("Digits"), confidence: form.get("Confidence"),
    }, input);

    if (!input) {
      const misses = trailingMissCount(state.a);
      const hasInput = Boolean(form.get("SpeechResult")?.trim() || form.get("Digits"));
      if (misses >= 2 && !hasInput) return twimlResponse(twimlGoodbye(state.l, voiceMessages[state.l].missedTwice));
      const fallback = misses >= 1 ? unknownReply(current.session.replies) : undefined;
      if (fallback) state.a.push({ value: fallback.value });
      else {
        state.a.push({ value: VOICE_MISS_VALUE });
        return responseForState(request, state, voiceMessages[state.l][misses >= 1 ? "missAgain" : "missOnce"]).response;
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
