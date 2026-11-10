/**
 * The real report agent with its writes taken away. Tool decisions, instructions, the engine and the
 * report contract are the calling code's own. Nothing here receives a database client: the
 * workspace a confirmed report produces is computed for the verdict and then dropped.
 */
import { answer, start, type CallSession } from "@/domain/conversation/engine";
import { makePersonalizer } from "@/domain/conversation/personalize";
import { HEALTH_LABELS, levelLabel, RESOURCE_LABELS } from "@/domain/catalog";
import { evaluateFindings, type ReportDraft } from "@/domain/findings";
import type { Certainty, Locale, Workspace } from "@/domain/types";
import { eventAllowed, parseVoiceEvent, voiceStep, type VoiceEvent } from "@/server/voice/contract";
import { decideTool, promptResult, spokenFrom, type ToolCounters } from "@/server/voice/realtime/decide";
import { buildInstructions } from "@/server/voice/realtime/instructions";
import type { ToolResponse } from "@/server/voice/realtime/state";
import { promptFor, SUMMARY_STEP } from "@/server/voice/realtime/tools";

export const LAB_RUN_ID = "00000000-0000-4000-8000-00000000f001";
const LAB_CALL_ID = "voice-lab";

const SAVED: Record<Locale, string> = { ar: "انحفظ التحديث. يعطيك العافية، مع السلامة.", en: "Your update is saved. Thank you, goodbye." };
const ENDED: Record<Locale, string> = { ar: "ما انحفظ التحديث. يعطيك العافية. مع السلامة.", en: "The update wasn't saved. Thank you. Goodbye." };
const FAILED: Record<Locale, string> = { ar: "صار خلل وما قدرت أتأكد من حفظ شيء.", en: "Something went wrong and I couldn't confirm that anything was saved." };

/** The session, plus the counts a real call keeps on its row. */
export type LabSession = CallSession & { counters?: ToolCounters };

export type LabVerdict =
  | { kind: "would_save" }
  | { kind: "would_reject"; reason: string }
  | { kind: "declined" }
  | { kind: "ended" }
  /** Three failed confirmations: a real call stops the AI and continues on the keypad script. */
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
  /** Null until the worker has chosen. */
  mode: "guided" | "open" | null;
  /** The report's questions in order, and how many are behind us. */
  queue: string[];
  answered: number;
  question: string;
  summary: string | null;
  facts: LabFact[];
  /** Topics saved as not reported. Known once the summary is ready. */
  notReported: string[];
  findings: string[];
  contract: { valid: true } | { valid: false; field: string };
  verdict: LabVerdict | null;
}

/** A real call's tool result, plus what the Lab shows about it. */
export type LabToolResult = ToolResponse & {
  session: LabSession;
  /** Null when the tool call was accepted; otherwise why nothing moved. */
  refused: string | null;
  view: LabView;
};

/** A copy that always holds an answered run and no report yet, so any farm can be tried at any hour. */
export function labWorkspace(base: Workspace, now: Date): Workspace {
  const at = now.toISOString();
  return {
    ...base,
    reports: [],
    reportCalls: [{ id: LAB_RUN_ID, occurrence: at, trigger: "manual", attempts: [{ at, result: "answered" }], nextAttemptAt: null, state: "answered", reportId: null }],
  };
}

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

/** Coverage is the engine's to work out and it only does so on saving, so a read-back asks it what saving would store. */
function notReportedTopics(session: CallSession, ws: Workspace, locale: Locale, now: Date): string[] {
  const coverage = session.draft.coverage ?? (session.step === SUMMARY_STEP && !session.done ? answer(session, ws, now, { value: "confirm_save" }).session.draft.coverage : undefined);
  const personalize = makePersonalizer(ws);
  return (coverage ?? []).filter((entry) => entry.status === "not_reported").flatMap((entry) => {
    const item = session.data.queue?.find((candidate) => candidate.id === entry.questionId);
    return item ? [personalize(item.question[locale])] : [];
  });
}

export function viewOf(session: CallSession, ws: Workspace, locale: Locale, verdict: LabVerdict | null, now: Date): LabView {
  const prompt = promptFor(session, spokenFrom(session, Math.max(0, session.turns.length - 1), ws, locale), ws, locale);
  const personalize = makePersonalizer(ws);
  const queue = (session.data.queue ?? []).map((item) => personalize(item.question[locale]));
  const isSummary = session.step === SUMMARY_STEP;
  const contract = checkContract(session.draft);
  return {
    step: session.step,
    done: session.done,
    isSummary,
    mode: session.data.reportMode ?? null,
    queue,
    answered: isSummary || session.done ? queue.length : Math.min(session.data.reportIndex ?? 0, queue.length),
    question: prompt.question,
    summary: isSummary ? prompt.question : null,
    facts: factsOf(session, ws, locale),
    notReported: notReportedTopics(session, ws, locale, now),
    findings: evaluateFindings(ws, session.draft).map((finding) => personalize(finding.text[locale])),
    contract: "event" in contract ? { valid: true } : { valid: false, field: contract.field },
    verdict,
  };
}

