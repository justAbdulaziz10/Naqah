/**
 * The real report agent with its writes taken away. Tool checks, instructions, the engine and the
 * report contract are the calling code's own. Nothing here receives a database client: the
 * workspace a confirmed report produces is computed for the verdict and then dropped.
 */
import { answer, start, type AnswerInput, type CallSession } from "@/domain/conversation/engine";
import { makePersonalizer } from "@/domain/conversation/personalize";
import { HEALTH_LABELS, levelLabel, RESOURCE_LABELS } from "@/domain/catalog";
import { evaluateFindings, type ReportDraft } from "@/domain/findings";
import type { Certainty, Locale, Workspace } from "@/domain/types";
import { eventAllowed, parseVoiceEvent, voiceStep, type VoiceEvent } from "@/server/voice/contract";
import { buildInstructions } from "@/server/voice/realtime/instructions";
import { checkTool, promptFor, SUMMARY_STEP } from "@/server/voice/realtime/tools";
import { spokenWording } from "@/server/voice/twiml";
import { isVerifiedConfirmation } from "@/server/voice/realtime/confirmation";
import { reviewAnswer, type LabSession } from "./answer-guards";

export const LAB_RUN_ID = "00000000-0000-4000-8000-00000000f001";
const LAB_CALL_ID = "voice-lab";

const SAVED: Record<Locale, string> = { ar: "تم حفظ التحديث، شكراً لك. مع السلامة.", en: "Your update is saved. Thank you. Goodbye." };
const ENDED: Record<Locale, string> = { ar: "ما انحفظ التحديث. يعطيك العافية. مع السلامة.", en: "The update wasn't saved. Thank you. Goodbye." };
const FAILED: Record<Locale, string> = { ar: "صار خلل وما قدرت أتأكد من حفظ شيء.", en: "Something went wrong and I couldn't confirm that anything was saved." };

export type LabVerdict =
  | { kind: "would_save" }
  | { kind: "would_reject"; reason: string }
  | { kind: "declined" }
  | { kind: "ended" }
  /** Two failed confirmations: a real call stops the AI and continues on the keypad script. */
  | { kind: "fallback" };

export interface LabFact {
  id: string;
  /** "said": the worker's answer. "report": the structured field the report would carry. */
  group: "said" | "report";
  label: string;
  value: string;
  certainty: Certainty | null;
}

export interface LabView {
  step: string;
  done: boolean;
  isSummary: boolean;
  /** The report's questions in order, and how many are behind us. */
  queue: string[];
  answered: number;
  question: string;
  summary: string | null;
  facts: LabFact[];
  findings: string[];
  contract: { valid: true } | { valid: false; field: string };
  verdict: LabVerdict | null;
}

export interface LabToolResult {
  /** The JSON the model receives, in the shape a real call returns. */
  output: string;
  awaitingConfirmation: boolean;
  end: null | "hangup" | "fallback";
  goodbye: string | null;
  /** The summary to speak word for word: only this counts as the worker having heard it. */
  summaryText?: string;
  session: CallSession;
  /** Null when the tool call was accepted; otherwise why the checks refused it. */
  refused: string | null;
  view: LabView;
}

/** A copy that always holds an answered run and no report yet, so any farm can be tried at any hour. */
export function labWorkspace(base: Workspace, now: Date): Workspace {
  const at = now.toISOString();
  return {
    ...base,
    reports: [],
    reportCalls: [{ id: LAB_RUN_ID, occurrence: at, trigger: "manual", attempts: [{ at, result: "answered" }], nextAttemptAt: null, state: "answered", reportId: null }],
  };
}

const lines = (session: CallSession, from: number, ws: Workspace, locale: Locale) => {
  const personalize = makePersonalizer(ws);
  return session.turns.slice(from).filter((turn) => turn.speaker === "agent").map((turn) => personalize(turn.text[locale]));
};

const stringify = (value: object) => JSON.stringify(value);

function reportEvent(draft: ReportDraft): unknown {
  const { extraFindings, ...rest } = draft;
  return {
    version: 1,
    eventId: `${LAB_CALL_ID}:report`,
    providerCallId: LAB_CALL_ID,
    type: "worker_report",
    reportCallId: LAB_RUN_ID,
    draft: { ...rest, ...(extraFindings?.length ? { heatWaterNeeded: true } : {}) },
  };
}

