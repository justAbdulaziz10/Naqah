/**
 * A real call on a real farm. The scripted engine runs the dialogue against the farm loaded from
 * Supabase, and every outcome is saved through the voice contract before the caller hears it.
 * The engine's own `commit` is never applied: it only signals which event to send, because
 * applyVoiceEvent runs the rules again on fresh state. See docs/integrations/twilio-activation.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { answer, start, type AnswerInput, type CallSession, type EngineResult } from "@/domain/conversation/engine";
import { makePersonalizer, personalizeTree } from "@/domain/conversation/personalize";
import type { ReportDraft } from "@/domain/findings";
import type { Locale, Workspace } from "@/domain/types";
import { DbError } from "@/server/db/errors";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { findCaller, findReportCallRun, recordedOutcome } from "@/server/db/service-repository";
import { callOwnerAfterReport } from "@/server/calls/owner-call";
import { afterResponse } from "@/server/calls/after";
import type { CallToken } from "@/server/calls/token";
import {
  advanceVoiceSession, createVoiceSession, deleteStaleVoiceSessions, deleteVoiceSession, readVoiceSession,
  type VoiceSessionRow,
} from "@/server/db/voice-sessions";
import { voiceLocale, voiceOwnerInquiryEnabled } from "@/server/env";
import { applyVoiceEvent, parseVoiceEvent, type VoiceContext, type VoiceOutcome } from "./contract";
import { logVoiceTurn } from "./diagnostics";
import { mapSpeechToInput, unknownReply } from "./speech";
import { twimlGather, twimlGoodbye } from "./twiml";

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

type Copy = Record<Locale, string>;
type VoiceCallSession = CallSession & { voiceSilences?: number };

const NOT_REGISTERED: Copy = { ar: "هذا الرقم غير مسجل لدى ناقة.", en: "This number is not registered with NAQAH." };
const NOT_READY: Copy = {
  ar: "إعداد هذي العزبة ما اكتمل. فضلاً تواصل مع صاحب العزبة.",
  en: "This farm's setup isn't finished yet. Please contact the farm owner.",
};
const OWNER_LINE_CLOSED: Copy = {
  ar: "استفسار المالك بالهاتف غير متاح الآن. آخر التفاصيل موجودة في الموقع.",
  en: "Owner calls aren't available yet. The latest details are on the website.",
};
const SAVED: Copy = { ar: "تم حفظ التحديث، شكراً لك. مع السلامة.", en: "Your update is saved. Thank you. Goodbye." };
const REFUSED: Copy = {
  ar: "ما انحفظ هذا التحديث، لأن تحديث هذه الفترة وصلنا. يعطيك العافية.",
  en: "This update wasn't saved, because this period's update is already in. Thank you.",
};
const CALL_NOT_ACTIVE: Copy = {
  ar: "ما انحفظ هذا التحديث، لأن مكالمة التقرير هذه انتهت. ناقة بتتصل في الموعد الجاي. يعطيك العافية.",
  en: "This update wasn't saved, because this report call is no longer active. NAQAH will call at the next report time. Thank you.",
};
const CALLBACK_FIRST: Copy = {
  ar: "ما انحفظ هذا التحديث، لأن عندك مكالمة فائتة منا. فضلاً اتصل مرة ثانية عشان توصلك الرسالة.",
  en: "This update wasn't saved, because you have a missed call from us. Please call again to get the message.",
};
// A save can land even when its reply is lost, so this must not say that nothing was saved.
const SAVE_RETRY: Copy = {
  ar: "ما قدرت أتأكد من الحفظ. نحاول مرة ثانية. ",
  en: "I couldn't confirm the save. Let's try once more. ",
};
export const SAVE_FAILED: Copy = {
  ar: "صار خلل وما قدرت أتأكد من حفظ شيء. فضلاً اتصل مرة ثانية.",
  en: "Something went wrong and I couldn't confirm that anything was saved. Please call again.",
};
const MISS_ONCE: Copy = { ar: "معليش، ما فهمت عليك. ", en: "Sorry, I didn't catch that. " };
const MISS_AGAIN: Copy = {
  ar: "معليش، ما وصلتني الإجابة. نعيد السؤال مرة أخيرة. ",
  en: "Sorry, I still didn't catch that. Let's try once more. ",
};
const SPOKEN_MISS: Copy = {
  ar: "سمعتك، بس ما فهمت إجابتك على السؤال. تقدر تجاوب أو تستخدم الأزرار. ",
  en: "I heard you, but could not match your answer to this question. Please answer or use the keypad. ",
};
const UNKNOWN_FALLBACK: Copy = {
  ar: "ما قدرت أحدد الإجابة، بسجل هالسؤال غير معروف ونكمل. ",
  en: "I could not determine that answer. I will mark this question unknown and continue. ",
};
const MISSED_TWICE: Copy = {
  ar: "ما قدرت أفهم إجابتك. تقدر تتصل مرة ثانية، يعطيك العافية.",
  en: "I couldn't understand your answer. Please call again. Thank you.",
};

const turnUrl = (seq: number) => `/api/voice/turn?n=${seq}`;

/**
 * Only the agent's latest line is kept: enough to repeat a question, and no record of what was
 * said. A finished call keeps no facts at all; a repeated webhook only needs its last reply.
 */
