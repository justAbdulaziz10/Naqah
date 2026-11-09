import { RESOURCE_KINDS } from "@/domain/catalog";
import type { CallSchedule, Integrations, QuestionPlanEntry, ReportCallRun, ReportMode, ReportingWindow, Weekday, Worker, Workspace } from "@/domain/types";
import { toDbId } from "./ids";
import type {
  CallRow, FarmRows, FindingRow, ReportAnswerRow, ReportCallRunRow, ReportRow, WorkerCallAttemptRow, WorkerRow,
} from "./rows";

const byTime = <T>(rows: T[], time: (row: T) => string) =>
  [...rows].sort((a, b) => new Date(time(a)).getTime() - new Date(time(b)).getTime());

const hhmm = (value: string | null) => value?.slice(0, 5) ?? "";

function windowFrom(row: FarmRows["farm"]): ReportingWindow | null {
  if (row.window_day === null) return null;
  return { day: row.window_day as Weekday, start: hhmm(row.window_start), end: hhmm(row.window_end) };
}

function callScheduleFrom(row: FarmRows["farm"]): CallSchedule | null {
  if (row.call_day === null && row.call_time === null) return null;
  return { day: row.call_day === null ? null : (row.call_day as Weekday), time: hhmm(row.call_time) };
}

const workerFrom = (row: WorkerRow): Worker => ({ id: row.id, name: row.name, phone: row.phone, language: row.language });

/** The primary worker is the one NAQAH calls: the farm's choice, or the oldest when none is set. */
function workersFrom(rows: FarmRows): { worker: Worker; otherWorkers: Worker[] } {
  const primary = rows.workers.find((w) => w.id === rows.farm.primary_worker_id) ?? rows.workers[0];
  return {
    worker: primary ? workerFrom(primary) : { name: "", phone: "", language: "ar" },
    otherWorkers: rows.workers.filter((w) => w !== primary).map(workerFrom),
  };
}

function integrationsFrom(row: FarmRows["farm"]): Integrations | undefined {
  if (!row.supplier_name && !row.supplier_phone) return undefined;
  return { supplierName: row.supplier_name, supplierPhone: row.supplier_phone };
}

const REPORT_MODES: readonly ReportMode[] = ["worker_choice", "guided", "open"];

/** Owners can write this column directly, so anything malformed is dropped. Missing until migrated: today's call. */
function questionPlanFrom(value: unknown): QuestionPlanEntry[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const entry = item as Partial<QuestionPlanEntry> | null;
    if (typeof entry?.id !== "string" || typeof entry.enabled !== "boolean" || typeof entry.required !== "boolean") return [];
    return [{ id: entry.id, enabled: entry.enabled, required: entry.required }];
  });
}

