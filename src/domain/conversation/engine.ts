/**
 * Public facade for the deterministic Call Lab conversation engine.
 * Scenario transitions live in focused family modules; callers keep this API.
 */
import { startReportCallScenario, startWorkerInbound, answerReportScenario, hangUpReportCall } from "./report-call";
import { startOwnerNotification, handleOwnerNotification } from "./owner-briefing";
import { startWorkerCallback, handleWorkerCallback } from "./worker-callback";
import { startWorkerOutbound, handleWorkerOutbound, hangUpWorkerOutbound } from "./worker-outbound";
import { startOwnerInquiry, handleOwnerInquiry } from "./owner-inquiry";
import { startEmergency } from "./emergency";
import { copy, say } from "./shared";
import type { AnswerInput, CallSession, EngineResult, Scenario } from "./shared";
import type { Workspace } from "../types";

export type {
  Scenario,
  InputMode,
  Turn,
  Reply,
  CallSession,
  EngineResult,
  AnswerInput,
  ReportCallAvailability,
  ScenarioAvailability,
} from "./shared";
export { isReportScenario } from "./shared";
export { scenarioAvailability } from "./availability";

export function start(
  ws: Workspace,
  now: Date,
  scenario: Scenario = "report_call",
  options: { reportId?: string; reportCallId?: string } = {},
): EngineResult {
  switch (scenario) {
    case "report_call":
      return startReportCallScenario(ws, now, options.reportCallId);
    case "worker_inbound":
      return startWorkerInbound(ws, now);
    case "worker_callback":
      return startWorkerCallback(ws, now);
    case "owner_notification":
      return startOwnerNotification(ws, now, options.reportId);
    case "worker_outbound":
      return startWorkerOutbound(ws, now);
    case "owner_inquiry":
      return startOwnerInquiry(ws, now);
    case "emergency":
      return startEmergency(ws, now);
  }
}

export function answer(session: CallSession, ws: Workspace, now: Date, input: AnswerInput): EngineResult {
  if (session.done) return { session };
  switch (session.scenario) {
    case "report_call":
    case "worker_inbound":
      return answerReportScenario(session, ws, now, input);
    case "owner_notification":
      return handleOwnerNotification(session, ws, now, input);
    case "worker_outbound":
      return handleWorkerOutbound(session, ws, now, input);
    case "worker_callback":
      return handleWorkerCallback(session, ws, now, input);
    case "owner_inquiry":
      return handleOwnerInquiry(session, ws, now, input);
    case "emergency":
      return { session };
  }
}

/** End an active call while retaining only state already committed by answered steps. */
export function hangUp(session: CallSession, ws: Workspace, now: Date): EngineResult {
  if (session.done) return { session };
  const ended = say(session, copy("This call has ended.", "انتهى الاتصال."), now, true);
  if (session.scenario === "report_call") return { session: ended, ...hangUpReportCall(session, ws, now) };
  if (session.scenario === "worker_outbound") return hangUpWorkerOutbound(session, ws, ended);
  return { session: ended };
}