function withoutTranscript(session: CallSession): CallSession {
  if (session.done) return { ...session, turns: [], replies: [], data: {}, draft: { answers: [], camelUpdates: [], resourceUpdates: [], herdAccountedFor: null, taskConfirmations: [] } };
  return { ...session, turns: session.turns.filter((turn) => turn.speaker === "agent").slice(-1) };
}

/** The engine's copy uses the sample names, so a farm missing either name must not reach it. */
const namesReady = (ws: Workspace) => Boolean(ws.settings.worker.name.trim() && ws.settings.owner.name.trim());

/** Everything the agent says for this step, including lines before the question. */
function respond(session: CallSession, spokenFrom: number, ws: Workspace, locale: Locale, seq: number, prefix = ""): string {
  const personalize = makePersonalizer(ws);
  const lines = session.turns.slice(spokenFrom).filter((turn) => turn.speaker === "agent").map((turn) => personalize(turn.text[locale]));
  if (session.done) return twimlGoodbye(locale, `${prefix}${lines.join(" ")}`);
  const earlier = lines.slice(0, -1).join(" ");
  const speakable = { ...session, ...personalizeTree({ turns: session.turns.slice(-1), replies: session.replies }, personalize) };
  return twimlGather(speakable, locale, turnUrl(seq), `${prefix}${earlier ? `${earlier} ` : ""}`);
}

/** The contract takes a flag for the heat-day finding, and writes the finding itself. */
function wireDraft({ extraFindings, ...draft }: ReportDraft) {
  return { ...draft, ...(extraFindings?.length ? { heatWaterNeeded: true } : {}) };
}

type WireEvent = Record<string, unknown> & { type: string };

/** Which contract event an engine commit stands for. A commit with no event must not pass silently. */
function eventFor(before: CallSession | null, result: EngineResult, input: AnswerInput | null, callSid: string): WireEvent | null {
  if (!result.commit) return null;
  const base = { version: 1, providerCallId: callSid };
  const report = (extra: object = {}) => ({ ...base, eventId: `${callSid}:report`, type: "worker_report", draft: wireDraft(result.session.draft), ...extra });
  if (!before) {
    if (result.session.scenario === "worker_inbound") return report({ refusedAtStart: true });
    if (result.session.scenario === "owner_inquiry") return { ...base, eventId: `${callSid}:inquiry`, type: "owner_inquiry" };
  } else if (before.step === "report_summary") {
    const reportCallId = before.scenario === "report_call" ? before.data.reportCallId : undefined;
    if (input?.value === "confirm_save") return report(reportCallId ? { reportCallId } : {});
    // Only a report call commits here: the worker ended it without saving.
    if (reportCallId) return { ...base, eventId: `${callSid}:ended`, type: "report_call_ended", reportCallId };
  } else if (before.step === "callback_acknowledge") {
    return { ...base, eventId: `${callSid}:callback`, type: "worker_callback" };
  } else if (before.step === "callback_task_confirmation") {
    const taskId = before.data.callbackTaskIds?.[before.data.callbackTaskIndex ?? 0];
    return { ...base, eventId: `${callSid}:task:${taskId}`, type: "task_confirmation", taskId, done: input?.value === "yes", via: "worker_callback" };
  }
  throw new DbError("invalid_input", "call outcome has no voice event");
}