/** As on a real call: the owner's settings pick guided, open or the worker's choice. */
export function openLabAgent(ws: Workspace, now: Date, locale: Locale) {
  const { session } = start(ws, now, "report_call", { reportCallId: LAB_RUN_ID, modesAvailable: true });
  const opening = spokenFrom(session, 0, ws, locale).join(" ");
  const firstStep = promptFor(session, spokenFrom(session, Math.max(0, session.turns.length - 1), ws, locale), ws, locale);
  const instructions = buildInstructions(locale, { worker: ws.settings.worker.name, owner: ws.settings.owner.name }, firstStep);
  return { session, opening, repromptText: firstStep.question, instructions, view: viewOf(session, ws, locale, null, now) };
}

/** A real call stores only the agent's latest line, which also keeps the signed token small enough for a request. */
const latestLineOnly = (session: LabSession): LabSession => ({ ...session, turns: session.turns.filter((turn) => turn.speaker === "agent").slice(-1) });

/**
 * One tool call, decided exactly as on a real call. `workerUtterance` is the final transcript of the
 * worker's turn and `heardSummaryId` the summary they heard to the end, as the bridge reports them.
 */
export function runLabTool(input: { session: LabSession; ws: Workspace; locale: Locale; name: unknown; args: unknown; spoke: boolean; workerUtterance?: string | null; heardSummaryId?: string; now: Date }): LabToolResult {
  const { session, ws, locale, name, args, spoke, workerUtterance = null, heardSummaryId, now } = input;
  const reply = (result: ToolResponse, next: LabSession, refused: string | null, verdict: LabVerdict | null = null): LabToolResult => ({
    ...result,
    session: latestLineOnly(next),
    refused,
    view: viewOf(next, ws, locale, verdict, now),
  });
  const closing = (ended: LabSession, status: string, goodbye: string, verdict: LabVerdict) =>
    reply({ output: stringify({ status, message: "The call is ending. Do not ask any more questions." }), awaitingConfirmation: false, end: "hangup", goodbye }, ended, null, verdict);

  if (session.done) return reply({ output: stringify({ status: "call_ended" }), awaitingConfirmation: false, end: "hangup", goodbye: ENDED[locale] }, session, "call_ended");

  const decision = decideTool({ session, counters: session.counters ?? {}, workspace: ws, locale, name, args, spoke, heard: workerUtterance ?? "", heardSummaryId, now });
  const counted = (next: CallSession): LabSession => ({ ...next, counters: { ...session.counters, ...decision.counters } });
  const inReview = session.step === SUMMARY_STEP || session.step === "report_correct_pick";

  if (decision.kind === "reply") {
    const fallback = decision.result.end === "fallback";
    return reply(decision.result, counted(fallback ? { ...session, done: true } : session), decision.refused, fallback ? { kind: "fallback" } : null);
  }
  if (decision.kind === "stay") return reply(decision.result, counted(decision.session), decision.refused ?? null);
  if (decision.kind === "end") return closing(counted({ ...decision.session, done: true }), "ended_without_saving", ENDED[locale], { kind: inReview ? "declined" : "ended" });

  // `commit` is deliberately ignored, as on a real call: it only signals which event applies.
  const next = counted(answer(decision.session, ws, now, decision.chosen).session);

  if (session.step === SUMMARY_STEP && decision.chosen.value === "confirm_save") {
    const contract = checkContract(next.draft);
    if (!("event" in contract)) return closing({ ...next, done: true }, "save_failed", FAILED[locale], { kind: "would_reject", reason: contract.field });
    if (!eventAllowed({ party: "worker" }, contract.event)) return closing({ ...next, done: true }, "not_saved", ENDED[locale], { kind: "would_reject", reason: "not_allowed" });
    const { result } = voiceStep(ws, now, contract.event);
    if (result.status === "rejected") return closing({ ...next, done: true }, "not_saved", ENDED[locale], { kind: "would_reject", reason: result.reason });
    return closing(next, "saved", SAVED[locale], { kind: "would_save" });
  }
  if (next.done) return closing(next, "ended_without_saving", spokenFrom(next, session.turns.length, ws, locale).join(" ") || ENDED[locale], { kind: inReview ? "declined" : "ended" });

  return reply(promptResult(next, ws, locale, "ok", undefined, decision.prefix, undefined, false, spokenFrom(next, session.turns.length, ws, locale)), next, null);
}
