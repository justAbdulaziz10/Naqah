/**
 * Data contract between the telephony layer (Twilio + voice model) and the farm.
 *
 * The voice layer sends one event per outcome. It never sends a farm id or a timestamp: the
 * server resolves the farm from the caller and uses its own clock, so neither can be forged by
 * a model or a replayed webhook. See docs/integrations/voice-data-contract.md.
 */
import { completeWorkerCallback, completeWorkerReport, confirmTask, recordOwnerInquiry, recordOwnerNotification, rejectOwnerInquiry, rejectWorkerReport, resolveWorkerCallAttempt, startTaskVerification, submitOwnerInstruction, submitOwnerInstructionBatch, type AttemptOutcome, type InstructionInput, type RejectReason } from "@/domain/actions";
import type { ReportDraft } from "@/domain/findings";
import { dueTaskVerifications, routeOwnerInboundCall, routeWorkerInboundCall } from "@/domain/rules";
import { uid } from "@/domain/id";
import { heatWaterFinding } from "@/domain/weather";
import type { CallKind, Certainty, Level, ReportAnswer, ResourceKind, Workspace } from "@/domain/types";
import { RESOURCE_KINDS } from "@/domain/catalog";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DbError } from "@/server/db/errors";
import { isUuid } from "@/server/db/ids";
import { runFarmAction } from "@/server/db/service-repository";
import { oneOf, record, requiredText, text } from "@/server/farm/input";

export const VOICE_CONTRACT_VERSION = 1;

/** `eventId` is unique per outcome and repeats on a retry; one call can carry several events. */
export type VoiceEvent = { version: 1; eventId: string; providerCallId: string } & (
  | { type: "worker_report"; draft: ReportDraft; refusedAtStart?: true }
  | { type: "worker_callback" }
  | { type: "owner_notification"; reportId: string; answered: boolean }
  | { type: "owner_inquiry" }
  | {
      type: "owner_instruction";
      message: string;
      actionable: boolean;
      scheduledFor: string | null;
      /** Present when the owner approved more than one instruction in the same call. */
      items?: InstructionInput[];
      /** What the worker hears. Defaults to the original instruction text. */
      deliveryMessage?: string;
    }
  | { type: "task_verification_start"; taskId: string }
  | { type: "worker_call_attempt"; pendingCallId: string; answered: boolean }
  | { type: "task_confirmation"; taskId: string; done: boolean; via: "worker_report" | "worker_task_verification" | "worker_callback" }
);

/**
 * Who this call is with, set by the server from the verified call, never by the event.
 * `system` is the scheduler and Twilio status callbacks.
 */
export type VoiceContext =
  | { party: "worker" }
  | { party: "owner"; call: "notification" | "inquiry" }
  | { party: "system" };

export type VoiceOutcome =
  | { status: "saved" | "unchanged"; detail?: AttemptOutcome }
  | { status: "rejected"; reason: RejectReason | "allowance_used" | "callback_required" | "not_allowed" };

const LEVELS: readonly Level[] = ["good", "medium", "low", "critical", "unknown"];
const CERTAINTIES: readonly Certainty[] = ["reported", "approximate", "unknown", "verified"];
const HEALTH = ["healthy", "watch", "sick", "unknown"] as const;
const CONFIRMING_CALLS = ["worker_report", "worker_task_verification", "worker_callback"] as const;
const MAX_ITEMS = 200;
// "All healthy" sends one update per camel, so this follows the herd, not a call's length.
const MAX_HERD = 5_000;
// A task question quotes the instruction, and a herd answer joins every camel's note.
const MAX_QUESTION = 1_200;
const MAX_ANSWER = 20_000;

function invalid(field: string) {
  return new DbError("invalid_input", field);
}

function list(value: unknown, field: string, max = MAX_ITEMS): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid(field);
  return value;
}

function bool(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw invalid(field);
  return value;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !isUuid(value)) throw invalid(field);
  return value;
}

function optional(value: unknown, field: string): string | null {
  return value === null || value === undefined ? null : text(value, field, 500) || null;
}

function localized(value: unknown, field: string, max = 500) {
  const input = record(value);
  return { ar: requiredText(input.ar, field, max), en: requiredText(input.en, field, max) };
}

function instructionItem(value: unknown): InstructionInput {
  const input = record(value);
  const scheduledFor = input.scheduledFor ?? null;
  if (scheduledFor !== null && (typeof scheduledFor !== "string" || Number.isNaN(Date.parse(scheduledFor)))) throw invalid("scheduledFor");
  return {
    message: requiredText(input.message, "message", 1000),
    actionable: bool(input.actionable, "actionable"),
    scheduledFor: scheduledFor as string | null,
  };
}

