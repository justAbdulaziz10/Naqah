/**
 * A real call on a real farm. The scripted engine runs the dialogue against the farm loaded from
 * Supabase, and every outcome is saved through the voice contract before the caller hears it.
 * The engine's own `commit` is never applied: it only signals which event to send, because
 * applyVoiceEvent runs the rules again on fresh state. See docs/integrations/twilio-activation.md.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { addWorkerNote, answer, start, type AnswerInput, type CallSession, type EngineResult } from "@/domain/conversation/engine";
import { instructionBatchId, startLiveOwnerBriefing } from "@/domain/conversation/owner-briefing";
import { startLiveWorkerDelivery } from "@/domain/conversation/worker-outbound";
import { makePersonalizer, personalizeTree } from "@/domain/conversation/personalize";
import type { ReportDraft } from "@/domain/findings";
import { markOwnerCallAnswered } from "@/domain/ownerCalls";
import { ownerSummaryText } from "@/domain/ownerSummary";
import { taskTicketsEnabled } from "@/domain/rules";
import type { Locale, Workspace } from "@/domain/types";
import { DbError } from "@/server/db/errors";
import { loadFarm, requireFarm } from "@/server/db/queries";
import { findCaller, findReportCallRun, recordedOutcome, runFarmAction } from "@/server/db/service-repository";
import { afterResponse } from "@/server/calls/after";
import { recordCallFailure } from "@/server/calls/reliability";
import { signCallToken, type CallToken } from "@/server/calls/token";
import {
  advanceVoiceSession, createVoiceSession, deleteStaleVoiceSessions, deleteVoiceSession, readVoiceSession,
  type VoiceSessionRow,
} from "@/server/db/voice-sessions";
import { realtimeVoiceConfig, voiceLocale } from "@/server/env";
import { applyVoiceEvent, parseVoiceEvent, type VoiceContext, type VoiceOutcome } from "./contract";
import { logVoiceTurn } from "./diagnostics";
import { traceCall } from "./trace";
import { mapSpeechToInput, unknownReply } from "./speech";
import { newRealtimeState, realtimeOf } from "./realtime/state";
import { isOffTopicAnswer } from "@/domain/conversation/answer-topic";
import { evidenceWords } from "./realtime/answer-check";
import { isVerifiedConfirmation } from "./realtime/confirmation";
import { forgetCallWorkspace, rememberCallWorkspace } from "./realtime/call-workspace";
import { buildInstructions } from "./realtime/instructions";
import { buildOwnerInstructions } from "./realtime/owner-instructions";
import { ownerPromptFor } from "./realtime/owner-tools";
import { promptFor } from "./realtime/tools";
import { signRealtimeTicket } from "./realtime/ticket";
import { spokenWording, twimlGather, twimlGoodbye, twimlSayThenRedirect, twimlStream } from "./twiml";

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

type Copy = Record<Locale, string>;
export type VoiceCallSession = CallSession & { voiceSilences?: number; voiceUnmatched?: number; voiceKeypad?: boolean };

const NOT_REGISTERED: Copy = { ar: "هذا الرقم غير مسجل لدى ناقة.", en: "This number is not registered with NAQAH." };
const NOT_READY: Copy = {
  ar: "إعداد هذي العزبة ما اكتمل. فضلاً تواصل مع صاحب العزبة.",
  en: "This farm's setup isn't finished yet. Please contact the farm owner.",
};
export const OWNER_LINE_CLOSED: Copy = {
  ar: "ناقة هي اللي تتصل عليك في موعدك، وآخر التفاصيل موجودة في الموقع.",
  en: "NAQAH calls you at the time you chose. The latest details are on the website.",
};
const SAVED: Copy = { ar: "انحفظ التحديث. يعطيك العافية، مع السلامة.", en: "Your update is saved. Thank you, goodbye." };
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
const INSTRUCTIONS_ALREADY_SAVED: Copy = {
  ar: "هذي التعليمات انحفظت قبل، وما تغير شيء. يعطيك العافية.",
  en: "These instructions were already saved, so nothing changed. Thank you.",
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
const TEXT_MISS: Copy = {
  ar: "هالسؤال يحتاج إجابة بصوتك. ",
  en: "Please say your answer aloud; keypad digits cannot answer this question. ",
};
const NOTED_BACK: Copy = {
  ar: "سجلتها ملاحظة، وخلنا نرجع للسؤال. ",
  en: "I've kept that as a note. Back to the question. ",
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

/** The agent's lines from a turn onwards, with the farm's real names. */
export function spokenLines(session: CallSession, spokenFrom: number, ws: Workspace, locale: Locale): string[] {
  const personalize = makePersonalizer(ws);
  return session.turns.slice(spokenFrom).filter((turn) => turn.speaker === "agent").map((turn) => spokenWording(turn.literal ? turn.text[locale] : personalize(turn.text[locale]), locale, turn.literal));
}