function checkContract(draft: ReportDraft): { event: VoiceEvent } | { field: string } {
  try {
    return { event: parseVoiceEvent(reportEvent(draft)) };
  } catch (error) {
    return { field: error instanceof Error ? error.message : "unknown" };
  }
}

function factsOf(session: CallSession, ws: Workspace, locale: Locale): LabFact[] {
  const personalize = makePersonalizer(ws);
  const { draft } = session;
  const facts: LabFact[] = draft.answers.map((item) => ({
    id: item.questionId,
    group: "said",
    label: personalize(item.question[locale]),
    value: item.answerText ? personalize(item.answerText[locale]) : item.answer,
    certainty: item.certainty,
  }));
  // "All healthy" writes one update per camel, so matching updates share a row.
  const camels = new Map<string, { names: string[]; value: string; certainty: Certainty }>();
  for (const update of draft.camelUpdates) {
    const name = ws.camels.find((camel) => camel.id === update.camelId)?.name ?? update.camelId;
    const value = [HEALTH_LABELS[update.health][locale], update.note].filter(Boolean).join(" · ");
    const key = `${value}|${update.certainty}`;
    camels.set(key, { names: [...(camels.get(key)?.names ?? []), name], value, certainty: update.certainty });
  }
  for (const [key, group] of camels) facts.push({ id: `camel:${key}`, group: "report", label: group.names.join(locale === "ar" ? "، " : ", "), value: group.value, certainty: group.certainty });
  for (const update of draft.resourceUpdates) {
    facts.push({
      id: `resource:${update.kind}`,
      group: "report",
      label: RESOURCE_LABELS[update.kind][locale],
      value: [levelLabel(update.kind, update.level)[locale], update.quantity, update.note].filter(Boolean).join(" · "),
      certainty: update.certainty,
    });
  }
  if (typeof draft.herdCount === "number") facts.push({ id: "herd:count", group: "report", label: locale === "ar" ? "عدد الحلال (مقترح)" : "Herd count (proposed)", value: String(draft.herdCount), certainty: "reported" });
  return facts;
}

export function viewOf(session: CallSession, ws: Workspace, locale: Locale, verdict: LabVerdict | null): LabView {
  const prompt = promptFor(session, lines(session, session.turns.length - 1, ws, locale), ws, locale);
  const personalize = makePersonalizer(ws);
  const queue = (session.data.queue ?? []).map((item) => personalize(item.question[locale]));
  const isSummary = session.step === SUMMARY_STEP;
  const contract = checkContract(session.draft);
  return {
    step: session.step,
    done: session.done,
    isSummary,
    queue,
    answered: isSummary || session.done ? queue.length : Math.min(session.data.reportIndex ?? 0, queue.length),
    question: prompt.question,
    summary: isSummary ? prompt.question : null,
    facts: factsOf(session, ws, locale),
    findings: evaluateFindings(ws, session.draft).map((finding) => personalize(finding.text[locale])),
    contract: "event" in contract ? { valid: true } : { valid: false, field: contract.field },
    verdict,
  };
}

export function openLabAgent(ws: Workspace, now: Date, locale: Locale) {
  const { session } = start(ws, now, "report_call", { reportCallId: LAB_RUN_ID });
  const opening = spokenWording(lines(session, 0, ws, locale).join(" "), locale);
  const current = promptFor(session, lines(session, session.turns.length - 1, ws, locale), ws, locale);
  const instructions = buildInstructions(locale, { worker: ws.settings.worker.name, owner: ws.settings.owner.name }, current);
  return { session, opening, instructions, view: viewOf(session, ws, locale, null) };
}

/**
 * `heard` is what the worker last said, when the Lab has it as final text. `workerUtterance` and
 * `heardSummary` are the turn's evidence for a confirmation, as the bridge reports them on a call.
 */