/** Rows → the document every domain function works on. */
export function workspaceFromRows(rows: FarmRows): Workspace {
  const { farm } = rows;
  return {
    version: 1,
    setupComplete: farm.setup_complete,
    createdAt: farm.created_at,
    settings: {
      plan: farm.plan,
      owner: { name: farm.owner_name, phone: farm.owner_phone },
      farm: {
        name: farm.name,
        location: farm.location,
        coords: farm.latitude === null || farm.longitude === null ? null : { lat: farm.latitude, lon: farm.longitude },
      },
      ...workersFrom(rows),
      herdCount: farm.herd_count,
      herdCountReviewedAt: farm.herd_count_reviewed_at,
      customQuestions: [...rows.customQuestions]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((q) => ({ id: q.id, text: q.text, createdAt: q.created_at })),
      reportMode: REPORT_MODES.includes(farm.report_mode as ReportMode) ? (farm.report_mode as ReportMode) : "guided",
      questionPlan: questionPlanFrom(farm.question_plan),
      criteria: rows.criteria.map((c) => ({ id: c.id, kind: c.kind, label: c.label, enabled: c.enabled })),
      emergencies: rows.emergencies.map((e) => ({ id: e.id, kind: e.kind, label: e.label })),
      window: windowFrom(farm),
      callSchedule: callScheduleFrom(farm),
      integrations: integrationsFrom(farm),
    },
    camels: rows.camels.map((c) => ({
      id: c.id,
      name: c.name,
      tag: c.tag,
      sex: c.sex,
      ageYears: c.age_years,
      health: c.health,
      healthNote: c.health_note,
      certainty: c.certainty,
      updatedAt: c.updated_at,
    })),
    resources: [...rows.resources]
      .sort((a, b) => RESOURCE_KINDS.indexOf(a.kind) - RESOURCE_KINDS.indexOf(b.kind))
      .map((r) => ({
        kind: r.kind,
        present: r.present,
        level: r.level,
        quantity: r.quantity,
        note: r.note,
        certainty: r.certainty,
        updatedAt: r.updated_at,
      })),
    lastUpdateAt: farm.last_update_at,
    reports: byTime(rows.reports, (r) => r.at).map((r) => ({
      id: r.id,
      at: r.at,
      callId: r.call_id ?? "",
      ...(r.mode ? { mode: r.mode } : {}),
      ...(r.coverage?.length ? { coverage: r.coverage } : {}),
      ...(r.herd_count_reported !== null && r.herd_count_reported !== undefined && { herdCountReported: r.herd_count_reported }),
      answers: [...r.report_answers]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((a) => ({
          questionId: a.question_id,
          question: { ar: a.question_ar, en: a.question_en },
          answer: a.answer,
          ...(a.answer_ar !== null && a.answer_en !== null ? { answerText: { ar: a.answer_ar, en: a.answer_en } } : {}),
          certainty: a.certainty,
          followUp: a.follow_up,
        })),
      findings: r.findings.map((f) => ({
        id: f.id,
        criterionId: f.criterion_id ?? f.source ?? "",
        text: { ar: f.text_ar, en: f.text_en },
      })),
    })),
    calls: byTime(rows.calls, (c) => c.at).map((c) => ({
      id: c.id,
      kind: c.kind,
      direction: c.direction,
      party: c.party,
      at: c.at,
      outcome: c.outcome,
      attempt: c.attempt,
      summary: { ar: c.summary_ar, en: c.summary_en },
      ticketId: c.task_ticket_id ?? c.no_answer_ticket_id,
      reportId: c.report_id,
    })),
    taskTickets: byTime(rows.taskTickets, (t) => t.created_at).map((t) => ({
      id: t.id,
      instruction: t.instruction,
      createdAt: t.created_at,
      scheduledFor: t.scheduled_for,
      status: t.status,
      closedAt: t.closed_at,
      closedVia: t.closed_via,
    })),
    noAnswerTickets: byTime(rows.noAnswerTickets, (t) => t.created_at).map((t) => ({
      id: t.id,
      createdAt: t.created_at,
      purpose: t.purpose,
      message: t.message,
      taskTicketId: t.task_ticket_id,
      status: t.status,
      closedAt: t.closed_at,
    })),
    pendingWorkerCalls: rows.pendingWorkerCalls.map((p) => ({
      id: p.id,
      purpose: p.purpose,
      message: p.message,
      taskTicketId: p.task_ticket_id,
      ...(p.batch_id ? { batchId: p.batch_id } : {}),
      ...(p.task_links_explicit ? { coveredTaskIds: (p.pending_worker_call_tasks ?? [])
        .filter((link) => link.covered_order !== null)
        .sort((a, b) => a.covered_order! - b.covered_order!)
        .map((link) => link.task_ticket_id) } : {}),
      relayId: p.relay_id,
      attempts: byTime(p.worker_call_attempts, (a) => a.at).map((a) => ({ at: a.at, answered: a.answered })),
      nextAttemptAt: p.next_attempt_at,
      state: p.state,
    })),
    reportCalls: byTime(rows.reportCallRuns, (r) => r.occurrence).map((r): ReportCallRun => ({
      id: r.id,
      // Postgres writes "+00:00"; the domain matches slots by their exact ISO string.
      occurrence: new Date(r.occurrence).toISOString(),
      trigger: r.trigger,
      attempts: r.attempts.map((a) => ({ at: a.at, result: a.result })),
      nextAttemptAt: r.next_attempt_at,
      state: r.state,
      reportId: r.report_id,
    })),
    relays: byTime(rows.relays, (r) => r.at).map((r) => ({ id: r.id, at: r.at, message: r.message, delivered: r.delivered })),
    events: byTime(rows.events, (e) => e.at).map((e) => ({
      id: e.id,
      at: e.at,
      tone: e.tone,
      text: { ar: e.text_ar, en: e.text_en },
    })),
    // Demo-only: production always runs on real time.
    clockOffsetMs: 0,
    ownerAllowanceUsedAt: farm.owner_allowance_used_at,
    missedNotificationAt: farm.missed_notification_at,
  };
}