/** Everything the agent says for this step, including lines before the question. */
export function respond(session: CallSession, spokenFrom: number, ws: Workspace, locale: Locale, seq: number, prefix = "", readOptions = (session as VoiceCallSession).voiceKeypad === true): string {
  const personalize = makePersonalizer(ws);
  const lines = spokenLines(session, spokenFrom, ws, locale);
  if (session.done) return twimlGoodbye(locale, `${prefix}${lines.join(" ")}`);
  const earlier = lines.slice(0, -1).join(" ");
  const speakable = { ...session, ...personalizeTree({ turns: session.turns.slice(-1), replies: session.replies }, personalize) };
  return twimlGather(speakable, locale, turnUrl(seq), `${prefix}${earlier ? `${earlier} ` : ""}`, readOptions);
}

/** The contract takes a flag for the heat-day finding, and writes the finding itself. */
function wireDraft({ extraFindings, ...draft }: ReportDraft) {
  return { ...draft, ...(extraFindings?.length ? { heatWaterNeeded: true } : {}) };
}

type WireEvent = Record<string, unknown> & { type: string };

/** Which contract event an engine commit stands for. A commit with no event must not pass silently. */
export function eventFor(before: CallSession | null, result: EngineResult, input: AnswerInput | null, callSid: string): WireEvent | null {
  if (!result.commit) return null;
  const base = { version: 1, providerCallId: callSid };
  const report = (extra: object = {}) => ({ ...base, eventId: `${callSid}:report`, type: "worker_report", draft: wireDraft(result.session.draft), ...extra });
  if (!before) {
    if (result.session.scenario === "worker_inbound") return report({ refusedAtStart: true });
    if (result.session.scenario === "owner_inquiry") return { ...base, eventId: `${callSid}:inquiry`, type: "owner_inquiry" };
  } else if (before.step === "report_summary" || before.step === "report_correct_pick") {
    const reportCallId = before.scenario === "report_call" ? before.data.reportCallId : undefined;
    // The engine refuses to save an empty draft: `next` is only set on a real report.
    if (input?.value === "confirm_save" && result.session.next) return report(reportCallId ? { reportCallId } : {});
    // Only a report call commits here: the worker ended it without saving.
    if (reportCallId) return { ...base, eventId: `${callSid}:ended`, type: "report_call_ended", reportCallId };
  } else if (before.step === "callback_acknowledge") {
    return { ...base, eventId: `${callSid}:callback`, type: "worker_callback" };
  } else if (before.step === "callback_task_confirmation") {
    const taskId = before.data.callbackTaskIds?.[before.data.callbackTaskIndex ?? 0];
    return { ...base, eventId: `${callSid}:task:${taskId}`, type: "task_confirmation", taskId, done: input?.value === "yes", via: "worker_callback" };
  } else if (before.scenario === "owner_notification" && before.step === "instruction_review") {
    const items = (before.data.pendingInstructions ?? []).map(({ message, actionable, scheduledFor }) => ({ message, actionable, scheduledFor }));
    const message = items.map((item) => item.message).join("\n");
    return {
      ...base,
      eventId: instructionBatchId(before, callSid),
      type: "owner_instruction",
      message,
      actionable: items.some((item) => item.actionable),
      scheduledFor: null,
      items,
      deliveryMessage: message,
    };
  } else if (before.scenario === "worker_outbound" && before.data.currentCallId) {
    const pendingCallId = before.data.currentCallId;
    const eventId = `${callSid}:worker:${pendingCallId}`;
    if (before.step === "outbound_answer") {
      return { ...base, eventId, type: "worker_call_attempt", pendingCallId, answered: false };
    }
    if (before.step === "outbound_receipt") return { ...base, eventId, type: "worker_call_attempt", pendingCallId, answered: true, completed: true };
    if (before.step === "outbound_task_confirmation") {
      const taskId = before.data.currentTaskId;
      const done = input?.value === "yes";
      // Each explicit answer is saved as given, so a hang-up can't lose what the worker already said.
      if (!result.session.data.attemptResolved) return { ...base, eventId: `${eventId}:task:${taskId}`, type: "task_confirmation", taskId, done, via: "worker_task_verification" };
      return {
        ...base,
        eventId,
        type: "worker_call_attempt",
        pendingCallId,
        answered: true,
        completed: result.session.data.deliveryCompleted === true,
        answeredTaskIds: (result.session.data.answeredTaskIds ?? []).filter((id) => id !== taskId),
        ...(taskId && (done || input?.value === "no") ? { taskId, taskDone: done } : {}),
      };
    }
  }
  throw new DbError("invalid_input", "call outcome has no voice event");
}