const contextFor = (party: VoiceSessionRow["party"]): VoiceContext =>
  party === "worker" ? { party: "worker" } : { party: "owner", call: "inquiry" };

function save(client: SupabaseClient, farmId: string, party: VoiceSessionRow["party"] | VoiceContext, event: unknown, now: Date): Promise<VoiceOutcome> {
  return applyVoiceEvent(client, farmId, typeof party === "string" ? contextFor(party) : party, parseVoiceEvent(event), now);
}

/** After a saved report: the farm owner's update call, when that paid channel is switched on. */
function notifyOwner(client: SupabaseClient, farmId: string, reportCallId: string | null, now: Date): Promise<void> {
  return afterResponse(async () => {
    const placed = await callOwnerAfterReport(client, { farmId, reportCallId, now });
    if (placed && !placed.placed) console.info(`[NAQAH] owner update call not placed (${placed.reason})`);
  });
}

export async function startFarmCall(client: SupabaseClient, input: { from: string; callSid: string; now: Date }): Promise<string> {
  const { from, callSid, now } = input;
  const repeated = await readVoiceSession(client, callSid);
  if (repeated) return repeated.last_response;
  await deleteStaleVoiceSessions(client, new Date(now.getTime() - STALE_AFTER_MS));

  const caller = await findCaller(client, from);
  const fallback = voiceLocale();
  if (caller.kind === "unknown") return twimlGoodbye(fallback, NOT_REGISTERED[fallback]);
  if (caller.kind === "owner" && !voiceOwnerInquiryEnabled()) return twimlGoodbye(fallback, OWNER_LINE_CLOSED[fallback]);

  const { workspace } = requireFarm(await loadFarm(client, { id: caller.farmId }));
  const locale = caller.kind === "worker" ? (workspace.settings.worker.language === "en" ? "en" : "ar") : fallback;
  if (!workspace.setupComplete || !namesReady(workspace)) return twimlGoodbye(locale, NOT_READY[locale]);

  // A worker calling in gets their missed message, returns a missed report call, or hears when NAQAH calls.
  const result = start(workspace, now, caller.kind === "worker" ? "worker_inbound" : "owner_inquiry");
  const event = eventFor(null, result, null, callSid);
  const outcome = event ? await save(client, caller.farmId, caller.kind, event, now) : null;
  if (result.session.done) return respond(result.session, 0, workspace, locale, 0);
  if (outcome?.status === "rejected") return twimlGoodbye(locale, OWNER_LINE_CLOSED[locale]);

  const response = respond(result.session, 0, workspace, locale, 0);
  const row = await createVoiceSession(client, {
    call_sid: callSid,
    farm_id: caller.farmId,
    party: caller.kind,
    locale,
    session: withoutTranscript(result.session),
    last_response: response,
    created_at: now.toISOString(),
  });
  return row?.last_response ?? response;
}

/** Stores the step and hands back what Twilio should play, or the first reply if a repeat won. */
async function advance(client: SupabaseClient, row: VoiceSessionRow, session: VoiceCallSession, misses: number, response: string, onAdvanced?: () => Promise<void>): Promise<string> {
  const saved = await advanceVoiceSession(client, row.call_sid, row.seq, { session: withoutTranscript(session), misses, last_response: response });
  if (saved) {
    await onAdvanced?.();
    return saved.last_response;
  }
  return (await readVoiceSession(client, row.call_sid))?.last_response ?? response;
}

