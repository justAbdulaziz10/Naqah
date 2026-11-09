import { activeReportCall, dueScheduledReportCall, reportCallBlock } from "../reportCalls";
import { nextScheduledCall } from "../schedule";
import { dueTaskVerifications, dueWorkerCalls, routeOwnerInboundCall, routeWorkerInboundCall } from "../rules";
import type { Workspace } from "../types";

import type { ScenarioAvailability } from './shared';

export function scenarioAvailability(ws: Workspace, now: Date): ScenarioAvailability {
  return {
    reportCall: {
      block: reportCallBlock(ws, now),
      active: activeReportCall(ws),
      due: dueScheduledReportCall(ws, now),
      next: nextScheduledCall(now, ws.settings.plan, ws.settings.callSchedule),
    },
    workerInbound: routeWorkerInboundCall(ws, now),
    ownerInquiry: routeOwnerInboundCall(ws, now),
    pendingWorkerCallCount: ws.pendingWorkerCalls.filter((call) => call.state === "pending").length,
    dueWorkerCallCount: dueWorkerCalls(ws, now).length,
    dueTaskVerificationCount: dueTaskVerifications(ws, now).length,
  };
}
