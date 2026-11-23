/**
 * Pure rules for the test-ranch call panel: when it is asked for, when it shows, which stage may open the
 * confirmation and which message explains a refusal. No React, so the guards run under the node test runner.
 */
import type { TestCallNotReadyReason, TestCallPanelState, TestCallStage, TestCallStageAvailability, TestCallStatus } from "@/server/calls/test-ranch-manual";

export const TEST_CALL_STAGES: readonly TestCallStage[] = ["report", "owner_summary", "worker_instruction", "worker_verification"];

const WORKER_STAGES: ReadonlySet<TestCallStage> = new Set(["report", "worker_instruction", "worker_verification"]);

/**
 * The panel is asked for only in account mode, and only until the server has said "no panel" once in this tab.
 * Outside test-ranch scope the server answers that from its environment alone (no session or database read), and the
 * answer cannot change without a new deployment, so every later Overview visit skips the request.
 */
export function shouldRequestTestCallsPanel(account: boolean, serverSaidNoPanel: boolean): boolean {
  return account && !serverSaidNoPanel;
}

export function shouldRenderTestCallsPanel(account: boolean, panel: TestCallPanelState | null): panel is TestCallPanelState {
  return account && panel?.visible === true;
}

export function stageStatus(availability: TestCallStageAvailability): TestCallStatus | "ready" {
  if (availability.status === "ready") return "ready";
  if (availability.status === "not_ready") return `not_ready:${availability.reason}`;
  return availability.status;
}

/** A stage's button opens the confirmation only when the server marked it ready, no call is live and none is sending. */
export function canOpenConfirmation(panel: TestCallPanelState, stage: TestCallStage, busy: TestCallStage | null): boolean {
  return panel.stages[stage].status === "ready" && !panel.callLive && busy === null;
}

/** Pressing a button never places a call: it only opens the confirmation for that stage, when allowed. */
export function pressStage(panel: TestCallPanelState, stage: TestCallStage, busy: TestCallStage | null): TestCallStage | null {
  return canOpenConfirmation(panel, stage, busy) ? stage : null;
}

/** The only stage that may be placed: the one the owner confirmed, once, while nothing else is sending. */
export function stageToPlace(confirming: TestCallStage | null, sending: boolean): TestCallStage | null {
  return sending ? null : confirming;
}

export type TestCallReasonKey =
  | "manualCallsOff" | "ownerCallsOff" | "notConfigured" | "ultimateRequired" | "noWorker" | "reportAlreadyDone"
  | "noReportQuestions" | "noOwnerNumber" | "numberNotAllowlisted" | "workerNumberNotAllowlisted" | "noPendingInstruction"
  | "noOpenTicket" | "instructionNotDelivered" | "verificationAlreadyAsked" | "callNotPlaced";

const REASON_KEYS: Record<TestCallNotReadyReason, TestCallReasonKey> = {
  manual_calls_off: "manualCallsOff",
  owner_calls_off: "ownerCallsOff",
  not_configured: "notConfigured",
  ultimate_required: "ultimateRequired",
  no_worker: "noWorker",
  report_already_done: "reportAlreadyDone",
  no_report_questions: "noReportQuestions",
  no_owner_number: "noOwnerNumber",
  number_not_allowlisted: "numberNotAllowlisted",
  no_pending_instruction: "noPendingInstruction",
  no_open_ticket: "noOpenTicket",
  instruction_not_delivered: "instructionNotDelivered",
  verification_already_asked: "verificationAlreadyAsked",
  call_not_placed: "callNotPlaced",
};

/** The message for a refusal. A number outside the allowlist names whose number: the worker's on worker stages. */
export function reasonKey(stage: TestCallStage, reason: TestCallNotReadyReason): TestCallReasonKey {
  if (reason === "number_not_allowlisted" && WORKER_STAGES.has(stage)) return "workerNumberNotAllowlisted";
  return REASON_KEYS[reason] ?? "callNotPlaced";
}