/** One event id per call, so whichever of the conversation or Twilio's status lands first decides. */
const ownerAttemptEvent = (callSid: string, runId: string, attempt: number, result: "unanswered" | "interrupted" | "completed") => ({
  version: 1, eventId: `${callSid}:owner-attempt`, providerCallId: callSid, type: "owner_call_attempt", runId, attempt, result,
});

const contextFor = (party: VoiceSessionRow["party"]): VoiceContext =>
  party === "worker" ? { party: "worker" } : { party: "owner", call: "inquiry" };

function save(client: SupabaseClient, farmId: string, party: VoiceSessionRow["party"] | VoiceContext, event: unknown, now: Date, onAppliedWorkspace?: (workspace: Workspace) => void): Promise<VoiceOutcome> {
  const context = typeof party === "string" ? contextFor(party) : party;
  const parsed = parseVoiceEvent(event);
  return onAppliedWorkspace ? applyVoiceEvent(client, farmId, context, parsed, now, onAppliedWorkspace) : applyVoiceEvent(client, farmId, context, parsed, now);
}

export async function startFarmCall(client: SupabaseClient, input: { from: string; callSid: string; now: Date }): Promise<string> {
  const { from, callSid, now } = input;
  const repeated = await readVoiceSession(client, callSid);
  if (repeated) return repeated.last_response;
  await deleteStaleVoiceSessions(client, new Date(now.getTime() - STALE_AFTER_MS));

  const caller = await findCaller(client, from);
  const fallback = voiceLocale();
  if (caller.kind === "unknown") return twimlGoodbye(fallback, NOT_REGISTERED[fallback]);
  if (caller.kind === "owner") return twimlGoodbye(fallback, OWNER_LINE_CLOSED[fallback]);

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

/** Stores the step from the turn it was read at. Null means another request got there first. */
export async function advanceRow(client: SupabaseClient, row: VoiceSessionRow, session: VoiceCallSession, misses: number, response: string, onAdvanced?: () => Promise<void>, requireRealtimeOpen = false): Promise<VoiceSessionRow | null> {
  const saved = await advanceVoiceSession(client, row.call_sid, row.seq, { session: withoutTranscript(session), misses, last_response: response }, requireRealtimeOpen);
  if (saved) await onAdvanced?.();
  return saved;
}

/** Stores the step and hands back what Twilio should play, or the first reply if a repeat won. */
async function advance(client: SupabaseClient, row: VoiceSessionRow, session: VoiceCallSession, misses: number, response: string, onAdvanced?: () => Promise<void>): Promise<string> {
  const saved = await advanceRow(client, row, session, misses, response, onAdvanced);
  if (saved) return saved.last_response;
  return (await readVoiceSession(client, row.call_sid))?.last_response ?? response;
}

/** The conversation reached its end without a failed save. Twilio's final status is then a replay. */
async function completeOwnerRun(client: SupabaseClient, farmId: string, session: CallSession, callSid: string, now: Date): Promise<void> {
  const { ownerRunId, ownerAttempt } = session.data;
  if (!ownerRunId || !ownerAttempt) return;
  try {
    await save(client, farmId, { party: "system" }, ownerAttemptEvent(callSid, ownerRunId, ownerAttempt, "completed"), now);
  } catch (error) {
    console.error(`[NAQAH] owner call completion failed (${error instanceof DbError ? error.code : "unknown"})`);
  }
}

export type TurnOutcome = "continue" | "saved" | "refused" | "retry_save" | "save_failed";

/** One engine step, worked out and saved through the contract, but not yet stored on the call. */
export interface TurnPlan {
  session: VoiceCallSession;
  misses: number;
  /** The scripted TwiML for this position: what a repeated webhook or a fallback plays. */
  response: string;
  onAdvanced?: () => Promise<void>;
  outcome: TurnOutcome;
  /** The closing line when this step ends the call. */
  goodbye: string | null;
}

/** Scripted and realtime calls share this, so an answer means the same on both. */
export async function planTurn(
  client: SupabaseClient, row: VoiceSessionRow, session: VoiceCallSession, workspace: Workspace, chosen: AnswerInput, now: Date, prefix = "",
): Promise<TurnPlan> {
  const { call_sid: callSid, locale } = row;
  const next = row.seq + 1;
  const closing = (ended: VoiceCallSession, misses: number, text: string, outcome: TurnOutcome, onAdvanced?: () => Promise<void>): TurnPlan =>
    ({ session: ended, misses, response: twimlGoodbye(locale, text), outcome, goodbye: text, onAdvanced });

  const result = answer(session, workspace, now, chosen);
  const event = eventFor(session, result, chosen, callSid);
  const saveParty = session.scenario === "owner_notification"
    ? { party: "owner" as const, call: "notification" as const }
    : session.scenario === "worker_outbound" && event?.type !== "task_confirmation"
      ? { party: "system" as const }
      : row.party;
  let outcome: VoiceOutcome | null = null;
  if (event) {
    try {
      outcome = await save(client, row.farm_id, saveParty, event, now);
    } catch (error) {
      console.error(`[NAQAH] voice save failed (${error instanceof DbError ? error.code : "unknown"})`);
      const retry = row.misses === 0 && !(error instanceof DbError && error.code === "invalid_input");
      if (!retry) return closing({ ...session, done: true }, row.misses, SAVE_FAILED[locale], "save_failed");
      return { session, misses: 1, response: respond(session, session.turns.length - 1, workspace, locale, next, SAVE_RETRY[locale]), outcome: "retry_save", goodbye: null };
    }
  }

  if (session.step === "report_summary" && event?.type === "worker_report") {
    const reason = outcome?.status === "rejected" ? outcome.reason : null;
    const text = outcome?.status === "saved" ? SAVED : reason === "callback_required" ? CALLBACK_FIRST : reason === "call_not_active" ? CALL_NOT_ACTIVE : REFUSED;
    return closing(result.session, 0, text[locale], outcome?.status === "saved" ? "saved" : "refused");
  }
  // After a failed save the first attempt may still have landed, so "not saved" needs checking.
  if (session.step === "report_summary" && row.misses > 0) {
    const landed = await recordedOutcome<VoiceOutcome>(client, row.farm_id, `${callSid}:report`);
    if (landed?.status === "saved") return closing(result.session, 0, SAVED[locale], "saved");
  }
  if (outcome?.status === "rejected") return closing({ ...session, done: true }, 0, SAVE_FAILED[locale], "save_failed");
  if (event?.type === "owner_instruction") {
    await completeOwnerRun(client, row.farm_id, session, callSid, now);
    // Only what the contract wrote is claimed: a replay of this run's batch saved nothing new.
    const text = outcome?.status === "unchanged" ? INSTRUCTIONS_ALREADY_SAVED[locale] : `${prefix}${spokenLines(result.session, session.turns.length, workspace, locale).join(" ")}`;
    return closing(result.session, 0, text, "saved");
  }
  if (result.session.done) await completeOwnerRun(client, row.farm_id, session, callSid, now);
  const goodbye = result.session.done ? `${prefix}${spokenLines(result.session, session.turns.length, workspace, locale).join(" ")}` : null;
  return { session: result.session, misses: 0, response: respond(result.session, session.turns.length, workspace, locale, next, prefix), outcome: "continue", goodbye };
}

type FarmCallInput = { callSid: string; seq: number; speech: string; digits: string | null; confidence?: string | null; now: Date };

export async function answerFarmCall(client: SupabaseClient, input: FarmCallInput): Promise<string> {
  const context: { session?: CallSession; status?: string } = {};
  const response = await answerFarmCallTurn(client, input, context);
  if (context.session) traceCall(input.callSid, { session: context.session, tool: "scripted_answer", args: { digits: input.digits }, workerUtterance: input.speech, resultStatus: context.status ?? "ignored", spokenText: [...response.matchAll(/<Say\b[^>]*>([\s\S]*?)<\/Say>/g)].map((match) => match[1].replaceAll("&apos;", "'").replaceAll("&quot;", '"').replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&amp;", "&")).join(" ") });
  return response;
}

async function answerFarmCallTurn(client: SupabaseClient, input: FarmCallInput, context: { session?: CallSession; status?: string }): Promise<string> {
  const { callSid, seq, speech, digits, now } = input;
  const row = await readVoiceSession(client, callSid);
  if (!row) {
    logVoiceTurn(input, "missing_session");
    return twimlGoodbye(voiceLocale());
  }
  context.session = row.session;
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
  const offTopic = !digits && isOffTopicAnswer(row.session, evidenceWords(speech));
  // Words about another topic can't answer this question, but they aren't thrown away either.
  const session: VoiceCallSession = { ...(offTopic ? addWorkerNote(row.session, speech) : row.session), voiceSilences: 0, ...(digits ? { voiceKeypad: true } : {}) };
  const { workspace } = requireFarm(await loadFarm(client, { id: row.farm_id }));
  const mapped = mapSpeechToInput(session, speech, digits, locale, input.confidence);
  const spoken = (mapped?.value === "confirm_save" || mapped?.value === "instructions_confirm") && !digits && !isVerifiedConfirmation(speech, session, locale) ? null : mapped;
  const unmatched = !spoken && hasInput ? ((row.session as VoiceCallSession).voiceUnmatched ?? 0) + 1 : 0;
  logVoiceTurn(input, spoken);
  const next = row.seq + 1;
  const fallback = !spoken && hasInput && row.misses >= 1 ? unknownReply(session.replies) : undefined;
  context.status = spoken ? "answered" : fallback ? "unknown" : "not_understood";
  if (!spoken && !fallback) {
    if (silenceCount >= 3 || unmatched >= 6) return advance(client, row, { ...session, done: true }, row.misses, twimlGoodbye(locale, MISSED_TWICE[locale]));
    const prefix = hasInput ? (offTopic ? NOTED_BACK : session.inputMode === "text" ? TEXT_MISS : SPOKEN_MISS)[locale] : (silenceCount === 1 ? MISS_ONCE : MISS_AGAIN)[locale];
    return advance(client, row, { ...session, voiceSilences: silenceCount, voiceUnmatched: unmatched }, Math.min(row.misses + 1, 2), respond(session, session.turns.length - 1, workspace, locale, next, prefix, true));
  }

  const chosen = spoken ?? { value: fallback!.value };
  const plan = await planTurn(client, row, { ...session, voiceUnmatched: 0 }, workspace, chosen, now, fallback ? UNKNOWN_FALLBACK[locale] : "");
  return advance(client, row, plan.session, plan.misses, plan.response, plan.onAdvanced);
}

export async function endFarmCall(client: SupabaseClient, callSid: string): Promise<void> {
  await deleteVoiceSession(client, callSid);
}

type ReportToken = Extract<CallToken, { k: "report" }>;

/** The CallSid, once stored on a run, must belong to the run the signed URL names. */
export async function boundElsewhere(client: SupabaseClient, token: ReportToken, callSid: string): Promise<boolean> {
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
  const realtime = realtimeVoiceConfig();
  const cleanup = () => deleteStaleVoiceSessions(client, new Date(now.getTime() - STALE_AFTER_MS));
  if (realtime) {
    await afterResponse(async () => {
      try { await cleanup(); } catch { console.error("[NAQAH] stale voice session cleanup failed"); }
    });
  } else {
    await cleanup();
  }

  const answered = { version: 1, eventId: `${callSid}:answered`, providerCallId: callSid, type: "report_call_attempt", reportCallId: token.r, attempt: token.n, answered: true };
  let appliedWorkspace: Workspace | undefined;
  await save(client, token.f, { party: "system" }, answered, now, realtime ? (workspace) => { appliedWorkspace = workspace; } : undefined);
  const workspace = appliedWorkspace ?? requireFarm(await loadFarm(client, { id: token.f })).workspace;
  const locale: Locale = workspace.settings.worker.language === "en" ? "en" : "ar";
  const run = workspace.reportCalls?.find((item) => item.id === token.r);
  if (!run || run.state !== "answered") return twimlGoodbye(locale, CALL_NOT_ACTIVE[locale]);
  if (!workspace.setupComplete || !namesReady(workspace)) {
    await save(client, token.f, { party: "system" }, { version: 1, eventId: `${callSid}:ended`, providerCallId: callSid, type: "report_call_ended", reportCallId: run.id }, now);
    return twimlGoodbye(locale, NOT_READY[locale]);
  }

  const result = start(workspace, now, "report_call", { reportCallId: run.id, modesAvailable: Boolean(realtime) });
  // The run was answered above, so the engine has nothing left to commit at the start.
  if (result.commit) throw new DbError("invalid_input", "report call start has no voice event");
  const response = respond(result.session, 0, workspace, locale, 0);
  if (result.session.done) return response;
  const state = realtime ? newRealtimeState(spokenLines(result.session, 0, workspace, locale).join(" ")) : null;
  if (state) {
    const firstStep = promptFor(result.session, spokenLines(result.session, result.session.turns.length - 1, workspace, locale), workspace, locale);
    state.instructions = buildInstructions(locale, { worker: workspace.settings.worker.name, owner: workspace.settings.owner.name }, firstStep);
    rememberCallWorkspace(callSid, workspace, now);
  }
  const stored = withoutTranscript(result.session);
  const row = await createVoiceSession(client, {
    call_sid: callSid,
    farm_id: token.f,
    party: "worker",
    locale,
    session: state ? ({ ...stored, realtime: state } as CallSession) : stored,
    last_response: response,
    created_at: now.toISOString(),
  });
  // Only the request whose row got in may open the stream: a repeat plays the scripted question.
  if (realtime && state && row && realtimeOf(row.session)?.jti === state.jti) {
    const ticket = signRealtimeTicket({ sid: callSid, f: token.f, r: run.id, l: locale, j: state.jti, t: now.getTime() }, realtime.secret);
    return twimlStream(`${realtime.baseUrl}/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token, realtime.secret))}`, realtime.bridgeUrl, ticket);
  }
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
  try {
    await recordCallFailure(client, token.f, token.r, status === "completed" ? "not_saved" : status === "busy" ? "busy" : status === "no-answer" ? "no_answer" : "provider_rejected", now);
  } catch { console.error("[NAQAH] call diagnostic storage failed"); }
  await deleteVoiceSession(client, callSid);
  forgetCallWorkspace(callSid);
}

async function openLiveCall(
  client: SupabaseClient,
  input: { farmId: string; callSid: string; locale: Locale; now: Date; party: "owner" | "worker"; result: EngineResult },
): Promise<string> {
  const { workspace } = requireFarm(await loadFarm(client, { id: input.farmId }));
  const response = respond(input.result.session, 0, workspace, input.locale, 0);
  if (input.result.session.done) return response;
  const row = await createVoiceSession(client, {
    call_sid: input.callSid,
    farm_id: input.farmId,
    party: input.party,
    locale: input.locale,
    session: withoutTranscript(input.result.session),
    last_response: response,
    created_at: input.now.toISOString(),
  });
  return row?.last_response ?? response;
}

const OWNER_CLOSING: Copy = { ar: "هذا اللي عندي. يعطيك العافية.", en: "That's all I have. Thank you." };

/**
 * The owner picked up the scheduled call. The run comes from the signed URL, never caller ID.
 * Picking up is not completion: Basic must hear the summary to the end, Ultimate must finish the
 * instructions step.
 */
export async function answerOwnerCall(
  client: SupabaseClient,
  input: { token: Extract<CallToken, { k: "owner" }>; callSid: string; now: Date },
): Promise<string> {
  const { token, callSid, now } = input;
  const repeated = await readVoiceSession(client, callSid);
  if (repeated) return repeated.farm_id === token.f ? repeated.last_response : twimlGoodbye(token.l);
  const { result: workspace } = await runFarmAction(client, token.f, (ws) => {
    const marked = markOwnerCallAnswered(ws, now, token.o);
    return { ws: marked, result: marked };
  });
  const run = workspace.ownerCallRun;
  if (run?.id !== token.o || run.state !== "answered" || run.attempts.length !== token.n) return twimlGoodbye(token.l);
  const report = token.r ? workspace.reports.find((item) => item.id === token.r) ?? null : null;
  if (token.r && !report) return twimlGoodbye(token.l);

  const summary = ownerSummaryText(workspace, report, now);
  if (workspace.settings.plan === "basic") {
    const text = `${spokenWording(summary[token.l], token.l)} ${OWNER_CLOSING[token.l]}`;
    return twimlSayThenRedirect(text, token.l, `/api/voice/owner/heard?s=${encodeURIComponent(signCallToken(token))}`);
  }
  const result = startLiveOwnerBriefing(workspace, now, report?.id ?? null, { runId: run.id, attempt: token.n }, summary);
  const realtime = realtimeVoiceConfig();
  if (!realtime || result.session.done) return openLiveCall(client, { farmId: token.f, callSid, locale: token.l, now, party: "owner", result });

  const locale = token.l;
  const response = respond(result.session, 0, workspace, locale, 0);
  const state = newRealtimeState(spokenLines(result.session, 0, workspace, locale).join(" "));
  const firstStep = ownerPromptFor(result.session, spokenLines(result.session, result.session.turns.length - 1, workspace, locale), workspace, locale);
  state.instructions = buildOwnerInstructions(locale, { worker: workspace.settings.worker.name, owner: workspace.settings.owner.name }, now, firstStep);
  rememberCallWorkspace(callSid, workspace, now);
  const stored = await createVoiceSession(client, {
    call_sid: callSid,
    farm_id: token.f,
    party: "owner",
    locale,
    session: { ...withoutTranscript(result.session), realtime: state } as CallSession,
    last_response: response,
    created_at: now.toISOString(),
  });
  // Only the request whose row got in may open the stream: a repeat plays the scripted question.
  if (stored && realtimeOf(stored.session)?.jti === state.jti) {
    const ticket = signRealtimeTicket({ sid: callSid, f: token.f, r: token.o, l: locale, j: state.jti, t: now.getTime(), p: "owner" }, realtime.secret);
    return twimlStream(`${realtime.baseUrl}/api/voice/realtime/after?s=${encodeURIComponent(signCallToken(token, realtime.secret))}`, realtime.bridgeUrl, ticket);
  }
  return stored?.last_response ?? response;
}

/** Twilio reached the end of the Basic summary: the only proof the owner heard all of it. */
export async function ownerCallHeard(
  client: SupabaseClient,
  input: { token: Extract<CallToken, { k: "owner" }>; callSid: string; now: Date },
): Promise<string> {
  const { token, callSid, now } = input;
  await save(client, token.f, { party: "system" }, ownerAttemptEvent(callSid, token.o, token.n, "completed"), now);
  return "<Response><Hangup/></Response>";
}

/** The worker answered an instruction or verification call reserved by the scheduler. */
export async function answerWorkerCall(
  client: SupabaseClient,
  input: { token: Extract<CallToken, { k: "worker" }>; callSid: string; now: Date },
): Promise<string> {
  const { token, callSid, now } = input;
  const repeated = await readVoiceSession(client, callSid);
  if (repeated) return repeated.farm_id === token.f ? repeated.last_response : twimlGoodbye(token.l);
  const { workspace } = requireFarm(await loadFarm(client, { id: token.f }));
  const call = workspace.pendingWorkerCalls.find((item) => item.id === token.p && item.state === "pending");
  if (!call || call.attempts.length + 1 !== token.n || !taskTicketsEnabled(workspace)) return twimlGoodbye(token.l);
  return openLiveCall(client, {
    farmId: token.f,
    callSid,
    locale: token.l,
    now,
    party: "worker",
    result: startLiveWorkerDelivery(workspace, now, call.id),
  });
}

/**
 * Final status of an instruction or verification call.
 * Picking up is not delivery. The conversation records delivery with this same event id;
 * a status that arrives afterwards is a replay and cannot mark the call delivered.
 */
export async function workerCallStatus(
  client: SupabaseClient,
  input: { token: Extract<CallToken, { k: "worker" }>; callSid: string; status: string; now: Date },
): Promise<void> {
  const { token, callSid, status, now } = input;
  if (!FINAL_STATUSES.has(status)) return;
  const event = {
    version: 1,
    eventId: `${callSid}:worker:${token.p}`,
    providerCallId: callSid,
    type: "worker_call_attempt",
    pendingCallId: token.p,
    answered: status === "completed",
    completed: false,
    attempt: token.n,
  };
  await save(client, token.f, { party: "system" }, event, now);
  await deleteVoiceSession(client, callSid);
}

/**
 * Twilio's final status for the owner's call. The phone never connected → unanswered. It connected
 * but no completion was recorded → interrupted. A recorded completion wins: same event id, so this is a replay.
 */
export async function ownerCallStatus(
  client: SupabaseClient,
  input: { token: Extract<CallToken, { k: "owner" }>; callSid: string; status: string; now: Date },
): Promise<void> {
  const { token, callSid, status, now } = input;
  if (!FINAL_STATUSES.has(status)) return;
  const result = status === "completed" ? "interrupted" : "unanswered";
  await save(client, token.f, { party: "system" }, ownerAttemptEvent(callSid, token.o, token.n, result), now);
  await deleteVoiceSession(client, callSid);
}