export async function answerFarmCall(
  client: SupabaseClient,
  input: { callSid: string; seq: number; speech: string; digits: string | null; confidence?: string | null; now: Date },
): Promise<string> {
  const { callSid, seq, speech, digits, now } = input;
  const row = await readVoiceSession(client, callSid);
  if (!row) {
    logVoiceTurn(input, "missing_session");
    return twimlGoodbye(voiceLocale());
  }
  if (seq === row.seq - 1) {
    logVoiceTurn(input, "duplicate");
    return row.last_response;
  }
  if (seq !== row.seq || row.session.done) {
    logVoiceTurn(input, "stale");
    return twimlGoodbye(row.locale);
  }

  const { locale } = row;
  const hasInput = Boolean(speech.trim() || digits);
  const silenceCount = hasInput ? 0 : ((row.session as VoiceCallSession).voiceSilences ?? 0) + 1;
  const session = { ...row.session, voiceSilences: 0 };
  const { workspace } = requireFarm(await loadFarm(client, { id: row.farm_id }));
  const spoken = mapSpeechToInput(session, speech, digits, locale, input.confidence);
  logVoiceTurn(input, spoken);
  const next = row.seq + 1;
  const fallback = !spoken && hasInput && row.misses >= 1 ? unknownReply(session.replies) : undefined;
  if (!spoken && !fallback) {
    if (silenceCount >= 3) return advance(client, row, { ...session, done: true }, row.misses, twimlGoodbye(locale, MISSED_TWICE[locale]));
    const prefix = hasInput ? SPOKEN_MISS[locale] : (silenceCount === 1 ? MISS_ONCE : MISS_AGAIN)[locale];
    return advance(client, row, { ...session, voiceSilences: silenceCount }, Math.min(row.misses + 1, 2), respond(session, session.turns.length - 1, workspace, locale, next, prefix));
  }

  const chosen = spoken ?? { value: fallback!.value };
  const result = answer(session, workspace, now, chosen);
  const event = eventFor(session, result, chosen, callSid);
  let outcome: VoiceOutcome | null = null;
  if (event) {
    try {
      outcome = await save(client, row.farm_id, row.party, event, now);
    } catch (error) {
      console.error(`[NAQAH] voice save failed (${error instanceof DbError ? error.code : "unknown"})`);
      const retry = row.misses === 0 && !(error instanceof DbError && error.code === "invalid_input");
      if (!retry) return advance(client, row, { ...session, done: true }, row.misses, twimlGoodbye(locale, SAVE_FAILED[locale]));
      return advance(client, row, session, 1, respond(session, session.turns.length - 1, workspace, locale, next, SAVE_RETRY[locale]));
    }
  }

  if (session.step === "report_summary" && event?.type === "worker_report") {
    const reason = outcome?.status === "rejected" ? outcome.reason : null;
    const text = outcome?.status === "saved" ? SAVED : reason === "callback_required" ? CALLBACK_FIRST : reason === "call_not_active" ? CALL_NOT_ACTIVE : REFUSED;
    return advance(client, row, result.session, 0, twimlGoodbye(locale, text[locale]), outcome?.status === "saved"
      ? () => notifyOwner(client, row.farm_id, (event.reportCallId as string | undefined) ?? null, now)
      : undefined);
  }
  // After a failed save the first attempt may still have landed, so "not saved" needs checking.
  if (session.step === "report_summary" && row.misses > 0) {
    const landed = await recordedOutcome<VoiceOutcome>(client, row.farm_id, `${callSid}:report`);
    if (landed?.status === "saved") return advance(client, row, result.session, 0, twimlGoodbye(locale, SAVED[locale]));
  }
  if (outcome?.status === "rejected") {
    return advance(client, row, { ...session, done: true }, 0, twimlGoodbye(locale, SAVE_FAILED[locale]));
  }
  return advance(client, row, result.session, 0, respond(result.session, session.turns.length, workspace, locale, next, fallback ? UNKNOWN_FALLBACK[locale] : ""));
}

export async function endFarmCall(client: SupabaseClient, callSid: string): Promise<void> {
  await deleteVoiceSession(client, callSid);
}

type ReportToken = Extract<CallToken, { k: "report" }>;