function answer(value: unknown): ReportAnswer {
  const input = record(value);
  return {
    questionId: requiredText(input.questionId, "questionId", 100),
    question: localized(input.question, "question", MAX_QUESTION),
    answer: text(input.answer, "answer", MAX_ANSWER),
    ...(input.answerText ? { answerText: localized(input.answerText, "answerText", MAX_ANSWER) } : {}),
    certainty: oneOf(input.certainty, CERTAINTIES, "certainty"),
    followUp: input.followUp === true,
  };
}

function draft(value: unknown): ReportDraft {
  const input = record(value);
  const herd = input.herdAccountedFor ?? null;
  if (herd !== null && typeof herd !== "boolean") throw invalid("herdAccountedFor");
  return {
    answers: list(input.answers, "answers").map(answer),
    camelUpdates: list(input.camelUpdates ?? [], "camelUpdates", MAX_HERD).map((item) => {
      const camel = record(item);
      return {
        camelId: uuid(camel.camelId, "camelId"),
        health: oneOf(camel.health, HEALTH, "health"),
        note: optional(camel.note, "note"),
        certainty: oneOf(camel.certainty, CERTAINTIES, "certainty"),
      };
    }),
    resourceUpdates: list(input.resourceUpdates ?? [], "resourceUpdates").map((item) => {
      const resource = record(item);
      return {
        kind: oneOf<ResourceKind>(resource.kind, RESOURCE_KINDS, "kind"),
        level: oneOf(resource.level, LEVELS, "level"),
        quantity: optional(resource.quantity, "quantity"),
        note: optional(resource.note, "note"),
        certainty: oneOf(resource.certainty, CERTAINTIES, "certainty"),
      };
    }),
    herdAccountedFor: herd as boolean | null,
    taskConfirmations: list(input.taskConfirmations ?? [], "taskConfirmations").map((item) => {
      const task = record(item);
      return { taskId: uuid(task.taskId, "taskId"), done: bool(task.done, "done") };
    }),
    // A flag, not a finding: the wording of what reaches the owner stays in the domain.
    ...(input.heatWaterNeeded === true ? { extraFindings: [heatWaterFinding(uid("fnd"))] } : {}),
  };
}

/** Validates an untrusted event. Model output reaches the farm only through this function. */
export function parseVoiceEvent(value: unknown): VoiceEvent {
  const input = record(value);
  if (input.version !== VOICE_CONTRACT_VERSION) throw invalid("version");
  const base = {
    version: 1 as const,
    eventId: requiredText(input.eventId, "eventId", 128),
    providerCallId: requiredText(input.providerCallId, "providerCallId", 64),
  };
  switch (input.type) {
    case "worker_report":
      return { ...base, type: "worker_report", draft: draft(input.draft), ...(input.refusedAtStart === true ? { refusedAtStart: true as const } : {}) };
    case "worker_callback":
      return { ...base, type: "worker_callback" };
    case "owner_notification":
      return { ...base, type: "owner_notification", reportId: uuid(input.reportId, "reportId"), answered: bool(input.answered, "answered") };
    case "owner_inquiry":
      return { ...base, type: "owner_inquiry" };
    case "owner_instruction": {
      const scheduledFor = input.scheduledFor ?? null;
      if (scheduledFor !== null && (typeof scheduledFor !== "string" || Number.isNaN(Date.parse(scheduledFor)))) throw invalid("scheduledFor");
      const items = input.items === undefined ? undefined : list(input.items, "items", 20).map(instructionItem);
      return {
        ...base,
        type: "owner_instruction",
        message: requiredText(input.message, "message", 4000),
        actionable: bool(input.actionable, "actionable"),
        scheduledFor: scheduledFor as string | null,
        ...(items ? { items } : {}),
        ...(input.deliveryMessage === undefined ? {} : { deliveryMessage: requiredText(input.deliveryMessage, "deliveryMessage", 4000) }),
      };
    }
    case "task_verification_start":
      return { ...base, type: "task_verification_start", taskId: uuid(input.taskId, "taskId") };
    case "worker_call_attempt":
      return { ...base, type: "worker_call_attempt", pendingCallId: uuid(input.pendingCallId, "pendingCallId"), answered: bool(input.answered, "answered") };
    case "task_confirmation":
      return {
        ...base,
        type: "task_confirmation",
        taskId: uuid(input.taskId, "taskId"),
        done: bool(input.done, "done"),
        via: oneOf(input.via, CONFIRMING_CALLS, "via"),
      };
    default:
      throw invalid("type");
  }
}

