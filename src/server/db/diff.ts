import type { Workspace } from "@/domain/types";
import { DbError } from "./errors";
import { toDbId as toDbIdFor } from "./ids";
import { historyRows } from "./mappers";

export interface FarmChanges {
  task_tickets?: unknown[];
  relays?: unknown[];
  no_answer_tickets?: unknown[];
  pending_worker_calls?: unknown[];
  worker_call_attempts?: unknown[];
  reports?: unknown[];
  report_call_runs?: unknown[];
  calls?: unknown[];
  report_answers?: unknown[];
  findings?: unknown[];
  events?: unknown[];
  camels?: unknown[];
  resources?: unknown[];
  farm?: Record<string, string | null>;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function changed<T>(before: T[], after: T[], key: (row: T) => string): T[] {
  const known = new Map(before.map((row) => [key(row), row]));
  return after.filter((row) => !same(known.get(key(row)), row));
}

function added<T>(before: T[], after: T[], key: (row: T) => string): T[] {
  const known = new Set(before.map(key));
  return after.filter((row) => !known.has(key(row)));
}

/**
 * What a domain action changed, in the shape apply_farm_changes takes. Never deletes: the
 * domain trims its event list, but history stays in the database. Settings are the owner's
 * and are written through the owner repository, so an action changing them is a bug.
 */
export function diffWorkspace(
  before: Workspace,
  after: Workspace,
  farmId: string,
  options: { providerCallId?: string; reportCallProviderIds?: Record<string, string> } = {},
): FarmChanges {
  if (!same(before.settings, after.settings)) throw new DbError("invalid_input", "actions must not change settings");
  if (!same(before.camels.map((c) => c.id), after.camels.map((c) => c.id))) {
    throw new DbError("invalid_input", "actions must not add or remove camels");
  }

  const b = historyRows(before, farmId);
  const a = historyRows(after, farmId);
  const id = (row: { id: string }) => row.id;
  const newReports = added(b.reports, a.reports, id);
  const newReportIds = new Set(newReports.map(id));
  const knownCalls = new Set(b.calls.map(id));

  const attempts = after.pendingWorkerCalls.flatMap((call) => {
    const seen = before.pendingWorkerCalls.find((p) => p.id === call.id)?.attempts.length ?? 0;
    return a.attempts(call.id, call.attempts.slice(seen));
  });

  const providerIds = new Map(
    Object.entries(options.reportCallProviderIds ?? {}).map(([runId, sid]) => [toDbIdFor(farmId, runId), sid]),
  );

  const farm: Record<string, string | null> = {};
  if (before.lastUpdateAt !== after.lastUpdateAt) farm.last_update_at = after.lastUpdateAt;
  if (before.ownerAllowanceUsedAt !== after.ownerAllowanceUsedAt) farm.owner_allowance_used_at = after.ownerAllowanceUsedAt;
  if (before.missedNotificationAt !== after.missedNotificationAt) farm.missed_notification_at = after.missedNotificationAt;
  if (!same(before.ownerSummary ?? null, after.ownerSummary ?? null)) {
    farm.owner_summary_report_id = after.ownerSummary ? toDbIdFor(farmId, after.ownerSummary.reportId) : null;
    farm.owner_summary_not_before = after.ownerSummary?.notBefore ?? null;
  }

  const changes: FarmChanges = {
    task_tickets: changed(b.taskTickets, a.taskTickets, id),
    relays: changed(b.relays, a.relays, id),
    no_answer_tickets: changed(b.noAnswerTickets, a.noAnswerTickets, id),
    pending_worker_calls: changed(b.pendingWorkerCalls, a.pendingWorkerCalls, id),
    worker_call_attempts: attempts,
    reports: newReports,
    // A placed attempt records its provider call id; otherwise the database keeps the one it has.
    report_call_runs: changed(b.reportCallRuns, a.reportCallRuns, id).map((run) => ({
      ...run,
      provider_call_id: providerIds.get(run.id) ?? null,
    })),
    calls: changed(b.calls, a.calls, id).map((call) =>
      knownCalls.has(call.id) ? call : { ...call, provider_call_id: options.providerCallId ?? null },
    ),
    report_answers: a.reportAnswers.filter((row) => newReportIds.has(row.report_id)),
    findings: a.findings.filter((row) => newReportIds.has(row.report_id)),
    events: added(b.events, a.events, id),
    camels: changed(b.camels, a.camels, id),
    resources: changed(b.resources, a.resources, (row) => row.kind),
  };
  if (Object.keys(farm).length) changes.farm = farm;
  return changes;
}

export const hasChanges = (changes: FarmChanges) =>
  Object.values(changes).some((value) => (Array.isArray(value) ? value.length > 0 : Boolean(value)));