/** The CallSid, once stored on a run, must belong to the run the signed URL names. */
async function boundElsewhere(client: SupabaseClient, token: ReportToken, callSid: string): Promise<boolean> {
  const bound = await findReportCallRun(client, callSid);
  return Boolean(bound && (bound.farmId !== token.f || bound.runId !== token.r));
}

/**
 * The worker picked up NAQAH's report call. The run comes from the signed URL, never from caller
 * ID. It is marked answered first, then the questions run exactly like an inbound call.
 */
export async function answerReportCall(client: SupabaseClient, input: { token: ReportToken; callSid: string; now: Date }): Promise<string> {
  const { token, callSid, now } = input;
  if (await boundElsewhere(client, token, callSid)) return twimlGoodbye(token.l);
  const repeated = await readVoiceSession(client, callSid);
  if (repeated) return repeated.farm_id === token.f ? repeated.last_response : twimlGoodbye(token.l);
  await deleteStaleVoiceSessions(client, new Date(now.getTime() - STALE_AFTER_MS));

  const answered = { version: 1, eventId: `${callSid}:answered`, providerCallId: callSid, type: "report_call_attempt", reportCallId: token.r, attempt: token.n, answered: true };
  await save(client, token.f, { party: "system" }, answered, now);
  const { workspace } = requireFarm(await loadFarm(client, { id: token.f }));
  const locale: Locale = workspace.settings.worker.language === "en" ? "en" : "ar";
  const run = workspace.reportCalls?.find((item) => item.id === token.r);
  if (!run || run.state !== "answered") return twimlGoodbye(locale, CALL_NOT_ACTIVE[locale]);
  if (!workspace.setupComplete || !namesReady(workspace)) {
    await save(client, token.f, { party: "system" }, { version: 1, eventId: `${callSid}:ended`, providerCallId: callSid, type: "report_call_ended", reportCallId: run.id }, now);
    return twimlGoodbye(locale, NOT_READY[locale]);
  }

  const result = start(workspace, now, "report_call", { reportCallId: run.id });
  // The run was answered above, so the engine has nothing left to commit at the start.
  if (result.commit) throw new DbError("invalid_input", "report call start has no voice event");
  const response = respond(result.session, 0, workspace, locale, 0);
  if (result.session.done) return response;
  const row = await createVoiceSession(client, {
    call_sid: callSid,
    farm_id: token.f,
    party: "worker",
    locale,
    session: withoutTranscript(result.session),
    last_response: response,
    created_at: now.toISOString(),
  });
  return row?.last_response ?? response;
}

const FINAL_STATUSES = new Set(["completed", "busy", "failed", "no-answer", "canceled"]);

/**
 * Twilio's final status for a report call. Not answered → retry in 20 minutes or missed.
 * Answered but ended before a save → the run ends unsaved. A saved report is left alone.
 */
export async function reportCallStatus(
  client: SupabaseClient,
  input: { token: ReportToken; callSid: string; status: string; now: Date },
): Promise<void> {
  const { token, callSid, status, now } = input;
  if (!FINAL_STATUSES.has(status)) return;
  if (await boundElsewhere(client, token, callSid)) return;
  const base = { version: 1, eventId: `${callSid}:final:${status}`, providerCallId: callSid, reportCallId: token.r, attempt: token.n };
  const event = status === "completed" ? { ...base, type: "report_call_ended" } : { ...base, type: "report_call_attempt", answered: false };
  await save(client, token.f, { party: "system" }, event, now);
  await deleteVoiceSession(client, callSid);
}

/** The owner's update call ended: answered or missed, as the domain records it. */
export async function ownerCallStatus(
  client: SupabaseClient,
  input: { token: Extract<CallToken, { k: "owner" }>; callSid: string; status: string; now: Date },
): Promise<void> {
  const { token, callSid, status, now } = input;
  if (!FINAL_STATUSES.has(status)) return;
  const event = { version: 1, eventId: `${callSid}:owner`, providerCallId: callSid, type: "owner_notification", reportId: token.r, answered: status === "completed" };
  await save(client, token.f, { party: "system" }, event, now);
}