/**
 * Scheduled tasks to start a verification call for. `dueTaskVerifications` keeps a task eligible
 * after a finished call, which the Call Lab relies on; a scheduler must not ring the worker on
 * every run, so it starts one per task. Later checks happen during the worker's own calls.
 * OPEN DECISION: whether and how often an unconfirmed task is called about again.
 */
export function tasksToVerify(ws: Workspace, now: Date) {
  const started = new Set(ws.pendingWorkerCalls.filter((c) => c.purpose === "task_verification").map((c) => c.taskTicketId));
  return dueTaskVerifications(ws, now).filter((task) => !started.has(task.id));
}

/**
 * Closing a task is the worker's alone, and an instruction belongs to the post-update call.
 * OPEN DECISION 6: instructions during owner-initiated inquiries are refused for now.
 */
export function eventAllowed(context: VoiceContext, event: VoiceEvent): boolean {
  switch (event.type) {
    case "worker_report":
    case "worker_callback":
    case "task_confirmation":
      return context.party === "worker";
    case "owner_inquiry":
      return context.party === "owner" && context.call === "inquiry";
    case "owner_instruction":
      return context.party === "owner" && context.call === "notification";
    case "owner_notification":
    case "task_verification_start":
    case "worker_call_attempt":
      return context.party === "system";
  }
}

type Step = { ws: Workspace; result: VoiceOutcome };

/** Every decision is the domain's. This only picks the action and states the outcome. */
export function voiceStep(ws: Workspace, now: Date, event: VoiceEvent): Step {
  const saved: VoiceOutcome = { status: "saved" };
  switch (event.type) {
    case "worker_report": {
      const route = routeWorkerInboundCall(ws, now);
      if (route.kind === "callback") return { ws, result: { status: "rejected", reason: "callback_required" } };
      if (route.kind === "rejected") {
        return { ws: rejectWorkerReport(ws, now, route.reason), result: { status: "rejected", reason: route.reason } };
      }
      // The call was refused before any question: never turn that into an empty report.
      if (event.refusedAtStart) return { ws, result: { status: "rejected", reason: "not_allowed" } };
      return { ws: completeWorkerReport(ws, now, event.draft).ws, result: saved };
    }
    case "worker_callback":
      if (routeWorkerInboundCall(ws, now).kind !== "callback") return { ws, result: saved };
      return { ws: completeWorkerCallback(ws, now), result: saved };
    case "owner_notification":
      return { ws: recordOwnerNotification(ws, now, event.reportId, event.answered), result: saved };
    case "owner_inquiry": {
      const route = routeOwnerInboundCall(ws, now);
      if (route.kind === "rejected") {
        return { ws: rejectOwnerInquiry(ws, now), result: { status: "rejected", reason: route.reason } };
      }
      return { ws: recordOwnerInquiry(ws, now, route.mode), result: saved };
    }
    case "owner_instruction": {
      if (event.items?.length) {
        const batch = submitOwnerInstructionBatch(ws, now, event.items, event.eventId, event.deliveryMessage ?? event.message);
        return { ws: batch.ws, result: batch.created ? saved : { status: "unchanged" } };
      }
      return { ws: submitOwnerInstruction(ws, now, event).ws, result: saved };
    }
    case "task_verification_start":
      if (!tasksToVerify(ws, now).some((task) => task.id === event.taskId)) return { ws, result: saved };
      return { ws: startTaskVerification(ws, now, event.taskId).ws, result: saved };
    case "worker_call_attempt": {
      const attempt = resolveWorkerCallAttempt(ws, now, event.pendingCallId, event.answered);
      return { ws: attempt.ws, result: { status: "saved", detail: attempt.outcome } };
    }
    case "task_confirmation":
      return { ws: confirmTask(ws, now, event.taskId, event.done, event.via as CallKind), result: saved };
  }
}

/** The agent may say "saved" only after this returns a saved status. */
export async function applyVoiceEvent(
  client: SupabaseClient,
  farmId: string,
  context: VoiceContext,
  event: VoiceEvent,
  now: Date,
): Promise<VoiceOutcome> {
  if (!eventAllowed(context, event)) return { status: "rejected", reason: "not_allowed" };
  const { result } = await runFarmAction<VoiceOutcome>(
    client,
    farmId,
    (ws) => {
      const step = voiceStep(ws, now, event);
      const same = JSON.stringify(step.ws) === JSON.stringify(ws);
      return { ws: step.ws, result: same && step.result.status === "saved" ? { status: "unchanged" } : step.result };
    },
    { eventId: event.eventId, providerCallId: event.providerCallId },
  );
  return result;
}