export function runLabTool(input: { session: LabSession; ws: Workspace; locale: Locale; name: unknown; args: unknown; spoke: boolean; heard?: string | null; workerUtterance?: string | null; heardSummary?: boolean; now: Date }): LabToolResult {
  const { ws, locale, name, args, spoke, heard = null, workerUtterance = null, heardSummary, now } = input;
  const { session } = input;
  const reply = (fields: Pick<LabToolResult, "output" | "end" | "goodbye" | "session" | "refused" | "summaryText">, verdict: LabVerdict | null = null): LabToolResult => ({
    ...fields,
    awaitingConfirmation: !fields.session.done && fields.session.step === SUMMARY_STEP,
    view: viewOf(fields.session, ws, locale, verdict),
  });
  const closing = (ended: CallSession, status: string, goodbye: string, verdict: LabVerdict) =>
    reply({ output: stringify({ status, message: "The call is ending. Do not ask any more questions." }), end: "hangup", goodbye, session: ended, refused: null }, verdict);

  if (session.done) return reply({ output: stringify({ status: "call_ended" }), end: "hangup", goodbye: ENDED[locale], session, refused: "call_ended" });

  const confirming = name === "confirm_report" && typeof args === "object" && args !== null && "confirmed" in args && args.confirmed === true;
  const verified = confirming ? spoke && isVerifiedConfirmation(workerUtterance ?? "", session, locale) : spoke;
  const check = checkTool(name, args, verified, session, locale);
  if (confirming && session.step === SUMMARY_STEP && (!verified || heardSummary !== true)) {
    const error = heardSummary !== true ? "summary_not_finished" : "worker_has_not_confirmed";
    const failures = (session.confirmationFailures ?? 0) + 1;
    const fallback = failures >= 2;
    const counted: LabSession = { ...session, confirmationFailures: failures, done: fallback };
    const prompt = promptFor(session, lines(session, session.turns.length - 1, ws, locale), ws, locale);
    const output = {
      status: "invalid",
      error,
      ...prompt,
      message: error === "summary_not_finished"
        ? "The worker did not hear the complete summary. It is being read again now. Wait for their answer. Nothing was saved."
        : "The worker has not clearly confirmed. Ask the worker to confirm clearly or use the keypad fallback. Nothing was saved.",
    };
    return reply({ output: stringify(output), end: fallback ? "fallback" : null, goodbye: null, session: counted, refused: error, ...(error === "summary_not_finished" && prompt.summary ? { summaryText: prompt.summary } : {}) }, fallback ? { kind: "fallback" } : null);
  }
  if (!check.ok) {
    return reply({ output: stringify({ status: "invalid", error: check.error, replies: session.replies.map((item) => item.value) }), end: null, goodbye: null, session, refused: check.error });
  }

  const atSummary = session.step === SUMMARY_STEP;
  if (check.action.kind === "answer") {
    const review = reviewAnswer({ session, input: check.action.input, heard, locale });
    if (review) {
      const output = { status: "invalid", error: review.error, message: "Nothing was recorded. Ask the worker this, in your own words, then wait for their answer.", clarify: review.clarify };
      return reply({ output: stringify(output), end: null, goodbye: null, session: review.session, refused: review.error });
    }
  }

  const chosen: AnswerInput | null =
    check.action.kind === "answer" ? check.action.input
    : check.action.kind === "confirm" ? { value: check.action.confirmed ? "confirm_save" : "end_without_save" }
    : atSummary ? { value: "end_without_save" } : null;
  if (!chosen) return closing({ ...session, done: true }, "ended_without_saving", ENDED[locale], { kind: "ended" });

  // `commit` is deliberately ignored, as on a real call: it only signals which event applies.
  const next = answer(session, ws, now, chosen).session;

  if (atSummary && chosen.value === "confirm_save") {
    const contract = checkContract(session.draft);
    if (!("event" in contract)) return closing({ ...next, done: true }, "save_failed", FAILED[locale], { kind: "would_reject", reason: contract.field });
    if (!eventAllowed({ party: "worker" }, contract.event)) return closing({ ...next, done: true }, "not_saved", ENDED[locale], { kind: "would_reject", reason: "not_allowed" });
    const { result } = voiceStep(ws, now, contract.event);
    if (result.status === "rejected") return closing({ ...next, done: true }, "not_saved", ENDED[locale], { kind: "would_reject", reason: result.reason });
    return closing(next, "saved", SAVED[locale], { kind: "would_save" });
  }
  if (next.done) return closing(next, "ended_without_saving", lines(next, session.turns.length, ws, locale).join(" ") || ENDED[locale], { kind: atSummary ? "declined" : "ended" });

  const spoken = lines(next, session.turns.length, ws, locale);
  const prompt = promptFor(next, spoken, ws, locale);
  return reply({ output: stringify({ status: "ok", ...prompt }), end: null, goodbye: null, session: next, refused: null, ...(prompt.summary ? { summaryText: prompt.summary } : {}) });
}