/** The farm's history and live state as rows. Also the basis for importing a saved workspace. */
export function historyRows(ws: Workspace, farmId: string) {
  const id = (value: string) => toDbId(farmId, value);
  const optional = (value: string | null) => (value ? id(value) : null);
  const taskIds = new Set(ws.taskTickets.map((t) => t.id));
  const noAnswerIds = new Set(ws.noAnswerTickets.map((t) => t.id));
  const criterionIds = new Set(ws.settings.criteria.map((c) => c.id));

  const reports: ReportRow[] = ws.reports.map((r) => ({
    id: id(r.id), farm_id: farmId, call_id: optional(r.callId), at: r.at, herd_count_reported: r.herdCountReported ?? null,
    ...(r.mode !== undefined ? { mode: r.mode } : {}),
    ...(r.coverage !== undefined ? { coverage: r.coverage } : {}),
  }));
  const reportCallRuns: ReportCallRunRow[] = (ws.reportCalls ?? []).map((r) => ({
    id: id(r.id),
    farm_id: farmId,
    occurrence: new Date(r.occurrence).toISOString(),
    trigger: r.trigger,
    attempts: r.attempts.map((a) => ({ at: a.at, result: a.result })),
    next_attempt_at: r.nextAttemptAt,
    state: r.state,
    report_id: optional(r.reportId),
    provider_call_id: null,
  }));
  const reportAnswers: ReportAnswerRow[] = ws.reports.flatMap((r) =>
    r.answers.map((a, index) => ({
      report_id: id(r.id),
      question_id: a.questionId,
      question_ar: a.question.ar,
      question_en: a.question.en,
      answer: a.answer,
      answer_ar: a.answerText?.ar ?? null,
      answer_en: a.answerText?.en ?? null,
      certainty: a.certainty,
      follow_up: a.followUp,
      sort_order: index,
    })),
  );
  const findings: FindingRow[] = ws.reports.flatMap((r) =>
    r.findings.map((f) => ({
      id: id(f.id),
      report_id: id(r.id),
      criterion_id: criterionIds.has(f.criterionId) ? id(f.criterionId) : null,
      source: criterionIds.has(f.criterionId) ? null : f.criterionId || null,
      text_ar: f.text.ar,
      text_en: f.text.en,
    })),
  );
  const calls: CallRow[] = ws.calls.map((c) => ({
    id: id(c.id),
    farm_id: farmId,
    kind: c.kind,
    direction: c.direction,
    party: c.party,
    at: c.at,
    outcome: c.outcome,
    attempt: c.attempt,
    summary_ar: c.summary.ar,
    summary_en: c.summary.en,
    provider_call_id: null,
    task_ticket_id: c.ticketId && taskIds.has(c.ticketId) ? id(c.ticketId) : null,
    report_id: optional(c.reportId),
    no_answer_ticket_id: c.ticketId && noAnswerIds.has(c.ticketId) ? id(c.ticketId) : null,
  }));
  const attempts = (pendingId: string, list: { at: string; answered: boolean }[]): WorkerCallAttemptRow[] =>
    list.map((a) => ({ pending_call_id: id(pendingId), at: a.at, answered: a.answered }));

  return {
    reports,
    reportCallRuns,
    reportAnswers,
    findings,
    calls,
    taskTickets: ws.taskTickets.map((t) => ({
      id: id(t.id),
      farm_id: farmId,
      instruction: t.instruction,
      created_at: t.createdAt,
      scheduled_for: t.scheduledFor,
      status: t.status,
      closed_at: t.closedAt,
      closed_via: t.closedVia,
    })),
    noAnswerTickets: ws.noAnswerTickets.map((t) => ({
      id: id(t.id),
      farm_id: farmId,
      created_at: t.createdAt,
      purpose: t.purpose,
      message: t.message,
      task_ticket_id: optional(t.taskTicketId),
      status: t.status,
      closed_at: t.closedAt,
    })),
    pendingWorkerCalls: ws.pendingWorkerCalls.map((p) => ({
      id: id(p.id),
      farm_id: farmId,
      purpose: p.purpose,
      message: p.message,
      task_ticket_id: optional(p.taskTicketId),
      ...(p.batchId === undefined ? {} : { batch_id: p.batchId }),
      ...(p.coveredTaskIds === undefined ? {} : { covered_task_ids: [...new Set(p.coveredTaskIds.map(id))] }),
      relay_id: optional(p.relayId),
      next_attempt_at: p.nextAttemptAt,
      state: p.state,
    })),
    attempts,
    relays: ws.relays.map((r) => ({ id: id(r.id), farm_id: farmId, at: r.at, message: r.message, delivered: r.delivered })),
    events: ws.events.map((e) => ({ id: id(e.id), farm_id: farmId, at: e.at, tone: e.tone, text_ar: e.text.ar, text_en: e.text.en })),
    camels: ws.camels.map((c) => ({
      id: id(c.id),
      health: c.health,
      health_note: c.healthNote,
      certainty: c.certainty,
      updated_at: c.updatedAt,
    })),
    resources: ws.resources.map((r) => ({
      kind: r.kind,
      level: r.level,
      quantity: r.quantity,
      note: r.note,
      certainty: r.certainty,
      updated_at: r.updatedAt,
    })),
  };
}
